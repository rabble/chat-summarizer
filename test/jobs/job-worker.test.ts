import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase, type GravediggerDatabase } from '../../src/db/database.js';
import { enqueueJob } from '../../src/jobs/job-queue.js';
import { drainDueJobs } from '../../src/jobs/job-worker.js';
import { storeMessage } from '../../src/messages/message-store.js';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../support/temp-database.js';

describe('job worker', () => {
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

  test('drains segment jobs into idempotent thread assignments', async () => {
    store('m1', 1_000);
    store('m2', 2_000);

    await expect(drainDueJobs(database, { now: () => 3_000 })).resolves.toEqual({
      claimed: 2,
      completed: 2,
      failed: 0,
      dead: 0,
      reachedLimit: false,
    });
    expect(database.prepare(
      "SELECT count(*) FROM jobs WHERE status = 'pending'",
    ).pluck().get()).toBe(0);
    expect(database.prepare('SELECT count(*) FROM thread_messages').pluck().get()).toBe(2);
    expect(database.prepare('SELECT count(*) FROM threads').pluck().get()).toBe(1);
  });

  test('dead-letters an unsupported job through the queue failure path', async () => {
    enqueueJob(database, {
      kind: 'unknown_kind',
      payload: {},
      maxAttempts: 1,
    }, 1_000);

    await expect(drainDueJobs(database, { now: () => 2_000 })).resolves.toEqual({
      claimed: 1,
      completed: 0,
      failed: 1,
      dead: 1,
      reachedLimit: false,
    });
    expect(database.prepare(
      'SELECT status, attempts, last_error FROM jobs WHERE id = 1',
    ).get()).toEqual({
      status: 'dead',
      attempts: 1,
      last_error: 'Unsupported job kind: unknown_kind',
    });
  });

  test('stops between jobs when the worker is shutting down', async () => {
    enqueueJob(database, { kind: 'build_digest', payload: {} }, 1_000);
    enqueueJob(database, { kind: 'unknown_kind', payload: {}, maxAttempts: 1 }, 1_000);
    let keepRunning = true;

    await expect(drainDueJobs(database, {
      now: () => 2_000,
      shouldContinue: () => keepRunning,
      buildDigest: async () => { keepRunning = false; },
    })).resolves.toMatchObject({ claimed: 1, completed: 1 });
    expect(database.prepare(
      "SELECT count(*) FROM jobs WHERE status = 'pending'",
    ).pluck().get()).toBe(1);
  });

  test('services event-loop callbacks between synchronous jobs', async () => {
    store('m1', 1_000);
    store('m2', 2_000);
    let keepRunning = true;
    const callback = new Promise<void>((resolve) => {
      setImmediate(() => {
        keepRunning = false;
        resolve();
      });
    });

    const report = await drainDueJobs(database, {
      now: () => 3_000,
      shouldContinue: () => keepRunning,
    });
    await callback;

    expect(report.claimed).toBe(1);
    expect(database.prepare(
      "SELECT count(*) FROM jobs WHERE status = 'pending'",
    ).pluck().get()).toBe(1);
  });

  function store(externalId: string, timestampMs: number): void {
    storeMessage(database, {
      externalId,
      groupJid: '120@g.us',
      senderJid: `${externalId}@s.whatsapp.net`,
      senderName: externalId,
      timestampMs,
      messageType: 'conversation',
      text: `Message ${externalId}`,
      quotedExternalId: null,
      rawJson: '{}',
    }, timestampMs);
  }
});
