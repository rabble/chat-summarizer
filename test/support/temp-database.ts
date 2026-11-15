import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type TemporaryDatabase = {
  directory: string;
  path: string;
  cleanup: () => void;
};

export function createTemporaryDatabase(): TemporaryDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'gravedigger-test-'));

  return {
    directory,
    path: join(directory, 'test.sqlite'),
    cleanup: () => rmSync(directory, { force: true, recursive: true }),
  };
}

