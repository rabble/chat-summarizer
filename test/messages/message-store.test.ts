import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase, type GravediggerDatabase } from '../../src/db/database.js';
import { storeMessage } from '../../src/messages/message-store.js';
import type { NormalizedMessage } from '../../src/whatsapp/normalize-message.js';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../support/temp-database.js';

const normalizedMessage: NormalizedMessage = {
  externalId: 'message-1',
  groupJid: '120363000000000000@g.us',
  senderJid: '64210000000@s.whatsapp.net',
  senderName: 'Redacted Person',
  timestampMs: 1_786_921_200_000,
  messageType: 'extendedTextMessage',
  text: 'Preserve the source edge.',
  quotedExternalId: 'message-earlier',
  rawJson: JSON.stringify({ complete: 'redacted envelope' }),
};

describe('storeMessage', () => {
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

  test('persists identities, the envelope, reply edge, FTS text, and downstream job', () => {
    expect(storeMessage(database, normalizedMessage, 10)).toBe('inserted');

    expect(database.prepare('SELECT jid FROM groups').pluck().all()).toEqual([
      normalizedMessage.groupJid,
    ]);
    expect(
      database.prepare('SELECT jid, display_name FROM people').get(),
    ).toEqual({
      jid: normalizedMessage.senderJid,
      display_name: normalizedMessage.senderName,
    });
    expect(
      database
        .prepare(
          `SELECT external_id, timestamp_ms, message_type, text,
                  quoted_external_id, raw_json, ingested_at
             FROM messages`,
        )
        .get(),
    ).toEqual({
      external_id: normalizedMessage.externalId,
      timestamp_ms: normalizedMessage.timestampMs,
      message_type: normalizedMessage.messageType,
      text: normalizedMessage.text,
      quoted_external_id: normalizedMessage.quotedExternalId,
      raw_json: normalizedMessage.rawJson,
      ingested_at: 10,
    });
    expect(
      database
        .prepare("SELECT rowid FROM message_fts WHERE message_fts MATCH 'source'")
        .pluck()
        .all(),
    ).toEqual([1]);
    expect(
      database
        .prepare('SELECT kind, payload_json, status, available_at FROM jobs')
        .get(),
    ).toEqual({
      kind: 'segment_window',
      payload_json: JSON.stringify({
        groupJid: normalizedMessage.groupJid,
        messageExternalId: normalizedMessage.externalId,
        timestampMs: normalizedMessage.timestampMs,
      }),
      status: 'pending',
      available_at: 10,
    });
  });

  test('treats replay as a duplicate without creating another message or job', () => {
    expect(storeMessage(database, normalizedMessage, 10)).toBe('inserted');
    expect(storeMessage(database, normalizedMessage, 20)).toBe('duplicate');

    expect(database.prepare('SELECT count(*) FROM messages').pluck().get()).toBe(1);
    expect(database.prepare('SELECT count(*) FROM jobs').pluck().get()).toBe(1);
  });

  test('extracts shared URLs and queues them for enrichment', () => {
    const linkedMessage = {
      ...normalizedMessage,
      text: [
        'Try the app at https://example.test/app,',
        'and the code at https://github.com/example/project.',
      ].join(' '),
    };

    expect(storeMessage(database, linkedMessage, 10)).toBe('inserted');

    expect(database.prepare(
      'SELECT url, normalized_url, status FROM links ORDER BY id',
    ).all()).toEqual([
      {
        url: 'https://example.test/app',
        normalized_url: 'https://example.test/app',
        status: 'pending',
      },
      {
        url: 'https://github.com/example/project',
        normalized_url: 'https://github.com/example/project',
        status: 'pending',
      },
    ]);
    expect(database.prepare(
      "SELECT kind FROM jobs WHERE kind = 'fetch_link' ORDER BY id",
    ).pluck().all()).toEqual(['fetch_link', 'fetch_link']);
  });

  test('does not erase a known sender name when a later delivery has no name', () => {
    storeMessage(database, normalizedMessage, 10);
    storeMessage(
      database,
      {
        ...normalizedMessage,
        externalId: 'message-2',
        senderName: null,
      },
      20,
    );

    expect(database.prepare('SELECT display_name FROM people').pluck().get()).toBe(
      normalizedMessage.senderName,
    );
  });

  test('rolls back identities and message when downstream enqueue fails', () => {
    database.exec(`
      CREATE TRIGGER force_job_failure BEFORE INSERT ON jobs BEGIN
        SELECT RAISE(ABORT, 'forced job failure');
      END
    `);

    expect(() => storeMessage(database, normalizedMessage, 10)).toThrow(
      /forced job failure/,
    );
    expect(database.prepare('SELECT count(*) FROM groups').pluck().get()).toBe(0);
    expect(database.prepare('SELECT count(*) FROM people').pluck().get()).toBe(0);
    expect(database.prepare('SELECT count(*) FROM messages').pluck().get()).toBe(0);
  });
});
