import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase, type GravediggerDatabase } from '../../src/db/database.js';
import { storeMessage } from '../../src/messages/message-store.js';
import { segmentUnthreadedMessages } from '../../src/threads/segmenter.js';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../support/temp-database.js';

describe('thread segmentation', () => {
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

  test('groups nearby messages while preserving replies across time gaps', () => {
    store('m1', 1_000, null, 'Initial model-routing proposal.');
    store('m2', 10 * 60_000, null, 'A nearby follow-up.');
    store('m3', 50 * 60_000, null, 'A separate release discussion.');
    store('m4', 2 * 60 * 60_000, 'm1', 'A late reply to the proposal.');

    expect(segmentUnthreadedMessages(database, '120@g.us')).toEqual({
      messagesAssigned: 4,
      threadsCreated: 2,
    });

    const assignments = database.prepare(
      `SELECT m.external_id, tm.thread_id
         FROM thread_messages tm
         JOIN messages m ON m.id = tm.message_id
        ORDER BY m.timestamp_ms, m.id`,
    ).all() as Array<{ external_id: string; thread_id: number }>;
    expect(assignments[0]?.thread_id).toBe(assignments[1]?.thread_id);
    expect(assignments[3]?.thread_id).toBe(assignments[0]?.thread_id);
    expect(assignments[2]?.thread_id).not.toBe(assignments[0]?.thread_id);
    expect(database.prepare(
      'SELECT status FROM threads ORDER BY id',
    ).pluck().all()).toEqual(['open', 'closed']);
  });

  test('is idempotent after all messages have assignments', () => {
    store('m1', 1_000, null, 'One message.');
    expect(segmentUnthreadedMessages(database, '120@g.us')).toEqual({
      messagesAssigned: 1,
      threadsCreated: 1,
    });
    expect(segmentUnthreadedMessages(database, '120@g.us')).toEqual({
      messagesAssigned: 0,
      threadsCreated: 0,
    });
    expect(database.prepare('SELECT count(*) FROM threads').pluck().get()).toBe(1);
  });

  function store(
    externalId: string,
    timestampMs: number,
    quotedExternalId: string | null,
    text: string,
  ): void {
    storeMessage(database, {
      externalId,
      groupJid: '120@g.us',
      senderJid: `${externalId}@s.whatsapp.net`,
      senderName: externalId,
      timestampMs,
      messageType: 'conversation',
      text,
      quotedExternalId,
      rawJson: '{}',
    }, timestampMs);
  }
});
