import { afterEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';

import { openDatabase } from '../../src/db/database.js';
import { migrations } from '../../src/db/migrations.js';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../support/temp-database.js';

const expectedTables = [
  'alerts',
  'connector_state',
  'digest_threads',
  'digests',
  'entities',
  'entity_mentions',
  'feedback',
  'gaps',
  'groups',
  'jobs',
  'links',
  'media',
  'message_fts',
  'messages',
  'people',
  'participant_profiles',
  'schema_migrations',
  'scheduled_digests',
  'thread_messages',
  'threads',
  'unsupported_messages',
];

describe('openDatabase', () => {
  let temporaryDatabase: TemporaryDatabase | undefined;

  afterEach(() => {
    temporaryDatabase?.cleanup();
    temporaryDatabase = undefined;
  });

  test('enables the required pragmas and creates the complete phase-one schema', () => {
    temporaryDatabase = createTemporaryDatabase();
    const database = openDatabase(temporaryDatabase.path);

    const journalMode = database.pragma('journal_mode', { simple: true });
    const foreignKeys = database.pragma('foreign_keys', { simple: true });
    const tables = database
      .prepare(
        `SELECT name
           FROM sqlite_master
          WHERE type IN ('table', 'view')
            AND name NOT LIKE 'sqlite_%'
          ORDER BY name`,
      )
      .pluck()
      .all();

    expect(journalMode).toBe('wal');
    expect(foreignKeys).toBe(1);
    expect(tables).toEqual(expect.arrayContaining(expectedTables));
    database.close();
  });

  test('applies each migration exactly once across reopen', () => {
    temporaryDatabase = createTemporaryDatabase();

    const first = openDatabase(temporaryDatabase.path);
    const firstVersions = first
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .pluck()
      .all();
    first.close();

    const second = openDatabase(temporaryDatabase.path);
    const secondVersions = second
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .pluck()
      .all();

    expect(firstVersions).toEqual([1, 2, 3, 4, 5, 6]);
    expect(secondVersions).toEqual(firstVersions);
    second.close();
  });

  test('keeps the external-content FTS index synchronized through triggers', () => {
    temporaryDatabase = createTemporaryDatabase();
    const database = openDatabase(temporaryDatabase.path);

    database
      .prepare('INSERT INTO groups (jid, created_at) VALUES (?, ?)')
      .run('120@g.us', 1);
    database
      .prepare('INSERT INTO people (jid, created_at) VALUES (?, ?)')
      .run('person@s.whatsapp.net', 1);
    database
      .prepare(
        `INSERT INTO messages (
           external_id, group_id, sender_id, timestamp_ms, message_type,
           text, raw_json, ingested_at
         ) VALUES (?, 1, 1, ?, ?, ?, ?, ?)`,
      )
      .run('message-1', 1, 'conversation', 'buried treasure', '{}', 1);

    expect(
      database
        .prepare("SELECT rowid FROM message_fts WHERE message_fts MATCH 'treasure'")
        .pluck()
        .all(),
    ).toEqual([1]);

    database.prepare('DELETE FROM messages WHERE id = 1').run();

    expect(database.prepare('SELECT rowid FROM message_fts').all()).toEqual([]);
    database.close();
  });

  test('looks up thread assignments by message without scanning all assignments', () => {
    temporaryDatabase = createTemporaryDatabase();
    const database = openDatabase(temporaryDatabase.path);
    try {
      const plan = database.prepare(
        'EXPLAIN QUERY PLAN SELECT thread_id FROM thread_messages WHERE message_id = ?',
      ).all(1) as Array<{ detail: string }>;
      expect(plan.map((row) => row.detail).join('\n')).toContain('SEARCH');
    } finally {
      database.close();
    }
  });

  test('preserves delivered editions when adding independent schedules', () => {
    temporaryDatabase = createTemporaryDatabase();
    const old = new Database(temporaryDatabase.path);
    old.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    for (const migration of migrations.filter((item) => item.version <= 5)) {
      old.exec(migration.sql);
      old.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(migration.version, 'test');
    }
    old.prepare(`INSERT INTO scheduled_digests
      (local_date,window_started_at,window_ended_at,status,markdown,delivered_at,created_at,updated_at)
      VALUES ('2026-11-09',1,2,'delivered','Saved edition',3,1,3)`).run();
    old.close();
    const upgraded = openDatabase(temporaryDatabase.path);
    try {
      expect(upgraded.prepare('SELECT schedule_id,local_date,status,markdown,delivered_at FROM scheduled_digests').get())
        .toEqual({ schedule_id: 'primary', local_date: '2026-11-09', status: 'delivered', markdown: 'Saved edition', delivered_at: 3 });
    } finally { upgraded.close(); }
  });
});
