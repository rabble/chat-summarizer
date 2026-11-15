import type {
  BaileysEventMap,
  WAMessage,
  WAMessageKey,
} from '@whiskeysockets/baileys';
import type Long from 'long';

export type HistoryRequest = {
  count: number;
  key: WAMessageKey;
  timestamp: number | Long;
};

type BackfillState = {
  cutoffMs: number;
  pagesRequested: number;
};

export class HistoryBackfillPlanner {
  readonly #groupAllowlist: ReadonlySet<string>;
  readonly #lookbackMs: number;
  readonly #maxPages: number;
  readonly #pageSize: number;
  readonly #states = new Map<string, BackfillState>();

  constructor(
    groupAllowlist: ReadonlySet<string>,
    options: { lookbackMs?: number; maxPages?: number; pageSize?: number } = {},
  ) {
    this.#groupAllowlist = groupAllowlist;
    this.#lookbackMs = options.lookbackMs ?? 7 * 24 * 60 * 60 * 1_000;
    this.#maxPages = options.maxPages ?? 20;
    this.#pageSize = options.pageSize ?? 50;
  }

  startFromLive(
    event: BaileysEventMap['messages.upsert'],
    now: number,
  ): HistoryRequest[] {
    if (event.type !== 'notify') return [];

    const oldestByGroup = selectOldestByGroup(
      event.messages,
      this.#groupAllowlist,
    );
    const requests: HistoryRequest[] = [];
    for (const [groupJid, anchor] of oldestByGroup) {
      if (this.#states.has(groupJid)) continue;
      this.#states.set(groupJid, {
        cutoffMs: now - this.#lookbackMs,
        pagesRequested: 1,
      });
      requests.push(this.#request(anchor));
    }
    return requests;
  }

  continueFromHistory(
    event: BaileysEventMap['messaging-history.set'],
  ): HistoryRequest[] {
    const activeGroups = new Set(this.#states.keys());
    const oldestByGroup = selectOldestByGroup(event.messages, activeGroups);
    const requests: HistoryRequest[] = [];

    for (const [groupJid, anchor] of oldestByGroup) {
      const state = this.#states.get(groupJid);
      if (state === undefined) continue;
      const timestampMs = messageTimestampMs(anchor);
      if (
        timestampMs === null ||
        timestampMs <= state.cutoffMs ||
        state.pagesRequested >= this.#maxPages
      ) {
        this.#states.delete(groupJid);
        continue;
      }
      state.pagesRequested += 1;
      requests.push(this.#request(anchor));
    }

    return requests;
  }

  #request(message: WAMessage): HistoryRequest {
    return {
      count: this.#pageSize,
      key: message.key,
      timestamp: message.messageTimestamp as number | Long,
    };
  }
}

function selectOldestByGroup(
  messages: readonly WAMessage[],
  groupAllowlist: ReadonlySet<string>,
): Map<string, WAMessage> {
  const oldestByGroup = new Map<string, WAMessage>();
  for (const message of messages) {
    const groupJid = message.key.remoteJid;
    if (
      groupJid === null ||
      groupJid === undefined ||
      !groupAllowlist.has(groupJid) ||
      message.key.id === null ||
      message.key.id === undefined ||
      messageTimestampMs(message) === null
    ) {
      continue;
    }
    const existing = oldestByGroup.get(groupJid);
    if (
      existing === undefined ||
      messageTimestampMs(message)! < messageTimestampMs(existing)!
    ) {
      oldestByGroup.set(groupJid, message);
    }
  }
  return oldestByGroup;
}

function messageTimestampMs(message: WAMessage): number | null {
  const value = message.messageTimestamp;
  if (value === null || value === undefined) return null;
  const seconds = typeof value === 'number' ? value : value.toNumber();
  const milliseconds = seconds * 1_000;
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0
    ? milliseconds
    : null;
}
