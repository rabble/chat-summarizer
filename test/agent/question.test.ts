import { createServer } from 'node:http';

import type { WAMessage } from '@whiskeysockets/baileys';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  answerQuestion,
  collectAuthorizedQuestions,
  extractAuthorizedQuestion,
} from '../../src/agent/question.js';
import { openDatabase, type GravediggerDatabase } from '../../src/db/database.js';
import { storeMessage } from '../../src/messages/message-store.js';
import { upsertParticipantProfile } from '../../src/profiles/profile-store.js';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../support/temp-database.js';

describe('private WhatsApp agent', () => {
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

  test('accepts text only from the configured recipient, including phone-number alt JIDs', () => {
    expect(extractAuthorizedQuestion(message({
      remoteJid: '987654321@lid',
      remoteJidAlt: '15550123456@s.whatsapp.net',
      text: ' What are the AGI rooms discussing? ',
    }), '15550123456@s.whatsapp.net')).toBe(
      'What are the AGI rooms discussing?',
    );

    expect(extractAuthorizedQuestion(message({
      remoteJid: '16660123456@s.whatsapp.net',
      text: 'Tell me everything',
    }), '15550123456@s.whatsapp.net')).toBeNull();

    expect(extractAuthorizedQuestion(message({
      remoteJid: '15550123456@s.whatsapp.net',
      text: 'echo',
      fromMe: true,
    }), '15550123456@s.whatsapp.net')).toBeNull();
  });

  test('collects authorized questions only from live notify batches', () => {
    const authorized = message({
      remoteJid: '15550123456@s.whatsapp.net',
      text: 'Summarize both rooms',
    });
    const stranger = message({
      remoteJid: '16660123456@s.whatsapp.net',
      text: 'Leak the rooms',
    });

    expect(collectAuthorizedQuestions(
      { type: 'notify', messages: [authorized, stranger] },
      '15550123456@s.whatsapp.net',
    )).toEqual(['Summarize both rooms']);
    expect(collectAuthorizedQuestions(
      { type: 'append', messages: [authorized] },
      '15550123456@s.whatsapp.net',
    )).toEqual([]);
  });

  test('answers from stored evidence through a real OpenRouter-compatible HTTP connection', async () => {
    storeMessage(database, {
      externalId: 'm1',
      groupJid: '120@g.us',
      senderJid: 'alice@s.whatsapp.net',
      senderName: 'Alice',
      timestampMs: 2_000,
      messageType: 'conversation',
      text: 'The room chose DeepSeek for the first test.',
      quotedExternalId: null,
      rawJson: JSON.stringify({ key: { id: 'm1' } }),
    }, 2_000);
    let requestBody: { messages?: Array<{ content?: string }> } = {};
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({
          choices: [{ message: { content: 'They chose DeepSeek. [message:1]' } }],
        }));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');

    await expect(answerQuestion(database, {
      apiKey: 'test-key',
      model: 'deepseek/test-model',
      groupJids: new Set(['120@g.us']),
      question: 'What did they choose?',
      now: 3_000,
      lookbackMs: 2_000,
      endpoint: `http://127.0.0.1:${address.port}/chat/completions`,
    })).resolves.toBe('They chose DeepSeek. [message:1]');
    expect(requestBody.messages?.[1]?.content).toContain('[message:1]');
    expect(requestBody.messages?.[0]?.content).toContain(
      'State clearly when material is uncited, unsourced, or missing a source',
    );
  });

  test('keeps community attribution while excluding private profile context from the editor', async () => {
    storeMessage(database, {
      externalId: 'm1',
      groupJid: '120@g.us',
      senderJid: 'alice@s.whatsapp.net',
      senderName: 'Alice',
      timestampMs: 2_000,
      messageType: 'conversation',
      text: 'A new model-routing workflow is being tested.',
      quotedExternalId: null,
      rawJson: JSON.stringify({ key: { id: 'm1' } }),
    }, 2_000);
    upsertParticipantProfile(database, {
      personId: 1,
      observedSummary: 'PRIVATE_PROFILE_SENTINEL',
      publicIdentityName: null,
      publicSummary: null,
      publicSourceUrls: [],
      identityConfidence: 'unverified',
      sourceMessageIds: [1],
      updatedAt: 2_000,
    });
    let requestBody: { messages?: Array<{ role?: string; content?: string }>; max_tokens?: number } = {};
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({
          choices: [{ message: { content: 'THE BIG STORY\n\nThe stack is unbundling. [message:1]' } }],
        }));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');

    const answer = await answerQuestion(database, {
      apiKey: 'test-key',
      model: 'deepseek/test-model',
      groupJids: new Set(['120@g.us']),
      question: 'Summarize what the AGI rooms are discussing',
      anonymous: false,
      includeParticipantProfiles: false,
      now: 3_000,
      lookbackMs: 2_000,
      endpoint: `http://127.0.0.1:${address.port}/chat/completions`,
    });

    expect(requestBody.messages?.[0]?.content).toContain('technology editor');
    expect(requestBody.messages?.[0]?.content).toContain('not a transcript recap');
    expect(requestBody.messages?.[0]?.content).toContain('Attribute consequential claims');
    expect(requestBody.messages?.[0]?.content).not.toContain('Chatham House');
    expect(requestBody.messages?.[1]?.content).toContain('| Alice:');
    expect(requestBody.messages?.[1]?.content).not.toContain('PRIVATE_PROFILE_SENTINEL');
    expect(requestBody.messages?.[1]?.content).toContain('THE BIG STORY');
    expect(requestBody.messages?.[1]?.content).toContain('LINKS WORTH OPENING');
    expect(requestBody.max_tokens).toBeGreaterThan(1_500);
    expect(answer).toBe('THE BIG STORY\n\nThe stack is unbundling.');
  });

  test('does not call a model when no messages have been captured', async () => {
    await expect(answerQuestion(database, {
      apiKey: 'not-used',
      model: 'deepseek/test-model',
      groupJids: new Set(['120@g.us']),
      question: 'What happened?',
      now: 3_000,
      lookbackMs: 2_000,
    })).resolves.toMatch(/haven't captured any messages/i);
  });

  test('prefers a transcript pasted privately over unrelated stored history', async () => {
    storeMessage(database, {
      externalId: 'irrelevant-old-message',
      groupJid: '120@g.us',
      senderJid: 'old@s.whatsapp.net',
      senderName: 'Old Sender',
      timestampMs: 2_000,
      messageType: 'conversation',
      text: 'Old unrelated database evidence.',
      quotedExternalId: null,
      rawJson: JSON.stringify({ key: { id: 'irrelevant-old-message' } }),
    }, 2_000);
    let requestBody: { messages?: Array<{ content?: string }> } = {};
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({
          choices: [{ message: { content: 'The pasted discussion compared agent personas.' } }],
        }));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    const pastedTranscript = [
      '[16/08/2026, 3:00 PM] Marcus: I do this with agent personas.',
      '[16/08/2026, 3:39 PM] Dave: Has anyone compiled the patterns?',
      'https://example.test/agent-patterns',
    ].join('\n');

    await expect(answerQuestion(database, {
      apiKey: 'test-key',
      model: 'deepseek/test-model',
      groupJids: new Set(['120@g.us']),
      question: pastedTranscript,
      now: 3_000,
      lookbackMs: 2_000,
      endpoint: `http://127.0.0.1:${address.port}/chat/completions`,
    })).resolves.toBe('The pasted discussion compared agent personas.');
    expect(requestBody.messages?.[1]?.content).toContain('User-supplied transcript:');
    expect(requestBody.messages?.[1]?.content).toContain(pastedTranscript);
    expect(requestBody.messages?.[0]?.content).toContain(
      'State clearly when material is uncited, unsourced, or missing a source',
    );
    expect(database.prepare('SELECT count(*) FROM messages').pluck().get()).toBe(1);
  });

  test('returns a private setup hint when evidence exists but the model key is absent', async () => {
    storeMessage(database, {
      externalId: 'm1',
      groupJid: '120@g.us',
      senderJid: 'alice@s.whatsapp.net',
      senderName: 'Alice',
      timestampMs: 2_000,
      messageType: 'conversation',
      text: 'Captured evidence.',
      quotedExternalId: null,
      rawJson: JSON.stringify({ key: { id: 'm1' } }),
    }, 2_000);

    await expect(answerQuestion(database, {
      apiKey: undefined,
      model: 'deepseek/test-model',
      groupJids: new Set(['120@g.us']),
      question: 'What happened?',
      now: 3_000,
      lookbackMs: 2_000,
    })).resolves.toMatch(/OPENROUTER_API_KEY/);
  });
});

function message(input: {
  remoteJid: string;
  remoteJidAlt?: string;
  text: string;
  fromMe?: boolean;
}): WAMessage {
  return {
    key: {
      id: 'question-1',
      fromMe: input.fromMe ?? false,
      remoteJid: input.remoteJid,
      ...(input.remoteJidAlt === undefined ? {} : { remoteJidAlt: input.remoteJidAlt }),
    },
    message: { conversation: input.text },
  };
}
