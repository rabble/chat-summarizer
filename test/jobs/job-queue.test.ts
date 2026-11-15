import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase, type GravediggerDatabase } from '../../src/db/database.js';
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  recoverStaleJobs,
} from '../../src/jobs/job-queue.js';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../support/temp-database.js';

describe('job queue', () => {
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

  test('enqueues a typed JSON payload', () => {
    const id = enqueueJob(
      database,
      { kind: 'fetch_link', payload: { linkId: 42 } },
      100,
    );

    expect(id).toBe(1);
    expect(
      database
        .prepare(
          `SELECT kind, payload_json, status, attempts, max_attempts,
                  available_at, created_at, updated_at
             FROM jobs`,
        )
        .get(),
    ).toEqual({
      kind: 'fetch_link',
      payload_json: '{"linkId":42}',
      status: 'pending',
      attempts: 0,
      max_attempts: 5,
      available_at: 100,
      created_at: 100,
      updated_at: 100,
    });
  });

  test('claims the earliest due job and marks it running', () => {
    enqueueJob(
      database,
      { kind: 'later', payload: {}, availableAt: 200 },
      100,
    );
    const dueId = enqueueJob(
      database,
      { kind: 'due', payload: { window: 1 }, availableAt: 100 },
      100,
    );

    expect(claimNextJob(database, 150)).toEqual({
      id: dueId,
      kind: 'due',
      payload: { window: 1 },
      attempts: 0,
      maxAttempts: 5,
      availableAt: 100,
      lockedAt: 150,
    });
    expect(
      database.prepare('SELECT status FROM jobs WHERE id = ?').pluck().get(dueId),
    ).toBe('running');
  });

  test('prioritizes a due digest over older enrichment backlog', () => {
    enqueueJob(database, { kind: 'fetch_link', payload: { linkId: 1 } }, 100);
    const digestId = enqueueJob(database, {
      kind: 'build_digest',
      payload: { localDate: '2026-08-18' },
    }, 200);

    expect(claimNextJob(database, 300)?.id).toBe(digestId);
  });

  test('does not let two database connections claim the same job', () => {
    enqueueJob(database, { kind: 'only', payload: {} }, 100);
    const secondConnection = openDatabase(temporaryDatabase.path);

    expect(claimNextJob(database, 100)?.id).toBe(1);
    expect(claimNextJob(secondConnection, 100)).toBeNull();

    secondConnection.close();
  });

  test('completes a running job', () => {
    const id = enqueueJob(database, { kind: 'work', payload: {} }, 100);
    claimNextJob(database, 100);

    completeJob(database, id, 120);

    expect(
      database
        .prepare('SELECT status, completed_at, locked_at FROM jobs WHERE id = ?')
        .get(id),
    ).toEqual({ status: 'completed', completed_at: 120, locked_at: null });
  });

  test('reschedules failure with deterministic exponential backoff', () => {
    const id = enqueueJob(database, { kind: 'work', payload: {} }, 100);
    claimNextJob(database, 100);

    expect(failJob(database, id, new Error('temporary'), 200, 1_000)).toBe(
      'pending',
    );
    expect(
      database
        .prepare(
          `SELECT status, attempts, available_at, locked_at, last_error
             FROM jobs WHERE id = ?`,
        )
        .get(id),
    ).toEqual({
      status: 'pending',
      attempts: 1,
      available_at: 1_200,
      locked_at: null,
      last_error: 'temporary',
    });
  });

  test('dead-letters the Nth failure with a bounded final error', () => {
    const id = enqueueJob(
      database,
      { kind: 'work', payload: {}, maxAttempts: 2 },
      100,
    );
    claimNextJob(database, 100);
    failJob(database, id, 'first', 200, 1);
    claimNextJob(database, 201);

    expect(failJob(database, id, 'x'.repeat(3_000), 300, 1)).toBe('dead');
    const row = database
      .prepare(
        `SELECT status, attempts, completed_at, length(last_error) AS error_length
           FROM jobs WHERE id = ?`,
      )
      .get(id);
    expect(row).toEqual({
      status: 'dead',
      attempts: 2,
      completed_at: 300,
      error_length: 2_000,
    });
  });

  test('recovers stale running jobs at startup', () => {
    const staleId = enqueueJob(database, { kind: 'stale', payload: {} }, 100);
    claimNextJob(database, 100);
    const freshId = enqueueJob(database, { kind: 'fresh', payload: {} }, 150);
    claimNextJob(database, 150);

    expect(recoverStaleJobs(database, 120, 200)).toBe(1);
    expect(
      database
        .prepare('SELECT id, status, available_at, locked_at FROM jobs ORDER BY id')
        .all(),
    ).toEqual([
      { id: staleId, status: 'pending', available_at: 200, locked_at: null },
      { id: freshId, status: 'running', available_at: 150, locked_at: 150 },
    ]);
  });
});
