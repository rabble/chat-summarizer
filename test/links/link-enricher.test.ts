import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase, type GravediggerDatabase } from '../../src/db/database.js';
import {
  applyLinkMetadata,
  applyLinkFailure,
  extractPageMetadata,
  isPublicIpAddress,
  PermanentLinkError,
} from '../../src/links/link-enricher.js';
import { storeMessage } from '../../src/messages/message-store.js';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../support/temp-database.js';

describe('link enrichment', () => {
  let temporaryDatabase: TemporaryDatabase;
  let database: GravediggerDatabase;

  beforeEach(() => {
    temporaryDatabase = createTemporaryDatabase();
    database = openDatabase(temporaryDatabase.path);
  });

  afterEach(() => {
    database.close();
    temporaryDatabase.cleanup();
  });

  test('extracts readable title and description without trusting page markup', () => {
    expect(extractPageMetadata(`
      <html><head>
        <title>Example &amp; Tool</title>
        <meta name="description" content="A &quot;small&quot; agent router.">
      </head><body><script>ignore()</script><p>Fallback body text.</p></body></html>
    `)).toEqual({
      title: 'Example & Tool',
      summary: 'A "small" agent router.',
    });
  });

  test('rejects private, loopback, link-local, and documentation addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '169.254.169.254',
      '192.168.1.10',
      '::1',
      'fd00::1',
      'fe80::1',
      '2001:db8::1',
    ]) {
      expect(isPublicIpAddress(address), address).toBe(false);
    }
    expect(isPublicIpAddress('8.8.8.8')).toBe(true);
    expect(isPublicIpAddress('2606:4700:4700::1111')).toBe(true);
  });

  test('persists bounded metadata on the intended link row', () => {
    storeMessage(database, {
      externalId: 'm1',
      groupJid: '120@g.us',
      senderJid: 'alice@s.whatsapp.net',
      senderName: 'Alice',
      timestampMs: 1_000,
      messageType: 'conversation',
      text: 'https://example.test/tool',
      quotedExternalId: null,
      rawJson: '{}',
    }, 1_000);

    applyLinkMetadata(database, 1, {
      title: 'T'.repeat(600),
      summary: 'S'.repeat(5_000),
    }, 2_000);

    expect(database.prepare(
      `SELECT status, length(title) title_length, length(summary) summary_length,
              fetched_at
         FROM links WHERE id = 1`,
    ).get()).toEqual({
      status: 'fetched',
      title_length: 500,
      summary_length: 2_000,
      fetched_at: 2_000,
    });
  });

  test('finishes permanent failures but leaves transient failures retryable', () => {
    storeLinkMessage('permanent', 'https://example.test/permanent', 1_000);
    storeLinkMessage('transient', 'https://example.test/transient', 2_000);

    expect(applyLinkFailure(
      database,
      1,
      new PermanentLinkError('HTTP 404'),
      3_000,
    )).toBe('complete');
    expect(applyLinkFailure(
      database,
      2,
      new Error('timeout'),
      3_000,
    )).toBe('retry');
    expect(database.prepare(
      'SELECT id, status FROM links ORDER BY id',
    ).all()).toEqual([
      { id: 1, status: 'unreachable' },
      { id: 2, status: 'error' },
    ]);
  });

  function storeLinkMessage(
    externalId: string,
    url: string,
    timestampMs: number,
  ): void {
    storeMessage(database, {
      externalId,
      groupJid: '120@g.us',
      senderJid: `${externalId}@s.whatsapp.net`,
      senderName: externalId,
      timestampMs,
      messageType: 'conversation',
      text: url,
      quotedExternalId: null,
      rawJson: '{}',
    }, timestampMs);
  }
});
