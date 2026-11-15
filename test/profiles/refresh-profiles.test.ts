import { createServer } from 'node:http';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase, type GravediggerDatabase } from '../../src/db/database.js';
import { storeMessage } from '../../src/messages/message-store.js';
import { loadParticipantProfiles } from '../../src/profiles/profile-store.js';
import { refreshParticipantProfiles } from '../../src/profiles/refresh-profiles.js';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../support/temp-database.js';

describe('refresh participant profiles', () => {
  let temporaryDatabase: TemporaryDatabase;
  let database: GravediggerDatabase;
  const servers: ReturnType<typeof createServer>[] = [];

  beforeEach(() => {
    temporaryDatabase = createTemporaryDatabase();
    database = openDatabase(temporaryDatabase.path);
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })));
    database.close();
    temporaryDatabase.cleanup();
  });

  test('builds one source-bound observed profile per participant without exposing JIDs', async () => {
    store('alice-1', 'alice@s.whatsapp.net', 'Alice', 2_000,
      'I maintain Example Router and use it to switch models.');
    store('alice-2', 'alice@s.whatsapp.net', 'Alice', 2_500,
      'The frontier model plans; the cheaper model implements.');
    store('unnamed-1', '15550123456@s.whatsapp.net', null, 2_600,
      'This participant has no safe display name.');

    const requestBodies: Array<{ messages?: Array<{ content?: string }> }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          messages?: Array<{ content?: string }>;
        };
        requestBodies.push(requestBody);
        const unnamed = requestBody.messages?.[1]?.content?.includes('Participant 2') === true;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            observedSummary: unnamed
              ? 'Contributed one observation; identity is not yet known.'
              : 'Maintains Example Router and advocates model routing.',
            sourceMessageIds: unnamed ? [3] : [1, 2],
          }) } }],
        }));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');

    const report = await refreshParticipantProfiles(database, {
      apiKey: 'test-key',
      model: 'deepseek/test-model',
      groupJids: new Set(['120@g.us']),
      windowStartedAt: 1_000,
      windowEndedAt: 3_000,
      endpoint: `http://127.0.0.1:${address.port}/chat/completions`,
    });

    expect(report).toEqual({ candidates: 2, profiled: 2, failed: 0 });
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]?.messages?.[1]?.content).toContain('[message:1]');
    expect(requestBodies[0]?.messages?.[1]?.content).toContain('Example Router');
    expect(requestBodies[0]?.messages?.[1]?.content).not.toContain('alice@s.whatsapp.net');
    expect(loadParticipantProfiles(database, [1])[0]).toMatchObject({
      displayName: 'Alice',
      observedSummary: 'Maintains Example Router and advocates model routing.',
      sourceMessageIds: [1, 2],
      identityConfidence: 'unverified',
    });
    expect(loadParticipantProfiles(database, [2])[0]).toMatchObject({
      displayName: 'Unknown participant',
      observedSummary: 'Contributed one observation; identity is not yet known.',
      sourceMessageIds: [3],
    });

    await expect(refreshParticipantProfiles(database, {
      apiKey: 'test-key',
      model: 'deepseek/test-model',
      groupJids: new Set(['120@g.us']),
      windowStartedAt: 1_000,
      windowEndedAt: 3_500,
      endpoint: `http://127.0.0.1:${address.port}/chat/completions`,
    })).resolves.toEqual({ candidates: 0, profiled: 0, failed: 0 });
    expect(requestBodies).toHaveLength(2);
  });

  test('rejects invented source message IDs without storing the profile', async () => {
    store('alice-1', 'alice@s.whatsapp.net', 'Alice', 2_000, 'I built a tool.');
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          observedSummary: 'Builds tools.',
          sourceMessageIds: [999],
        }) } }],
      }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');

    await expect(refreshParticipantProfiles(database, {
      apiKey: 'test-key',
      model: 'deepseek/test-model',
      groupJids: new Set(['120@g.us']),
      windowStartedAt: 1_000,
      windowEndedAt: 3_000,
      endpoint: `http://127.0.0.1:${address.port}/chat/completions`,
    })).resolves.toEqual({ candidates: 1, profiled: 0, failed: 1 });
    expect(loadParticipantProfiles(database, [1])).toEqual([]);
  });

  function store(
    externalId: string,
    senderJid: string,
    senderName: string | null,
    timestampMs: number,
    text: string,
  ): void {
    storeMessage(database, {
      externalId,
      groupJid: '120@g.us',
      senderJid,
      senderName,
      timestampMs,
      messageType: 'conversation',
      text,
      quotedExternalId: null,
      rawJson: '{}',
    }, timestampMs);
  }
});
