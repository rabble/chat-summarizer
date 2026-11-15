import {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  makeWASocket,
  proto,
  type BaileysEventMap,
  type ConnectionState,
  type WASocket,
  type WAMessage,
  type WAMessageKey,
  type WAVersion,
} from '@whiskeysockets/baileys';
import { dirname, join } from 'node:path';
import pino, { type Logger } from 'pino';
import qrcode from 'qrcode-terminal';

import {
  answerQuestion,
  collectAuthorizedQuestions,
} from '../agent/question.js';
import type { Config } from '../config.js';
import type { GravediggerDatabase } from '../db/database.js';
import { buildDigestDeliveries } from '../digests/delivery.js';
import {
  recordConnected,
  recordDisconnected,
  recordHeartbeat,
  reconcileGapsFromStoredHistory,
  recoverUncleanStartup,
} from '../gaps/gap-tracker.js';
import { storeGroupSubjects } from '../groups/group-store.js';
import { validateDigestGroup } from '../groups/digest-group.js';
import { backfillStoredLinks } from '../links/backfill-links.js';
import { storeMessage } from '../messages/message-store.js';
import { storeContactNames } from '../people/contact-store.js';
import { installDependencyLogRedaction } from '../privacy/dependency-log-redaction.js';
import { refreshParticipantProfiles } from '../profiles/refresh-profiles.js';
import { loadAuthState, type PersistedAuthState } from './auth-state.js';
import {
  HistoryBackfillPlanner,
  type HistoryRequest,
} from './history-backfill.js';
import { normalizeMessage } from './normalize-message.js';
import { writePairingQr } from './pairing-qr.js';

export type BatchReport = {
  received: number;
  inserted: number;
  duplicates: number;
  ignored: number;
  unsupported: number;
  skipped: number;
};

export type ConnectionDecision =
  | { action: 'none' }
  | { action: 'reconnect'; delayMs: number }
  | { action: 'stop'; reason: string };

export type ConnectorHandlers = {
  handleMessagesUpsert: (
    event: BaileysEventMap['messages.upsert'],
    observedAt?: number,
  ) => Promise<BatchReport>;
  handleConnectionUpdate: (
    update: Partial<ConnectionState>,
    reconnectAttempt?: number,
    observedAt?: number,
  ) => ConnectionDecision;
  handleCredsUpdate: (
    update: BaileysEventMap['creds.update'],
  ) => Promise<void>;
  handleAuthorizedQuestions: (
    event: BaileysEventMap['messages.upsert'],
    observedAt?: number,
  ) => Promise<string[]>;
  handleHistorySet: (
    event: BaileysEventMap['messaging-history.set'],
    observedAt?: number,
  ) => Promise<BatchReport>;
};

export type RunningConnector = {
  deliverDigest: (markdown: string, privateRecipientJid?: string) => Promise<void>;
  stop: () => Promise<void>;
};

export const silentSocketOptions = {
  markOnlineOnConnect: false,
  syncFullHistory: true,
} as const;

export const companionBrowser = Browsers.macOS('Community Brief');

export function shouldSyncHistoryMessage(): boolean {
  return true;
}

export function scheduleReconnect(
  callback: () => void,
  delayMs: number,
): NodeJS.Timeout {
  return setTimeout(callback, delayMs);
}

export async function resolveWhatsAppWebVersion(
  fetchVersion: () => Promise<{ version: WAVersion }> = () =>
    fetchLatestWaWebVersion({}),
): Promise<WAVersion> {
  return (await fetchVersion()).version;
}

