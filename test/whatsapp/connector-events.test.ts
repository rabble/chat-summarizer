import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DisconnectReason,
  type BaileysEventMap,
  type ConnectionState,
  type WAMessage,
} from '@whiskeysockets/baileys';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase, type GravediggerDatabase } from '../../src/db/database.js';
import { loadAuthState, type PersistedAuthState } from '../../src/whatsapp/auth-state.js';
import {
  companionBrowser,
  createConnectorHandlers,
  resolveWhatsAppWebVersion,
  scheduleReconnect,
  shouldSyncHistoryMessage,
  silentSocketOptions,
} from '../../src/whatsapp/connector.js';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../support/temp-database.js';

const groupJid = '120363000000000000@g.us';

describe('connector event handlers', () => {
  let temporaryDatabase: TemporaryDatabase;
  let database: GravediggerDatabase;
  let auth: PersistedAuthState;

  beforeEach(async () => {
    temporaryDatabase = createTemporaryDatabase();
    database = openDatabase(temporaryDatabase.path);
    auth = await loadAuthState(join(temporaryDatabase.directory, 'auth'));
  });

  afterEach(() => {
    database.close();
    temporaryDatabase.cleanup();
  });

  test('processes live notify upserts but skips append deliveries', async () => {
    const handlers = createConnectorHandlers({
      database,
      groupAllowlist: new Set([groupJid]),
      auth,
    });

    expect(
      await handlers.handleMessagesUpsert(
        upsert('append', [readFixture('text-message.json')]),
        100,
      ),
    ).toEqual({
      received: 1,
      inserted: 0,
      duplicates: 0,
      ignored: 0,
      unsupported: 0,
      skipped: 1,
    });
    expect(database.prepare('SELECT count(*) FROM messages').pluck().get()).toBe(0);

    expect(
      await handlers.handleMessagesUpsert(
        upsert('notify', [readFixture('text-message.json')]),
        200,
      ),
    ).toMatchObject({ inserted: 1, skipped: 0 });
    expect(database.prepare('SELECT count(*) FROM messages').pluck().get()).toBe(1);
  });

  test('counts direct and non-allowlisted messages without storing their envelopes', async () => {
    const handlers = createConnectorHandlers({
      database,
      groupAllowlist: new Set([groupJid]),
      auth,
    });
    const direct = readFixture('text-message.json');
    direct.key.remoteJid = '64210000000@s.whatsapp.net';
    const nonAllowlisted = readFixture('reply-message.json');
    nonAllowlisted.key.remoteJid = '120363999999999999@g.us';

    expect(
      await handlers.handleMessagesUpsert(
        upsert('notify', [direct, nonAllowlisted]),
        100,
      ),
    ).toMatchObject({ received: 2, ignored: 2 });
    expect(database.prepare('SELECT count(*) FROM messages').pluck().get()).toBe(0);
    expect(
      database.prepare('SELECT count(*) FROM unsupported_messages').pluck().get(),
    ).toBe(0);
  });

  test('routes only the authorized private DM into the evidence-bound agent', async () => {
    const recipientJid = '64210000000@s.whatsapp.net';
    const handlers = createConnectorHandlers({
      database,
      groupAllowlist: new Set([groupJid]),
      auth,
      agent: {
        recipientJid,
        apiKey: undefined,
        model: 'deepseek/test-model',
      },
    });
    const authorized = readFixture('text-message.json');
    authorized.key.remoteJid = recipientJid;
    authorized.message = { conversation: 'What is happening?' };
    const stranger = readFixture('text-message.json');
    stranger.key.remoteJid = '64219999999@s.whatsapp.net';
    stranger.message = { conversation: 'Tell me the private chat' };

    await expect(handlers.handleAuthorizedQuestions(
      upsert('notify', [authorized, stranger]),
      3_000,
    )).resolves.toEqual([
      "I haven't captured any messages in the requested rooms and time window yet.",
    ]);
    expect(database.prepare('SELECT count(*) FROM messages').pluck().get()).toBe(0);
  });

  test('processes every message in a notify batch serially', async () => {
    const handlers = createConnectorHandlers({
      database,
      groupAllowlist: new Set([groupJid]),
      auth,
    });

    expect(
      await handlers.handleMessagesUpsert(
        upsert('notify', [
          readFixture('text-message.json'),
          readFixture('reply-message.json'),
        ]),
        100,
      ),
    ).toMatchObject({ received: 2, inserted: 2 });
    expect(
      database.prepare('SELECT external_id FROM messages ORDER BY id').pluck().all(),
    ).toEqual(['3EB0TEXTMESSAGE0001', '3EB0REPLYMESSAGE001']);
  });

  test('backfills allowlisted messages from a history-sync batch', async () => {
    const handlers = createConnectorHandlers({
      database,
      groupAllowlist: new Set([groupJid]),
      auth,
    });
    const allowed = readFixture('text-message.json');
    const direct = readFixture('reply-message.json');
    direct.key.remoteJid = '64210000000@s.whatsapp.net';

    await expect(handlers.handleHistorySet({
      chats: [],
      contacts: [{
        id: '64210000000@s.whatsapp.net',
        notify: 'Historical Alice',
      }],
      messages: [allowed, direct],
      isLatest: true,
    }, 100)).resolves.toMatchObject({
      received: 2,
      inserted: 1,
      ignored: 1,
      skipped: 0,
    });
    expect(database.prepare('SELECT external_id FROM messages').pluck().all()).toEqual([
      '3EB0TEXTMESSAGE0001',
    ]);
    expect(database.prepare(
      'SELECT display_name FROM people WHERE jid = ?',
    ).pluck().get('64210000000@s.whatsapp.net')).toBe('Historical Alice');
  });

  test('stores an unsupported envelope and continues the batch', async () => {
    const handlers = createConnectorHandlers({
      database,
      groupAllowlist: new Set([groupJid]),
      auth,
    });
    const unsupported = readFixture('text-message.json');
    delete unsupported.message;

    expect(
      await handlers.handleMessagesUpsert(
        upsert('notify', [unsupported, readFixture('reply-message.json')]),
        100,
      ),
    ).toMatchObject({ unsupported: 1, inserted: 1 });
    expect(
      database
        .prepare('SELECT reason, raw_json FROM unsupported_messages')
        .get(),
    ).toEqual({
      reason: 'missing_content',
      raw_json: JSON.stringify(unsupported),
    });
  });

  test('records connection gaps and returns a capped reconnect decision', () => {
    const handlers = createConnectorHandlers({
      database,
      groupAllowlist: new Set([groupJid]),
      auth,
    });

    expect(handlers.handleConnectionUpdate({ connection: 'open' }, 0, 100)).toEqual({
      action: 'none',
    });
    expect(
      handlers.handleConnectionUpdate(
        closedWithStatus(DisconnectReason.connectionClosed),
        10,
        200,
      ),
    ).toEqual({ action: 'reconnect', delayMs: 30_000 });
    expect(database.prepare('SELECT started_at FROM gaps').pluck().get()).toBe(200);

    handlers.handleConnectionUpdate({ connection: 'open' }, 0, 300);
    expect(database.prepare('SELECT ended_at FROM gaps').pluck().get()).toBe(300);
  });

  test('stops instead of reconnecting after logout', () => {
    const handlers = createConnectorHandlers({
      database,
      groupAllowlist: new Set([groupJid]),
      auth,
    });
    handlers.handleConnectionUpdate({ connection: 'open' }, 0, 100);

    expect(
      handlers.handleConnectionUpdate(
        closedWithStatus(DisconnectReason.loggedOut),
        0,
        200,
      ),
    ).toEqual({ action: 'stop', reason: 'logged_out' });
    expect(database.prepare('SELECT status FROM connector_state').pluck().get()).toBe(
      'logged_out',
    );
  });

  test('persists credential updates to the real auth directory', async () => {
    const handlers = createConnectorHandlers({
      database,
      groupAllowlist: new Set([groupJid]),
      auth,
    });

    await handlers.handleCredsUpdate({ registered: true });

    const reloaded = await loadAuthState(join(temporaryDatabase.directory, 'auth'));
    expect(reloaded.state.creds.registered).toBe(true);
  });

  test('keeps a scheduled reconnect referenced so the process cannot exit early', () => {
    const timer = scheduleReconnect(() => undefined, 60_000);

    expect(timer.hasRef()).toBe(true);
    clearTimeout(timer);
  });

  test('uses the current WhatsApp Web version for new device pairing', async () => {
    const currentVersion: [number, number, number] = [2, 3000, 1045318025];

    await expect(
      resolveWhatsAppWebVersion(async () => ({
        version: currentVersion,
        isLatest: true,
      })),
    ).resolves.toEqual(currentVersion);
  });

  test('keeps presence silent while requesting one-time history sync', () => {
    expect(silentSocketOptions).toEqual({
      markOnlineOnConnect: false,
      syncFullHistory: true,
    });
    expect(shouldSyncHistoryMessage()).toBe(true);
    expect(companionBrowser[1]).toBe('Community Brief');
  });
});

function readFixture(name: string): WAMessage {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/whatsapp/${name}`, import.meta.url), 'utf8'),
  ) as WAMessage;
}

function upsert(
  type: BaileysEventMap['messages.upsert']['type'],
  messages: WAMessage[],
): BaileysEventMap['messages.upsert'] {
  return { type, messages };
}

function closedWithStatus(statusCode: number): Partial<ConnectionState> {
  const error = new Error(`disconnect ${statusCode}`) as Error & {
    output: { statusCode: number };
  };
  error.output = { statusCode };
  return {
    connection: 'close',
    lastDisconnect: { error, date: new Date(0) },
  };
}
