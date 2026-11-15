import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase, type GravediggerDatabase } from '../../src/db/database.js';
import { purgePerson } from '../../src/privacy/purge-person.js';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../support/temp-database.js';

const targetJid = '64210000000@s.whatsapp.net';

describe('purgePerson', () => {
  let temporaryDatabase: TemporaryDatabase;
  let database: GravediggerDatabase;

  beforeEach(() => {
    temporaryDatabase = createTemporaryDatabase();
    database = openDatabase(temporaryDatabase.path);
    seedProvenanceGraph(database);
  });

  afterEach(() => {
    database.close();
    temporaryDatabase.cleanup();
  });

  test('removes a sender and every source-derived cache while preserving unrelated data', () => {
    expect(purgePerson(database, targetJid)).toEqual({
      found: true,
      people: 1,
      messages: 1,
      media: 1,
      links: 1,
      unsupportedMessages: 1,
      threads: 1,
      digests: 1,
      alerts: 1,
      feedback: 1,
      entityMentions: 1,
      jobs: 2,
      entities: 1,
    });

    expect(database.prepare('SELECT jid FROM people').pluck().all()).toEqual([
      '64210000001@s.whatsapp.net',
    ]);
    expect(database.prepare('SELECT external_id FROM messages ORDER BY id').pluck().all()).toEqual([
      'other-shared-message',
      'other-only-message',
    ]);
    expect(database.prepare('SELECT count(*) FROM media').pluck().get()).toBe(0);
    expect(database.prepare('SELECT count(*) FROM links').pluck().get()).toBe(0);
    expect(database.prepare('SELECT id FROM threads').pluck().all()).toEqual([2]);
    expect(database.prepare('SELECT id FROM digests').pluck().all()).toEqual([2]);
    expect(database.prepare('SELECT id FROM alerts').pluck().all()).toEqual([2]);
    expect(database.prepare('SELECT id FROM feedback').pluck().all()).toEqual([2]);
    expect(database.prepare('SELECT id FROM jobs').pluck().all()).toEqual([3]);
    expect(database.prepare('SELECT canonical_name FROM entities').pluck().all()).toEqual([
      'Other Tool',
    ]);
    expect(database.prepare('SELECT count(*) FROM unsupported_messages').pluck().get()).toBe(0);
    expect(
      database
        .prepare("SELECT rowid FROM message_fts WHERE message_fts MATCH 'target'")
        .all(),
    ).toEqual([]);
  });

  test('is idempotent after the sender is gone', () => {
    purgePerson(database, targetJid);

    expect(purgePerson(database, targetJid)).toEqual({
      found: false,
      people: 0,
      messages: 0,
      media: 0,
      links: 0,
      unsupportedMessages: 0,
      threads: 0,
      digests: 0,
      alerts: 0,
      feedback: 0,
      entityMentions: 0,
      jobs: 0,
      entities: 0,
    });
  });

  test('rolls the complete purge back when a delete fails', () => {
    database.exec(`
      CREATE TRIGGER force_person_delete_failure BEFORE DELETE ON people BEGIN
        SELECT RAISE(ABORT, 'forced person delete failure');
      END
    `);

    expect(() => purgePerson(database, targetJid)).toThrow(
      /forced person delete failure/,
    );
    expect(database.prepare('SELECT count(*) FROM people').pluck().get()).toBe(2);
    expect(database.prepare('SELECT count(*) FROM messages').pluck().get()).toBe(3);
    expect(database.prepare('SELECT count(*) FROM threads').pluck().get()).toBe(2);
    expect(database.prepare('SELECT count(*) FROM digests').pluck().get()).toBe(2);
    expect(database.prepare('SELECT count(*) FROM jobs').pluck().get()).toBe(3);
  });
});

function seedProvenanceGraph(database: GravediggerDatabase): void {
  database.exec(`
    INSERT INTO groups (id, jid, created_at)
    VALUES (1, '120363000000000000@g.us', 1);

    INSERT INTO people (id, jid, display_name, created_at) VALUES
      (1, '${targetJid}', 'Target Person', 1),
      (2, '64210000001@s.whatsapp.net', 'Other Person', 1);

    INSERT INTO messages (
      id, external_id, group_id, sender_id, timestamp_ms, message_type,
      text, raw_json, ingested_at
    ) VALUES
      (1, 'target-message', 1, 1, 100, 'conversation', 'target secret', '{}', 100),
      (2, 'other-shared-message', 1, 2, 110, 'conversation', 'shared context', '{}', 110),
      (3, 'other-only-message', 1, 2, 300, 'conversation', 'unrelated context', '{}', 300);

    INSERT INTO media (
      id, message_id, sender_id, kind, path, created_at
    ) VALUES (1, 1, 1, 'image', '/tmp/redacted', 100);

    INSERT INTO links (id, message_id, sender_id, url)
    VALUES (1, 1, 1, 'https://example.test/target');

    INSERT INTO threads (
      id, group_id, title, summary, status, opened_at, closed_at
    ) VALUES
      (1, 1, 'Shared thread', 'May quote target', 'closed', 100, 200),
      (2, 1, 'Other thread', 'Only other person', 'closed', 300, 400);

    INSERT INTO thread_messages (thread_id, message_id) VALUES
      (1, 1), (1, 2), (2, 3);

    INSERT INTO entities (
      id, kind, canonical_name, aliases_json, first_seen_at
    ) VALUES
      (1, 'tool', 'Target Tool', '[]', 100),
      (2, 'tool', 'Other Tool', '[]', 300);

    INSERT INTO entity_mentions (
      id, entity_id, thread_id, person_id, message_id, claim_text
    ) VALUES
      (1, 1, 1, 1, 1, 'target claim'),
      (2, 2, 2, 2, 3, 'other claim');

    INSERT INTO digests (
      id, group_id, window_started_at, window_ended_at, markdown, created_at
    ) VALUES
      (1, 1, 0, 250, 'May quote target', 250),
      (2, 1, 250, 500, 'Other only', 500);

    INSERT INTO digest_threads (digest_id, thread_id) VALUES (1, 1), (2, 2);
    INSERT INTO alerts (id, thread_id, rule, body, created_at) VALUES
      (1, 1, 'target-rule', 'target alert', 200),
      (2, 2, 'other-rule', 'other alert', 400);
    INSERT INTO feedback (id, thread_id, rating, created_at) VALUES
      (1, 1, 'star', 200),
      (2, 2, 'skip', 400);

    INSERT INTO jobs (
      id, kind, payload_json, available_at, created_at, updated_at
    ) VALUES
      (1, 'segment_window', '{"messageExternalId":"target-message"}', 100, 100, 100),
      (2, 'extract_thread', '{"threadId":1}', 100, 100, 100),
      (3, 'extract_thread', '{"threadId":2}', 100, 100, 100);

    INSERT INTO unsupported_messages (
      id, external_id, group_jid, sender_jid, reason, raw_json, observed_at
    ) VALUES (
      1, 'unsupported-target', '120363000000000000@g.us', '${targetJid}',
      'unknown', '{}', 100
    );
  `);
}
