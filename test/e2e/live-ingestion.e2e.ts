import 'dotenv/config';

import { describe, expect, test } from 'vitest';

import { loadConfig } from '../../src/config.js';
import { openDatabase } from '../../src/db/database.js';
import { startConnector } from '../../src/whatsapp/connector.js';

const liveTest = process.env.GRAVEDIGGER_E2E === '1' ? test : test.skip;
const timeoutMs = parseTimeout(process.env.GRAVEDIGGER_E2E_TIMEOUT_MS);

describe('live WhatsApp ingestion', () => {
  liveTest(
    'stores one real allowlisted message with its envelope, FTS row, and downstream job',
    async () => {
      const config = loadConfig(process.env);
      const marker = process.env.GRAVEDIGGER_E2E_MARKER?.trim() || undefined;
      const database = openDatabase(config.databasePath);
      const baselineMessageId = database
        .prepare('SELECT coalesce(max(id), 0) FROM messages')
        .pluck()
        .get() as number;
      const connector = await startConnector({ config, database });

      if (marker === undefined) {
        process.stdout.write(
          '\nSilently waiting for the next organic text message in an allowlisted group.\n',
        );
      } else {
        process.stdout.write(
          `\nWaiting for the explicitly configured dedicated-group marker:\n\n${marker}\n\n`,
        );
      }

      try {
        const stored = await waitFor(
          () =>
            (marker === undefined
              ? database
                  .prepare(
                    `SELECT id, external_id, raw_json, text
                       FROM messages
                      WHERE id > ?
                        AND text IS NOT NULL
                      ORDER BY id
                      LIMIT 1`,
                  )
                  .get(baselineMessageId)
              : database
                  .prepare(
                    `SELECT id, external_id, raw_json, text
                       FROM messages
                      WHERE text = ?
                      ORDER BY id DESC
                      LIMIT 1`,
                  )
                  .get(marker)) as
              | {
                  id: number;
                  external_id: string;
                  raw_json: string;
                  text: string;
                }
              | undefined,
          marker === undefined
            ? 'the next organic allowlisted text message to appear in SQLite'
            : 'the configured marker to appear in SQLite',
          timeoutMs,
        );

        expect(JSON.parse(stored.raw_json)).toHaveProperty('message');
        expect(
          database
            .prepare('SELECT text FROM message_fts WHERE rowid = ?')
            .pluck()
            .get(stored.id),
        ).toBe(stored.text);
        expect(
          database
            .prepare(
              `SELECT count(*)
                 FROM jobs
                WHERE kind = 'segment_window'
                  AND json_extract(payload_json, '$.messageExternalId') = ?`,
            )
            .pluck()
            .get(stored.external_id),
        ).toBe(1);
      } finally {
        await connector.stop();
        database.close();
      }
    },
    timeoutMs + 30_000,
  );
});

async function waitFor<T>(
  condition: () => T | undefined | null | false,
  description: string,
  maximumWaitMs: number,
): Promise<T> {
  const startedAt = Date.now();

  while (true) {
    const result = condition();
    if (result) {
      return result;
    }
    if (Date.now() - startedAt >= maximumWaitMs) {
      throw new Error(
        `Timeout waiting for ${description} after ${maximumWaitMs}ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined) {
    return 300_000;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000) {
    throw new Error('GRAVEDIGGER_E2E_TIMEOUT_MS must be an integer of at least 1000');
  }
  return parsed;
}
