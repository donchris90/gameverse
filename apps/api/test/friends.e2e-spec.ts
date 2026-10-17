import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registerUser, registerWithProfile, type SocialUser } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

describe('friends, search and blocking', () => {
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

  const sendRequest = (from: SocialUser, to: SocialUser) =>
    request(t.server).post('/v1/friends/requests').set(from.auth).send({ userId: to.id });
  const incoming = async (user: SocialUser) =>
    (
      await request(t.server)
        .get('/v1/friends/requests?direction=incoming')
        .set(user.auth)
        .expect(200)
    ).body.items as { id: string; user: { userId: string } }[];
  const friendIds = async (user: SocialUser) =>
    (
      (await request(t.server).get('/v1/friends').set(user.auth).expect(200)).body.items as {
        userId: string;
      }[]
    ).map((u) => u.userId);

  describe('authentication and input', () => {
    it.each([
      ['get', '/v1/friends'],
      ['post', '/v1/friends/requests'],
      ['get', '/v1/friends/requests'],
      ['get', '/v1/users/search?q=ab'],
      ['get', '/v1/blocks'],
      ['post', '/v1/blocks'],
    ] as const)('%s %s requires a token', async (method, path) => {
      await request(t.server)[method](path).send({}).expect(401);
    });

    it('rejects malformed ids and short search terms', async () => {
      const a = await registerWithProfile(t);
      await request(t.server)
        .post('/v1/friends/requests')
        .set(a.auth)
        .send({ userId: 'nope' })
        .expect(400);
      await request(t.server).get('/v1/users/not-a-uuid/profile').set(a.auth).expect(400);
      await request(t.server).get('/v1/users/search?q=a').set(a.auth).expect(400);
      await request(t.server).get('/v1/friends?limit=1000').set(a.auth).expect(400);
    });

    it('requires a profile before sending a request', async () => {
      const bare = await registerUser(t);
      const b = await registerWithProfile(t);
      const response = await request(t.server)
        .post('/v1/friends/requests')
        .set({ Authorization: `Bearer ${bare.session.accessToken}` })
        .send({ userId: b.id })
        .expect(409);
      expect(response.body.error.code).toBe('PROFILE_REQUIRED');
    });
  });

  describe('request lifecycle', () => {
    it('send, list, accept: both sides become friends and the request disappears', async () => {
      const a = await registerWithProfile(t, 'Amaka');
      const b = await registerWithProfile(t, 'Bayo');
      const sent = await sendRequest(a, b).expect(200);
      expect(sent.body).toEqual({ status: 'PENDING' });

      const list = await incoming(b);
      expect(list).toHaveLength(1);
      expect(list[0]?.user.userId).toBe(a.id);
      const outgoing = await request(t.server)
        .get('/v1/friends/requests?direction=outgoing')
        .set(a.auth)
        .expect(200);
      expect(outgoing.body.items[0].user).toMatchObject({
        userId: b.id,
        relationship: 'REQUEST_SENT',
      });

      await request(t.server)
        .post(`/v1/friends/requests/${list[0]?.id}/accept`)
        .set(b.auth)
        .expect(204);
      expect(await friendIds(a)).toEqual([b.id]);
      expect(await friendIds(b)).toEqual([a.id]);
      expect(await incoming(b)).toHaveLength(0);
      expect(await t.prisma.friendRequest.count()).toBe(0);
    });

    it('is idempotent when the same request is sent twice', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      await sendRequest(a, b).expect(200);
      await sendRequest(a, b).expect(200);
      expect(await t.prisma.friendRequest.count()).toBe(1);
    });

    it('says FRIENDS when asking someone who is already a friend', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      await sendRequest(a, b).expect(200);
      await request(t.server)
        .post(`/v1/friends/requests/${(await incoming(b))[0]?.id}/accept`)
        .set(b.auth)
        .expect(204);
      const again = await sendRequest(a, b).expect(200);
      expect(again.body).toEqual({ status: 'FRIENDS' });
    });

    it('cannot request yourself, a stranger who does not exist, or an account without a profile', async () => {
      const a = await registerWithProfile(t);
      const bare = await registerUser(t);
      expect((await sendRequest(a, a).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      await request(t.server)
        .post('/v1/friends/requests')
        .set(a.auth)
        .send({ userId: '0198a000-0000-7000-8000-00000000dead' })
        .expect(404);
      await request(t.server)
        .post('/v1/friends/requests')
        .set(a.auth)
        .send({ userId: bare.session.user.id })
        .expect(404);
    });

    it('reject is silent to the sender, who cannot resend inside the cooldown', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      await sendRequest(a, b).expect(200);
      const id = (await incoming(b))[0]?.id;
      await request(t.server).post(`/v1/friends/requests/${id}/reject`).set(b.auth).expect(204);
      await request(t.server).post(`/v1/friends/requests/${id}/reject`).set(b.auth).expect(204); // idempotent

      expect(await incoming(b)).toHaveLength(0);
      // Sender sees "sent" again but nothing reaches the receiver.
      expect((await sendRequest(a, b).expect(200)).body).toEqual({ status: 'PENDING' });
      expect(await incoming(b)).toHaveLength(0);
      const outgoing = await request(t.server)
        .get('/v1/friends/requests?direction=outgoing')
        .set(a.auth)
        .expect(200);
      expect(outgoing.body.items).toHaveLength(0);
    });

    it('allows a resend after the cooldown, and lets the rejecter reverse course immediately', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      await sendRequest(a, b).expect(200);
      await request(t.server)
        .post(`/v1/friends/requests/${(await incoming(b))[0]?.id}/reject`)
        .set(b.auth)
        .expect(204);

      // The rejecter (b) now asks a: that works immediately and a sees it.
      await sendRequest(b, a).expect(200);
      expect(await incoming(a)).toHaveLength(1);
      await request(t.server)
        .delete(`/v1/friends/requests/${(await incoming(a))[0]?.id}`)
        .set(b.auth)
        .expect(204);

      // Back to a clean slate, then test the sender's cooldown expiry.
      await sendRequest(a, b).expect(200);
      await request(t.server)
        .post(`/v1/friends/requests/${(await incoming(b))[0]?.id}/reject`)
        .set(b.auth)
        .expect(204);
      await t.prisma.friendRequest.updateMany({
        data: { respondedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
      });
      await sendRequest(a, b).expect(200);
      expect(await incoming(b)).toHaveLength(1);
    });

    it('lets the sender cancel a pending request', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      await sendRequest(a, b).expect(200);
      const id = (await incoming(b))[0]?.id;
      await request(t.server).delete(`/v1/friends/requests/${id}`).set(a.auth).expect(204);
      expect(await incoming(b)).toHaveLength(0);
      await request(t.server).post(`/v1/friends/requests/${id}/accept`).set(b.auth).expect(404);
    });

    it('does not let a rejected request be cancelled to bypass the cooldown', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      await sendRequest(a, b).expect(200);
      const id = (await incoming(b))[0]?.id;
      await request(t.server).post(`/v1/friends/requests/${id}/reject`).set(b.auth).expect(204);
      await request(t.server).delete(`/v1/friends/requests/${id}`).set(a.auth).expect(204);
      expect(await t.prisma.friendRequest.count({ where: { status: 'REJECTED' } })).toBe(1);
    });

    it('removing a friend ends the friendship for both sides and is idempotent', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      await sendRequest(a, b).expect(200);
      await request(t.server)
        .post(`/v1/friends/requests/${(await incoming(b))[0]?.id}/accept`)
        .set(b.auth)
        .expect(204);
      await request(t.server).delete(`/v1/friends/${b.id}`).set(a.auth).expect(204);
      await request(t.server).delete(`/v1/friends/${b.id}`).set(a.auth).expect(204);
      expect(await friendIds(a)).toEqual([]);
      expect(await friendIds(b)).toEqual([]);
    });
  });

  describe('object-level authorization', () => {
    it("treats other people's requests as not found for accept, reject and cancel", async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      const mallory = await registerWithProfile(t);
      await sendRequest(a, b).expect(200);
      const id = (await incoming(b))[0]?.id;
      const attempts: [string, () => request.Test][] = [
        [
          'stranger accepts',
          () => request(t.server).post(`/v1/friends/requests/${id}/accept`).set(mallory.auth),
        ],
        [
          'stranger rejects',
          () => request(t.server).post(`/v1/friends/requests/${id}/reject`).set(mallory.auth),
        ],
        [
          'stranger cancels',
          () => request(t.server).delete(`/v1/friends/requests/${id}`).set(mallory.auth),
        ],
        [
          'sender accepts own request',
          () => request(t.server).post(`/v1/friends/requests/${id}/accept`).set(a.auth),
        ],
        [
          'receiver cancels',
          () => request(t.server).delete(`/v1/friends/requests/${id}`).set(b.auth),
        ],
      ];
      for (const [label, attempt] of attempts) {
        const response = await attempt();
        expect(response.status, label).toBe(404);
      }
      expect(await t.prisma.friendship.count()).toBe(0);
      expect(await t.prisma.friendRequest.count({ where: { status: 'PENDING' } })).toBe(1);
    });
  });

  describe('concurrency', () => {
    it('A->B and B->A at the same instant produce exactly one friendship, never an error or duplicate', async () => {
      for (let round = 0; round < 8; round += 1) {
        const a = await registerWithProfile(t);
        const b = await registerWithProfile(t);
        const [r1, r2] = await Promise.all([sendRequest(a, b), sendRequest(b, a)]);
        expect([r1.status, r2.status]).toEqual([200, 200]);
        expect(await t.prisma.friendship.count()).toBe(1);
        expect(await t.prisma.friendRequest.count()).toBe(0);
        expect(await friendIds(a)).toEqual([b.id]);
        await resetDatabase(t.prisma);
      }
    });

    it('many duplicate sends and a simultaneous accept leave one friendship and no request rows', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      await sendRequest(a, b).expect(200);
      const id = (await incoming(b))[0]?.id;
      const results = await Promise.all([
        sendRequest(a, b),
        sendRequest(a, b),
        request(t.server).post(`/v1/friends/requests/${id}/accept`).set(b.auth),
        request(t.server).post(`/v1/friends/requests/${id}/accept`).set(b.auth),
        sendRequest(b, a),
      ]);
      for (const r of results) expect([200, 204, 404]).toContain(r.status);
      expect(await t.prisma.friendship.count()).toBe(1);
      expect(await t.prisma.friendRequest.count({ where: { status: 'PENDING' } })).toBe(0);
    });

    it('a block racing an accept never leaves a friendship and a block together', async () => {
      for (let round = 0; round < 8; round += 1) {
        const a = await registerWithProfile(t);
        const b = await registerWithProfile(t);
        await sendRequest(a, b).expect(200);
        const id = (await incoming(b))[0]?.id;
        const results = await Promise.all([
          request(t.server).post(`/v1/friends/requests/${id}/accept`).set(b.auth),
          request(t.server).post('/v1/blocks').set(a.auth).send({ userId: b.id }),
        ]);
        for (const r of results) expect([204, 404]).toContain(r.status);
        const blocks = await t.prisma.blockedUser.count();
        const friendships = await t.prisma.friendship.count();
        expect(blocks).toBe(1);
        expect(friendships).toBe(0);
        await resetDatabase(t.prisma);
      }
    });
  });

  describe('blocking', () => {
    it('removes an existing friendship and any pending request, and hides both users from each other', async () => {
      const a = await registerWithProfile(t, 'Blocker1');
      const b = await registerWithProfile(t, 'Blocked1');
      await sendRequest(a, b).expect(200);
      await request(t.server)
        .post(`/v1/friends/requests/${(await incoming(b))[0]?.id}/accept`)
        .set(b.auth)
        .expect(204);

      await request(t.server).post('/v1/blocks').set(a.auth).send({ userId: b.id }).expect(204);
      await request(t.server).post('/v1/blocks').set(a.auth).send({ userId: b.id }).expect(204); // idempotent

      expect(await friendIds(a)).toEqual([]);
      for (const [viewer, target] of [
        [a, b],
        [b, a],
      ] as const) {
        await request(t.server).get(`/v1/users/${target.id}/profile`).set(viewer.auth).expect(404);
        const search = await request(t.server)
          .get(`/v1/users/search?q=${target.username.slice(0, 5)}`)
          .set(viewer.auth)
          .expect(200);
        expect(search.body.map((u: { userId: string }) => u.userId)).not.toContain(target.id);
        await sendRequest(viewer, target).expect(404);
      }
      const blocked = await request(t.server).get('/v1/blocks').set(a.auth).expect(200);
      expect(blocked.body.items.map((u: { userId: string }) => u.userId)).toEqual([b.id]);
    });

    it('unblocking restores visibility but not the old friendship', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      await request(t.server).post('/v1/blocks').set(a.auth).send({ userId: b.id }).expect(204);
      await request(t.server).delete(`/v1/blocks/${b.id}`).set(a.auth).expect(204);
      await request(t.server).delete(`/v1/blocks/${b.id}`).set(a.auth).expect(204); // idempotent
      await request(t.server).get(`/v1/users/${b.id}/profile`).set(a.auth).expect(200);
      expect(await friendIds(a)).toEqual([]);
    });

    it('cannot block yourself or a user that does not exist', async () => {
      const a = await registerWithProfile(t);
      await request(t.server).post('/v1/blocks').set(a.auth).send({ userId: a.id }).expect(400);
      await request(t.server)
        .post('/v1/blocks')
        .set(a.auth)
        .send({ userId: '0198a000-0000-7000-8000-00000000dead' })
        .expect(404);
    });

    it('a block set by the other party also stops a pending accept', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      await sendRequest(a, b).expect(200);
      const id = (await incoming(b))[0]?.id;
      await request(t.server).post('/v1/blocks').set(b.auth).send({ userId: a.id }).expect(204);
      await request(t.server).post(`/v1/friends/requests/${id}/accept`).set(b.auth).expect(404);
      expect(await t.prisma.friendship.count()).toBe(0);
    });
  });

  describe('search', () => {
    it('matches by case-insensitive prefix, excludes self, and treats _ literally', async () => {
      const me = await registerWithProfile(t, 'Searcher');
      await registerWithProfile(t, 'Ada_One');
      await registerWithProfile(t, 'adaTwo');
      await registerWithProfile(t, 'AdXOther');
      const result = await request(t.server).get('/v1/users/search?q=ADA').set(me.auth).expect(200);
      expect(result.body.map((u: { username: string }) => u.username).sort()).toEqual([
        'Ada_One',
        'adaTwo',
      ]);
      const underscore = await request(t.server)
        .get('/v1/users/search?q=ad_')
        .set(me.auth)
        .expect(200);
      expect(underscore.body).toEqual([]); // "_" must not act as a wildcard matching "adX..."
      const self = await request(t.server)
        .get('/v1/users/search?q=Searcher')
        .set(me.auth)
        .expect(200);
      expect(self.body).toEqual([]);
    });

    it('reports the relationship and never leaks bio, email or dates', async () => {
      const me = await registerWithProfile(t, 'Meeee');
      const friend = await registerWithProfile(t, 'Zed_friend', { bio: 'secret bio' });
      const stranger = await registerWithProfile(t, 'Zed_stranger');
      const asked = await registerWithProfile(t, 'Zed_asked');
      await sendRequest(me, friend).expect(200);
      await request(t.server)
        .post(`/v1/friends/requests/${(await incoming(friend))[0]?.id}/accept`)
        .set(friend.auth)
        .expect(204);
      await sendRequest(asked, me).expect(200);

      const result = await request(t.server)
        .get('/v1/users/search?q=zed_')
        .set(me.auth)
        .expect(200);
      const byName = Object.fromEntries(
        result.body.map((u: { username: string; relationship: string }) => [
          u.username,
          u.relationship,
        ]),
      );
      expect(byName).toEqual({
        Zed_friend: 'FRIEND',
        Zed_stranger: 'NONE',
        Zed_asked: 'REQUEST_RECEIVED',
      });
      expect(stranger.id).toBeDefined();
      expect(JSON.stringify(result.body)).not.toMatch(/secret bio|email|dateOfBirth|@example/i);
    });

    it('hides suspended and banned users', async () => {
      const me = await registerWithProfile(t, 'Viewer1');
      const gone = await registerWithProfile(t, 'Hidden_user');
      await t.prisma.user.update({ where: { id: gone.id }, data: { status: 'BANNED' } });
      const result = await request(t.server)
        .get('/v1/users/search?q=hidden')
        .set(me.auth)
        .expect(200);
      expect(result.body).toEqual([]);
      await request(t.server).get(`/v1/users/${gone.id}/profile`).set(me.auth).expect(404);
      await sendRequest(me, gone).expect(404);
    });
  });

  describe('profile visibility', () => {
    it('shows full profiles to friends and EVERYONE-visible profiles, and a restricted card otherwise', async () => {
      const viewer = await registerWithProfile(t, 'Viewer2');
      const owner = await registerWithProfile(t, 'Owner2', { bio: 'my private bio' });

      const restricted = await request(t.server)
        .get(`/v1/users/${owner.id}/profile`)
        .set(viewer.auth)
        .expect(200);
      expect(restricted.body).toMatchObject({
        username: 'Owner2',
        bio: null,
        restricted: true,
        relationship: 'NONE',
      });

      await request(t.server)
        .patch('/v1/me/settings')
        .set(owner.auth)
        .send({ profileVisibility: 'EVERYONE' })
        .expect(200);
      const open = await request(t.server)
        .get(`/v1/users/${owner.id}/profile`)
        .set(viewer.auth)
        .expect(200);
      expect(open.body).toMatchObject({ bio: 'my private bio', restricted: false });

      await request(t.server)
        .patch('/v1/me/settings')
        .set(owner.auth)
        .send({ profileVisibility: 'FRIENDS' })
        .expect(200);
      await sendRequest(viewer, owner).expect(200);
      await request(t.server)
        .post(`/v1/friends/requests/${(await incoming(owner))[0]?.id}/accept`)
        .set(owner.auth)
        .expect(204);
      const friend = await request(t.server)
        .get(`/v1/users/${owner.id}/profile`)
        .set(viewer.auth)
        .expect(200);
      expect(friend.body).toMatchObject({
        bio: 'my private bio',
        restricted: false,
        relationship: 'FRIEND',
      });
    });

    it('always lets users see their own profile', async () => {
      const me = await registerWithProfile(t, 'Myself', { bio: 'mine' });
      const own = await request(t.server)
        .get(`/v1/users/${me.id}/profile`)
        .set(me.auth)
        .expect(200);
      expect(own.body).toMatchObject({ bio: 'mine', restricted: false });
    });
  });

  describe('pagination', () => {
    it('pages the friend list with a cursor and no duplicates', async () => {
      const me = await registerWithProfile(t, 'Popular');
      const others: SocialUser[] = [];
      for (let i = 0; i < 5; i += 1) others.push(await registerWithProfile(t));
      for (const other of others) {
        await sendRequest(other, me).expect(200);
      }
      for (const row of await incoming(me)) {
        await request(t.server)
          .post(`/v1/friends/requests/${row.id}/accept`)
          .set(me.auth)
          .expect(204);
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 10; guard += 1) {
        const page: request.Response = await request(t.server)
          .get('/v1/friends')
          .query({ limit: 2, ...(cursor ? { cursor } : {}) })
          .set(me.auth)
          .expect(200);
        seen.push(...page.body.items.map((u: { userId: string }) => u.userId));
        cursor = page.body.nextCursor;
        if (!cursor) break;
      }
      expect(seen.sort()).toEqual(others.map((o) => o.id).sort());
    });
  });
});
