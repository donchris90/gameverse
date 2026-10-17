import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  befriend,
  login,
  makeStaff,
  newClientMessageId,
  openConversation,
  registerWithProfile,
  type SocialUser,
} from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

describe('reports, moderation and audit', () => {
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

  const report = (from: SocialUser, body: Record<string, unknown>) =>
    request(t.server).post('/v1/reports').set(from.auth).send(body);
  const sendMessage = (from: SocialUser, conversationId: string, body: string) =>
    request(t.server)
      .post(`/v1/conversations/${conversationId}/messages`)
      .set(from.auth)
      .send({ body, clientMessageId: newClientMessageId() });
  const act = (
    staff: SocialUser,
    userId: string,
    action: 'ban' | 'suspend' | 'reinstate',
    body: Record<string, unknown> = { reason: 'because rules' },
  ) => request(t.server).post(`/v1/admin/users/${userId}/${action}`).set(staff.auth).send(body);
  const auditActions = async () =>
    (await t.prisma.auditLog.findMany({ orderBy: { id: 'asc' } })).map((row) => row.action);

  describe('filing reports', () => {
    it('requires authentication and validates input', async () => {
      await request(t.server).post('/v1/reports').send({}).expect(401);
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      for (const body of [
        {},
        { userId: b.id },
        { userId: b.id, reason: 'MEAN' },
        { userId: 'x', reason: 'SPAM' },
        { userId: b.id, reason: 'SPAM', details: 'x'.repeat(501) },
      ]) {
        await report(a, body).expect(400);
      }
    });

    it('files a report once, is idempotent, and survives simultaneous duplicates', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      const first = await report(a, {
        userId: b.id,
        reason: 'HARASSMENT',
        details: '  rude  ',
      }).expect(201);
      const second = await report(a, { userId: b.id, reason: 'HARASSMENT' }).expect(200);
      expect(second.body.id).toBe(first.body.id);

      const c = await registerWithProfile(t);
      const results = await Promise.all(
        [1, 2, 3, 4, 5].map(() => report(c, { userId: b.id, reason: 'SPAM' })),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
      expect(await t.prisma.moderationReport.count()).toBe(2);
      const stored = await t.prisma.moderationReport.findUniqueOrThrow({
        where: { id: first.body.id },
      });
      expect(stored.details).toBe('rude');
    });

    it('cannot report yourself or a user that does not exist, but can report someone who blocked you', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      await report(a, { userId: a.id, reason: 'SPAM' }).expect(400);
      await report(a, { userId: '0198a000-0000-7000-8000-00000000dead', reason: 'SPAM' }).expect(
        404,
      );
      await request(t.server).post('/v1/blocks').set(b.auth).send({ userId: a.id }).expect(204);
      await report(a, { userId: b.id, reason: 'HARASSMENT' }).expect(201);
    });

    it('snapshots a reported message with context, and only for people in that conversation', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      const mallory = await registerWithProfile(t);
      await befriend(t, a, b);
      const conversationId = await openConversation(t, a, b);
      for (let i = 1; i <= 7; i += 1)
        await sendMessage(i % 2 === 0 ? a : b, conversationId, `line ${String(i)}`).expect(201);
      const offending = await sendMessage(b, conversationId, 'the offending line').expect(201);

      const filed = await report(a, {
        userId: b.id,
        reason: 'HARASSMENT',
        messageId: offending.body.id,
      }).expect(201);
      const stored = await t.prisma.moderationReport.findUniqueOrThrow({
        where: { id: filed.body.id },
      });
      expect(stored.messageSnapshot).toBe('the offending line');
      const context = stored.contextSnapshot as { body: string }[];
      expect(context.map((m) => m.body)).toEqual([
        'line 3',
        'line 4',
        'line 5',
        'line 6',
        'line 7',
      ]);

      // Same message again -> same report; a different user cannot see or report the message.
      expect(
        (await report(a, { userId: b.id, reason: 'HARASSMENT', messageId: offending.body.id })).body
          .id,
      ).toBe(filed.body.id);
      await report(mallory, {
        userId: b.id,
        reason: 'HARASSMENT',
        messageId: offending.body.id,
      }).expect(404);
      // Reporting the wrong sender for a message is refused too.
      await report(b, { userId: a.id, reason: 'HARASSMENT', messageId: offending.body.id }).expect(
        404,
      );
    });

    it('caps reports per reporter per day', async () => {
      const a = await registerWithProfile(t);
      const targets: SocialUser[] = [];
      for (let i = 0; i < 20; i += 1) targets.push(await registerWithProfile(t));
      await t.prisma.moderationReport.createMany({
        data: targets.map((target) => ({
          reporterId: a.id,
          reportedUserId: target.id,
          reason: 'SPAM' as const,
        })),
      });
      const extra = await registerWithProfile(t);
      const response = await report(a, { userId: extra.id, reason: 'SPAM' }).expect(429);
      expect(response.body.error.code).toBe('TOO_MANY_REPORTS');
    });
  });

  describe('staff access control', () => {
    const endpoints: [string, string][] = [
      ['get', '/v1/admin/users?q=ab'],
      ['get', '/v1/admin/users/0198a000-0000-7000-8000-000000000001'],
      ['post', '/v1/admin/users/0198a000-0000-7000-8000-000000000001/ban'],
      ['post', '/v1/admin/users/0198a000-0000-7000-8000-000000000001/suspend'],
      ['post', '/v1/admin/users/0198a000-0000-7000-8000-000000000001/reinstate'],
      ['patch', '/v1/admin/users/0198a000-0000-7000-8000-000000000001/role'],
      ['get', '/v1/admin/reports'],
      ['get', '/v1/admin/reports/0198a000-0000-7000-8000-000000000001'],
      ['post', '/v1/admin/reports/0198a000-0000-7000-8000-000000000001/dismiss'],
      ['get', '/v1/admin/audit-logs'],
    ];

    it.each(endpoints)('%s %s: anonymous 401, ordinary user 403', async (method, path) => {
      const user = await registerWithProfile(t);
      const call = (r: request.Test) => r.send({});
      const anon = await call(
        (request(t.server) as unknown as Record<string, (p: string) => request.Test>)[method]!(
          path,
        ),
      );
      expect(anon.status).toBe(401);
      const asUser = await call(
        (request(t.server) as unknown as Record<string, (p: string) => request.Test>)[method]!(
          path,
        ).set(user.auth),
      );
      expect(asUser.status).toBe(403);
      expect(asUser.body.error.code).toBe('INSUFFICIENT_ROLE');
    });

    it('moderators cannot read the audit log or change roles; admins can', async () => {
      const moderator = await makeStaff(t, 'MODERATOR');
      const admin = await makeStaff(t, 'ADMIN');
      const user = await registerWithProfile(t);
      await request(t.server).get('/v1/admin/audit-logs').set(moderator.auth).expect(403);
      await request(t.server)
        .patch(`/v1/admin/users/${user.id}/role`)
        .set(moderator.auth)
        .send({ role: 'MODERATOR', reason: 'nope' })
        .expect(403);
      await request(t.server).get('/v1/admin/audit-logs').set(admin.auth).expect(200);
    });

    it('reads the role from the database, so a demotion takes effect on the same token', async () => {
      const moderator = await makeStaff(t, 'MODERATOR');
      await request(t.server).get('/v1/admin/reports').set(moderator.auth).expect(200);
      await t.prisma.user.update({ where: { id: moderator.id }, data: { role: 'USER' } });
      await request(t.server).get('/v1/admin/reports').set(moderator.auth).expect(403);
    });
  });

  describe('ban, suspend, reinstate', () => {
    it('a ban ends access immediately: token, refresh, login, sockets and discoverability', async () => {
      const moderator = await makeStaff(t, 'MODERATOR');
      const target = await registerWithProfile(t, 'Troublemaker');
      const viewer = await registerWithProfile(t);

      const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`);
      sockets.push(ws);
      const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
      const ready = new Promise<void>((resolve) =>
        ws.on('message', (data) => {
          if ((JSON.parse(data.toString()) as { type: string }).type === 'ready') resolve();
        }),
      );
      await new Promise((resolve) => ws.once('open', resolve));
      ws.send(JSON.stringify({ type: 'auth', token: target.token }));
      await ready;
      await request(t.server).get('/v1/me').set(target.auth).expect(200);

      await act(moderator, target.id, 'ban').expect(204);
      // Checked first: later requests (refresh, login) could revoke tokens themselves and mask a gap.
      expect(
        await t.prisma.refreshToken.count({ where: { userId: target.id, revokedAt: null } }),
      ).toBe(0);

      const me = await request(t.server).get('/v1/me').set(target.auth).expect(403);
      expect(me.body.error.code).toBe('ACCOUNT_BANNED');
      await request(t.server)
        .post('/v1/auth/refresh')
        .send({ refreshToken: target.session.refreshToken })
        .expect((r) => {
          expect([401, 403]).toContain(r.status);
        });
      const loginAttempt = await request(t.server)
        .post('/v1/auth/login')
        .send({ email: target.email, password: target.password });
      expect(loginAttempt.status).toBe(403);
      expect(loginAttempt.body.error.code).toBe('ACCOUNT_BANNED');
      expect(await closed).toBe(4403);
      const search = await request(t.server)
        .get('/v1/users/search?q=Trouble')
        .set(viewer.auth)
        .expect(200);
      expect(search.body).toEqual([]);
    });

    it('reinstating restores access; suspend works the same way and cannot be applied to a banned account', async () => {
      const moderator = await makeStaff(t, 'MODERATOR');
      const target = await registerWithProfile(t);
      await act(moderator, target.id, 'suspend').expect(204);
      const suspended = await request(t.server).get('/v1/me').set(target.auth).expect(403);
      expect(suspended.body.error.code).toBe('ACCOUNT_SUSPENDED');

      await act(moderator, target.id, 'ban').expect(204); // suspended -> banned is allowed
      expect((await act(moderator, target.id, 'suspend')).status).toBe(409); // banned -> suspend is not

      await act(moderator, target.id, 'reinstate', { reason: 'appeal accepted' }).expect(204);
      await request(t.server).get('/v1/me').set(target.auth).expect(200);
      const fresh = await login(t, target.email, target.password);
      expect(fresh.accessToken).toEqual(expect.any(String));
    });

    it('is idempotent: repeating an action changes and records nothing more', async () => {
      const moderator = await makeStaff(t, 'MODERATOR');
      const target = await registerWithProfile(t);
      await act(moderator, target.id, 'ban').expect(204);
      await act(moderator, target.id, 'ban').expect(204);
      await act(moderator, target.id, 'reinstate').expect(204);
      await act(moderator, target.id, 'reinstate').expect(204);
      expect(await t.prisma.moderationAction.count()).toBe(2);
      expect(await auditActions()).toEqual(['USER_BANNED', 'USER_REINSTATED']);
    });

    it('requires a reason and refuses unknown or deleted accounts', async () => {
      const moderator = await makeStaff(t, 'MODERATOR');
      const target = await registerWithProfile(t);
      await act(moderator, target.id, 'ban', {}).expect(400);
      await act(moderator, target.id, 'ban', { reason: 'x' }).expect(400);
      await act(moderator, '0198a000-0000-7000-8000-00000000dead', 'ban').expect(404);
      await t.prisma.user.update({ where: { id: target.id }, data: { status: 'DELETED' } });
      const response = await act(moderator, target.id, 'ban').expect(409);
      expect(response.body.error.code).toBe('INVALID_STATE');
    });

    it('enforces the role hierarchy and forbids acting on yourself', async () => {
      const moderator = await makeStaff(t, 'MODERATOR');
      const otherModerator = await makeStaff(t, 'MODERATOR');
      const admin = await makeStaff(t, 'ADMIN');
      const otherAdmin = await makeStaff(t, 'ADMIN');
      const user = await registerWithProfile(t);

      for (const [actor, target] of [
        [moderator, otherModerator],
        [moderator, admin],
        [moderator, moderator],
        [admin, otherAdmin],
        [admin, admin],
      ] as const) {
        const response = await act(actor, target.id, 'ban').expect(403);
        expect(response.body.error.code).toBe('INSUFFICIENT_ROLE');
      }
      await act(admin, otherModerator.id, 'suspend').expect(204);
      await act(moderator, user.id, 'ban').expect(204);
      expect(
        await t.prisma.user.findUniqueOrThrow({ where: { id: admin.id } }).then((u) => u.status),
      ).toBe('ACTIVE');
    });

    it('two moderators acting at once leave a consistent state with no server errors', async () => {
      const m1 = await makeStaff(t, 'MODERATOR');
      const m2 = await makeStaff(t, 'MODERATOR');
      const target = await registerWithProfile(t);
      const results = await Promise.all([
        act(m1, target.id, 'ban'),
        act(m2, target.id, 'suspend'),
        act(m1, target.id, 'ban'),
      ]);
      for (const r of results) expect([204, 409]).toContain(r.status);
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: target.id } })).status).toBe(
        'BANNED',
      );
    });
  });

  describe('report queue', () => {
    it('lists open reports oldest first with evidence and cards, and pages', async () => {
      const moderator = await makeStaff(t, 'MODERATOR');
      const reporter = await registerWithProfile(t, 'Reporter1');
      const targets: SocialUser[] = [];
      for (let i = 0; i < 3; i += 1)
        targets.push(await registerWithProfile(t, `Target${String(i)}`));
      for (const target of targets)
        await report(reporter, { userId: target.id, reason: 'SPAM' }).expect(201);

      const first = await request(t.server)
        .get('/v1/admin/reports?limit=2')
        .set(moderator.auth)
        .expect(200);
      expect(
        first.body.items.map((r: { reported: { username: string } }) => r.reported.username),
      ).toEqual(['Target0', 'Target1']);
      expect(first.body.items[0].reporter.username).toBe('Reporter1');
      const second = await request(t.server)
        .get(`/v1/admin/reports?limit=2&cursor=${first.body.nextCursor}`)
        .set(moderator.auth)
        .expect(200);
      expect(
        second.body.items.map((r: { reported: { username: string } }) => r.reported.username),
      ).toEqual(['Target2']);
      expect(second.body.nextCursor).toBeNull();
      await request(t.server).get('/v1/admin/reports?status=BOGUS').set(moderator.auth).expect(400);
    });

    it('a ban linked to a report resolves it; mismatched or closed reports are refused', async () => {
      const moderator = await makeStaff(t, 'MODERATOR');
      const reporter = await registerWithProfile(t);
      const target = await registerWithProfile(t);
      const other = await registerWithProfile(t);
      const filed = await report(reporter, { userId: target.id, reason: 'HARASSMENT' }).expect(201);
      const unrelated = await report(reporter, { userId: other.id, reason: 'SPAM' }).expect(201);

      await act(moderator, target.id, 'ban', {
        reason: 'confirmed harassment',
        reportId: unrelated.body.id,
      }).expect(404);
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: target.id } })).status).toBe(
        'ACTIVE',
      );

      await act(moderator, target.id, 'ban', {
        reason: 'confirmed harassment',
        reportId: filed.body.id,
      }).expect(204);
      const resolved = await t.prisma.moderationReport.findUniqueOrThrow({
        where: { id: filed.body.id },
      });
      expect(resolved).toMatchObject({
        status: 'RESOLVED',
        resolvedById: moderator.id,
        dedupeKey: null,
      });
      expect(resolved.resolutionNote).toContain('BAN');

      await act(moderator, target.id, 'reinstate', {
        reason: 'ok',
        reportId: filed.body.id,
      }).expect(400);
      await act(moderator, target.id, 'ban', { reason: 'again', reportId: filed.body.id }).expect(
        409,
      );
    });

    it('dismissing closes the report, frees the reporter to report again, and cannot happen twice', async () => {
      const m1 = await makeStaff(t, 'MODERATOR');
      const m2 = await makeStaff(t, 'MODERATOR');
      const reporter = await registerWithProfile(t);
      const target = await registerWithProfile(t);
      const filed = await report(reporter, { userId: target.id, reason: 'SPAM' }).expect(201);

      const results = await Promise.all([
        request(t.server)
          .post(`/v1/admin/reports/${filed.body.id}/dismiss`)
          .set(m1.auth)
          .send({ note: 'not a violation' }),
        request(t.server)
          .post(`/v1/admin/reports/${filed.body.id}/dismiss`)
          .set(m2.auth)
          .send({ note: 'not a violation' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
      expect(await auditActions()).toEqual(['REPORT_DISMISSED']);

      const again = await report(reporter, { userId: target.id, reason: 'SPAM' }).expect(201);
      expect(again.body.id).not.toBe(filed.body.id);
      const closed = await request(t.server)
        .get('/v1/admin/reports?status=DISMISSED')
        .set(m1.auth)
        .expect(200);
      expect(closed.body.items).toHaveLength(1);
    });
  });

  describe('lookup, roles and audit log', () => {
    it('finds users by email, id and username prefix, shows no secrets, and audits access without the query', async () => {
      const moderator = await makeStaff(t, 'MODERATOR');
      const target = await registerWithProfile(t, 'Findable_Person');
      const byEmail = await request(t.server)
        .get('/v1/admin/users')
        .query({ q: target.email.toUpperCase() })
        .set(moderator.auth)
        .expect(200);
      const byId = await request(t.server)
        .get('/v1/admin/users')
        .query({ q: target.id })
        .set(moderator.auth)
        .expect(200);
      const byName = await request(t.server)
        .get('/v1/admin/users')
        .query({ q: 'findable' })
        .set(moderator.auth)
        .expect(200);
      for (const result of [byEmail, byId, byName]) {
        expect(result.body.map((u: { id: string }) => u.id)).toEqual([target.id]);
      }
      const detail = await request(t.server)
        .get(`/v1/admin/users/${target.id}`)
        .set(moderator.auth)
        .expect(200);
      expect(detail.body).toMatchObject({
        id: target.id,
        username: 'Findable_Person',
        status: 'ACTIVE',
        role: 'USER',
        reportsAgainst: 0,
      });
      expect(JSON.stringify(detail.body)).not.toMatch(/passwordHash|dateOfBirth|\$argon2/);

      const logs = await t.prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
      expect(logs.map((l) => l.action)).toEqual([
        'USER_SEARCHED',
        'USER_SEARCHED',
        'USER_SEARCHED',
        'USER_VIEWED',
      ]);
      expect(JSON.stringify(logs)).not.toContain(target.email);
      await request(t.server)
        .get(`/v1/admin/users/0198a000-0000-7000-8000-00000000dead`)
        .set(moderator.auth)
        .expect(404);
    });

    it('records who did what to whom, newest first, filterable, admin only', async () => {
      const admin = await makeStaff(t, 'ADMIN');
      const moderator = await makeStaff(t, 'MODERATOR');
      const target = await registerWithProfile(t);
      await act(moderator, target.id, 'suspend', { reason: 'cooling off' }).expect(204);
      await act(moderator, target.id, 'reinstate', { reason: 'done' }).expect(204);

      const all = await request(t.server).get('/v1/admin/audit-logs').set(admin.auth).expect(200);
      expect(all.body.items.map((l: { action: string }) => l.action)).toEqual([
        'USER_REINSTATED',
        'USER_SUSPENDED',
      ]);
      expect(all.body.items[1]).toMatchObject({
        actorId: moderator.id,
        targetType: 'user',
        targetId: target.id,
        metadata: {
          reason: 'cooling off',
          previousStatus: 'ACTIVE',
          newStatus: 'SUSPENDED',
          reportId: null,
        },
      });
      const filtered = await request(t.server)
        .get(`/v1/admin/audit-logs?targetId=${target.id}&limit=1`)
        .set(admin.auth)
        .expect(200);
      expect(filtered.body.items).toHaveLength(1);
      expect(filtered.body.nextCursor).toEqual(expect.any(String));
      const none = await request(t.server)
        .get(`/v1/admin/audit-logs?actorId=${admin.id}`)
        .set(admin.auth)
        .expect(200);
      expect(none.body.items).toEqual([]);
    });

    it('the audit log is append-only at the database level', async () => {
      const moderator = await makeStaff(t, 'MODERATOR');
      const target = await registerWithProfile(t);
      await act(moderator, target.id, 'ban').expect(204);
      await expect(t.prisma.auditLog.updateMany({ data: { action: 'FORGED' } })).rejects.toThrow(
        /append-only/,
      );
      await expect(t.prisma.auditLog.deleteMany()).rejects.toThrow(/append-only/);
      expect(await auditActions()).toEqual(['USER_BANNED']);
    });

    it('an action and its audit entry commit together (a failing action leaves no entry)', async () => {
      const moderator = await makeStaff(t, 'MODERATOR');
      const admin = await makeStaff(t, 'ADMIN');
      await act(moderator, admin.id, 'ban').expect(403);
      await act(moderator, '0198a000-0000-7000-8000-00000000dead', 'ban').expect(404);
      expect(await auditActions()).toEqual([]);
      expect(await t.prisma.moderationAction.count()).toBe(0);
    });

    it('admins can make moderators and demote them; admin accounts cannot be created or edited via the API', async () => {
      const admin = await makeStaff(t, 'ADMIN');
      const otherAdmin = await makeStaff(t, 'ADMIN');
      const user = await registerWithProfile(t);
      const role = (actor: SocialUser, target: string, body: Record<string, unknown>) =>
        request(t.server).patch(`/v1/admin/users/${target}/role`).set(actor.auth).send(body);

      await request(t.server).get('/v1/admin/reports').set(user.auth).expect(403);
      await role(admin, user.id, { role: 'MODERATOR', reason: 'trusted community member' }).expect(
        204,
      );
      await request(t.server).get('/v1/admin/reports').set(user.auth).expect(200);
      await role(admin, user.id, { role: 'USER', reason: 'stepped down' }).expect(204);
      await request(t.server).get('/v1/admin/reports').set(user.auth).expect(403);

      await role(admin, user.id, { role: 'ADMIN', reason: 'promote please' }).expect(403);
      await role(admin, admin.id, { role: 'USER', reason: 'self' }).expect(403);
      await role(admin, otherAdmin.id, { role: 'USER', reason: 'coup' }).expect(403);
      await role(admin, user.id, { role: 'SUPERUSER', reason: 'invalid' }).expect(400);
      expect(await auditActions()).toEqual(['ROLE_CHANGED', 'ROLE_CHANGED']);
    });
  });
});
