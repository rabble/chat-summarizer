import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase, type GravediggerDatabase } from '../../src/db/database.js';
import { storeGroupSubjects } from '../../src/groups/group-store.js';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../support/temp-database.js';

describe('group metadata', () => {
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

  test('persists current subjects for allowlisted rooms only', () => {
    database.prepare(
      'INSERT INTO groups (jid, subject, created_at) VALUES (?, ?, ?)',
    ).run('weather@g.us', null, 100);

    const stored = storeGroupSubjects(database, {
      'weather@g.us': { id: 'weather@g.us', subject: 'Agentic Weather Report' },
      'vibez@g.us': { id: 'vibez@g.us', subject: 'The vibez (code code code)' },
      'private@g.us': { id: 'private@g.us', subject: 'Not monitored' },
    }, new Set(['weather@g.us', 'vibez@g.us']), 200);

    expect(stored).toBe(2);
    expect(database.prepare(
      'SELECT jid, subject FROM groups ORDER BY jid',
    ).all()).toEqual([
      { jid: 'vibez@g.us', subject: 'The vibez (code code code)' },
      { jid: 'weather@g.us', subject: 'Agentic Weather Report' },
    ]);
  });

  test('does not erase a known subject with blank metadata', () => {
    database.prepare(
      'INSERT INTO groups (jid, subject, created_at) VALUES (?, ?, ?)',
    ).run('weather@g.us', 'Agentic Weather Report', 100);

    storeGroupSubjects(database, {
      'weather@g.us': { id: 'weather@g.us', subject: '   ' },
    }, new Set(['weather@g.us']), 200);

    expect(database.prepare(
      'SELECT subject FROM groups WHERE jid = ?',
    ).pluck().get('weather@g.us')).toBe('Agentic Weather Report');
  });
});
