import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

import { migrations } from './migrations.js';

export type GravediggerDatabase = Database.Database;

export function openDatabase(path: string): GravediggerDatabase {
  mkdirSync(dirname(path), { recursive: true });

  const database = new Database(path);
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  database.pragma('journal_mode = WAL');

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const appliedVersions = new Set(
    database
      .prepare('SELECT version FROM schema_migrations')
      .pluck()
      .all() as number[],
  );
  const applyMigration = database.transaction((version: number, sql: string) => {
    database.exec(sql);
    database
      .prepare(
        `INSERT INTO schema_migrations (version, applied_at)
         VALUES (?, ?)`,
      )
      .run(version, new Date().toISOString());
  });

  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) {
      applyMigration(migration.version, migration.sql);
    }
  }

  return database;
}
