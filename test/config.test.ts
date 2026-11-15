import { describe, expect, test } from 'vitest';

import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const groupEnvironment = {
    GRAVEDIGGER_DATABASE_PATH: '/tmp/gravedigger.sqlite',
    GRAVEDIGGER_AUTH_DIR: '/tmp/gravedigger-auth',
    GRAVEDIGGER_GROUP_JIDS: '120@g.us',
    GRAVEDIGGER_DIGEST_RECIPIENT: '+15550123456',
    GRAVEDIGGER_DIGEST_GROUP_JID: '121@g.us',
  };

  test('selects Lunaroute credentials and its model ahead of legacy OpenRouter settings', () => {
    expect(loadConfig({
      ...groupEnvironment,
      LUNAROUTE_API_KEY: 'lr_test_key',
      LUNAROUTE_MODEL: 'deepseek-4.1-flash',
      OPENROUTER_API_KEY: 'old-openrouter-key',
      OPENROUTER_MODEL: 'deepseek/old-model',
    })).toMatchObject({
      openRouterApiKey: 'lr_test_key',
      openRouterModel: 'deepseek-4.1-flash',
    });
  });

  test('a blank Lunaroute key leaves the existing OpenRouter configuration active', () => {
    expect(loadConfig({
      ...groupEnvironment,
      LUNAROUTE_API_KEY: ' ',
      OPENROUTER_API_KEY: 'old-openrouter-key',
      OPENROUTER_MODEL: 'deepseek/old-model',
    })).toMatchObject({
      openRouterApiKey: 'old-openrouter-key',
      openRouterModel: 'deepseek/old-model',
    });
  });

  test('parses additional private schedules without expanding question authorization', () => {
    const config = loadConfig({ ...groupEnvironment, GRAVEDIGGER_ADDITIONAL_DIGESTS: JSON.stringify([
      { id: 'second', recipient: '+15550987654', timeZone: 'America/Chicago', hour: 8, startDate: '2026-11-09' },
    ]) });
    expect(config.digestRecipientJid).toBe('15550123456@s.whatsapp.net');
    expect(config.additionalDigests).toEqual([{
      id: 'second', recipient: '15550987654@s.whatsapp.net', timeZone: 'America/Chicago',
      hour: 8, minute: 0, lookbackHours: 24, startDate: '2026-11-09',
    }]);
  });

  test('rejects malformed or conflicting additional subscriptions', () => {
    for (const item of [
      { id: 'primary', recipient: '+15550987654', timeZone: 'America/Chicago' },
      { id: 'second', recipient: '120@g.us', timeZone: 'America/Chicago' },
      { id: 'second', recipient: '+15550987654', timeZone: 'Houston' },
    ]) {
      expect(() => loadConfig({ ...groupEnvironment, GRAVEDIGGER_ADDITIONAL_DIGESTS: JSON.stringify([item]) })).toThrow();
    }
  });

  test('separates group newsletter delivery from private question authorization', () => {
    expect(loadConfig(groupEnvironment)).toMatchObject({
      digestGroupJid: '121@g.us',
      digestRecipientJid: '15550123456@s.whatsapp.net',
    });
  });

  test('rejects summary feedback loops and invalid group destinations', () => {
    expect(() => loadConfig({ ...groupEnvironment, GRAVEDIGGER_DIGEST_GROUP_JID: '120@g.us' })).toThrow(/must not/);
    expect(() => loadConfig({ ...groupEnvironment, GRAVEDIGGER_DIGEST_GROUP_JID: '+15550123456' })).toThrow();
    expect(loadConfig({ ...groupEnvironment, GRAVEDIGGER_DIGEST_GROUP_JID: '' }).digestGroupJid).toBeUndefined();
  });
  test('parses paths and a comma-separated allowlist of group JIDs', () => {
    expect(
      loadConfig({
        GRAVEDIGGER_DATABASE_PATH: '/tmp/gravedigger.sqlite',
        GRAVEDIGGER_AUTH_DIR: '/tmp/gravedigger-auth',
        GRAVEDIGGER_GROUP_JIDS: '120@g.us, 121@g.us ',
        GRAVEDIGGER_DIGEST_RECIPIENT: '+15550123456',
        OPENROUTER_API_KEY: 'test-key',
        OPENROUTER_MODEL: 'deepseek/test-model',
      }),
    ).toEqual({
      databasePath: '/tmp/gravedigger.sqlite',
      authDir: '/tmp/gravedigger-auth',
      groupJids: new Set(['120@g.us', '121@g.us']),
      digestRecipientJid: '15550123456@s.whatsapp.net',
      openRouterApiKey: 'test-key',
      openRouterModel: 'deepseek/test-model',
      logLevel: 'info',
      automaticDigestEnabled: true,
      digestHour: 8,
      digestMinute: 0,
      digestTimeZone: 'Pacific/Auckland',
      digestLookbackHours: 24,
    });
  });

  test('rejects an empty group allowlist', () => {
    expect(() =>
      loadConfig({
        GRAVEDIGGER_DATABASE_PATH: '/tmp/gravedigger.sqlite',
        GRAVEDIGGER_AUTH_DIR: '/tmp/gravedigger-auth',
        GRAVEDIGGER_GROUP_JIDS: ' ',
        GRAVEDIGGER_DIGEST_RECIPIENT: '+15550123456',
      }),
    ).toThrow(/GRAVEDIGGER_GROUP_JIDS/);
  });

  test('rejects entries that are not group JIDs', () => {
    expect(() =>
      loadConfig({
        GRAVEDIGGER_DATABASE_PATH: '/tmp/gravedigger.sqlite',
        GRAVEDIGGER_AUTH_DIR: '/tmp/gravedigger-auth',
        GRAVEDIGGER_GROUP_JIDS: 'person@s.whatsapp.net',
        GRAVEDIGGER_DIGEST_RECIPIENT: '+15550123456',
      }),
    ).toThrow(/GRAVEDIGGER_GROUP_JIDS/);
  });

  test('rejects a digest recipient that is not an E.164 phone number', () => {
    expect(() =>
      loadConfig({
        GRAVEDIGGER_DATABASE_PATH: '/tmp/gravedigger.sqlite',
        GRAVEDIGGER_AUTH_DIR: '/tmp/gravedigger-auth',
        GRAVEDIGGER_GROUP_JIDS: '120@g.us',
        GRAVEDIGGER_DIGEST_RECIPIENT: '120@g.us',
      }),
    ).toThrow(/GRAVEDIGGER_DIGEST_RECIPIENT/);
  });

  test('defaults to the pinned low-cost open model without requiring a model key for ingestion', () => {
    expect(
      loadConfig({
        GRAVEDIGGER_DATABASE_PATH: '/tmp/gravedigger.sqlite',
        GRAVEDIGGER_AUTH_DIR: '/tmp/gravedigger-auth',
        GRAVEDIGGER_GROUP_JIDS: '120@g.us',
        GRAVEDIGGER_DIGEST_RECIPIENT: '+15550123456',
      }),
    ).toMatchObject({
      openRouterApiKey: undefined,
      openRouterModel: 'deepseek/deepseek-v4-flash-0731',
    });
  });

  test('parses an explicit automatic digest schedule', () => {
    expect(loadConfig({
      GRAVEDIGGER_DATABASE_PATH: '/tmp/gravedigger.sqlite',
      GRAVEDIGGER_AUTH_DIR: '/tmp/gravedigger-auth',
      GRAVEDIGGER_GROUP_JIDS: '120@g.us',
      GRAVEDIGGER_DIGEST_RECIPIENT: '+15550123456',
      GRAVEDIGGER_AUTO_DIGEST_ENABLED: 'false',
      GRAVEDIGGER_DIGEST_HOUR: '17',
      GRAVEDIGGER_DIGEST_MINUTE: '30',
      GRAVEDIGGER_DIGEST_TIME_ZONE: 'America/Los_Angeles',
      GRAVEDIGGER_DIGEST_LOOKBACK_HOURS: '48',
    })).toMatchObject({
      automaticDigestEnabled: false,
      digestHour: 17,
      digestMinute: 30,
      digestTimeZone: 'America/Los_Angeles',
      digestLookbackHours: 48,
    });
  });
});
