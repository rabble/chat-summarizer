import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { openDatabase } from '../../src/db/database.js';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../support/temp-database.js';

const projectRoot = new URL('../..', import.meta.url).pathname;
const cliPath = join(projectRoot, 'dist', 'cli.js');

describe('operator CLI', () => {
  let temporaryDatabase: TemporaryDatabase;

  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], { cwd: projectRoot, stdio: 'pipe' });
    temporaryDatabase = createTemporaryDatabase();
  });

  afterAll(() => {
    temporaryDatabase.cleanup();
  });

  test('health --json reports ingestion and queue state', () => {
    const database = openDatabase(temporaryDatabase.path);
    database.exec(`
      INSERT INTO groups (id, jid, created_at)
      VALUES (1, '120363000000000000@g.us', 1);
      INSERT INTO people (id, jid, created_at)
      VALUES (1, '64210000000@s.whatsapp.net', 1);
      INSERT INTO messages (
        external_id, group_id, sender_id, timestamp_ms, message_type,
        text, raw_json, ingested_at
      ) VALUES ('latest', 1, 1, 123, 'conversation', 'redacted', '{}', 123);
      INSERT INTO gaps (started_at, ended_at, cause, created_at)
      VALUES (100, NULL, 'connection_closed', 100);
      INSERT INTO jobs (
        kind, payload_json, status, available_at, completed_at, created_at, updated_at
      ) VALUES
        ('pending', '{}', 'pending', 1, NULL, 1, 1),
        ('running', '{}', 'running', 1, NULL, 1, 1),
        ('dead', '{}', 'dead', 1, 2, 1, 2);
      INSERT INTO unsupported_messages (reason, raw_json, observed_at)
      VALUES ('unknown', '{}', 1);
    `);
    database.close();

    const result = runCli(
      ['health', '--json'],
      configuredEnvironment(temporaryDatabase),
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      databasePath: temporaryDatabase.path,
      lastMessageAt: 123,
      openGap: { startedAt: 100, cause: 'connection_closed' },
      jobs: {
        pending: 1,
        running: 1,
        dead: 1,
        byKind: [
          { kind: 'dead', status: 'dead', count: 1 },
          { kind: 'pending', status: 'pending', count: 1 },
          { kind: 'running', status: 'running', count: 1 },
        ],
      },
      unsupportedMessages: 1,
    });
  });

  test('purge-person exits nonzero for an unknown JID unless allow-missing is set', () => {
    const database = openDatabase(temporaryDatabase.path);
    database
      .prepare('INSERT INTO people (jid, created_at) VALUES (?, ?)')
      .run('64210000001@s.whatsapp.net', 1);
    database.close();
    const environment = configuredEnvironment(temporaryDatabase);

    const first = runCli(
      ['purge-person', '64210000001@s.whatsapp.net', '--json'],
      environment,
    );
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({ found: true, people: 1 });

    const missing = runCli(
      ['purge-person', '64210000001@s.whatsapp.net', '--json'],
      environment,
    );
    expect(missing.status).toBe(2);
    expect(JSON.parse(missing.stdout)).toMatchObject({ found: false });

    const allowed = runCli(
      [
        'purge-person',
        '64210000001@s.whatsapp.net',
        '--json',
        '--allow-missing',
      ],
      environment,
    );
    expect(allowed.status).toBe(0);
  });

  test('invalid configuration exits without dumping environment values', () => {
    const environment = { ...process.env };
    delete environment.GRAVEDIGGER_DATABASE_PATH;
    delete environment.GRAVEDIGGER_AUTH_DIR;
    delete environment.GRAVEDIGGER_GROUP_JIDS;
    environment.ANTHROPIC_API_KEY = 'SECRET_SENTINEL';
    environment.DOTENV_CONFIG_PATH = join(
      temporaryDatabase.directory,
      'intentionally-missing.env',
    );

    const result = runCli(['health', '--json'], environment);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Invalid GRAVEDIGGER configuration');
    expect(result.stderr).not.toContain('SECRET_SENTINEL');
  });

  test('help lists the start, health, and purge commands', () => {
    const result = runCli(['--help'], process.env);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('start');
    expect(result.stdout).toContain('health');
    expect(result.stdout).toContain('purge-person');
  });
});

function configuredEnvironment(
  temporary: TemporaryDatabase,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GRAVEDIGGER_DATABASE_PATH: temporary.path,
    GRAVEDIGGER_AUTH_DIR: join(temporary.directory, 'auth'),
    GRAVEDIGGER_GROUP_JIDS: '120363000000000000@g.us',
    GRAVEDIGGER_DIGEST_RECIPIENT: '+15550123456',
    GRAVEDIGGER_DIGEST_GROUP_JID: '',
    GRAVEDIGGER_ADDITIONAL_DIGESTS: '[]',
    GRAVEDIGGER_AUTO_DIGEST_ENABLED: 'false',
    GRAVEDIGGER_LOG_LEVEL: 'silent',
  };
}

function runCli(
  arguments_: string[],
  environment: NodeJS.ProcessEnv,
): ReturnType<typeof spawnSync> & { stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cliPath, ...arguments_], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: environment,
  });
  return result as ReturnType<typeof spawnSync> & {
    stdout: string;
    stderr: string;
  };
}
