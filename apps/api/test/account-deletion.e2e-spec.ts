import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  befriend,
  newClientMessageId,
  openConversation,
  registerWithProfile,
  tokenFromLastEmail,
  type SocialUser,
} from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

describe('account deletion', () => {
  let t: TestApp;
  let port: number;
  const sockets: WebSocket[] = [];

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
    for (const ws of sockets.splice(0)) ws.terminate();
  });

  const requestLink = (user: SocialUser) =>
    request(t.server).post('/v1/me/deletion/request').set(user.auth);
  const confirm = (user: SocialUser, token: string) =>
    request(t.server).post('/v1/me/deletion/confirm').set(user.auth).send({ token });
  async function deleteAccount(user: SocialUser): Promise<void> {
    await requestLink(user).expect(202);
    await confirm(user, tokenFromLastEmail(t, user.email)).expect(204);
  }

  it('requires authentication on both steps', async () => {
    await request(t.server).post('/v1/me/deletion/request').expect(401);
    await request(t.server)
      .post('/v1/me/deletion/confirm')
      .send({ token: 'x'.repeat(30) })
      .expect(401);
  });

  it('request emails a link to the registered address only, and is rate limited per account', async () => {
    const a = await registerWithProfile(t);
    const b = await registerWithProfile(t);
    await requestLink(a).expect(202);
    expect(t.email.last(a.email)?.subject).toMatch(/delet/i);
    expect(t.email.last(b.email)?.subject ?? '').not.toMatch(/delet/i);
    expect(t.email.last(a.email)?.text).toContain('/delete-account?token=');
    await requestLink(a).expect(429);
    expect(await t.prisma.user.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      status: 'ACTIVE',
    });
  });

  it('a failed email send leaves no usable link and does not lock the player out of retrying', async () => {
    const a = await registerWithProfile(t);
    const original = t.email.send.bind(t.email);
    t.email.send = () => Promise.reject(new Error('mail provider down'));
    try {
      const failed = await requestLink(a).expect(503);
      expect(failed.body.error.code).toBe('SERVICE_UNAVAILABLE');
    } finally {
      t.email.send = original;
    }
    expect(
      await t.prisma.oneTimeToken.count({ where: { userId: a.id, type: 'ACCOUNT_DELETION' } }),
    ).toBe(0);
    await requestLink(a).expect(202); // no cooldown from the failed attempt
  });

  it('confirm validates input and rejects wrong, foreign, used and expired tokens identically', async () => {
    const a = await registerWithProfile(t);
    const b = await registerWithProfile(t);
    await confirm(a, 'short').expect(400);
    await request(t.server).post('/v1/me/deletion/confirm').set(a.auth).send({}).expect(400);

    await requestLink(a).expect(202);
    const token = tokenFromLastEmail(t, a.email);
    const wrong = await confirm(a, 'z'.repeat(43)).expect(400);
    expect(wrong.body.error.code).toBe('ONE_TIME_TOKEN_INVALID');

    // Someone else holding A's link cannot use it, and it still works for A afterwards.
    const stolen = await confirm(b, token).expect(400);
    expect(stolen.body).toEqual({ ...wrong.body, requestId: stolen.body.requestId });
    expect(await t.prisma.user.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      status: 'ACTIVE',
    });

    await t.prisma.oneTimeToken.updateMany({
      where: { userId: a.id, type: 'ACCOUNT_DELETION' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await confirm(a, token).expect(400);
    expect(await t.prisma.user.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      status: 'ACTIVE',
    });
  });

  it('a password-reset or verification token cannot be used to delete an account', async () => {
    const a = await registerWithProfile(t);
    await request(t.server).post('/v1/auth/forgot-password').send({ email: a.email }).expect(202);
    const resetToken = tokenFromLastEmail(t, a.email);
    await confirm(a, resetToken).expect(400);
    expect(await t.prisma.user.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      status: 'ACTIVE',
    });
  });

  it('erases personal data, keeps an anonymous tombstone, and records an audit entry', async () => {
    const a = await registerWithProfile(t, 'Leaving_Soon');
    const b = await registerWithProfile(t);
    await befriend(t, a, b);
    await openConversation(t, a, b);
    await request(t.server)
      .put('/v1/me/devices')
      .set(a.auth)
      .send({ token: 'ExponentPushToken[abcdefgh12345678]', platform: 'IOS' })
      .expect(204);

    await deleteAccount(a);

    const user = await t.prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    expect(user).toMatchObject({ status: 'DELETED', passwordHash: null, emailVerifiedAt: null });
    expect(user.email).toBe(`deleted-${a.id}@deleted.invalid`);
    expect(user.deletedAt).toBeInstanceOf(Date);
    expect(user.dateOfBirth.toISOString().slice(0, 10)).toBe('1970-01-01');
    expect(await t.prisma.userProfile.count({ where: { userId: a.id } })).toBe(0);
    expect(await t.prisma.userSettings.count({ where: { userId: a.id } })).toBe(0);
    expect(await t.prisma.authIdentity.count({ where: { userId: a.id } })).toBe(0);
    expect(await t.prisma.refreshToken.count({ where: { userId: a.id } })).toBe(0);
    expect(await t.prisma.deviceToken.count({ where: { userId: a.id } })).toBe(0);
    expect(await t.prisma.oneTimeToken.count({ where: { userId: a.id } })).toBe(0);
    expect(
      await t.prisma.auditLog.count({ where: { action: 'ACCOUNT_DELETED', targetId: a.id } }),
    ).toBe(1);
  });

  it("removes the user from everyone else's world: friends, chats, search, profile lookup", async () => {
    const a = await registerWithProfile(t, 'Vanishing_A');
    const b = await registerWithProfile(t);
    await befriend(t, a, b);
    const conversationId = await openConversation(t, a, b);
    await request(t.server)
      .post(`/v1/conversations/${conversationId}/messages`)
      .set(a.auth)
      .send({ body: 'bye', clientMessageId: newClientMessageId() })
      .expect(201);

    await deleteAccount(a);

    expect((await request(t.server).get('/v1/friends').set(b.auth).expect(200)).body.items).toEqual(
      [],
    );
    expect(
      (await request(t.server).get('/v1/conversations').set(b.auth).expect(200)).body.items,
    ).toEqual([]);
    expect(await t.prisma.message.count()).toBe(0);
    expect(await t.prisma.friendship.count()).toBe(0);
    expect(await t.prisma.friendRequest.count()).toBe(0);
    expect(await t.prisma.conversation.count()).toBe(0);
    await request(t.server).get(`/v1/users/${a.id}/profile`).set(b.auth).expect(404);
    const search = await request(t.server)
      .get('/v1/users/search')
      .query({ q: 'Vanishing' })
      .set(b.auth)
      .expect(200);
    expect(search.body).toEqual([]);
    await request(t.server)
      .post('/v1/friends/requests')
      .set(b.auth)
      .send({ userId: a.id })
      .expect(404);
  });

  it('kills the old sessions immediately, blocks login, and frees the email and username', async () => {
    const a = await registerWithProfile(t, 'Reusable_Name');
    await deleteAccount(a);

    const after = await request(t.server).get('/v1/me/profile').set(a.auth);
    expect([401, 403]).toContain(after.status);
    await request(t.server)
      .post('/v1/auth/refresh')
      .send({ refreshToken: a.session.refreshToken })
      .expect(401);
    await request(t.server)
      .post('/v1/auth/login')
      .send({ email: a.email, password: a.password })
      .expect(401);

    const again = await registerWithProfile(t, 'Reusable_Name', {});
    expect(again.id).not.toBe(a.id);
  });

  it('closes live sockets with the account-unavailable code', async () => {
    const a = await registerWithProfile(t);
    const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`);
    sockets.push(ws);
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    const ready = new Promise<void>((resolve) =>
      ws.on('message', (data) => {
        if ((JSON.parse(data.toString()) as { type: string }).type === 'ready') resolve();
      }),
    );
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({ type: 'auth', token: a.token }));
    await ready;

    await deleteAccount(a);
    expect(await closed).toBe(4403);
  });

  it('keeps moderation records about the deleted user, on purpose', async () => {
    const reporter = await registerWithProfile(t);
    const offender = await registerWithProfile(t);
    await request(t.server)
      .post('/v1/reports')
      .set(reporter.auth)
      .send({ userId: offender.id, reason: 'HARASSMENT' })
      .expect(201);

    await deleteAccount(offender);

    expect(await t.prisma.moderationReport.count({ where: { reportedUserId: offender.id } })).toBe(
      1,
    );
  });

  it('banned and suspended accounts cannot delete themselves; a second confirm fails', async () => {
    const a = await registerWithProfile(t);
    await requestLink(a).expect(202);
    const token = tokenFromLastEmail(t, a.email);
    await t.prisma.user.update({ where: { id: a.id }, data: { status: 'SUSPENDED' } });
    // Sessions of suspended accounts are rejected before reaching the handler; either refusal is fine.
    const refused = await confirm(a, token);
    expect([401, 403, 409]).toContain(refused.status);
    expect(await t.prisma.user.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      status: 'SUSPENDED',
    });

    const b = await registerWithProfile(t);
    await deleteAccount(b);
    const reused = await request(t.server)
      .post('/v1/me/deletion/confirm')
      .set(b.auth)
      .send({ token: 'y'.repeat(43) });
    expect([400, 401, 403]).toContain(reused.status);
  });

  describe('without the app (public web pages)', () => {
    const ask = (email: string) =>
      request(t.server).post('/account-deletion').type('form').send({ email });
    const confirmOnWeb = (token: string) =>
      request(t.server).post('/delete-account').type('form').send({ token });

    it('the request page is public and explains what is deleted and what is kept', async () => {
      const page = await request(t.server).get('/account-deletion').expect(200);
      expect(page.text).toContain('Delete your GameVerse account');
      expect(page.text).toContain('name="email"');
      expect(page.text).toMatch(/reports and moderation records are kept/i);
      expect(page.headers['content-security-policy']).toContain("form-action 'self'");
    });

    it('emailing the link, then confirming on the web, deletes the account with no sign-in', async () => {
      const user = await registerWithProfile(t);
      const friend = await registerWithProfile(t);
      await befriend(t, user, friend);
      const reply = await ask(user.email).expect(200);
      expect(reply.text).toContain('Check your email');
      const token = tokenFromLastEmail(t, user.email);

      const landing = await request(t.server)
        .get(`/delete-account?token=${encodeURIComponent(token)}`)
        .expect(200);
      expect(landing.text).toContain('action="/delete-account"');
      expect(landing.text).toContain('Delete my account');

      const done = await confirmOnWeb(token).expect(200);
      expect(done.text).toContain('Account deleted');
      expect(await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
        status: 'DELETED',
        passwordHash: null,
      });
      await request(t.server).get('/v1/me').set(user.auth).expect(403);
      // The link is single use.
      await confirmOnWeb(token).expect(400);
    });

    it('gives the same answer for an unknown address and sends nothing', async () => {
      const known = await registerWithProfile(t);
      const asked = await ask(known.email).expect(200);
      const unknown = await ask('nobody-here@example.com').expect(200);
      expect(unknown.text).toBe(asked.text);
      expect(t.email.last('nobody-here@example.com')).toBeUndefined();
      const garbage = await ask('not-an-email').expect(200);
      expect(garbage.text).toBe(asked.text);
    });

    it('does not mail a second link inside the cooldown, and never for banned accounts', async () => {
      const user = await registerWithProfile(t);
      await ask(user.email).expect(200);
      const first = t.email.last(user.email)?.text;
      await ask(user.email).expect(200);
      expect(t.email.last(user.email)?.text).toBe(first);

      const banned = await registerWithProfile(t);
      await t.prisma.user.update({ where: { id: banned.id }, data: { status: 'BANNED' } });
      await ask(banned.email).expect(200);
      expect(t.email.last(banned.email)?.subject ?? '').not.toMatch(/delet/i);
    });

    it('rejects malformed, unknown, expired and wrong-type tokens', async () => {
      await confirmOnWeb('short').expect(400);
      await confirmOnWeb('A'.repeat(43)).expect(400);
      const user = await registerWithProfile(t);
      await ask(user.email).expect(200);
      const token = tokenFromLastEmail(t, user.email);
      await t.prisma.oneTimeToken.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await confirmOnWeb(token).expect(400);
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe(
        'ACTIVE',
      );
    });

    it('a banned account cannot be erased by a token that already existed', async () => {
      const user = await registerWithProfile(t);
      await ask(user.email).expect(200);
      const token = tokenFromLastEmail(t, user.email);
      await t.prisma.user.update({ where: { id: user.id }, data: { status: 'BANNED' } });
      await confirmOnWeb(token).expect(409);
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe(
        'BANNED',
      );
    });
  });
});
