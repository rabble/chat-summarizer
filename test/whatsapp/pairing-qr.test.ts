import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { writePairingQr } from '../../src/whatsapp/pairing-qr.js';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../support/temp-database.js';

describe('writePairingQr', () => {
  let temporaryDirectory: TemporaryDatabase | undefined;

  afterEach(() => temporaryDirectory?.cleanup());

  test('writes a private PNG that can be surfaced outside terminal output', async () => {
    temporaryDirectory = createTemporaryDatabase();
    const outputPath = join(temporaryDirectory.directory, 'private', 'pairing-qr.png');

    await writePairingQr('redacted-pairing-token', outputPath);

    expect(readFileSync(outputPath).subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
  });
});
