import type { BaileysEventMap, WAMessage } from '@whiskeysockets/baileys';
import { describe, expect, test } from 'vitest';

import { HistoryBackfillPlanner } from '../../src/whatsapp/history-backfill.js';

const groupJid = '120363000000000000@g.us';

describe('HistoryBackfillPlanner', () => {
  test('starts one seven-day backfill from the first live allowlisted message', () => {
    const planner = new HistoryBackfillPlanner(new Set([groupJid]));
    const anchor = message(groupJid, 'live-1', 10_000);

    expect(planner.startFromLive(upsert('notify', [anchor]), 10_000)).toEqual([
      { count: 50, key: anchor.key, timestamp: anchor.messageTimestamp },
    ]);
    expect(planner.startFromLive(upsert('notify', [anchor]), 10_001)).toEqual([]);
  });

  test('ignores append batches, direct messages, and non-allowlisted groups', () => {
    const planner = new HistoryBackfillPlanner(new Set([groupJid]));

    expect(planner.startFromLive(upsert('append', [
      message(groupJid, 'append', 10_000),
    ]), 10_000)).toEqual([]);
    expect(planner.startFromLive(upsert('notify', [
      message('15550123456@s.whatsapp.net', 'direct', 10_000),
      message('120363999999999999@g.us', 'other', 10_000),
    ]), 10_000)).toEqual([]);
  });

  test('pages from the oldest returned key and stops at the cutoff', () => {
    const planner = new HistoryBackfillPlanner(new Set([groupJid]), {
      lookbackMs: 7_000,
      maxPages: 20,
    });
    planner.startFromLive(upsert('notify', [
      message(groupJid, 'live', 10_000),
    ]), 10_000);
    const oldest = message(groupJid, 'older', 5_000);

    expect(planner.continueFromHistory(history([message(groupJid, 'newer', 8_000), oldest]))).toEqual([
      { count: 50, key: oldest.key, timestamp: oldest.messageTimestamp },
    ]);
    expect(planner.continueFromHistory(history([
      message(groupJid, 'at-cutoff', 3_000),
    ]))).toEqual([]);
  });
});

function message(remoteJid: string, id: string, timestamp: number): WAMessage {
  return {
    key: { remoteJid, id, fromMe: false },
    messageTimestamp: timestamp / 1_000,
    message: { conversation: id },
  };
}

function upsert(
  type: BaileysEventMap['messages.upsert']['type'],
  messages: WAMessage[],
): BaileysEventMap['messages.upsert'] {
  return { type, messages };
}

function history(messages: WAMessage[]): BaileysEventMap['messaging-history.set'] {
  return { chats: [], contacts: [], messages };
}
