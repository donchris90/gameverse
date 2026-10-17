import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config/config.js';
import { ExpoPushProvider, type PushMessage } from './push.provider.js';

/**
 * These tests run against a local stand-in that follows the request and response shapes documented
 * by Expo. They prove our side of the contract only; they do NOT prove that the live Expo service
 * accepts our requests. That needs a real device token and network access.
 */
describe('ExpoPushProvider (against a local stand-in)', () => {
  let server: Server | null = null;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = null;
  });

  interface Captured {
    headers: IncomingMessage['headers'];
    body: unknown;
  }

  async function start(
    respond: (captured: Captured) => { status: number; body: unknown } | 'hang',
  ): Promise<{ url: string; calls: Captured[] }> {
    const calls: Captured[] = [];
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const captured: Captured = {
          headers: request.headers,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        };
        calls.push(captured);
        const result = respond(captured);
        if (result === 'hang') return;
        response.writeHead(result.status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(result.body));
      });
    });
    const listening = server;
    await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
    return {
      url: `http://127.0.0.1:${String((listening.address() as AddressInfo).port)}/push`,
      calls,
    };
  }

  function provider(url: string, extra: Record<string, string> = {}): ExpoPushProvider {
    return new ExpoPushProvider(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://localhost/unused_test',
        JWT_ACCESS_SECRET: 'k7Qm2VxR9tLp4WzN8bYc1JhD6sFg3AeU5oIv0XnT',
        EXPO_PUSH_URL: url,
        ...extra,
      }),
    );
  }

  const message = (n: number): PushMessage => ({
    to: `ExponentPushToken[token${String(n).padStart(6, '0')}]`,
    title: 'Ada',
    body: 'Sent you a message',
    data: { type: 'MESSAGE', conversationId: 'c1' },
  });

  it('posts the documented JSON shape and maps ok / DeviceNotRegistered / other errors', async () => {
    const { url, calls } = await start(() => ({
      status: 200,
      body: {
        data: [
          { status: 'ok', id: 'x' },
          { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
          { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } },
        ],
      },
    }));
    const outcomes = await provider(url).send([message(1), message(2), message(3)]);
    expect(outcomes).toEqual(['sent', 'invalid-token', 'failed']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers['content-type']).toBe('application/json');
    expect(calls[0]?.headers['authorization']).toBeUndefined();
    expect(calls[0]?.body).toEqual([
      expect.objectContaining({
        to: message(1).to,
        title: 'Ada',
        body: 'Sent you a message',
        data: { type: 'MESSAGE', conversationId: 'c1' },
      }),
      expect.anything(),
      expect.anything(),
    ]);
  });

  it('sends the access token when configured', async () => {
    const { url, calls } = await start(() => ({ status: 200, body: { data: [{ status: 'ok' }] } }));
    await provider(url, { EXPO_ACCESS_TOKEN: 'test-access-token' }).send([message(1)]);
    expect(calls[0]?.headers['authorization']).toBe('Bearer test-access-token');
  });

  it('splits more than 100 messages into batches and keeps outcomes in order', async () => {
    const { url, calls } = await start((captured) => ({
      status: 200,
      body: { data: (captured.body as unknown[]).map(() => ({ status: 'ok' })) },
    }));
    const outcomes = await provider(url).send(Array.from({ length: 250 }, (_, i) => message(i)));
    expect(outcomes).toHaveLength(250);
    expect(outcomes.every((o) => o === 'sent')).toBe(true);
    expect(calls.map((c) => (c.body as unknown[]).length)).toEqual([100, 100, 50]);
  });

  it.each([
    ['HTTP 500', { status: 500, body: {} }],
    ['HTTP 429', { status: 429, body: {} }],
    ['a malformed body', { status: 200, body: { nope: true } }],
    ['a ticket count mismatch', { status: 200, body: { data: [] } }],
  ])('reports failure (and does not throw) on %s', async (_name, reply) => {
    const { url } = await start(() => reply);
    expect(await provider(url).send([message(1)])).toEqual(['failed']);
  });

  it('reports failure when the service is unreachable', async () => {
    expect(await provider('http://127.0.0.1:9/push').send([message(1)])).toEqual(['failed']);
  });
});
