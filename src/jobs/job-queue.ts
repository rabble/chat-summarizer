import type { GravediggerDatabase } from '../db/database.js';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type EnqueueJobInput = {
  kind: string;
  payload: JsonValue;
  availableAt?: number;
  maxAttempts?: number;
};

export type ClaimedJob = {
  id: number;
  kind: string;
  payload: JsonValue;
  attempts: number;
  maxAttempts: number;
  availableAt: number;
  lockedAt: number;
};

export function enqueueJob(
  database: GravediggerDatabase,
  input: EnqueueJobInput,
  observedAt: number = Date.now(),
): number {
  const result = database
    .prepare(
      `INSERT INTO jobs (
         kind, payload_json, max_attempts, available_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.kind,
      JSON.stringify(input.payload),
      input.maxAttempts ?? 5,
      input.availableAt ?? observedAt,
      observedAt,
      observedAt,
    );

  return Number(result.lastInsertRowid);
}

export function claimNextJob(
  database: GravediggerDatabase,
  observedAt: number = Date.now(),
): ClaimedJob | null {
  const claim = database.transaction(() => {
    const row = database
      .prepare(
        `SELECT id, kind, payload_json, attempts, max_attempts, available_at
          FROM jobs
          WHERE status = 'pending' AND available_at <= ?
          ORDER BY CASE kind
                     WHEN 'build_digest' THEN 0
                     WHEN 'segment_window' THEN 1
                     WHEN 'fetch_link' THEN 2
                     ELSE 3
                   END,
                   available_at, id
          LIMIT 1`,
      )
      .get(observedAt) as QueueRow | undefined;

    if (row === undefined) {
      return null;
    }

    database
      .prepare(
        `UPDATE jobs
            SET status = 'running', locked_at = ?, updated_at = ?
          WHERE id = ? AND status = 'pending'`,
      )
      .run(observedAt, observedAt, row.id);

    return {
      id: row.id,
      kind: row.kind,
      payload: JSON.parse(row.payload_json) as JsonValue,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      availableAt: row.available_at,
      lockedAt: observedAt,
    };
  });

  return claim.immediate();
}

export function completeJob(
  database: GravediggerDatabase,
  id: number,
  observedAt: number = Date.now(),
): void {
  const result = database
    .prepare(
      `UPDATE jobs
          SET status = 'completed', completed_at = ?, locked_at = NULL,
              updated_at = ?
        WHERE id = ? AND status = 'running'`,
    )
    .run(observedAt, observedAt, id);

  if (result.changes !== 1) {
    throw new Error(`Job ${id} is not running`);
  }
}

export function failJob(
  database: GravediggerDatabase,
  id: number,
  error: unknown,
  observedAt: number = Date.now(),
  baseDelayMs: number = 1_000,
): 'pending' | 'dead' {
  return database.transaction(() => {
    const row = database
      .prepare(
        `SELECT attempts, max_attempts
           FROM jobs
          WHERE id = ? AND status = 'running'`,
      )
      .get(id) as { attempts: number; max_attempts: number } | undefined;

    if (row === undefined) {
      throw new Error(`Job ${id} is not running`);
    }

    const attempts = row.attempts + 1;
    const errorText = errorMessage(error).slice(0, 2_000);
    if (attempts >= row.max_attempts) {
      database
        .prepare(
          `UPDATE jobs
              SET status = 'dead', attempts = ?, completed_at = ?,
                  locked_at = NULL, last_error = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(attempts, observedAt, errorText, observedAt, id);
      return 'dead';
    }

    const availableAt = observedAt + baseDelayMs * 2 ** (attempts - 1);
    database
      .prepare(
        `UPDATE jobs
            SET status = 'pending', attempts = ?, available_at = ?,
                locked_at = NULL, last_error = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(attempts, availableAt, errorText, observedAt, id);
    return 'pending';
  })();
}

export function recoverStaleJobs(
  database: GravediggerDatabase,
  staleBefore: number,
  observedAt: number = Date.now(),
): number {
  const result = database
    .prepare(
      `UPDATE jobs
          SET status = 'pending', available_at = ?, locked_at = NULL,
              updated_at = ?
        WHERE status = 'running' AND locked_at < ?`,
    )
    .run(observedAt, observedAt, staleBefore);

  return result.changes;
}

type QueueRow = {
  id: number;
  kind: string;
  payload_json: string;
  attempts: number;
  max_attempts: number;
  available_at: number;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
