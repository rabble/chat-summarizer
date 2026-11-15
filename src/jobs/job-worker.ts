import { setImmediate as yieldToEventLoop } from 'node:timers/promises';

import type { Logger } from 'pino';
import { z } from 'zod';

import type { GravediggerDatabase } from '../db/database.js';
import { enrichStoredLink } from '../links/link-enricher.js';
import { segmentUnthreadedMessages } from '../threads/segmenter.js';
import {
  claimNextJob,
  completeJob,
  failJob,
  recoverStaleJobs,
  type ClaimedJob,
  type JsonValue,
} from './job-queue.js';

export type DrainReport = {
  claimed: number;
  completed: number;
  failed: number;
  dead: number;
  reachedLimit: boolean;
};

type WorkerContext = {
  now?: () => number;
  maxJobs?: number;
  shouldContinue?: () => boolean;
  buildDigest?: (payload: JsonValue) => Promise<void>;
};

export type RunningJobWorker = {
  wake: () => void;
  stop: () => Promise<void>;
};

const segmentPayloadSchema = z.object({
  groupJid: z.string().endsWith('@g.us'),
  messageExternalId: z.string().min(1),
  timestampMs: z.number().int().nonnegative(),
});
const linkPayloadSchema = z.object({
  linkId: z.number().int().positive(),
  url: z.string().url(),
});

export async function drainDueJobs(
  database: GravediggerDatabase,
  context: WorkerContext = {},
): Promise<DrainReport> {
  const now = context.now ?? Date.now;
  const maxJobs = context.maxJobs ?? 100;
  const report: DrainReport = {
    claimed: 0,
    completed: 0,
    failed: 0,
    dead: 0,
    reachedLimit: false,
  };

  while (
    report.claimed < maxJobs &&
    (context.shouldContinue === undefined || context.shouldContinue())
  ) {
    const job = claimNextJob(database, now());
    if (job === null) return report;
    report.claimed += 1;
    try {
      await processJob(database, job, context);
      completeJob(database, job.id, now());
      report.completed += 1;
    } catch (error) {
      const disposition = failJob(database, job.id, error, now());
      report.failed += 1;
      if (disposition === 'dead') report.dead += 1;
    }
    // Awaiting synchronous SQLite work only yields to microtasks. Give socket
    // events, heartbeats, and shutdown signals a turn before claiming more work.
    await yieldToEventLoop();
  }
  report.reachedLimit = true;
  return report;
}

export function startJobWorker(input: {
  database: GravediggerDatabase;
  logger: Logger;
  buildDigest?: (payload: JsonValue) => Promise<void>;
  idlePollMs?: number;
}): RunningJobWorker {
  recoverStaleJobs(input.database, Date.now() - 5 * 60_000);
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  const schedule = (delayMs: number): void => {
    if (stopped) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(pump, delayMs);
    timer.unref();
  };
  const pump = (): void => {
    if (stopped) return;
    timer = undefined;
    running = drainDueJobs(input.database, {
      maxJobs: 100,
      shouldContinue: () => !stopped,
      ...(input.buildDigest === undefined ? {} : { buildDigest: input.buildDigest }),
    }).then(
      (report) => {
        if (report.claimed > 0) input.logger.info({ report }, 'processed background jobs');
        schedule(report.reachedLimit ? 0 : (input.idlePollMs ?? 1_000));
      },
      (error: unknown) => {
        input.logger.error({ error: errorText(error) }, 'background worker failed');
        schedule(input.idlePollMs ?? 1_000);
      },
    );
  };
  const wake = (): void => schedule(0);
  wake();

  return {
    wake,
    stop: async () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      await running;
    },
  };
}

async function processJob(
  database: GravediggerDatabase,
  job: ClaimedJob,
  context: WorkerContext,
): Promise<void> {
  if (job.kind === 'segment_window') {
    const payload = segmentPayloadSchema.parse(job.payload);
    segmentUnthreadedMessages(database, payload.groupJid);
    return;
  }
  if (job.kind === 'fetch_link') {
    const payload = linkPayloadSchema.parse(job.payload);
    await enrichStoredLink(database, payload.linkId);
    return;
  }
  if (job.kind === 'build_digest' && context.buildDigest !== undefined) {
    await context.buildDigest(job.payload);
    return;
  }
  throw new Error(`Unsupported job kind: ${job.kind}`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
