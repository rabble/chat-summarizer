import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase, type GravediggerDatabase } from '../../src/db/database.js';
import {
  buildScheduledDigestInput,
  enqueueDailyDigestIfDue,
  processScheduledDigestJob,
} from '../../src/digests/digest-scheduler.js';
import { claimNextJob, completeJob } from '../../src/jobs/job-queue.js';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../support/temp-database.js';
import { loadConfig } from '../../src/config.js';

describe('automatic digest scheduling', () => {
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

  test.each([
    ['community', 'primary', '123456789@g.us', false, false],
    ['operator', 'primary', undefined, false, true],
    ['additional private recipient', 'second', '123456789@g.us', true, false],
  ] as const)('sets attribution and profile access for %s editions', (_audience, scheduleId, groupJid, anonymous, includeParticipantProfiles) => {
    const config = loadConfig({
      GRAVEDIGGER_DATABASE_PATH: temporaryDatabase.path,
      GRAVEDIGGER_AUTH_DIR: 'data/auth',
      GRAVEDIGGER_GROUP_JIDS: '120@g.us',
      GRAVEDIGGER_DIGEST_RECIPIENT: '+15550123456',
      GRAVEDIGGER_DIGEST_GROUP_JID: groupJid,
      OPENROUTER_API_KEY: 'test-key',
    });
    const input = buildScheduledDigestInput(config, 1_000, 3_000, scheduleId);
    expect(input.anonymous).toBe(anonymous);
    expect(input.includeParticipantProfiles).toBe(includeParticipantProfiles);
    if (!anonymous) {
      expect(input.question).toContain('attribute consequential claims by verified participant name');
      expect(input.question).not.toContain('Chatham House');
    }
  });

  test('enqueues one catch-up digest per local date after the scheduled time', () => {
    const before = Date.parse('2026-08-17T19:59:00.000Z'); // 07:59 NZST
    const due = Date.parse('2026-08-17T20:00:00.000Z'); // 08:00 NZST
    const schedule = {
      timeZone: 'Pacific/Auckland',
      hour: 8,
      minute: 0,
      lookbackHours: 24,
    };

    expect(enqueueDailyDigestIfDue(database, schedule, before)).toBeNull();
    expect(enqueueDailyDigestIfDue(database, schedule, due)).toBe(1);
    expect(enqueueDailyDigestIfDue(database, schedule, due + 60_000)).toBeNull();
    expect(database.prepare(
      `SELECT local_date, window_started_at, window_ended_at, status
         FROM scheduled_digests`,
    ).get()).toEqual({
      local_date: '2026-08-18',
      window_started_at: due - 24 * 60 * 60_000,
      window_ended_at: due,
      status: 'scheduled',
    });
    expect(database.prepare(
      "SELECT kind, status FROM jobs WHERE id = 1",
    ).get()).toEqual({ kind: 'build_digest', status: 'pending' });
  });

  test('stores generated copy before delivery and does not redeliver a completed date', async () => {
    const due = Date.parse('2026-08-17T20:00:00.000Z');
    enqueueDailyDigestIfDue(database, {
      timeZone: 'Pacific/Auckland',
      hour: 8,
      minute: 0,
      lookbackHours: 24,
    }, due);
    const job = claimNextJob(database, due);
    if (job === null) throw new Error('Expected scheduled job');
    const delivered: string[] = [];

    await processScheduledDigestJob(database, job.payload, {
      generate: async () => 'THE BIG STORY\n\nA source-bound edition.',
      deliver: async (markdown) => { delivered.push(markdown); },
      now: () => due + 1_000,
    });
    completeJob(database, job.id, due + 1_000);

    expect(delivered).toEqual(['THE BIG STORY\n\nA source-bound edition.']);
    expect(database.prepare(
      `SELECT status, markdown, delivered_at
         FROM scheduled_digests WHERE local_date = '2026-08-18'`,
    ).get()).toEqual({
      status: 'delivered',
      markdown: 'THE BIG STORY\n\nA source-bound edition.',
      delivered_at: due + 1_000,
    });

    await processScheduledDigestJob(database, job.payload, {
      generate: async () => { throw new Error('must not regenerate'); },
      deliver: async (markdown) => { delivered.push(markdown); },
      now: () => due + 2_000,
    });
    expect(delivered).toHaveLength(1);
  });

  test('keeps recipients independent even when their editions share a date', async () => {
    const due = Date.parse('2026-11-09T14:00:00Z');
    const primary = { timeZone: 'Pacific/Auckland', hour: 8, minute: 0, lookbackHours: 24 };
    const second = { ...primary, id: 'second', timeZone: 'America/Chicago' };
    expect(enqueueDailyDigestIfDue(database, primary, Date.parse('2026-11-08T19:00:00Z'))).toBe(1);
    expect(enqueueDailyDigestIfDue(database, second, due)).toBe(2);
    expect(enqueueDailyDigestIfDue(database, second, due + 60000)).toBeNull();
    const delivered: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const job = claimNextJob(database, due);
      if (!job) throw new Error('Expected separate jobs');
      await processScheduledDigestJob(database, job.payload, {
        generate: async (_start, _end, id) => `Edition for ${id}`,
        deliver: async (markdown, id) => { delivered.push(`${id}: ${markdown}`); },
      });
      completeJob(database, job.id, due);
    }
    expect(delivered).toEqual(['primary: Edition for primary', 'second: Edition for second']);
    expect(database.prepare('SELECT schedule_id, status FROM scheduled_digests ORDER BY schedule_id').all())
      .toEqual([{ schedule_id: 'primary', status: 'delivered' }, { schedule_id: 'second', status: 'delivered' }]);
  });

  test.each([
    ['2026-01-15T14:00:00Z'],
    ['2026-07-15T13:00:00Z'],
  ])('uses 8am Houston time across standard and daylight time: %s', (time) => {
    const due = Date.parse(time);
    const schedule = { id: 'houston', timeZone: 'America/Chicago', hour: 8, minute: 0, lookbackHours: 24 };
    expect(enqueueDailyDigestIfDue(database, schedule, due - 60000)).toBeNull();
    expect(enqueueDailyDigestIfDue(database, schedule, due)).not.toBeNull();
  });

  test('does not send a late catch-up before a subscription start date', () => {
    const schedule = { id: 'houston', timeZone: 'America/Chicago', hour: 8, minute: 0,
      lookbackHours: 24, startDate: '2026-11-09' };
    expect(enqueueDailyDigestIfDue(database, schedule, Date.parse('2026-11-09T00:00:00Z'))).toBeNull();
    expect(enqueueDailyDigestIfDue(database, schedule, Date.parse('2026-11-09T13:59:00Z'))).toBeNull();
    expect(enqueueDailyDigestIfDue(database, schedule, Date.parse('2026-11-09T14:00:00Z'))).not.toBeNull();
  });
});
