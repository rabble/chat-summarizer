import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase, type GravediggerDatabase } from '../../src/db/database.js';
import {
  findGapsOverlapping,
  reconcileGapsFromStoredHistory,
  recordConnected,
  recordDisconnected,
  recordHeartbeat,
  recoverUncleanStartup,
} from '../../src/gaps/gap-tracker.js';
import { storeMessage } from '../../src/messages/message-store.js';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../support/temp-database.js';

describe('gap tracker', () => {
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

  test('does not create a gap for the first observed connection', () => {
    recordConnected(database, 100);

    expect(database.prepare('SELECT * FROM gaps').all()).toEqual([]);
    expect(database.prepare('SELECT status FROM connector_state').pluck().get()).toBe(
      'connected',
    );
  });

  test('opens a possible gap on disconnect and closes it on reconnect', () => {
    recordConnected(database, 100);
    recordDisconnected(database, 200, 'connection_closed');

    expect(
      database
        .prepare('SELECT started_at, ended_at, cause FROM gaps')
        .get(),
    ).toEqual({
      started_at: 200,
      ended_at: null,
      cause: 'connection_closed',
    });

    recordConnected(database, 300);

    expect(
      database
        .prepare('SELECT started_at, ended_at, cause FROM gaps')
        .get(),
    ).toEqual({
      started_at: 200,
      ended_at: 300,
      cause: 'connection_closed',
    });
  });

  test('does not duplicate a gap for repeated disconnect events', () => {
    recordConnected(database, 100);
    recordDisconnected(database, 200, 'connection_closed');
    recordDisconnected(database, 250, 'connection_closed');

    expect(database.prepare('SELECT count(*) FROM gaps').pluck().get()).toBe(1);
    expect(database.prepare('SELECT started_at FROM gaps').pluck().get()).toBe(200);
  });

  test('opens an unclean-startup gap from the last persisted heartbeat', () => {
    recordConnected(database, 100);
    recordHeartbeat(database, 150);

    expect(recoverUncleanStartup(database, 200)).toBe(true);
    expect(
      database
        .prepare('SELECT started_at, ended_at, cause FROM gaps')
        .get(),
    ).toEqual({
      started_at: 150,
      ended_at: null,
      cause: 'process_restart',
    });

    recordConnected(database, 250);
    expect(database.prepare('SELECT ended_at FROM gaps').pluck().get()).toBe(250);
  });

  test('coalesces overlapping ranges observed out of order', () => {
    recordConnected(database, 50);
    recordDisconnected(database, 100, 'first_disconnect');
    recordConnected(database, 200);
    recordDisconnected(database, 150, 'overlapping_disconnect');
    recordConnected(database, 250);

    expect(
      database
        .prepare('SELECT started_at, ended_at FROM gaps ORDER BY started_at')
        .all(),
    ).toEqual([{ started_at: 100, ended_at: 250 }]);
  });

  test('returns only gaps intersecting a half-open digest window', () => {
    recordConnected(database, 0);
    recordDisconnected(database, 100, 'first');
    recordConnected(database, 400_000);
    recordDisconnected(database, 500_000, 'second');
    recordConnected(database, 900_000);
    recordDisconnected(database, 1_000_000, 'open');

    expect(findGapsOverlapping(database, 400_000, 700_000)).toEqual([
      {
        id: 2,
        startedAt: 500_000,
        endedAt: 900_000,
        cause: 'second',
      },
    ]);
    expect(findGapsOverlapping(database, 950_000, 1_100_000)).toEqual([
      {
        id: 3,
        startedAt: 1_000_000,
        endedAt: null,
        cause: 'open',
      },
    ]);
  });

  test('keeps brief and planned interruptions for operations but reconciles them for evidence', () => {
    recordConnected(database, 0);
    recordDisconnected(database, 100, 'connection_closed');
    recordConnected(database, 60_000);
    recordDisconnected(database, 100_000, 'operator_stop');
    recordConnected(database, 1_000_000);

    expect(database.prepare('SELECT count(*) FROM gaps').pluck().get()).toBe(2);
    expect(findGapsOverlapping(database, 0, 2_000_000)).toEqual([]);
    expect(database.prepare(
      'SELECT count(*) FROM gaps WHERE reconciled_at IS NOT NULL',
    ).pluck().get()).toBe(2);
  });

  test('reconciles a long interruption when later history recovers messages inside it', () => {
    recordConnected(database, 0);
    recordDisconnected(database, 100, 'disconnect_408');
    recordConnected(database, 400_000);
    storeMessage(database, {
      externalId: 'recovered',
      groupJid: '120@g.us',
      senderJid: 'alice@s.whatsapp.net',
      senderName: 'Alice',
      timestampMs: 200_000,
      messageType: 'conversation',
      text: 'Recovered from history.',
      quotedExternalId: null,
      rawJson: '{}',
    }, 500_000);

    expect(findGapsOverlapping(database, 0, 500_000)).toHaveLength(1);
    expect(reconcileGapsFromStoredHistory(database, 500_000)).toBe(1);
    expect(findGapsOverlapping(database, 0, 500_000)).toEqual([]);
  });
});
