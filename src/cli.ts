#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';
import 'dotenv/config';
import pino from 'pino';

import { answerQuestion } from './agent/question.js';
import { loadConfig, type Config } from './config.js';
import { openDatabase } from './db/database.js';
import {
  buildScheduledDigestInput,
  processScheduledDigestJob,
  startDailyDigestScheduler,
  type RunningDigestScheduler,
} from './digests/digest-scheduler.js';
import { buildHealthReport } from './health/health-report.js';
import { startJobWorker } from './jobs/job-worker.js';
import { purgePerson } from './privacy/purge-person.js';
import { startConnector } from './whatsapp/connector.js';

export async function main(arguments_: string[] = process.argv): Promise<void> {
  const program = new Command()
    .name('community-brief')
    .description('Community Brief — self-hosted WhatsApp community briefings')
    .showHelpAfterError()
    .showSuggestionAfterError();

  program
    .command('start')
    .description('start the live WhatsApp companion-device connector')
    .action(async () => {
      const config = loadCliConfig();
      const database = openDatabase(config.databasePath);
      const logger = pino({ level: config.logLevel });
      try {
        const connector = await startConnector({ config, database, logger });
        const worker = startJobWorker({
          database,
          logger,
          buildDigest: (payload) => processScheduledDigestJob(database, payload, {
            generate: (windowStartedAt, windowEndedAt, scheduleId) => answerQuestion(database,
              buildScheduledDigestInput(config, windowStartedAt, windowEndedAt, scheduleId)),
            deliver: (markdown, scheduleId) => {
              if (scheduleId === 'primary') return connector.deliverDigest(markdown);
              const schedule = config.additionalDigests?.find((item) => item.id === scheduleId);
              if (schedule === undefined) throw new Error('Newsletter schedule is no longer configured');
              return connector.deliverDigest(markdown, schedule.recipient);
            },
          }),
        });
        const schedulers: RunningDigestScheduler[] = [];
        if (config.automaticDigestEnabled && config.openRouterApiKey !== undefined) {
          schedulers.push(startDailyDigestScheduler({
            database,
            schedule: {
              timeZone: config.digestTimeZone,
              hour: config.digestHour,
              minute: config.digestMinute,
              lookbackHours: config.digestLookbackHours,
            },
            wakeWorker: worker.wake,
          }));
          logger.info({ scheduleId: 'primary', hour: config.digestHour,
            minute: config.digestMinute, timeZone: config.digestTimeZone }, 'daily digest schedule active');
          for (const schedule of config.additionalDigests ?? []) {
            schedulers.push(startDailyDigestScheduler({
              database, schedule, wakeWorker: worker.wake,
            }));
            logger.info({ scheduleId: schedule.id, hour: schedule.hour,
              minute: schedule.minute, timeZone: schedule.timeZone,
              startDate: schedule.startDate }, 'daily digest schedule active');
          }
        } else if (config.automaticDigestEnabled) {
          logger.warn('automatic digest disabled because LUNAROUTE_API_KEY and OPENROUTER_API_KEY are absent');
        }
        let shuttingDown = false;
        const shutdown = (signal: string): void => {
          if (shuttingDown) {
            return;
          }
          shuttingDown = true;
          logger.info({ signal }, 'shutting down Community Brief');
          for (const scheduler of schedulers) scheduler.stop();
          void worker.stop().then(
            () => connector.stop(),
          ).then(
            () => database.close(),
            (error: unknown) => {
              logger.error({ error: safeError(error) }, 'shutdown failed');
              database.close();
              process.exitCode = 1;
            },
          );
        };
        process.once('SIGINT', () => shutdown('SIGINT'));
        process.once('SIGTERM', () => shutdown('SIGTERM'));
      } catch (error) {
        database.close();
        throw error;
      }
    });

  program
    .command('health')
    .description('show connector, queue, and ingestion health')
    .option('--json', 'emit machine-readable JSON')
    .action((options: { json?: boolean }) => {
      const config = loadCliConfig();
      const database = openDatabase(config.databasePath);
      try {
        writeResult(
          buildHealthReport(database, config.databasePath),
          options.json === true,
        );
      } finally {
        database.close();
      }
    });

  program
    .command('purge-person')
    .description('delete one sender and every affected derived cache')
    .argument('<jid>', 'sender JID, for example 6421…@s.whatsapp.net')
    .option('--json', 'emit machine-readable JSON')
    .option('--allow-missing', 'exit successfully when the sender is already absent')
    .action(
      (
        jid: string,
        options: { json?: boolean; allowMissing?: boolean },
      ) => {
        const config = loadCliConfig();
        const database = openDatabase(config.databasePath);
        try {
          const report = purgePerson(database, jid);
          writeResult(report, options.json === true);
          if (!report.found && options.allowMissing !== true) {
            process.exitCode = 2;
          }
        } finally {
          database.close();
        }
      },
    );

  await program.parseAsync(arguments_);
}

function loadCliConfig(): Config {
  try {
    return loadConfig(process.env);
  } catch {
    throw new Error(
      'Invalid GRAVEDIGGER configuration. Check the required GRAVEDIGGER_* environment variables.',
    );
  }
}

function writeResult(value: unknown, asJson: boolean): void {
  process.stdout.write(`${JSON.stringify(value, null, asJson ? 0 : 2)}\n`);
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const executablePath = process.argv[1];
if (
  executablePath !== undefined &&
  resolve(executablePath) === resolve(fileURLToPath(import.meta.url))
) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${safeError(error)}\n`);
    process.exitCode = 1;
  });
}
