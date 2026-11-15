import { z } from 'zod';

import type { AnswerQuestionInput } from '../agent/question.js';
import type { Config } from '../config.js';
import type { GravediggerDatabase } from '../db/database.js';
import { enqueueJob, type JsonValue } from '../jobs/job-queue.js';

export type DigestSchedule = {
  timeZone: string;
  hour: number;
  minute: number;
  lookbackHours: number;
  id?: string;
  startDate?: string | undefined;
};

export type RunningDigestScheduler = {
  stop: () => void;
};

const scheduledDigestPayloadSchema = z.object({
  scheduleId: z.string().default('primary'),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  windowStartedAt: z.number().int().nonnegative(),
  windowEndedAt: z.number().int().nonnegative(),
});

export function buildScheduledDigestInput(
  config: Config,
  windowStartedAt: number,
  windowEndedAt: number,
  scheduleId: string,
): AnswerQuestionInput {
  if (config.openRouterApiKey === undefined) {
    throw new Error('Cannot generate a scheduled digest without LUNAROUTE_API_KEY or OPENROUTER_API_KEY');
  }
  const anonymous = scheduleId !== 'primary';
  return {
    apiKey: config.openRouterApiKey,
    model: config.openRouterModel,
    groupJids: config.groupJids,
    anonymous,
    includeParticipantProfiles: !anonymous && config.digestGroupJid === undefined,
    question: [
      windowEndedAt - windowStartedAt > 48 * 60 * 60_000
        ? 'Write a catch-up editorial newsletter synthesizing the monitored community rooms across the entire supplied multi-week window. Describe trends across the window, not just the latest day. Begin with Community Brief — Catch-up and the date range.'
        : 'Write the automatic daily editorial newsletter for the monitored community rooms. Begin with Community Brief and the edition date.',
      `Evidence window: ${new Date(windowStartedAt).toISOString()} to ${new Date(windowEndedAt).toISOString()}. Be clear about missing rooms and incomplete captured history.`,
      anonymous
        ? 'Follow Chatham House rules: no participant names, identifying attribution, or verbatim quotes. Preserve disagreements and include direct shared links.'
        : 'Tell the strongest cross-room story, attribute consequential claims by verified participant name, preserve disagreements, and include direct shared links. Use only names supplied in the evidence; never guess identities.',
      'Do not mention GRAVEDIGGER operations.',
    ].join(' '),
    now: windowEndedAt,
    lookbackMs: windowEndedAt - windowStartedAt,
  };
}

export function enqueueDailyDigestIfDue(
  database: GravediggerDatabase,
  schedule: DigestSchedule,
  observedAt: number = Date.now(),
): number | null {
  const local = localDateTime(observedAt, schedule.timeZone);
  if (schedule.startDate !== undefined && local.date < schedule.startDate) return null;
  const scheduleId = schedule.id ?? 'primary';
  if (
    local.hour < schedule.hour ||
    (local.hour === schedule.hour && local.minute < schedule.minute)
  ) {
    return null;
  }
  return database.transaction(() => {
    const exists = database.prepare(
      'SELECT 1 FROM scheduled_digests WHERE schedule_id = ? AND local_date = ?',
    ).get(scheduleId, local.date);
    if (exists !== undefined) return null;
    const windowStartedAt = observedAt - schedule.lookbackHours * 60 * 60_000;
    const payload = {
      scheduleId,
      localDate: local.date,
      windowStartedAt,
      windowEndedAt: observedAt,
    };
    const jobId = enqueueJob(database, {
      kind: 'build_digest',
      payload,
      maxAttempts: 5,
    }, observedAt);
    database.prepare(
      `INSERT INTO scheduled_digests (
         schedule_id, local_date, window_started_at, window_ended_at, job_id,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      scheduleId, local.date,
      windowStartedAt,
      observedAt,
      jobId,
      observedAt,
      observedAt,
    );
    return jobId;
  })();
}

export async function processScheduledDigestJob(
  database: GravediggerDatabase,
  rawPayload: JsonValue,
  input: {
    generate: (windowStartedAt: number, windowEndedAt: number, scheduleId: string) => Promise<string>;
    deliver: (markdown: string, scheduleId: string) => Promise<void>;
    now?: () => number;
  },
): Promise<void> {
  const payload = scheduledDigestPayloadSchema.parse(rawPayload);
  const row = database.prepare(
    `SELECT status, markdown
       FROM scheduled_digests
      WHERE schedule_id = ? AND local_date = ?`,
  ).get(payload.scheduleId, payload.localDate) as {
    status: 'scheduled' | 'delivered';
    markdown: string | null;
  } | undefined;
  if (row === undefined) throw new Error(`Scheduled digest ${payload.localDate} does not exist`);
  if (row.status === 'delivered') return;

  const markdown = row.markdown ?? await input.generate(
    payload.windowStartedAt,
    payload.windowEndedAt,
    payload.scheduleId,
  );
  if (row.markdown === null) {
    database.prepare(
      `UPDATE scheduled_digests SET markdown = ?, updated_at = ?
        WHERE schedule_id = ? AND local_date = ?`,
    ).run(markdown, (input.now ?? Date.now)(), payload.scheduleId, payload.localDate);
  }
  await input.deliver(markdown, payload.scheduleId);
  const deliveredAt = (input.now ?? Date.now)();
  database.prepare(
    `UPDATE scheduled_digests
        SET status = 'delivered', delivered_at = ?, updated_at = ?
      WHERE schedule_id = ? AND local_date = ?`,
  ).run(deliveredAt, deliveredAt, payload.scheduleId, payload.localDate);
}

export function startDailyDigestScheduler(input: {
  database: GravediggerDatabase;
  schedule: DigestSchedule;
  wakeWorker: () => void;
  pollMs?: number;
}): RunningDigestScheduler {
  const tick = (): void => {
    const jobId = enqueueDailyDigestIfDue(input.database, input.schedule);
    if (jobId !== null) input.wakeWorker();
  };
  tick();
  const timer = setInterval(tick, input.pollMs ?? 60_000);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}

function localDateTime(
  timestamp: number,
  timeZone: string,
): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    hour: Number(value('hour')),
    minute: Number(value('minute')),
  };
}
