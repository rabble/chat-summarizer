import type { GravediggerDatabase } from '../db/database.js';

export type HealthReport = {
  databasePath: string;
  lastMessageAt: number | null;
  openGap: { startedAt: number; cause: string } | null;
  jobs: {
    pending: number;
    running: number;
    dead: number;
    byKind: Array<{
      kind: string;
      status: 'pending' | 'running' | 'dead';
      count: number;
    }>;
  };
  unsupportedMessages: number;
};

export function buildHealthReport(
  database: GravediggerDatabase,
  databasePath: string,
): HealthReport {
  const lastMessageAt = database
    .prepare('SELECT max(timestamp_ms) FROM messages')
    .pluck()
    .get() as number | null;
  const gap = database
    .prepare(
      `SELECT started_at, cause
         FROM gaps
        WHERE ended_at IS NULL
        ORDER BY started_at DESC, id DESC
        LIMIT 1`,
    )
    .get() as { started_at: number; cause: string } | undefined;
  const jobRows = database
    .prepare(
      `SELECT kind, status, count(*) AS count
         FROM jobs
        WHERE status IN ('pending', 'running', 'dead')
        GROUP BY kind, status
        ORDER BY kind, status`,
    )
    .all() as Array<{
      kind: string;
      status: 'pending' | 'running' | 'dead';
      count: number;
    }>;
  const countStatus = (status: 'pending' | 'running' | 'dead'): number =>
    jobRows
      .filter((row) => row.status === status)
      .reduce((total, row) => total + row.count, 0);

  return {
    databasePath,
    lastMessageAt,
    openGap:
      gap === undefined ? null : { startedAt: gap.started_at, cause: gap.cause },
    jobs: {
      pending: countStatus('pending'),
      running: countStatus('running'),
      dead: countStatus('dead'),
      byKind: jobRows,
    },
    unsupportedMessages: database
      .prepare('SELECT count(*) FROM unsupported_messages')
      .pluck()
      .get() as number,
  };
}
