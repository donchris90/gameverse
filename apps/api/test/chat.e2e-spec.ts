import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  befriend,
  newClientMessageId,
  openConversation,
  registerWithProfile,
  type SocialUser,
} from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

describe('1:1 chat (REST)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });

  const send = (
    user: SocialUser,
    conversationId: string,
    body = 'hello',
    clientMessageId = newClientMessageId(),
  ) =>
    request(t.server)
      .post(`/v1/conversations/${conversationId}/messages`)
      .set(user.auth)
      .send({ body, clientMessageId });

  async function friendsWithConversation() {
    const a = await registerWithProfile(t, undefined);
    const b = await registerWithProfile(t, undefined);
    await befriend(t, a, b);
    const conversationId = await openConversation(t, a, b);
    return { a, b, conversationId };
  }

  describe('authentication', () => {
    it.each([
      ['post', '/v1/conversations'],
      ['get', '/v1/conversations'],
      ['get', '/v1/conversations/0198a000-0000-7000-8000-000000000001/messages'],
      ['post', '/v1/conversations/0198a000-0000-7000-8000-000000000001/messages'],
      ['post', '/v1/conversations/0198a000-0000-7000-8000-000000000001/read'],
      ['patch', '/v1/conversations/0198a000-0000-7000-8000-000000000001/mute'],
    ] as const)('%s %s requires a token', async (method, path) => {
      await request(t.server)[method](path).send({}).expect(401);
    });
  });

  describe('who may start a conversation', () => {
    it('friends can; opening twice returns the same conversation', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      await befriend(t, a, b);
      const first = await openConversation(t, a, b);
      const second = await openConversation(t, b, a);
      expect(second).toBe(first);
      expect(await t.prisma.conversation.count()).toBe(1);
      expect(await t.prisma.conversationMember.count()).toBe(2);
    });

    it('simultaneous opens from both sides still create exactly one conversation', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      await befriend(t, a, b);
      const results = await Promise.all([
        request(t.server).post('/v1/conversations').set(a.auth).send({ userId: b.id }),
        request(t.server).post('/v1/conversations').set(b.auth).send({ userId: a.id }),
        request(t.server).post('/v1/conversations').set(a.auth).send({ userId: b.id }),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(await t.prisma.conversation.count()).toBe(1);
    });

    it('strangers are refused under the default friends-only DM setting', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      const response = await request(t.server)
        .post('/v1/conversations')
        .set(a.auth)
        .send({ userId: b.id })
        .expect(403);
      expect(response.body.error.code).toBe('CANNOT_MESSAGE');
    });

    it('strangers can message someone who opted into EVERYONE, and nobody can message a NOBODY user', async () => {
      const open = await registerWithProfile(t);
      const closed = await registerWithProfile(t);
      const friend = await registerWithProfile(t);
      const stranger = await registerWithProfile(t);
      await request(t.server)
        .patch('/v1/me/settings')
        .set(open.auth)
        .send({ dmPolicy: 'EVERYONE' })
        .expect(200);
      await request(t.server)
        .patch('/v1/me/settings')
        .set(closed.auth)
        .send({ dmPolicy: 'NOBODY' })
        .expect(200);
      await befriend(t, friend, closed);

      await request(t.server)
        .post('/v1/conversations')
        .set(stranger.auth)
        .send({ userId: open.id })
        .expect(200);
      await request(t.server)
        .post('/v1/conversations')
        .set(stranger.auth)
        .send({ userId: closed.id })
        .expect(403);
      await request(t.server)
        .post('/v1/conversations')
        .set(friend.auth)
        .send({ userId: closed.id })
        .expect(403);
    });

    it('rejects self, unknown users and blocked users', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      await befriend(t, a, b);
      await request(t.server)
        .post('/v1/conversations')
        .set(a.auth)
        .send({ userId: a.id })
        .expect(400);
      await request(t.server)
        .post('/v1/conversations')
        .set(a.auth)
        .send({ userId: '0198a000-0000-7000-8000-00000000dead' })
        .expect(404);
      await request(t.server).post('/v1/blocks').set(b.auth).send({ userId: a.id }).expect(204);
      await request(t.server)
        .post('/v1/conversations')
        .set(a.auth)
        .send({ userId: b.id })
        .expect(404);
    });
  });

  describe('sending and history', () => {
    it('sends, stores the trimmed body with the real sender, and lists newest first with paging', async () => {
      const { a, b, conversationId } = await friendsWithConversation();
      const sent = await send(a, conversationId, '  hi there  ').expect(201);
      expect(sent.body).toMatchObject({ conversationId, senderId: a.id, body: 'hi there' });
      for (let i = 0; i < 4; i += 1)
        await send(i % 2 === 0 ? b : a, conversationId, `m${String(i)}`).expect(201);

      const page1 = await request(t.server)
        .get(`/v1/conversations/${conversationId}/messages?limit=2`)
        .set(b.auth)
        .expect(200);
      expect(page1.body.items.map((m: { body: string }) => m.body)).toEqual(['m3', 'm2']);
      const page2 = await request(t.server)
        .get(`/v1/conversations/${conversationId}/messages?limit=2&before=${page1.body.nextCursor}`)
        .set(b.auth)
        .expect(200);
      expect(page2.body.items.map((m: { body: string }) => m.body)).toEqual(['m1', 'm0']);
      const page3 = await request(t.server)
        .get(`/v1/conversations/${conversationId}/messages?limit=2&before=${page2.body.nextCursor}`)
        .set(b.auth)
        .expect(200);
      expect(page3.body.items.map((m: { body: string }) => m.body)).toEqual(['hi there']);
      expect(page3.body.nextCursor).toBeNull();
    });

    it('ignores a spoofed senderId in the request body', async () => {
      const { a, b, conversationId } = await friendsWithConversation();
      const response = await request(t.server)
        .post(`/v1/conversations/${conversationId}/messages`)
        .set(a.auth)
        .send({ body: 'hi', clientMessageId: newClientMessageId(), senderId: b.id })
        .expect(201);
      expect(response.body.senderId).toBe(a.id);
    });

    it('is idempotent on clientMessageId, including under concurrent retries', async () => {
      const { a, conversationId } = await friendsWithConversation();
      const clientMessageId = newClientMessageId();
      const first = await send(a, conversationId, 'once', clientMessageId).expect(201);
      const retry = await send(a, conversationId, 'once', clientMessageId).expect(200);
      expect(retry.body.id).toBe(first.body.id);

      const racing = newClientMessageId();
      const results = await Promise.all(
        [1, 2, 3, 4, 5].map(() => send(a, conversationId, 'race', racing)),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 200, 200, 200, 201]);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(await t.prisma.message.count()).toBe(2);
    });

    it.each([
      ['empty', { body: '', clientMessageId: newClientMessageId() }],
      ['whitespace only', { body: '   ', clientMessageId: newClientMessageId() }],
      ['too long', { body: 'x'.repeat(2001), clientMessageId: newClientMessageId() }],
      ['no clientMessageId', { body: 'hi' }],
      ['bad clientMessageId', { body: 'hi', clientMessageId: 'abc' }],
      ['non-string body', { body: 5, clientMessageId: newClientMessageId() }],
    ])('rejects an invalid message: %s', async (_name, body) => {
      const { a, conversationId } = await friendsWithConversation();
      const response = await request(t.server)
        .post(`/v1/conversations/${conversationId}/messages`)
        .set(a.auth)
        .send(body)
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('filters blocked words and stores nothing', async () => {
      const { a, conversationId } = await friendsWithConversation();
      const response = await send(a, conversationId, 'you are a f.u.c.k').expect(422);
      expect(response.body.error.code).toBe('CONTENT_NOT_ALLOWED');
      expect(await t.prisma.message.count()).toBe(0);
    });

    it('rate limits bursts per sender with 429', async () => {
      const { a, conversationId } = await friendsWithConversation();
      await t.prisma.message.createMany({
        data: Array.from({ length: 20 }, () => ({
          conversationId,
          senderId: a.id,
          body: 'spam',
          clientMessageId: crypto.randomUUID(),
        })),
      });
      const response = await send(a, conversationId, 'one more').expect(429);
      expect(response.body.error.code).toBe('RATE_LIMITED');
      expect(await t.prisma.message.count()).toBe(20);
    });
  });

  describe('object-level authorization', () => {
    it('non-members get 404 for every conversation endpoint', async () => {
      const { a, conversationId } = await friendsWithConversation();
      const mallory = await registerWithProfile(t);
      const own = await send(a, conversationId, 'private').expect(201);
      const attempts: [string, () => request.Test][] = [
        [
          'read history',
          () =>
            request(t.server).get(`/v1/conversations/${conversationId}/messages`).set(mallory.auth),
        ],
        ['send', () => send(mallory, conversationId, 'intrude')],
        [
          'mark read',
          () =>
            request(t.server)
              .post(`/v1/conversations/${conversationId}/read`)
              .set(mallory.auth)
              .send({}),
        ],
        [
          'mark read specific',
          () =>
            request(t.server)
              .post(`/v1/conversations/${conversationId}/read`)
              .set(mallory.auth)
              .send({ messageId: own.body.id }),
        ],
        [
          'mute',
          () =>
            request(t.server)
              .patch(`/v1/conversations/${conversationId}/mute`)
              .set(mallory.auth)
              .send({ muted: true }),
        ],
      ];
      for (const [label, attempt] of attempts) {
        const response = await attempt();
        expect(response.status, label).toBe(404);
      }
      expect(await t.prisma.message.count()).toBe(1);
      const list = await request(t.server).get('/v1/conversations').set(mallory.auth).expect(200);
      expect(list.body.items).toEqual([]);
    });
  });

  describe('changing relationships', () => {
    it('blocking hides the conversation both ways and keeps history for after an unblock', async () => {
      const { a, b, conversationId } = await friendsWithConversation();
      await send(a, conversationId, 'before block').expect(201);
      await request(t.server).post('/v1/blocks').set(a.auth).send({ userId: b.id }).expect(204);

      for (const user of [a, b]) {
        await request(t.server)
          .get(`/v1/conversations/${conversationId}/messages`)
          .set(user.auth)
          .expect(404);
        await send(user, conversationId, 'after block').expect(404);
        const list = await request(t.server).get('/v1/conversations').set(user.auth).expect(200);
        expect(list.body.items).toEqual([]);
      }
      await request(t.server).delete(`/v1/blocks/${b.id}`).set(a.auth).expect(204);
      const restored = await request(t.server)
        .get(`/v1/conversations/${conversationId}/messages`)
        .set(a.auth)
        .expect(200);
      expect(restored.body.items.map((m: { body: string }) => m.body)).toEqual(['before block']);
    });

    it('re-checks the DM setting on every send, and unfriending ends friends-only messaging', async () => {
      const { a, b, conversationId } = await friendsWithConversation();
      await send(a, conversationId).expect(201);
      await request(t.server)
        .patch('/v1/me/settings')
        .set(b.auth)
        .send({ dmPolicy: 'NOBODY' })
        .expect(200);
      const refused = await send(a, conversationId).expect(403);
      expect(refused.body.error.code).toBe('CANNOT_MESSAGE');
      // The recipient may still reply to the person they muted themselves from.
      await send(b, conversationId).expect(201);

      await request(t.server)
        .patch('/v1/me/settings')
        .set(b.auth)
        .send({ dmPolicy: 'FRIENDS' })
        .expect(200);
      await send(a, conversationId).expect(201);
      await request(t.server).delete(`/v1/friends/${b.id}`).set(a.auth).expect(204);
      await send(a, conversationId).expect(403);
    });

    it('hides conversations with suspended or banned users and refuses to send to them', async () => {
      const { a, b, conversationId } = await friendsWithConversation();
      await send(a, conversationId).expect(201);
      await t.prisma.user.update({ where: { id: b.id }, data: { status: 'BANNED' } });
      await send(a, conversationId).expect(403);
      const list = await request(t.server).get('/v1/conversations').set(a.auth).expect(200);
      expect(list.body.items).toEqual([]);
    });
  });

  describe('read state and unread counts', () => {
    it('counts only the other persons messages, clears on read, and only moves forward', async () => {
      const { a, b, conversationId } = await friendsWithConversation();
      const m1 = await send(a, conversationId, 'one').expect(201);
      const m2 = await send(a, conversationId, 'two').expect(201);

      const unread = async (user: SocialUser) =>
        (await request(t.server).get('/v1/conversations').set(user.auth).expect(200)).body.items[0]
          .unreadCount;
      expect(await unread(b)).toBe(2);
      expect(await unread(a)).toBe(0); // your own messages are never unread

      await request(t.server)
        .post(`/v1/conversations/${conversationId}/read`)
        .set(b.auth)
        .send({ messageId: m1.body.id })
        .expect(204);
      expect(await unread(b)).toBe(1);
      await request(t.server)
        .post(`/v1/conversations/${conversationId}/read`)
        .set(b.auth)
        .send({})
        .expect(204);
      expect(await unread(b)).toBe(0);

      // A stale request for an older message must not move the position backwards.
      await request(t.server)
        .post(`/v1/conversations/${conversationId}/read`)
        .set(b.auth)
        .send({ messageId: m1.body.id })
        .expect(204);
      expect(await unread(b)).toBe(0);
      const member = await t.prisma.conversationMember.findUniqueOrThrow({
        where: { conversationId_userId: { conversationId, userId: b.id } },
      });
      expect(member.lastReadMessageId).toBe(m2.body.id);
    });

    it('replying counts as having read everything up to your reply', async () => {
      const { a, b, conversationId } = await friendsWithConversation();
      await send(a, conversationId, 'question').expect(201);
      await send(b, conversationId, 'answer').expect(201);
      const list = async (user: SocialUser) =>
        (await request(t.server).get('/v1/conversations').set(user.auth).expect(200)).body.items[0];
      expect((await list(b)).unreadCount).toBe(0);
      expect((await list(a)).unreadCount).toBe(1);
    });

    it('rejects marking read a message from another conversation', async () => {
      const { a, b, conversationId } = await friendsWithConversation();
      const c = await registerWithProfile(t);
      await befriend(t, a, c);
      const other = await openConversation(t, a, c);
      const foreign = await send(a, other, 'elsewhere').expect(201);
      await request(t.server)
        .post(`/v1/conversations/${conversationId}/read`)
        .set(b.auth)
        .send({ messageId: foreign.body.id })
        .expect(404);
    });
  });

  describe('mute and listing', () => {
    it('mute is per person and shows in the list', async () => {
      const { a, b, conversationId } = await friendsWithConversation();
      await send(a, conversationId).expect(201);
      await request(t.server)
        .patch(`/v1/conversations/${conversationId}/mute`)
        .set(b.auth)
        .send({ muted: true })
        .expect(200);
      const mine = await request(t.server).get('/v1/conversations').set(b.auth).expect(200);
      const theirs = await request(t.server).get('/v1/conversations').set(a.auth).expect(200);
      expect(mine.body.items[0].muted).toBe(true);
      expect(theirs.body.items[0].muted).toBe(false);
      await request(t.server)
        .patch(`/v1/conversations/${conversationId}/mute`)
        .set(b.auth)
        .send({ muted: 'yes' })
        .expect(400);
    });

    it('orders by latest activity, hides empty conversations, and pages with an opaque cursor', async () => {
      const me = await registerWithProfile(t);
      const friends: SocialUser[] = [];
      for (let i = 0; i < 3; i += 1) {
        const friend = await registerWithProfile(t);
        await befriend(t, me, friend);
        friends.push(friend);
      }
      const ids: string[] = [];
      for (const friend of friends) ids.push(await openConversation(t, me, friend));
      const emptyOne = await registerWithProfile(t);
      await befriend(t, me, emptyOne);
      await openConversation(t, me, emptyOne);

      await send(me, ids[0] as string).expect(201);
      await send(me, ids[1] as string).expect(201);
      await send(me, ids[2] as string).expect(201);
      await send(me, ids[0] as string, 'bump').expect(201);

      const first = await request(t.server)
        .get('/v1/conversations?limit=2')
        .set(me.auth)
        .expect(200);
      expect(first.body.items.map((c: { id: string }) => c.id)).toEqual([ids[0], ids[2]]);
      const second = await request(t.server)
        .get(`/v1/conversations?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`)
        .set(me.auth)
        .expect(200);
      expect(second.body.items.map((c: { id: string }) => c.id)).toEqual([ids[1]]);
      expect(second.body.nextCursor).toBeNull();
      expect(first.body.items[0].lastMessage.body).toBe('bump');
      expect(JSON.stringify(first.body)).not.toMatch(/email|dateOfBirth/i);

      await request(t.server).get('/v1/conversations?cursor=garbage').set(me.auth).expect(400);
    });
  });
});
