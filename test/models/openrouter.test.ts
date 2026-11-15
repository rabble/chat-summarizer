import { createServer } from 'node:http';

import { afterEach, describe, expect, test } from 'vitest';

import {
  buildOpenRouterRequest,
  completeOpenRouterText,
  parseOpenRouterTextResponse,
} from '../../src/models/openrouter.js';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('OpenRouter boundary', () => {
  test('sends Lunaroute credentials and compatible parameters over a real HTTP connection', async () => {
    let headers: Record<string, string | string[] | undefined> = {};
    let body: Record<string, unknown> = {};
    const server = createServer((request, response) => {
      headers = request.headers;
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ choices: [{ message: { content: 'Lunaroute answer' } }] }));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    await expect(completeOpenRouterText({
      apiKey: 'lr_test_key',
      endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`,
      model: 'deepseek-4.1-flash',
      system: 'Use only supplied evidence.',
      user: 'What happened?',
      maxTokens: 500,
    })).resolves.toBe('Lunaroute answer');
    expect(headers['lunaroute-api-key']).toBe('lr_test_key');
    expect(headers.authorization).toBeUndefined();
    expect(body).toMatchObject({model: 'deepseek-4.1-flash', max_tokens: 500, reasoning_effort: 'none'});
    expect(body).not.toHaveProperty('provider');
    expect(body).not.toHaveProperty('reasoning');
  });
  test('builds a text completion that requires privacy-safe provider routing', () => {
    expect(
      buildOpenRouterRequest({
        model: 'deepseek/deepseek-v4-flash-0731',
        system: 'Summarize only the supplied evidence.',
        user: 'Evidence goes here.',
        maxTokens: 2_000,
      }),
    ).toEqual({
      model: 'deepseek/deepseek-v4-flash-0731',
      messages: [
        { role: 'system', content: 'Summarize only the supplied evidence.' },
        { role: 'user', content: 'Evidence goes here.' },
      ],
      max_tokens: 2_000,
      reasoning: {
        effort: 'none',
        exclude: true,
      },
      provider: {
        zdr: true,
        data_collection: 'deny',
        require_parameters: true,
      },
    });
  });

  test('extracts the assistant text from a successful response', () => {
    expect(
      parseOpenRouterTextResponse({
        choices: [{ message: { role: 'assistant', content: '# Digest' } }],
      }),
    ).toBe('# Digest');
  });

  test('rejects a response without usable assistant text', () => {
    expect(() =>
      parseOpenRouterTextResponse({ choices: [{ message: { content: '' } }] }),
    ).toThrow(/usable text/);
  });

  test('sends an authenticated completion over a real HTTP connection', async () => {
    let receivedAuthorization: string | undefined;
    let receivedBody: unknown;
    const server = createServer((request, response) => {
      receivedAuthorization = request.headers.authorization;
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'Private answer' } }],
        }));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');

    const result = await completeOpenRouterText({
      apiKey: 'secret-test-key',
      endpoint: `http://127.0.0.1:${address.port}/chat/completions`,
      model: 'deepseek/test-model',
      system: 'Use only supplied evidence.',
      user: 'What happened?',
      maxTokens: 500,
    });

    expect(result).toBe('Private answer');
    expect(receivedAuthorization).toBe('Bearer secret-test-key');
    expect(receivedBody).toMatchObject({
      model: 'deepseek/test-model',
      provider: { zdr: true, data_collection: 'deny', require_parameters: true },
    });
  });
});
