import type { GravediggerDatabase } from '../db/database.js';

export type Gap = {
  id: number;
  startedAt: number;
  endedAt: number | null;
  cause: string;
};

export function recordConnected(
  database: GravediggerDatabase,
  observedAt: number,
): void {
  database.transaction(() => {
    const state = readState(database);
    if (state?.status === 'disconnected') {
      const openGaps = database
        .prepare(
          `SELECT id, started_at, cause, created_at
             FROM gaps
            WHERE ended_at IS NULL`,
        )
        .all() as OpenGapRow[];

      for (const gap of openGaps) {
        database.prepare('DELETE FROM gaps WHERE id = ?').run(gap.id);
        mergeGap(
          database,
          gap.started_at,
          observedAt,
          gap.cause,
          gap.created_at,
        );
      }
      reconcileOperationalGaps(database, observedAt);
    }

    writeState(database, 'connected', observedAt, observedAt);
  })();
}

export function recordDisconnected(
  database: GravediggerDatabase,
  observedAt: number,
  cause: string,
): void {
  database.transaction(() => {
    const state = readState(database);
    if (state?.status === 'disconnected') {
      return;
    }

    mergeGap(database, observedAt, null, cause, observedAt);
    writeState(database, 'disconnected', observedAt, state?.last_heartbeat_at ?? null);
  })();
}

export function recordHeartbeat(
  database: GravediggerDatabase,
  observedAt: number,
): void {
  database
    .prepare(
      `UPDATE connector_state
          SET observed_at = ?, last_heartbeat_at = ?
        WHERE singleton = 1 AND status = 'connected'`,
    )
    .run(observedAt, observedAt);
}

export function recoverUncleanStartup(
  database: GravediggerDatabase,
  observedAt: number,
): boolean {
  return database.transaction(() => {
    const state = readState(database);
    if (state?.status !== 'connected') {
      return false;
    }

    const gapStartedAt = state.last_heartbeat_at ?? state.observed_at;
    mergeGap(database, gapStartedAt, null, 'process_restart', observedAt);
    writeState(database, 'disconnected', observedAt, state.last_heartbeat_at);
    return true;
  })();
}

export function findGapsOverlapping(
  database: GravediggerDatabase,
  windowStartedAt: number,
  windowEndedAt: number,
): Gap[] {
  const rows = database
    .prepare(
      `SELECT id, started_at, ended_at, cause
         FROM gaps
        WHERE started_at < ?
          AND coalesce(ended_at, 9223372036854775807) > ?
          AND reconciled_at IS NULL
        ORDER BY started_at, id`,
    )
    .all(windowEndedAt, windowStartedAt) as GapRow[];

  return rows.map((row) => ({
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    cause: row.cause,
  }));
}

export function reconcileGapsFromStoredHistory(
  database: GravediggerDatabase,
  observedAt: number = Date.now(),
): number {
  return database.prepare(
    `UPDATE gaps
        SET reconciled_at = ?, reconciliation_reason = 'history_recovered'
      WHERE reconciled_at IS NULL
        AND ended_at IS NOT NULL
        AND EXISTS (
          SELECT 1
            FROM messages m
           WHERE m.timestamp_ms >= gaps.started_at
             AND m.timestamp_ms < gaps.ended_at
             AND m.ingested_at >= gaps.ended_at
        )`,
  ).run(observedAt).changes;
}

function reconcileOperationalGaps(
  database: GravediggerDatabase,
  observedAt: number,
): void {
  database.prepare(
    `UPDATE gaps
        SET reconciled_at = ?,
            reconciliation_reason = CASE
              WHEN cause = 'operator_stop' THEN 'planned_restart'
              ELSE 'brief_reconnect'
            END
      WHERE reconciled_at IS NULL
        AND ended_at IS NOT NULL
        AND (cause = 'operator_stop' OR ended_at - started_at < 300000)`,
  ).run(observedAt);
}

function mergeGap(
  database: GravediggerDatabase,
  startedAt: number,
  endedAt: number | null,
  cause: string,
  createdAt: number,
): void {
  const overlapping = database
    .prepare(
      `SELECT id, started_at, ended_at, cause, created_at
         FROM gaps
        WHERE coalesce(ended_at, 9223372036854775807) > ?
          AND (? IS NULL OR started_at < ?)
        ORDER BY started_at, id`,
    )
    .all(startedAt, endedAt, endedAt) as GapStorageRow[];

  if (overlapping.length === 0) {
    database
      .prepare(
        `INSERT INTO gaps (started_at, ended_at, cause, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(startedAt, endedAt, cause, createdAt);
    return;
  }

  const mergedStartedAt = Math.min(
    startedAt,
    ...overlapping.map((gap) => gap.started_at),
  );
  const hasOpenEnd =
    endedAt === null || overlapping.some((gap) => gap.ended_at === null);
  const closedEnds = overlapping.flatMap((gap) =>
    gap.ended_at === null ? [] : [gap.ended_at],
  );
  const mergedEndedAt = hasOpenEnd
    ? null
    : Math.max(endedAt as number, ...closedEnds);
  const earliest = overlapping.find((gap) => gap.started_at === mergedStartedAt);
  const mergedCause = earliest?.cause ?? cause;
  const mergedCreatedAt = Math.min(
    createdAt,
    ...overlapping.map((gap) => gap.created_at),
  );
  const placeholders = overlapping.map(() => '?').join(', ');
  database
    .prepare(`DELETE FROM gaps WHERE id IN (${placeholders})`)
    .run(...overlapping.map((gap) => gap.id));
  database
    .prepare(
      `INSERT INTO gaps (started_at, ended_at, cause, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(mergedStartedAt, mergedEndedAt, mergedCause, mergedCreatedAt);
}

function readState(database: GravediggerDatabase): ConnectorStateRow | undefined {
  return database
    .prepare(
      `SELECT status, observed_at, last_heartbeat_at
         FROM connector_state
        WHERE singleton = 1`,
    )
    .get() as ConnectorStateRow | undefined;
}

function writeState(
  database: GravediggerDatabase,
  status: ConnectorStateRow['status'],
  observedAt: number,
  lastHeartbeatAt: number | null,
): void {
  database
    .prepare(
      `INSERT INTO connector_state (
         singleton, status, observed_at, last_heartbeat_at
       ) VALUES (1, ?, ?, ?)
       ON CONFLICT (singleton) DO UPDATE SET
         status = excluded.status,
         observed_at = excluded.observed_at,
         last_heartbeat_at = excluded.last_heartbeat_at`,
    )
    .run(status, observedAt, lastHeartbeatAt);
}

type ConnectorStateRow = {
  status: 'connected' | 'disconnected' | 'logged_out';
  observed_at: number;
  last_heartbeat_at: number | null;
};

type OpenGapRow = {
  id: number;
  started_at: number;
  cause: string;
  created_at: number;
};

type GapRow = {
  id: number;
  started_at: number;
  ended_at: number | null;
  cause: string;
};

type GapStorageRow = GapRow & { created_at: number };
