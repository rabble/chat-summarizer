import 'dotenv/config';

import { describe, expect, test } from 'vitest';

import { completeOpenRouterText } from '../../src/models/openrouter.js';
import { loadConfig } from '../../src/config.js';

const live = process.env.GRAVEDIGGER_MODEL_E2E === '1';

describe.runIf(live)('live configured model provider', () => {
  test('answers a harmless request through the configured open model', async () => {
    const config = loadConfig(process.env);
    const apiKey = config.openRouterApiKey;
    if (apiKey === undefined || apiKey.trim() === '') {
      throw new Error('LUNAROUTE_API_KEY or OPENROUTER_API_KEY is required for the live model E2E');
    }

    const answer = await completeOpenRouterText({
      apiKey,
      model: config.openRouterModel,
      system: 'Follow the user instruction exactly.',
      user: 'Reply with exactly: GRAVEDIGGER_OK',
      maxTokens: 20,
    });

    expect(answer.trim()).toBe('GRAVEDIGGER_OK');
  }, 60_000);
});
