import type { GravediggerDatabase } from '../db/database.js';
import { extractLinks } from '../links/extract-links.js';
import type { NormalizedMessage } from '../whatsapp/normalize-message.js';

export type StoreMessageResult = 'inserted' | 'duplicate';

export function storeMessage(
  database: GravediggerDatabase,
  message: NormalizedMessage,
  observedAt: number = Date.now(),
): StoreMessageResult {
  return database.transaction(() => {
    database
      .prepare(
        `INSERT INTO groups (jid, created_at)
         VALUES (?, ?)
         ON CONFLICT (jid) DO NOTHING`,
      )
      .run(message.groupJid, observedAt);

    database
      .prepare(
        `INSERT INTO people (jid, display_name, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT (jid) DO UPDATE SET
           display_name = coalesce(excluded.display_name, people.display_name)`,
      )
      .run(message.senderJid, message.senderName, observedAt);

    const groupId = selectId(database, 'groups', message.groupJid);
    const senderId = selectId(database, 'people', message.senderJid);
    const insertion = database
      .prepare(
        `INSERT OR IGNORE INTO messages (
           external_id,
           group_id,
           sender_id,
           timestamp_ms,
           message_type,
           text,
           quoted_external_id,
           raw_json,
           ingested_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.externalId,
        groupId,
        senderId,
        message.timestampMs,
        message.messageType,
        message.text,
        message.quotedExternalId,
        message.rawJson,
        observedAt,
      );

    if (insertion.changes === 0) {
      return 'duplicate';
    }

    const messageId = Number(insertion.lastInsertRowid);
    for (const link of extractLinks(message.text)) {
      const linkInsertion = database.prepare(
        `INSERT INTO links (
           message_id, sender_id, url, normalized_url
         ) VALUES (?, ?, ?, ?)`,
      ).run(messageId, senderId, link.url, link.normalizedUrl);
      const linkId = Number(linkInsertion.lastInsertRowid);
      database.prepare(
        `INSERT INTO jobs (
           kind, payload_json, available_at, created_at, updated_at
         ) VALUES ('fetch_link', ?, ?, ?, ?)`,
      ).run(
        JSON.stringify({ linkId, url: link.normalizedUrl }),
        observedAt,
        observedAt,
        observedAt,
      );
    }

    const payload = JSON.stringify({
      groupJid: message.groupJid,
      messageExternalId: message.externalId,
      timestampMs: message.timestampMs,
    });
    database
      .prepare(
        `INSERT INTO jobs (
           kind, payload_json, available_at, created_at, updated_at
         ) VALUES ('segment_window', ?, ?, ?, ?)`,
      )
      .run(payload, observedAt, observedAt, observedAt);

    return 'inserted';
  })();
}

function selectId(
  database: GravediggerDatabase,
  table: 'groups' | 'people',
  jid: string,
): number {
  const row = database
    .prepare(`SELECT id FROM ${table} WHERE jid = ?`)
    .get(jid) as { id: number } | undefined;

  if (row === undefined) {
    throw new Error(`Failed to resolve ${table} identity`);
  }
  return row.id;
}
