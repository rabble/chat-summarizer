import type { GravediggerDatabase } from '../db/database.js';

export type SegmentationReport = {
  messagesAssigned: number;
  threadsCreated: number;
};

type MessageRow = {
  id: number;
  external_id: string;
  timestamp_ms: number;
  quoted_external_id: string | null;
  thread_id: number | null;
};

export function segmentUnthreadedMessages(
  database: GravediggerDatabase,
  groupJid: string,
  continuityMs = 30 * 60 * 1_000,
): SegmentationReport {
  return database.transaction(() => {
    const groupId = database.prepare(
      'SELECT id FROM groups WHERE jid = ?',
    ).pluck().get(groupJid) as number | undefined;
    if (groupId === undefined) {
      return { messagesAssigned: 0, threadsCreated: 0 };
    }

    // History sync enqueues one job per message. The first job assigns the
    // whole group; subsequent jobs should not rescan and rewrite its threads.
    const unassigned = database.prepare(
      `SELECT 1 FROM messages m
        WHERE m.group_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM thread_messages tm WHERE tm.message_id = m.id
          )
        LIMIT 1`,
    ).get(groupId);
    if (unassigned === undefined) {
      return { messagesAssigned: 0, threadsCreated: 0 };
    }

    const rows = database.prepare(
      `SELECT m.id, m.external_id, m.timestamp_ms, m.quoted_external_id,
              tm.thread_id
         FROM messages m
         LEFT JOIN thread_messages tm ON tm.message_id = m.id
        WHERE m.group_id = ?
        ORDER BY m.timestamp_ms, m.id`,
    ).all(groupId) as MessageRow[];
    const assignments = new Map<string, number>();
    let previous: { timestampMs: number; threadId: number } | undefined;
    let messagesAssigned = 0;
    let threadsCreated = 0;

    for (const row of rows) {
      let threadId = row.thread_id;
      if (threadId === null) {
        const replyThread = row.quoted_external_id === null
          ? undefined
          : assignments.get(row.quoted_external_id);
        if (replyThread !== undefined) {
          threadId = replyThread;
        } else if (
          previous !== undefined &&
          row.timestamp_ms - previous.timestampMs <= continuityMs
        ) {
          threadId = previous.threadId;
        } else {
          const insertion = database.prepare(
            `INSERT INTO threads (group_id, opened_at)
             VALUES (?, ?)`,
          ).run(groupId, row.timestamp_ms);
          threadId = Number(insertion.lastInsertRowid);
          threadsCreated += 1;
        }
        database.prepare(
          `INSERT INTO thread_messages (thread_id, message_id)
           VALUES (?, ?)`,
        ).run(threadId, row.id);
        messagesAssigned += 1;
      }
      assignments.set(row.external_id, threadId);
      previous = { timestampMs: row.timestamp_ms, threadId };
    }

    refreshThreadWindows(database, groupId);
    return { messagesAssigned, threadsCreated };
  })();
}

function refreshThreadWindows(
  database: GravediggerDatabase,
  groupId: number,
): void {
  const windows = database.prepare(
    `SELECT t.id, min(m.timestamp_ms) AS opened_at,
            max(m.timestamp_ms) AS closed_at
       FROM threads t
       JOIN thread_messages tm ON tm.thread_id = t.id
       JOIN messages m ON m.id = tm.message_id
      WHERE t.group_id = ?
      GROUP BY t.id`,
  ).all(groupId) as Array<{ id: number; opened_at: number; closed_at: number }>;
  for (const window of windows) {
    database.prepare(
      `UPDATE threads
          SET opened_at = ?, closed_at = ?, status = 'closed'
        WHERE id = ?`,
    ).run(window.opened_at, window.closed_at, window.id);
  }

  const latestThreadId = database.prepare(
    `SELECT tm.thread_id
       FROM thread_messages tm
       JOIN messages m ON m.id = tm.message_id
      WHERE m.group_id = ?
      ORDER BY m.timestamp_ms DESC, m.id DESC
      LIMIT 1`,
  ).pluck().get(groupId) as number | undefined;
  if (latestThreadId !== undefined) {
    database.prepare(
      `UPDATE threads SET status = 'open', closed_at = NULL WHERE id = ?`,
    ).run(latestThreadId);
  }
}
