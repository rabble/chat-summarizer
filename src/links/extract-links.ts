export type ExtractedLink = {
  url: string;
  normalizedUrl: string;
};

export function extractLinks(text: string | null): ExtractedLink[] {
  if (text === null) return [];

  const links = new Map<string, ExtractedLink>();
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"']+/giu)) {
    const raw = match[0].replace(/[.,;:!?\]\[)}]+$/u, '');
    try {
      const parsed = new URL(raw);
      parsed.hash = '';
      const normalizedUrl = parsed.toString();
      links.set(normalizedUrl, { url: raw, normalizedUrl });
    } catch {
      // Malformed URLs remain ordinary message text.
    }
  }
  return [...links.values()];
}
