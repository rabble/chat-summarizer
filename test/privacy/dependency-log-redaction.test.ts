import { describe, expect, test } from 'vitest';

import { buildRedactedConsoleInfo } from '../../src/privacy/dependency-log-redaction.js';

describe('dependency console log redaction', () => {
  test('suppresses libsignal session dumps while preserving ordinary console info', () => {
    const calls: unknown[][] = [];
    const redacted = buildRedactedConsoleInfo((...arguments_: unknown[]) => {
      calls.push(arguments_);
    });

    redacted('Closing session:', { privateKey: 'must-not-appear' });
    redacted('ordinary diagnostic', { count: 2 });

    expect(calls).toEqual([['ordinary diagnostic', { count: 2 }]]);
  });
});
