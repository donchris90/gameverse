import type { AddressInfo } from 'node:net';
import { SignJWT } from 'jose';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  befriend,
  newClientMessageId,
  openConversation,
  registerWithProfile,
  type SocialUser,
} from './helpers/factories.js';
import { createTestApp, resetDatabase, TEST_JWT_SECRET, type TestApp } from './helpers/test-app.js';

interface Client {
  ws: WebSocket;
  events: Record<string, unknown>[];
  closed: Promise<{ code: number; reason: string }>;
  waitFor: (
    predicate: (event: Record<string, unknown>) => boolean,
    ms?: number,
  ) => Promise<Record<string, unknown>>;
}

describe('WebSocket delivery', () => {
  let t: TestApp;
  let port: number;
  const open: WebSocket[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.listen(0);
    port = (t.app.getHttpServer().address() as AddressInfo).port;
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });
  afterEach(() => {
    for (const ws of open.splice(0)) ws.terminate();
  });

  function connect(path = '/ws'): Client {
    const ws = new WebSocket(`ws://127.0.0.1:${String(port)}${path}`);
    open.push(ws);
    const events: Record<string, unknown>[] = [];
    const listeners: (() => void)[] = [];
    ws.on('message', (data) => {
      events.push(JSON.parse(data.toString()) as Record<string, unknown>);
      for (const listener of listeners.slice()) listener(); // copy: listeners remove themselves
    });
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
      ws.on('error', () => undefined);
    });
    const waitFor: Client['waitFor'] = (predicate, ms = 3000) =>
      new Promise((resolve, reject) => {
        const check = () => {
          const found = events.find(predicate);
          if (found) {
            clearTimeout(timer);
            listeners.splice(listeners.indexOf(check), 1);
            resolve(found);
          }
        };
        const timer = setTimeout(() => {
          listeners.splice(listeners.indexOf(check), 1);
          reject(new Error(`timed out waiting for event; saw ${JSON.stringify(events)}`));
        }, ms);
        listeners.push(check);
        check();
      });
    return { ws, events, closed, waitFor };
  }

  async function authed(user: SocialUser, token = user.token): Promise<Client> {
    const client = connect();
    await new Promise<void>((resolve, reject) => {
      client.ws.once('open', () => resolve());
      client.ws.once('error', reject);
    });
    client.ws.send(JSON.stringify({ type: 'auth', token }));
    await client.waitFor((e) => e['type'] === 'ready');
    return client;
  }

  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function pair() {
    const a = await registerWithProfile(t);
    const b = await registerWithProfile(t);
    await befriend(t, a, b);
    const conversationId = await openConversation(t, a, b);
    return { a, b, conversationId };
  }

  const send = (user: SocialUser, conversationId: string, body = 'hello') =>
    request(t.server)
      .post(`/v1/conversations/${conversationId}/messages`)
      .set(user.auth)
      .send({ body, clientMessageId: newClientMessageId() });

  describe('authentication', () => {
    it('accepts a valid access token and says ready', async () => {
      const a = await registerWithProfile(t);
      const client = await authed(a);
      expect(client.events).toContainEqual({ type: 'ready', userId: a.id });
    });

    it('closes unauthenticated sockets that send anything but auth first', async () => {
      const client = connect();
      await new Promise((resolve) => client.ws.once('open', resolve));
      client.ws.send(JSON.stringify({ type: 'ping' }));
      expect((await client.closed).code).toBe(4401);
    });

    it.each(['garbage', ''])('rejects an invalid token %j', async (token) => {
      const client = connect();
      await new Promise((resolve) => client.ws.once('open', resolve));
      client.ws.send(JSON.stringify({ type: 'auth', token }));
      expect((await client.closed).code).toBe(4401);
    });

    it('rejects an expired token', async () => {
      const a = await registerWithProfile(t);
      const key = new TextEncoder().encode(TEST_JWT_SECRET);
      const expired = await new SignJWT({ role: 'USER' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(a.id)
        .setIssuer('gameverse-api')
        .setAudience('gameverse-app')
        .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
        .sign(key);
      const client = connect();
      await new Promise((resolve) => client.ws.once('open', resolve));
      client.ws.send(JSON.stringify({ type: 'auth', token: expired }));
      expect((await client.closed).code).toBe(4401);
    });

    it('rejects banned accounts with 4403', async () => {
      const a = await registerWithProfile(t);
      await t.prisma.user.update({ where: { id: a.id }, data: { status: 'BANNED' } });
      const client = connect();
      await new Promise((resolve) => client.ws.once('open', resolve));
      client.ws.send(JSON.stringify({ type: 'auth', token: a.token }));
      expect((await client.closed).code).toBe(4403);
    });

    it('closes a socket that never authenticates', async () => {
      const client = connect();
      const result = await client.closed;
      expect(result.code).toBe(4408);
    }, 10_000);

    it('closes the socket when its access token expires so the client must refresh', async () => {
      const a = await registerWithProfile(t);
      const key = new TextEncoder().encode(TEST_JWT_SECRET);
      const shortLived = await new SignJWT({ role: 'USER' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(a.id)
        .setIssuer('gameverse-api')
        .setAudience('gameverse-app')
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + 2)
        .sign(key);
      const client = await authed(a, shortLived);
      const result = await client.closed;
      expect(result).toEqual({ code: 4401, reason: 'token expired' });
    }, 10_000);

    it('refuses upgrades on any other path', async () => {
      const client = connect('/not-ws');
      const outcome = await new Promise<string>((resolve) => {
        client.ws.once('open', () => resolve('open'));
        client.ws.once('error', () => resolve('error'));
      });
      expect(outcome).toBe('error');
    });
  });

  describe('protocol hygiene', () => {
    it('answers ping, reports unsupported frames, and closes on binary or invalid JSON', async () => {
      const a = await registerWithProfile(t);
      const client = await authed(a);
      client.ws.send(JSON.stringify({ type: 'ping' }));
      await client.waitFor((e) => e['type'] === 'pong');
      client.ws.send(JSON.stringify({ type: 'send_message', body: 'nope' }));
      await client.waitFor((e) => e['type'] === 'error' && e['code'] === 'UNSUPPORTED');

      const bad = await authed(a);
      bad.ws.send('{not json');
      expect((await bad.closed).code).toBe(1007);

      const binary = await authed(a);
      binary.ws.send(Buffer.from([1, 2, 3]));
      expect((await binary.closed).code).toBe(1003);
    });

    it('closes oversized frames and frame floods', async () => {
      const a = await registerWithProfile(t);
      const big = await authed(a);
      big.ws.send(JSON.stringify({ type: 'ping', pad: 'x'.repeat(8000) }));
      expect((await big.closed).code).toBe(1009);

      const flood = await authed(a);
      for (let i = 0; i < 40; i += 1) flood.ws.send(JSON.stringify({ type: 'ping' }));
      expect((await flood.closed).code).toBe(4429);
    });

    it('keeps at most 5 sockets per user by closing the oldest', async () => {
      const a = await registerWithProfile(t);
      const clients: Client[] = [];
      for (let i = 0; i < 6; i += 1) clients.push(await authed(a));
      const first = clients[0] as Client;
      expect((await first.closed).code).toBe(4409);
    });
  });

  describe('message delivery', () => {
    it('delivers new messages to the recipient and the senders other devices, and nobody else', async () => {
      const { a, b, conversationId } = await pair();
      const mallory = await registerWithProfile(t);
      const recipient = await authed(b);
      const senderOtherDevice = await authed(a);
      const outsider = await authed(mallory);

      const response = await send(a, conversationId, 'live!').expect(201);

      const received = await recipient.waitFor((e) => e['type'] === 'message.new');
      expect(received).toMatchObject({
        conversationId,
        message: { id: response.body.id, body: 'live!', senderId: a.id },
      });
      await senderOtherDevice.waitFor((e) => e['type'] === 'message.new');
      await pause(400);
      expect(outsider.events.filter((e) => e['type'] === 'message.new')).toEqual([]);
    });

    it('does not deliver when the send is refused (blocked, filtered, rate limited)', async () => {
      const { a, b, conversationId } = await pair();
      const recipient = await authed(b);
      await send(a, conversationId, 'f.u.c.k').expect(422);
      await request(t.server).post('/v1/blocks').set(b.auth).send({ userId: a.id }).expect(204);
      await send(a, conversationId, 'hi').expect(404);
      await pause(400);
      expect(recipient.events.filter((e) => e['type'] === 'message.new')).toEqual([]);
    });

    it('does not re-deliver an idempotent retry', async () => {
      const { a, b, conversationId } = await pair();
      const recipient = await authed(b);
      const clientMessageId = newClientMessageId();
      const post = () =>
        request(t.server)
          .post(`/v1/conversations/${conversationId}/messages`)
          .set(a.auth)
          .send({ body: 'once', clientMessageId });
      await post().expect(201);
      await post().expect(200);
      await pause(400);
      expect(recipient.events.filter((e) => e['type'] === 'message.new')).toHaveLength(1);
    });

    it('sends read receipts to the other person, only when the position actually moves', async () => {
      const { a, b, conversationId } = await pair();
      const senderSocket = await authed(a);
      const sent = await send(a, conversationId, 'seen?').expect(201);
      await request(t.server)
        .post(`/v1/conversations/${conversationId}/read`)
        .set(b.auth)
        .send({})
        .expect(204);
      const receipt = await senderSocket.waitFor((e) => e['type'] === 'message.read');
      expect(receipt).toEqual({
        type: 'message.read',
        conversationId,
        userId: b.id,
        lastReadMessageId: sent.body.id,
      });
      await request(t.server)
        .post(`/v1/conversations/${conversationId}/read`)
        .set(b.auth)
        .send({})
        .expect(204);
      await pause(300);
      expect(senderSocket.events.filter((e) => e['type'] === 'message.read')).toHaveLength(1);
    });
  });
});
