import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ResendEmailProvider } from './email.provider.js';

/**
 * Runs against a local stand-in that follows Resend's documented request shape. It proves OUR side
 * of the contract only; the live service has not been contacted.
 */
describe('ResendEmailProvider (against a local stand-in)', () => {
  let server: Server | null = null;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = null;
  });

  async function start(status: number | 'hang') {
    const calls: { headers: IncomingMessage['headers']; body: unknown }[] = [];
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        calls.push({
          headers: request.headers,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        });
        if (status === 'hang') return;
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ id: 'x' }));
      });
    });
    const listening = server;
    await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
    return {
      url: `http://127.0.0.1:${String((listening.address() as AddressInfo).port)}/emails`,
      calls,
    };
  }

  const message = {
    to: 'player@example.test',
    subject: 'Hello',
    text: 'link: https://x.test/?token=SECRET',
  };

  it('posts the documented shape with the bearer key', async () => {
    const { url, calls } = await start(200);
    await new ResendEmailProvider('re_key', 'GameVerse <hi@gameverse.test>', url).send(message);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers['authorization']).toBe('Bearer re_key');
    expect(calls[0]?.body).toEqual({
      from: 'GameVerse <hi@gameverse.test>',
      to: ['player@example.test'],
      subject: 'Hello',
      text: message.text,
    });
  });

  it('throws on a rejected message without leaking the body or key into the error', async () => {
    const { url } = await start(422);
    const error = await new ResendEmailProvider('re_key', 'a@b.test', url)
      .send(message)
      .catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('422');
    expect((error as Error).message).not.toContain('SECRET');
    expect((error as Error).message).not.toContain('re_key');
  });

  it('throws when the provider is unreachable or too slow', async () => {
    await expect(
      new ResendEmailProvider('k', 'a@b.test', 'http://127.0.0.1:1/emails', 500).send(message),
    ).rejects.toThrow('unreachable');
    const { url } = await start('hang');
    await expect(new ResendEmailProvider('k', 'a@b.test', url, 200).send(message)).rejects.toThrow(
      'unreachable',
    );
  });
});
