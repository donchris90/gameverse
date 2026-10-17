import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MemoryPushProvider, PushProvider } from '../src/push/push.provider.js';
import { PushService } from '../src/push/push.service.js';
import {
  befriend,
  newClientMessageId,
  openConversation,
  registerWithProfile,
  type SocialUser,
} from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

let tokenCounter = 0;
const deviceToken = (): string => {
  tokenCounter += 1;
  return `ExponentPushToken[device${String(tokenCounter).padStart(8, '0')}]`;
};

describe('push notifications and presence', () => {
  let t: TestApp;
  let port: number;
  let provider: MemoryPushProvider;
  let push: PushService;
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    t = await createTestApp({ PUSH_PROVIDER: 'memory', PRESENCE_OFFLINE_GRACE_MS: '200' });
    await t.app.listen(0);
    port = (t.app.getHttpServer().address() as AddressInfo).port;
    provider = t.app.get(PushProvider) as MemoryPushProvider;
    push = t.app.get(PushService);
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    provider.clear();
    provider.invalidTokens.clear();
  });
  afterEach(() => {
    for (const ws of sockets.splice(0)) ws.terminate();
  });

  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function register(
    user: SocialUser,
    token = deviceToken(),
    platform = 'ANDROID',
  ): Promise<string> {
    await request(t.server)
      .put('/v1/me/devices')
      .set(user.auth)
      .send({ token, platform })
      .expect(204);
    return token;
  }

  interface Live {
    ws: WebSocket;
    events: Record<string, unknown>[];
    closed: Promise<number>;
  }
  async function connect(user: SocialUser): Promise<Live> {
    const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`);
    sockets.push(ws);
    const events: Record<string, unknown>[] = [];
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    ws.on('error', () => undefined);
    let ready!: () => void;
    const isReady = new Promise<void>((resolve) => (ready = resolve));
    ws.on('message', (data) => {
      const event = JSON.parse(data.toString()) as Record<string, unknown>;
      events.push(event);
      if (event['type'] === 'ready') ready();
    });
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({ type: 'auth', token: user.token }));
    await isReady;
    return { ws, events, closed };
  }

  describe('device tokens', () => {
    it('requires authentication and a valid Expo token', async () => {
      await request(t.server).put('/v1/me/devices').send({}).expect(401);
      await request(t.server).delete('/v1/me/devices?token=x').expect(401);
      const a = await registerWithProfile(t);
      for (const body of [
        {},
        { token: 'not-a-token', platform: 'IOS' },
        { token: deviceToken(), platform: 'WINDOWS' },
        { token: 'ExponentPushToken[]', platform: 'IOS' },
      ]) {
        await request(t.server).put('/v1/me/devices').set(a.auth).send(body).expect(400);
      }
    });

    it('registering is idempotent, and a token moves to the latest account that registers it', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      const token = await register(a);
      await register(a, token);
      expect(await t.prisma.deviceToken.count({ where: { userId: a.id } })).toBe(1);

      await register(b, token, 'IOS'); // same phone, different account
      expect(await t.prisma.deviceToken.count()).toBe(1);
      expect((await t.prisma.deviceToken.findUniqueOrThrow({ where: { token } })).userId).toBe(
        b.id,
      );
    });

    it('unregister only removes your own token; a user keeps at most 10 devices', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      const token = await register(a);
      await request(t.server).delete('/v1/me/devices').query({ token }).set(b.auth).expect(204);
      expect(await t.prisma.deviceToken.count()).toBe(1);
      await request(t.server).delete('/v1/me/devices').query({ token }).set(a.auth).expect(204);
      expect(await t.prisma.deviceToken.count()).toBe(0);

      for (let i = 0; i < 12; i += 1) await register(a);
      expect(await t.prisma.deviceToken.count({ where: { userId: a.id } })).toBe(10);
    });
  });

  describe('when a push is sent', () => {
    it('friend request: the receiver is notified once, with no personal data; resends and cooldown sends stay silent', async () => {
      const a = await registerWithProfile(t, 'Sender_A');
      const b = await registerWithProfile(t);
      const token = await register(b);
      const send = () =>
        request(t.server)
          .post('/v1/friends/requests')
          .set(a.auth)
          .send({ userId: b.id })
          .expect(200);

      await send();
      await push.idle();
      expect(provider.to(token)).toEqual([
        expect.objectContaining({
          body: 'Sender_A sent you a friend request',
          data: { type: 'FRIEND_REQUEST', userId: a.id },
        }),
      ]);
      expect(JSON.stringify(provider.sent)).not.toMatch(/@example|email/i);

      await send();
      await push.idle();
      expect(provider.sent).toHaveLength(1);

      // Rejected, then re-sent inside the cooldown: the receiver must not be pinged again.
      const incoming = await request(t.server).get('/v1/friends/requests').set(b.auth).expect(200);
      await request(t.server)
        .post(`/v1/friends/requests/${incoming.body.items[0].id}/reject`)
        .set(b.auth)
        .expect(204);
      await send();
      await push.idle();
      expect(provider.sent).toHaveLength(1);
    });

    it('accepting notifies the original sender, including when a mutual request auto-accepts', async () => {
      const a = await registerWithProfile(t, 'Asker');
      const b = await registerWithProfile(t, 'Accepter');
      const tokenA = await register(a);
      const tokenB = await register(b);

      await request(t.server)
        .post('/v1/friends/requests')
        .set(a.auth)
        .send({ userId: b.id })
        .expect(200);
      await push.idle();
      expect(provider.to(tokenB)).toHaveLength(1);

      const incoming = await request(t.server).get('/v1/friends/requests').set(b.auth).expect(200);
      await request(t.server)
        .post(`/v1/friends/requests/${incoming.body.items[0].id}/accept`)
        .set(b.auth)
        .expect(204);
      await push.idle();
      expect(provider.to(tokenA).map((m) => m.body)).toEqual([
        'Accepter accepted your friend request',
      ]);

      // Mutual path: C asks D, D asks C -> C is told D accepted.
      const c = await registerWithProfile(t, 'Cee');
      const d = await registerWithProfile(t, 'Dee');
      const tokenC = await register(c);
      await request(t.server)
        .post('/v1/friends/requests')
        .set(c.auth)
        .send({ userId: d.id })
        .expect(200);
      await request(t.server)
        .post('/v1/friends/requests')
        .set(d.auth)
        .send({ userId: c.id })
        .expect(200);
      await push.idle();
      expect(provider.to(tokenC).map((m) => m.body)).toEqual(['Dee accepted your friend request']);
    });

    it('messages: notifies an offline recipient without the message text; not the sender, not when muted, not when online', async () => {
      const a = await registerWithProfile(t, 'Chatty_A');
      const b = await registerWithProfile(t);
      await befriend(t, a, b);
      const conversationId = await openConversation(t, a, b);
      const tokenA = await register(a);
      const tokenB = await register(b);
      provider.clear();
      const send = (text: string) =>
        request(t.server)
          .post(`/v1/conversations/${conversationId}/messages`)
          .set(a.auth)
          .send({ body: text, clientMessageId: newClientMessageId() })
          .expect(201);

      await send('super secret plans');
      await push.idle();
      expect(provider.to(tokenB)).toEqual([
        expect.objectContaining({
          title: 'Chatty_A',
          body: 'Sent you a message',
          data: { type: 'MESSAGE', conversationId },
        }),
      ]);
      expect(JSON.stringify(provider.sent)).not.toContain('secret');
      expect(provider.to(tokenA)).toEqual([]);

      await request(t.server)
        .patch(`/v1/conversations/${conversationId}/mute`)
        .set(b.auth)
        .send({ muted: true })
        .expect(200);
      provider.clear();
      await send('muted one');
      await push.idle();
      expect(provider.sent).toEqual([]);

      await request(t.server)
        .patch(`/v1/conversations/${conversationId}/mute`)
        .set(b.auth)
        .send({ muted: false })
        .expect(200);
      await connect(b); // recipient is online: they get it live, no push
      await send('live one');
      await push.idle();
      expect(provider.sent).toEqual([]);
    });

    it('refused messages never push', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      await befriend(t, a, b);
      const conversationId = await openConversation(t, a, b);
      await register(b);
      provider.clear();
      await request(t.server).post('/v1/blocks').set(b.auth).send({ userId: a.id }).expect(204);
      await request(t.server)
        .post(`/v1/conversations/${conversationId}/messages`)
        .set(a.auth)
        .send({ body: 'hi', clientMessageId: newClientMessageId() })
        .expect(404);
      await push.idle();
      expect(provider.sent).toEqual([]);
    });

    it('drops device tokens the push service reports as gone, and tokens of banned accounts', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      const dead = await register(b);
      await register(b);
      provider.invalidTokens.add(dead);
      await request(t.server)
        .post('/v1/friends/requests')
        .set(a.auth)
        .send({ userId: b.id })
        .expect(200);
      await push.idle();
      expect(await t.prisma.deviceToken.count({ where: { userId: b.id } })).toBe(1);
      expect(await t.prisma.deviceToken.findUnique({ where: { token: dead } })).toBeNull();

      const staff = await registerWithProfile(t);
      await t.prisma.user.update({ where: { id: staff.id }, data: { role: 'MODERATOR' } });
      await request(t.server)
        .post(`/v1/admin/users/${b.id}/ban`)
        .set(staff.auth)
        .send({ reason: 'test ban' })
        .expect(204);
      expect(await t.prisma.deviceToken.count({ where: { userId: b.id } })).toBe(0);
    });

    it('a push failure never fails the request that caused it', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      await register(b);
      const original = provider.send.bind(provider);
      provider.send = () => Promise.reject(new Error('push service exploded'));
      try {
        await request(t.server)
          .post('/v1/friends/requests')
          .set(a.auth)
          .send({ userId: b.id })
          .expect(200);
        await push.idle();
      } finally {
        provider.send = original;
      }
      expect(await t.prisma.friendRequest.count()).toBe(1);
    });
  });

  describe('presence', () => {
    const query = (viewer: SocialUser, userIds: string[]) =>
      request(t.server).post('/v1/presence/query').set(viewer.auth).send({ userIds });

    it('requires authentication and validates the list', async () => {
      await request(t.server).post('/v1/presence/query').send({ userIds: [] }).expect(401);
      const a = await registerWithProfile(t);
      await query(a, []).expect(400);
      await query(a, ['nope']).expect(400);
      await query(
        a,
        Array.from({ length: 101 }, () => crypto.randomUUID()),
      ).expect(400);
    });

    it('shows friends online/offline by default and hides strangers; yourself is always visible', async () => {
      const me = await registerWithProfile(t);
      const friend = await registerWithProfile(t);
      const stranger = await registerWithProfile(t);
      await befriend(t, me, friend);
      await connect(friend);
      await connect(stranger);

      const result = await query(me, [friend.id, stranger.id, me.id]).expect(200);
      expect(result.body).toEqual([
        { userId: friend.id, online: true },
        { userId: stranger.id, online: null },
        { userId: me.id, online: false },
      ]);
    });

    it('honours EVERYONE and NOBODY, and answers identically for blocked, unknown and hidden users', async () => {
      const me = await registerWithProfile(t);
      const open = await registerWithProfile(t);
      const hidden = await registerWithProfile(t);
      const blocker = await registerWithProfile(t);
      await befriend(t, me, hidden);
      await request(t.server)
        .patch('/v1/me/settings')
        .set(open.auth)
        .send({ onlineStatusVisibility: 'EVERYONE' })
        .expect(200);
      await request(t.server)
        .patch('/v1/me/settings')
        .set(hidden.auth)
        .send({ onlineStatusVisibility: 'NOBODY' })
        .expect(200);
      await request(t.server)
        .patch('/v1/me/settings')
        .set(blocker.auth)
        .send({ onlineStatusVisibility: 'EVERYONE' })
        .expect(200);
      await request(t.server)
        .post('/v1/blocks')
        .set(blocker.auth)
        .send({ userId: me.id })
        .expect(204);
      for (const user of [open, hidden, blocker]) await connect(user);

      const ghost = crypto.randomUUID();
      const result = await query(me, [open.id, hidden.id, blocker.id, ghost]).expect(200);
      expect(result.body).toEqual([
        { userId: open.id, online: true },
        { userId: hidden.id, online: null },
        { userId: blocker.id, online: null },
        { userId: ghost, online: null },
      ]);
    });

    it('banned users look the same as unknown users', async () => {
      const me = await registerWithProfile(t);
      const user = await registerWithProfile(t);
      await request(t.server)
        .patch('/v1/me/settings')
        .set(user.auth)
        .send({ onlineStatusVisibility: 'EVERYONE' })
        .expect(200);
      await connect(user);
      await t.prisma.user.update({ where: { id: user.id }, data: { status: 'BANNED' } });
      expect((await query(me, [user.id]).expect(200)).body).toEqual([
        { userId: user.id, online: null },
      ]);
    });

    it('tells online friends when someone connects and, after the grace period, disconnects', async () => {
      const a = await registerWithProfile(t);
      const friend = await registerWithProfile(t);
      const stranger = await registerWithProfile(t);
      await befriend(t, a, friend);
      const watcher = await connect(friend);
      const outsider = await connect(stranger);

      const live = await connect(a);
      await pause(150);
      expect(watcher.events).toContainEqual({
        type: 'presence.update',
        userId: a.id,
        online: true,
      });

      live.ws.close();
      await pause(80);
      expect(watcher.events.filter((e) => e['online'] === false)).toEqual([]); // still inside the grace period
      await pause(400);
      expect(watcher.events).toContainEqual({
        type: 'presence.update',
        userId: a.id,
        online: false,
      });
      expect(outsider.events.filter((e) => e['type'] === 'presence.update')).toEqual([]);
    });

    it('a quick reconnect inside the grace period produces no offline/online flapping', async () => {
      const a = await registerWithProfile(t);
      const friend = await registerWithProfile(t);
      await befriend(t, a, friend);
      const watcher = await connect(friend);
      const first = await connect(a);
      await pause(100);
      watcher.events.length = 0;

      first.ws.close();
      await pause(60);
      await connect(a);
      await pause(500);
      expect(watcher.events.filter((e) => e['type'] === 'presence.update')).toEqual([]);
    });

    it('does not broadcast for users who chose NOBODY, and a second device does not re-announce', async () => {
      const a = await registerWithProfile(t);
      const friend = await registerWithProfile(t);
      await befriend(t, a, friend);
      const watcher = await connect(friend);
      await request(t.server)
        .patch('/v1/me/settings')
        .set(a.auth)
        .send({ onlineStatusVisibility: 'NOBODY' })
        .expect(200);
      await connect(a);
      await pause(200);
      expect(watcher.events.filter((e) => e['type'] === 'presence.update')).toEqual([]);

      await request(t.server)
        .patch('/v1/me/settings')
        .set(a.auth)
        .send({ onlineStatusVisibility: 'FRIENDS' })
        .expect(200);
      await connect(a); // second device while already online
      await pause(200);
      expect(watcher.events.filter((e) => e['type'] === 'presence.update')).toEqual([]);
    });
  });
});