export function createConnectorHandlers(input: {
  database: GravediggerDatabase;
  groupAllowlist: ReadonlySet<string>;
  auth: PersistedAuthState;
  agent?: {
    recipientJid: string;
    apiKey: string | undefined;
    model: string;
  };
}): ConnectorHandlers {
  let inboundChain: Promise<void> = Promise.resolve();
  let questionChain: Promise<void> = Promise.resolve();

  return {
    handleMessagesUpsert: (event, observedAt = Date.now()) => {
      const result = inboundChain.then(() =>
        processMessagesUpsert(
          input.database,
          input.groupAllowlist,
          event,
          observedAt,
        ),
      );
      inboundChain = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    handleConnectionUpdate: (
      update,
      reconnectAttempt = 0,
      observedAt = Date.now(),
    ) => handleConnectionUpdate(input.database, update, reconnectAttempt, observedAt),
    handleCredsUpdate: (update) => input.auth.updateAndSave(update),
    handleAuthorizedQuestions: (event, observedAt = Date.now()) => {
      if (input.agent === undefined) return Promise.resolve([]);
      const agent = input.agent;
      const questions = collectAuthorizedQuestions(event, agent.recipientJid);
      const result = questionChain.then(async () => {
        const replies: string[] = [];
        for (const question of questions) {
          replies.push(await answerQuestion(input.database, {
            apiKey: agent.apiKey,
            model: agent.model,
            groupJids: input.groupAllowlist,
            question,
            now: observedAt,
          }));
        }
        return replies;
      });
      questionChain = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    handleHistorySet: (event, observedAt = Date.now()) => {
      const result = inboundChain.then(() => {
        const report = processMessageBatch(
          input.database,
          input.groupAllowlist,
          event.messages,
          observedAt,
        );
        storeContactNames(input.database, event.contacts);
        reconcileGapsFromStoredHistory(input.database, observedAt);
        return report;
      });
      inboundChain = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

export async function startConnector(input: {
  config: Config;
  database: GravediggerDatabase;
  logger?: Logger;
}): Promise<RunningConnector> {
  installDependencyLogRedaction();
  const logger = input.logger ?? pino({ level: input.config.logLevel });
  const baileysLogger = pino({ level: 'silent' });
  const auth = await loadAuthState(input.config.authDir);
  const version = await resolveWhatsAppWebVersion();
  const pairingQrPath = join(dirname(input.config.authDir), 'pairing-qr.png');
  const handlers = createConnectorHandlers({
    database: input.database,
    groupAllowlist: input.config.groupJids,
    auth,
    agent: {
      recipientJid: input.config.digestRecipientJid,
      apiKey: input.config.openRouterApiKey,
      model: input.config.openRouterModel,
    },
  });

  recoverUncleanStartup(input.database, Date.now());
  logger.info(
    { report: backfillStoredLinks(input.database) },
    'backfilled shared links',
  );

  let currentSocket: WASocket | undefined;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let heartbeatTimer: NodeJS.Timeout | undefined;
  let reconnectAttempt = 0;
  let stopped = false;
  let connected = false;
  let profileRefreshInFlight = false;
  const openWaiters = new Set<(socket: WASocket | undefined) => void>();

  const waitForOpenSocket = async (): Promise<WASocket> => {
    if (stopped) {
      throw new Error('Cannot deliver a digest after the connector has stopped');
    }
    if (connected && currentSocket !== undefined) {
      return currentSocket;
    }
    const socket = await new Promise<WASocket | undefined>((resolve) => {
      openWaiters.add(resolve);
    });
    if (socket === undefined) {
      throw new Error('Connector stopped before digest delivery');
    }
    return socket;
  };

  const releaseOpenWaiters = (socket: WASocket | undefined): void => {
    for (const resolve of openWaiters) {
      resolve(socket);
    }
    openWaiters.clear();
  };

  const clearHeartbeat = (): void => {
    if (heartbeatTimer !== undefined) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  };

  const connect = (): void => {
    if (stopped) {
      return;
    }

    const socket = makeWASocket({
      auth: auth.state,
      version,
      logger: baileysLogger,
      browser: companionBrowser,
      ...silentSocketOptions,
      shouldSyncHistoryMessage,
      getMessage: (key) => getStoredMessage(input.database, key),
    });
    currentSocket = socket;
    socket.ws.on('upgrade', () => {
      logger.info('WhatsApp WebSocket upgrade accepted');
    });
    socket.ws.on('unexpected-response', (_request: unknown, response: {
      statusCode?: number;
      resume: () => void;
    }) => {
      logger.warn({ statusCode: response.statusCode }, 'WhatsApp WebSocket upgrade rejected');
      response.resume();
      socket.end(new Error(`WhatsApp WebSocket upgrade rejected: ${response.statusCode}`));
    });
    const historyBackfill = new HistoryBackfillPlanner(input.config.groupJids);
    const requestHistory = async (requests: readonly HistoryRequest[]): Promise<void> => {
      for (const request of requests) {
        await socket.fetchMessageHistory(
          request.count,
          request.key,
          request.timestamp,
        );
      }
      if (requests.length > 0) {
        logger.info(
          { pages: requests.length, pageSize: requests[0]?.count },
          'requested WhatsApp history pages',
        );
      }
    };

    socket.ev.on('creds.update', (update) => {
      void handlers.handleCredsUpdate(update).catch((error: unknown) => {
        logger.error({ error: errorText(error) }, 'failed to persist WhatsApp auth state');
      });
    });
    socket.ev.on('messages.upsert', (event) => {
      const backfillRequests = historyBackfill.startFromLive(event, Date.now());
      void handlers
        .handleMessagesUpsert(event)
        .then(async (report) => {
          logger.info({ report }, 'processed WhatsApp message batch');
          await requestHistory(backfillRequests);
        })
        .catch((error: unknown) =>
          logger.error({ error: errorText(error) }, 'failed to persist message batch'),
        );
      void handlers
        .handleAuthorizedQuestions(event)
        .then(async (replies) => {
          for (const reply of replies) {
            const deliveries = buildDigestDeliveries(
              input.config.digestRecipientJid,
              reply,
            );
            for (const delivery of deliveries) {
              await socket.sendMessage(delivery.recipientJid, delivery.message);
            }
          }
        })
        .catch((error: unknown) =>
          logger.error({ error: errorText(error) }, 'failed to answer private question'),
        );
    });
    socket.ev.on('messaging-history.set', (event) => {
      void handlers
        .handleHistorySet(event)
        .then(async (report) => {
          logger.info(
            {
              report,
              isLatest: event.isLatest,
              progress: event.progress,
              syncType: event.syncType,
            },
            'processed WhatsApp history batch',
          );
          await requestHistory(historyBackfill.continueFromHistory(event));
        })
        .catch((error: unknown) =>
          logger.error({ error: errorText(error) }, 'failed to persist history batch'),
        );
    });
    socket.ev.on('contacts.upsert', (contacts) => {
      storeContactNames(input.database, contacts);
    });
    socket.ev.on('contacts.update', (contacts) => {
      storeContactNames(input.database, contacts);
    });
    socket.ev.on('connection.update', (update) => {
      if (update.qr !== undefined) {
        qrcode.generate(update.qr, { small: true }, (code) => {
          process.stdout.write(`\nScan this QR in WhatsApp Linked Devices:\n${code}\n`);
        });
        void writePairingQr(update.qr, pairingQrPath).then(
          () => logger.info({ path: pairingQrPath }, 'pairing QR written'),
          (error: unknown) =>
            logger.error(
              { error: errorText(error) },
              'failed to write pairing QR image',
            ),
        );
      }
      if (stopped) {
        return;
      }

      const decision = handlers.handleConnectionUpdate(update, reconnectAttempt);
      if (update.connection === 'open') {
        connected = true;
        releaseOpenWaiters(socket);
        reconnectAttempt = 0;
        clearHeartbeat();
        heartbeatTimer = setInterval(
          () => recordHeartbeat(input.database, Date.now()),
          30_000,
        );
        heartbeatTimer.unref();
        logger.info('WhatsApp connection opened');
        void socket.groupFetchAllParticipating().then(
          (groups) => {
            const storedSubjects = storeGroupSubjects(
              input.database,
              groups,
              input.config.groupJids,
            );
            logger.info(
              {
                storedSubjects,
                groups: Object.values(groups).map((group) => ({
                  jid: group.id,
                  subject: group.subject,
                })),
              },
              'available WhatsApp groups',
            );
            if (
              input.config.openRouterApiKey !== undefined &&
              !profileRefreshInFlight
            ) {
              profileRefreshInFlight = true;
              const windowEndedAt = Date.now();
              void refreshParticipantProfiles(input.database, {
                apiKey: input.config.openRouterApiKey,
                model: input.config.openRouterModel,
                groupJids: input.config.groupJids,
                windowStartedAt: windowEndedAt - 30 * 24 * 60 * 60 * 1_000,
                windowEndedAt,
              }).then(
                (report) => logger.info({ report }, 'refreshed participant profiles'),
                (error: unknown) => logger.warn(
                  { error: errorText(error) },
                  'could not refresh participant profiles',
                ),
              ).finally(() => {
                profileRefreshInFlight = false;
              });
            }
          },
          (error: unknown) => {
            logger.warn(
              { error: errorText(error) },
              'could not list participating WhatsApp groups',
            );
          },
        );
      } else if (update.connection === 'close') {
        connected = false;
        clearHeartbeat();
        logger.warn(
          { statusCode: disconnectStatusCode(update.lastDisconnect?.error) },
          'WhatsApp connection closed',
        );
      }

      if (decision.action === 'reconnect') {
        const attemptForNextConnection = reconnectAttempt + 1;
        reconnectAttempt = attemptForNextConnection;
        reconnectTimer = scheduleReconnect(connect, decision.delayMs);
        logger.warn(
          { delayMs: decision.delayMs, attempt: attemptForNextConnection },
          'WhatsApp connection closed; reconnect scheduled',
        );
      } else if (decision.action === 'stop') {
        stopped = true;
        logger.error({ reason: decision.reason }, 'WhatsApp session requires operator action');
      }
    });
  };

  connect();

  return {
    deliverDigest: async (markdown, privateRecipientJid) => {
      if (privateRecipientJid !== undefined &&
          !input.config.additionalDigests?.some((schedule) => schedule.recipient === privateRecipientJid)) {
        throw new Error('Private newsletter recipient is not configured');
      }
      const groupJid = privateRecipientJid === undefined ? input.config.digestGroupJid : undefined;
      const deliveries = buildDigestDeliveries(
        privateRecipientJid ?? groupJid ?? input.config.digestRecipientJid,
        markdown,
        2_500,
        groupJid,
      );
      const socket = await waitForOpenSocket();
      if (groupJid !== undefined) {
        const group = await socket.groupMetadata(groupJid);
        validateDigestGroup(group, groupJid,
          [socket.user?.id, socket.user?.lid].filter((jid): jid is string => typeof jid === 'string'));
        for (const delivery of deliveries) {
          await socket.sendMessage(delivery.recipientJid, delivery.message);
        }
        logger.info({ groupJid, parts: deliveries.length }, 'delivered newsletter to summaries group');
        return;
      }
      const recipientJid = deliveries[0]!.recipientJid;
      const phoneNumber = recipientJid.slice(
        0,
        recipientJid.indexOf('@'),
      );
      const [registration] = (await socket.onWhatsApp(phoneNumber)) ?? [];
      if (registration?.exists !== true) {
        throw new Error('Configured digest recipient is not registered on WhatsApp');
      }
      for (const delivery of deliveries) {
        await socket.sendMessage(registration.jid, delivery.message);
      }
    },
    stop: async () => {
      if (stopped) {
        return;
      }
      recordDisconnected(input.database, Date.now(), 'operator_stop');
      stopped = true;
      connected = false;
      releaseOpenWaiters(undefined);
      clearHeartbeat();
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
      }
      await currentSocket?.end(undefined);
    },
  };
}

function processMessagesUpsert(
  database: GravediggerDatabase,
  groupAllowlist: ReadonlySet<string>,
  event: BaileysEventMap['messages.upsert'],
  observedAt: number,
): BatchReport {
  if (event.type !== 'notify') {
    return {
      received: event.messages.length,
      inserted: 0,
      duplicates: 0,
      ignored: 0,
      unsupported: 0,
      skipped: event.messages.length,
    };
  }

  return processMessageBatch(
    database,
    groupAllowlist,
    event.messages,
    observedAt,
  );
}

function processMessageBatch(
  database: GravediggerDatabase,
  groupAllowlist: ReadonlySet<string>,
  messages: readonly WAMessage[],
  observedAt: number,
): BatchReport {
  const report: BatchReport = {
    received: messages.length,
    inserted: 0,
    duplicates: 0,
    ignored: 0,
    unsupported: 0,
    skipped: 0,
  };

  for (const envelope of messages) {
    const result = normalizeMessage(envelope, groupAllowlist);
    if (result.status === 'ignored') {
      report.ignored += 1;
    } else if (result.status === 'unsupported') {
      storeUnsupportedEnvelope(database, envelope, result.reason, observedAt);
      report.unsupported += 1;
    } else if (storeMessage(database, result.message, observedAt) === 'inserted') {
      report.inserted += 1;
    } else {
      report.duplicates += 1;
    }
  }

  return report;
}

function handleConnectionUpdate(
  database: GravediggerDatabase,
  update: Partial<ConnectionState>,
  reconnectAttempt: number,
  observedAt: number,
): ConnectionDecision {
  if (update.connection === 'open') {
    recordConnected(database, observedAt);
    return { action: 'none' };
  }
  if (update.connection !== 'close') {
    return { action: 'none' };
  }

  const statusCode = disconnectStatusCode(update.lastDisconnect?.error);
  const terminalReason = terminalDisconnectReason(statusCode);
  if (terminalReason !== null) {
    recordDisconnected(database, observedAt, terminalReason);
    database
      .prepare(
        `UPDATE connector_state
            SET status = 'logged_out', observed_at = ?
          WHERE singleton = 1`,
      )
      .run(observedAt);
    return { action: 'stop', reason: terminalReason };
  }

  recordDisconnected(
    database,
    observedAt,
    statusCode === null ? 'connection_closed' : `disconnect_${statusCode}`,
  );
  return {
    action: 'reconnect',
    delayMs: Math.min(1_000 * 2 ** reconnectAttempt, 30_000),
  };
}

function storeUnsupportedEnvelope(
  database: GravediggerDatabase,
  envelope: WAMessage,
  reason: string,
  observedAt: number,
): void {
  database
    .prepare(
      `INSERT INTO unsupported_messages (
         external_id, group_jid, sender_jid, reason, raw_json, observed_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      envelope.key.id ?? null,
      envelope.key.remoteJid ?? null,
      envelope.key.participant ?? envelope.participant ?? null,
      reason,
      serializeEnvelope(envelope),
      observedAt,
    );
}

async function getStoredMessage(
  database: GravediggerDatabase,
  key: WAMessageKey,
): Promise<proto.IMessage | undefined> {
  if (key.remoteJid === null || key.remoteJid === undefined || key.id === null || key.id === undefined) {
    return undefined;
  }
  const row = database
    .prepare(
      `SELECT m.raw_json
         FROM messages m
         JOIN groups g ON g.id = m.group_id
        WHERE g.jid = ? AND m.external_id = ?`,
    )
    .get(key.remoteJid, key.id) as { raw_json: string } | undefined;
  if (row === undefined) {
    return undefined;
  }
  return proto.WebMessageInfo.fromObject(JSON.parse(row.raw_json)).message ?? undefined;
}

function disconnectStatusCode(error: Error | undefined): number | null {
  if (error === undefined) {
    return null;
  }
  const structural = error as Error & {
    output?: { statusCode?: number };
    statusCode?: number;
  };
  return structural.output?.statusCode ?? structural.statusCode ?? null;
}

function terminalDisconnectReason(statusCode: number | null): string | null {
  switch (statusCode) {
    case DisconnectReason.loggedOut:
      return 'logged_out';
    case DisconnectReason.badSession:
      return 'bad_session';
    case DisconnectReason.multideviceMismatch:
      return 'multidevice_mismatch';
    case DisconnectReason.forbidden:
      return 'forbidden';
    case DisconnectReason.connectionReplaced:
      return 'connection_replaced';
    default:
      return null;
  }
}

function serializeEnvelope(message: WAMessage): string {
  return JSON.stringify(message, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
