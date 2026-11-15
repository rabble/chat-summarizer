import type { GravediggerDatabase } from '../db/database.js';
import { extractLinks } from './extract-links.js';

export type LinkBackfillReport = {
  messagesScanned: number;
  linksInserted: number;
  jobsQueued: number;
};

type MessageRow = {
  id: number;
  sender_id: number;
  text: string | null;
};

export function backfillStoredLinks(
  database: GravediggerDatabase,
  observedAt: number = Date.now(),
): LinkBackfillReport {
  const rows = database.prepare(
    'SELECT id, sender_id, text FROM messages ORDER BY id',
  ).all() as MessageRow[];

  return database.transaction(() => {
    const report: LinkBackfillReport = {
      messagesScanned: rows.length,
      linksInserted: 0,
      jobsQueued: 0,
    };
    const insertLink = database.prepare(
      `INSERT OR IGNORE INTO links (
         message_id, sender_id, url, normalized_url
       ) VALUES (?, ?, ?, ?)`,
    );
    const enqueue = database.prepare(
      `INSERT INTO jobs (
         kind, payload_json, available_at, created_at, updated_at
       ) VALUES ('fetch_link', ?, ?, ?, ?)`,
    );

    for (const row of rows) {
      for (const link of extractLinks(row.text)) {
        const insertion = insertLink.run(
          row.id,
          row.sender_id,
          link.url,
          link.normalizedUrl,
        );
        if (insertion.changes === 0) continue;
        const linkId = Number(insertion.lastInsertRowid);
        enqueue.run(
          JSON.stringify({ linkId, url: link.normalizedUrl }),
          observedAt,
          observedAt,
          observedAt,
        );
        report.linksInserted += 1;
        report.jobsQueued += 1;
      }
    }
    return report;
  })();
}
