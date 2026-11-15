import 'dotenv/config';

import { describe, test } from 'vitest';

import { loadConfig } from '../../src/config.js';
import { openDatabase } from '../../src/db/database.js';
import { startConnector } from '../../src/whatsapp/connector.js';

const liveTest = process.env.GRAVEDIGGER_DELIVERY_E2E === '1' ? test : test.skip;

describe('live private digest delivery', () => {
  liveTest(
    'sends one explicitly supplied digest only to the configured recipient',
    async () => {
      const markdown = process.env.GRAVEDIGGER_DELIVERY_E2E_MESSAGE;
      if (markdown === undefined || markdown.trim().length === 0) {
        throw new Error('GRAVEDIGGER_DELIVERY_E2E_MESSAGE is required');
      }

      const config = loadConfig(process.env);
      const database = openDatabase(config.databasePath);
      const connector = await startConnector({ config, database });
      try {
        await connector.deliverDigest(markdown);
      } finally {
        await connector.stop();
        database.close();
      }
    },
    120_000,
  );
});
