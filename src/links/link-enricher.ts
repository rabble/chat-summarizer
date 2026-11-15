import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import type { GravediggerDatabase } from '../db/database.js';

export type LinkMetadata = {
  title: string | null;
  summary: string | null;
};

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export class PermanentLinkError extends Error {}

export async function enrichStoredLink(
  database: GravediggerDatabase,
  linkId: number,
  observedAt: number = Date.now(),
): Promise<void> {
  const row = database.prepare(
    'SELECT normalized_url FROM links WHERE id = ?',
  ).get(linkId) as { normalized_url: string | null } | undefined;
  if (row === undefined || row.normalized_url === null) {
    throw new Error(`Link ${linkId} does not exist or has no normalized URL`);
  }

  database.prepare(
    "UPDATE links SET status = 'fetching' WHERE id = ?",
  ).run(linkId);
  try {
    const metadata = await fetchLinkMetadata(row.normalized_url);
    applyLinkMetadata(database, linkId, metadata, observedAt);
  } catch (error) {
    if (applyLinkFailure(database, linkId, error, observedAt) === 'retry') {
      throw error;
    }
  }
}

export function applyLinkFailure(
  database: GravediggerDatabase,
  linkId: number,
  error: unknown,
  observedAt: number = Date.now(),
): 'complete' | 'retry' {
  const permanent = error instanceof PermanentLinkError;
  const result = database.prepare(
    `UPDATE links SET status = ?, fetched_at = ? WHERE id = ?`,
  ).run(permanent ? 'unreachable' : 'error', observedAt, linkId);
  if (result.changes !== 1) throw new Error(`Link ${linkId} does not exist`);
  return permanent ? 'complete' : 'retry';
}

export function applyLinkMetadata(
  database: GravediggerDatabase,
  linkId: number,
  metadata: LinkMetadata,
  observedAt: number = Date.now(),
): void {
  const result = database.prepare(
    `UPDATE links
        SET status = 'fetched', title = ?, summary = ?, fetched_at = ?
      WHERE id = ?`,
  ).run(
    metadata.title?.slice(0, 500) ?? null,
    metadata.summary?.slice(0, 2_000) ?? null,
    observedAt,
    linkId,
  );
  if (result.changes !== 1) throw new Error(`Link ${linkId} does not exist`);
}

export async function fetchLinkMetadata(urlText: string): Promise<LinkMetadata> {
  let current = new URL(urlText);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertSafePublicUrl(current);
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: {
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1',
        'user-agent': 'CommunityBrief/0.1 link-enricher',
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location === null) throw new PermanentLinkError('Link redirect had no location');
      if (redirects === MAX_REDIRECTS) throw new PermanentLinkError('Link exceeded redirect limit');
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) {
      const ErrorType = response.status >= 400 && response.status < 500 &&
        response.status !== 408 && response.status !== 429
        ? PermanentLinkError
        : Error;
      throw new ErrorType(`Link fetch failed with HTTP ${response.status}`);
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new PermanentLinkError('Link response exceeded size limit');
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.includes('text/html') &&
        !contentType.includes('application/xhtml+xml') &&
        !contentType.includes('text/plain')) {
      return {
        title: current.hostname,
        summary: contentType.length > 0 ? `Shared ${contentType.split(';')[0]} resource.` : 'Shared resource.',
      };
    }
    return extractPageMetadata(await readBoundedText(response));
  }
  throw new PermanentLinkError('Link redirect loop');
}

async function assertSafePublicUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PermanentLinkError('Only HTTP(S) links may be fetched');
  }
  if (url.username !== '' || url.password !== '') {
    throw new PermanentLinkError('Credential-bearing URLs may not be fetched');
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new PermanentLinkError('Local links may not be fetched');
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = isIP(hostname) === 0
      ? await lookup(hostname, { all: true, verbatim: true })
      : [{ address: hostname }];
  } catch {
    throw new PermanentLinkError('Link hostname could not be resolved');
  }
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new PermanentLinkError('Link resolved to a non-public address');
  }
}

export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split('.').map(Number);
    const [a, b] = octets;
    if (a === undefined || b === undefined) return false;
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0)
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    const mapped = normalized.match(/^(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
    if (mapped !== undefined) return isPublicIpAddress(mapped);
    return !(
      normalized === '::' || normalized === '::1' ||
      normalized.startsWith('fc') || normalized.startsWith('fd') ||
      /^fe[89ab]/u.test(normalized) || normalized.startsWith('ff') ||
      normalized.startsWith('2001:db8:')
    );
  }
  return false;
}

export function extractPageMetadata(html: string): LinkMetadata {
  const withoutScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ');
  const title = cleanText(withoutScripts.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1]);
  const descriptionTag = withoutScripts.match(
    /<meta\b(?=[^>]*\bname\s*=\s*["']description["'])(?=[^>]*\bcontent\s*=\s*["']([^"']*)["'])[^>]*>/iu,
  )?.[1] ?? withoutScripts.match(
    /<meta\b(?=[^>]*\bcontent\s*=\s*["']([^"']*)["'])(?=[^>]*\bname\s*=\s*["']description["'])[^>]*>/iu,
  )?.[1];
  const description = cleanText(descriptionTag);
  const body = cleanText(withoutScripts.replace(/<[^>]+>/gu, ' '));
  return {
    title,
    summary: description ?? body?.slice(0, 2_000) ?? null,
  };
}

async function readBoundedText(response: Response): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new PermanentLinkError('Link response exceeded size limit');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function cleanText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const cleaned = decodeEntities(value).replace(/\s+/gu, ' ').trim();
  return cleaned.length === 0 ? null : cleaned;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/giu, '&')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&nbsp;/giu, ' ');
}
