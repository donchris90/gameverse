import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registerUser } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

describe('profiles, usernames and settings', () => {
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

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const put = (token: string, body: Record<string, unknown>) =>
    request(t.server).put('/v1/me/profile').set(auth(token)).send(body);

  describe('authentication', () => {
    it.each([
      ['get', '/v1/me/profile'],
      ['put', '/v1/me/profile'],
      ['get', '/v1/me/settings'],
      ['patch', '/v1/me/settings'],
      ['get', '/v1/usernames/check?username=abc'],
    ] as const)('%s %s requires a bearer token', async (method, path) => {
      const response = await request(t.server)[method](path).send({});
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('profile', () => {
    it('is 404 until the user completes onboarding', async () => {
      const user = await registerUser(t);
      await request(t.server).get('/v1/me/profile').set(auth(user.session.accessToken)).expect(404);
    });

    it('creates then returns a profile and exposes nothing private', async () => {
      const user = await registerUser(t);
      const saved = await put(user.session.accessToken, {
        username: 'Alice_01',
        avatarId: 'avatar-03',
        bio: '  Ludo fan  ',
      }).expect(200);
      expect(saved.body).toEqual({
        userId: user.session.user.id,
        username: 'Alice_01',
        avatarId: 'avatar-03',
        bio: 'Ludo fan',
      });
      const fetched = await request(t.server)
        .get('/v1/me/profile')
        .set(auth(user.session.accessToken))
        .expect(200);
      expect(fetched.body).toEqual(saved.body);
      expect(JSON.stringify(fetched.body)).not.toMatch(/email|dateOfBirth|passwordHash/i);
    });

    it('stores an empty bio as null and omits bio as null', async () => {
      const user = await registerUser(t);
      const first = await put(user.session.accessToken, {
        username: 'NoBio',
        avatarId: 'avatar-01',
        bio: '   ',
      }).expect(200);
      expect(first.body.bio).toBeNull();
      const second = await put(user.session.accessToken, {
        username: 'NoBio',
        avatarId: 'avatar-02',
      }).expect(200);
      expect(second.body.bio).toBeNull();
      expect(second.body.avatarId).toBe('avatar-02');
    });

    it.each([
      ['too short', { username: 'ab', avatarId: 'avatar-01' }],
      ['too long', { username: 'a'.repeat(21), avatarId: 'avatar-01' }],
      ['starts with a digit', { username: '1abc', avatarId: 'avatar-01' }],
      ['has a space', { username: 'ab c', avatarId: 'avatar-01' }],
      ['has an emoji', { username: 'abc😀', avatarId: 'avatar-01' }],
      ['unknown avatar', { username: 'abcd', avatarId: 'avatar-99' }],
      ['bio over 160 chars', { username: 'abcd', avatarId: 'avatar-01', bio: 'x'.repeat(161) }],
      ['non-string username', { username: 123, avatarId: 'avatar-01' }],
    ])('rejects invalid input: %s', async (_name, body) => {
      const user = await registerUser(t);
      const response = await put(user.session.accessToken, body).expect(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it.each(['admin', 'Support_2', 'xGameVersex', 'sh1t_head'])(
      'rejects the disallowed username %j with 422',
      async (username) => {
        const user = await registerUser(t);
        const response = await put(user.session.accessToken, {
          username,
          avatarId: 'avatar-01',
        }).expect(422);
        expect(response.body.error.code).toBe('USERNAME_NOT_ALLOWED');
      },
    );

    it('rejects a bio containing a blocked term', async () => {
      const user = await registerUser(t);
      const response = await put(user.session.accessToken, {
        username: 'Politeperson',
        avatarId: 'avatar-01',
        bio: 'you are a f.u.c.k',
      }).expect(422);
      expect(response.body.error.code).toBe('CONTENT_NOT_ALLOWED');
    });
  });

  describe('username uniqueness', () => {
    it('is case-insensitive across accounts', async () => {
      const a = await registerUser(t);
      const b = await registerUser(t);
      await put(a.session.accessToken, { username: 'alice', avatarId: 'avatar-01' }).expect(200);
      const response = await put(b.session.accessToken, {
        username: 'ALICE',
        avatarId: 'avatar-01',
      }).expect(409);
      expect(response.body.error.code).toBe('USERNAME_TAKEN');
    });

    it('lets exactly one of many simultaneous claims win, with no 500s', async () => {
      const users = await Promise.all([1, 2, 3, 4, 5, 6].map(() => registerUser(t)));
      const responses = await Promise.all(
        users.map((user) =>
          put(user.session.accessToken, { username: 'Contested', avatarId: 'avatar-01' }),
        ),
      );
      const statuses = responses.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409, 409, 409, 409, 409]);
      expect(await t.prisma.userProfile.count({ where: { usernameLower: 'contested' } })).toBe(1);
    });

    it('treats a double-submitted first save by the same user as success, not an error', async () => {
      const user = await registerUser(t);
      const responses = await Promise.all(
        [1, 2, 3, 4, 5].map(() =>
          put(user.session.accessToken, { username: 'Doubleclick', avatarId: 'avatar-01' }),
        ),
      );
      expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      expect(await t.prisma.userProfile.count()).toBe(1);
    });
  });

  describe('username change cooldown', () => {
    it('blocks a second rename inside the cooldown, allows case-only edits, then allows after 7 days', async () => {
      const user = await registerUser(t);
      const token = user.session.accessToken;
      await put(token, { username: 'FirstName', avatarId: 'avatar-01' }).expect(200);

      // First rename after creation is allowed (no previous rename on record) and starts the cooldown.
      await put(token, { username: 'SecondName', avatarId: 'avatar-01' }).expect(200);
      const blocked = await put(token, { username: 'ThirdName', avatarId: 'avatar-01' }).expect(
        409,
      );
      expect(blocked.body.error.code).toBe('USERNAME_CHANGE_TOO_SOON');
      expect(blocked.body.error.details.availableAt).toEqual(expect.any(String));

      await put(token, { username: 'secondname', avatarId: 'avatar-01' }).expect(200); // case only

      await t.prisma.userProfile.update({
        where: { userId: user.session.user.id },
        data: { usernameChangedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
      });
      await put(token, { username: 'ThirdName', avatarId: 'avatar-01' }).expect(200);
    });

    it('lets someone take a username that another account has released by renaming', async () => {
      const a = await registerUser(t);
      const b = await registerUser(t);
      await put(a.session.accessToken, { username: 'Shared', avatarId: 'avatar-01' }).expect(200);
      await put(a.session.accessToken, { username: 'Moved', avatarId: 'avatar-01' }).expect(200);
      await put(b.session.accessToken, { username: 'Shared', avatarId: 'avatar-01' }).expect(200);
    });
  });

  describe('username availability check', () => {
    it('reports invalid, not allowed, taken, own and free names', async () => {
      const a = await registerUser(t);
      const b = await registerUser(t);
      await put(a.session.accessToken, { username: 'Holder', avatarId: 'avatar-01' }).expect(200);
      const check = async (token: string, username: string) =>
        (
          await request(t.server)
            .get('/v1/usernames/check')
            .query({ username })
            .set(auth(token))
            .expect(200)
        ).body;

      expect(await check(b.session.accessToken, 'x')).toEqual({
        available: false,
        reason: 'INVALID',
      });
      expect(await check(b.session.accessToken, 'admin')).toEqual({
        available: false,
        reason: 'NOT_ALLOWED',
      });
      expect(await check(b.session.accessToken, 'HOLDER')).toEqual({
        available: false,
        reason: 'TAKEN',
      });
      expect(await check(a.session.accessToken, 'holder')).toEqual({ available: true });
      expect(await check(b.session.accessToken, 'FreeName')).toEqual({ available: true });
    });

    it('requires the username query parameter', async () => {
      const user = await registerUser(t);
      await request(t.server)
        .get('/v1/usernames/check')
        .set(auth(user.session.accessToken))
        .expect(400);
    });
  });

  describe('settings', () => {
    it('defaults to the conservative friends-only values', async () => {
      const user = await registerUser(t);
      const response = await request(t.server)
        .get('/v1/me/settings')
        .set(auth(user.session.accessToken))
        .expect(200);
      expect(response.body).toEqual({
        profileVisibility: 'FRIENDS',
        onlineStatusVisibility: 'FRIENDS',
        dmPolicy: 'FRIENDS',
      });
    });

    it('applies partial updates, persists them, and never touches other users', async () => {
      const a = await registerUser(t);
      const b = await registerUser(t);
      const updated = await request(t.server)
        .patch('/v1/me/settings')
        .set(auth(a.session.accessToken))
        .send({ dmPolicy: 'NOBODY' })
        .expect(200);
      expect(updated.body).toEqual({
        profileVisibility: 'FRIENDS',
        onlineStatusVisibility: 'FRIENDS',
        dmPolicy: 'NOBODY',
      });
      await request(t.server)
        .patch('/v1/me/settings')
        .set(auth(a.session.accessToken))
        .send({ onlineStatusVisibility: 'NOBODY', profileVisibility: 'EVERYONE' })
        .expect(200);
      const again = await request(t.server).get('/v1/me/settings').set(auth(a.session.accessToken));
      expect(again.body).toEqual({
        profileVisibility: 'EVERYONE',
        onlineStatusVisibility: 'NOBODY',
        dmPolicy: 'NOBODY',
      });
      const other = await request(t.server).get('/v1/me/settings').set(auth(b.session.accessToken));
      expect(other.body.dmPolicy).toBe('FRIENDS');
    });

    it.each([
      ['empty body', {}],
      ['unknown value', { dmPolicy: 'EVERYONE_AND_THEIR_DOG' }],
      ['unknown key only', { isAdmin: true }],
    ])('rejects %s', async (_name, body) => {
      const user = await registerUser(t);
      const response = await request(t.server)
        .patch('/v1/me/settings')
        .set(auth(user.session.accessToken))
        .send(body)
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });
});
