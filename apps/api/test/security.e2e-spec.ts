import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { SignJWT } from 'jose';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MatchView } from '@gameverse/shared-types';
import { MatchesService } from '../src/matches/matches.service.js';
import {
  befriend,
  makeStaff,
  openConversation,
  registerUser,
  registerWithProfile,
  type SocialUser,
} from './helpers/factories.js';
import { collectRoutes } from './helpers/routes.js';
import { createTestApp, resetDatabase, TEST_JWT_SECRET, type TestApp } from './helpers/test-app.js';

const NOBODY = '00000000-0000-4000-8000-00000000dead';

interface Probe {
  name: string;
  /** Builds the request for a given resource id. */
  send: (t: TestApp, as: SocialUser, id: string) => request.Test;
}

const post = (path: (id: string) => string, body: object): Probe['send'] => {
  return (t, as, id) => request(t.server).post(path(id)).set(as.auth).send(body);
};

describe('security: object-level access, token abuse, sockets', () => {
  let t: TestApp;
  let port = 0;
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

  const action = () => ({ clientActionId: randomUUID(), expectedVersion: 0 });

  describe('cross-user access fails closed and cannot be told apart from "does not exist"', () => {
    const matchProbes: Probe[] = [
      {
        name: 'GET match',
        send: (t, as, id) => request(t.server).get(`/v1/matches/${id}`).set(as.auth),
      },
      { name: 'ready', send: post((id) => `/v1/matches/${id}/ready`, {}) },
      { name: 'leave', send: post((id) => `/v1/matches/${id}/leave`, {}) },
      { name: 'rematch', send: post((id) => `/v1/matches/${id}/rematch`, {}) },
      {
        name: 'tic-tac-toe move',
        send: (t, as, id) =>
          request(t.server)
            .post(`/v1/matches/${id}/moves`)
            .set(as.auth)
            .send({ cell: 4, ...action() }),
      },
      {
        name: 'ludo roll',
        send: (t, as, id) =>
          request(t.server).post(`/v1/matches/${id}/roll`).set(as.auth).send(action()),
      },
      {
        name: 'ludo token move',
        send: (t, as, id) =>
          request(t.server)
            .post(`/v1/matches/${id}/token-moves`)
            .set(as.auth)
            .send({ token: 0, ...action() }),
      },
      { name: 'voice token', send: post((id) => `/v1/matches/${id}/voice/token`, {}) },
      { name: 'voice joined', send: post((id) => `/v1/matches/${id}/voice/joined`, {}) },
      { name: 'voice left', send: post((id) => `/v1/matches/${id}/voice/left`, {}) },
    ];

    const conversationProbes: Probe[] = [
      {
        name: 'read history',
        send: (t, as, id) => request(t.server).get(`/v1/conversations/${id}/messages`).set(as.auth),
      },
      {
        name: 'send message',
        send: post((id) => `/v1/conversations/${id}/messages`, {
          body: 'hello',
          clientMessageId: randomUUID(),
        }),
      },
      { name: 'mark read', send: post((id) => `/v1/conversations/${id}/read`, {}) },
      {
        name: 'mute',
        send: (t, as, id) =>
          request(t.server)
            .patch(`/v1/conversations/${id}/mute`)
            .set(as.auth)
            .send({ muted: true }),
      },
    ];

    const roomProbes: Probe[] = [
      { name: 'accept', send: post((id) => `/v1/rooms/${id}/accept`, {}) },
      { name: 'start', send: post((id) => `/v1/rooms/${id}/start`, {}) },
      { name: 'leave', send: post((id) => `/v1/rooms/${id}/leave`, {}) },
      { name: 'decline', send: post((id) => `/v1/rooms/${id}/decline`, {}) },
      {
        name: 'close',
        send: (t, as, id) => request(t.server).delete(`/v1/rooms/${id}`).set(as.auth),
      },
    ];

    async function expectIndistinguishable(
      probes: Probe[],
      stranger: SocialUser,
      realId: string,
      secrets: string[],
    ): Promise<void> {
      for (const probe of probes) {
        const real = await probe.send(t, stranger, realId);
        const missing = await probe.send(t, stranger, NOBODY);
        expect(real.status, `${probe.name}: status`).toBeGreaterThanOrEqual(400);
        expect(real.status, `${probe.name}: same status as a missing id`).toBe(missing.status);
        expect(real.body?.error?.code, `${probe.name}: same code`).toBe(missing.body?.error?.code);
        const text = JSON.stringify(real.body);
        for (const secret of secrets) {
          expect(text, `${probe.name}: leaks ${secret}`).not.toContain(secret);
        }
      }
    }

    it('matches: a stranger can do nothing to, or learn anything from, someone else’s match', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      const stranger = await registerWithProfile(t);
      const id = await t.app.get(MatchesService).createMatch({
        gameId: 'tictactoe',
        kind: 'PRIVATE',
        seats: [{ userId: a.id }, { userId: b.id }],
        openingSeat: 0,
      });
      const before = await request(t.server).get(`/v1/matches/${id}`).set(a.auth).expect(200);
      await expectIndistinguishable(matchProbes, stranger, id, [
        a.id,
        b.id,
        a.username,
        b.username,
      ]);
      // And the real players' match is untouched.
      const after = await request(t.server).get(`/v1/matches/${id}`).set(a.auth).expect(200);
      expect(after.body.version).toBe(before.body.version);
      expect(after.body.status).toBe(before.body.status);
    });

    it('matches: a stranger cannot reach a Ludo match either', async () => {
      await t.prisma.game.update({ where: { id: 'ludo' }, data: { enabled: true } });
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      const stranger = await registerWithProfile(t);
      const id = await t.app.get(MatchesService).createMatch({
        gameId: 'ludo',
        kind: 'PRIVATE',
        seats: [{ userId: a.id }, { userId: b.id }],
        openingSeat: 0,
      });
      await expectIndistinguishable(matchProbes, stranger, id, [
        a.id,
        b.id,
        a.username,
        b.username,
      ]);
    });

    it('conversations: a stranger cannot read, write, mark or mute a private chat', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      const stranger = await registerWithProfile(t);
      await befriend(t, a, b);
      const id = await openConversation(t, a, b);
      await request(t.server)
        .post(`/v1/conversations/${id}/messages`)
        .set(a.auth)
        .send({ body: 'top secret plans', clientMessageId: randomUUID() })
        .expect(201);
      await expectIndistinguishable(conversationProbes, stranger, id, [
        a.id,
        b.id,
        a.username,
        b.username,
        'top secret plans',
      ]);
      const history = await request(t.server)
        .get(`/v1/conversations/${id}/messages`)
        .set(b.auth)
        .expect(200);
      expect(history.body.items).toHaveLength(1);
    });

    it('rooms: a stranger cannot accept, start, leave, decline or close someone else’s room', async () => {
      const host = await registerWithProfile(t);
      const stranger = await registerWithProfile(t);
      const created = await request(t.server)
        .post('/v1/rooms')
        .set(host.auth)
        .send({ gameId: 'tictactoe' })
        .expect(201);
      const roomId = (created.body as { id: string }).id;
      await expectIndistinguishable(roomProbes, stranger, roomId, [host.id, host.username]);
      const rooms = await request(t.server).get('/v1/rooms').set(host.auth).expect(200);
      expect(JSON.stringify(rooms.body)).toContain(roomId);
    });
  });

  describe('forged and replayed credentials', () => {
    const key = new TextEncoder().encode(TEST_JWT_SECRET);
    const sign = (sub: string, claims: Record<string, unknown>, exp = '10m') =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(sub)
        .setIssuer('gameverse-api')
        .setAudience('gameverse-app')
        .setIssuedAt()
        .setExpirationTime(exp)
        .sign(key);

    it('a validly signed token that claims role ADMIN does not make a USER an admin', async () => {
      const user = await registerWithProfile(t);
      const forged = await sign(user.id, { role: 'ADMIN' });
      const response = await request(t.server)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${forged}`);
      expect(response.status).toBe(403);
      await request(t.server)
        .patch(`/v1/admin/users/${user.id}/role`)
        .set('Authorization', `Bearer ${forged}`)
        .send({ role: 'ADMIN', reason: 'promote myself' })
        .expect(403);
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe('USER');
    });

    it('a signed token for an account that does not exist is rejected', async () => {
      const ghost = await sign(randomUUID(), { role: 'USER' });
      await request(t.server).get('/v1/me').set('Authorization', `Bearer ${ghost}`).expect(401);
    });

    it('a refresh token is not accepted as an access token, and the reverse', async () => {
      const { session } = await registerUser(t);
      await request(t.server)
        .get('/v1/me')
        .set('Authorization', `Bearer ${session.refreshToken}`)
        .expect(401);
      await request(t.server)
        .post('/v1/auth/refresh')
        .send({ refreshToken: session.accessToken })
        .expect(401);
    });

    it('a moderator cannot do admin-only things', async () => {
      const moderator = await makeStaff(t, 'MODERATOR');
      const victim = await registerWithProfile(t);
      await request(t.server)
        .patch(`/v1/admin/users/${victim.id}/role`)
        .set(moderator.auth)
        .send({ role: 'ADMIN', reason: 'x' })
        .expect(403);
      await request(t.server).get('/v1/admin/audit-logs').set(moderator.auth).expect(403);
    });

    it('every admin route refuses an ordinary player', async () => {
      const player = await registerWithProfile(t);
      const admin = collectRoutes(t).filter((r) => r.path.startsWith('/v1/admin/'));
      expect(admin.length).toBeGreaterThan(5);
      for (const route of admin) {
        const url = route.path.replace(/:\w+/g, randomUUID());
        const response = await request(t.server)
          [route.method.toLowerCase() as 'get'](url)
          .set(player.auth)
          .send({});
        expect(response.status, `${route.method} ${route.path}`).toBe(403);
      }
    });
  });

  describe('mass assignment: privileged fields cannot be set through public endpoints', () => {
    it('register ignores or rejects role and status, and never creates staff', async () => {
      const email = `mass-${randomUUID()}@example.com`;
      const response = await request(t.server).post('/v1/auth/register').send({
        email,
        password: 'correct-horse-battery-staple',
        dateOfBirth: '1990-01-01',
        acceptedTerms: true,
        role: 'ADMIN',
        status: 'ACTIVE',
        emailVerified: true,
      });
      if (response.status === 201) {
        expect(response.body.user.role).toBe('USER');
        expect(response.body.user.emailVerified).toBe(false);
      } else {
        expect(response.status).toBe(400);
      }
      const row = await t.prisma.user.findUnique({ where: { email } });
      if (row) expect(row.role).toBe('USER');
    });

    it('profile and settings updates cannot touch role, status, rating or xp', async () => {
      const user = await registerWithProfile(t);
      for (const [method, path] of [
        ['put', '/v1/me/profile'],
        ['patch', '/v1/me/settings'],
      ] as const) {
        await request(t.server)[method](path).set(user.auth).send({
          username: user.username,
          avatarId: 'avatar-01',
          role: 'ADMIN',
          status: 'BANNED',
          xp: 999999,
          rating: 3000,
        });
      }
      const row = await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.role).toBe('USER');
      expect(row.status).toBe('ACTIVE');
      const me = await request(t.server).get('/v1/me/progress').set(user.auth).expect(200);
      expect(JSON.stringify(me.body)).not.toContain('999999');
    });
  });

  describe('sockets: delivery only, scoped to the signed-in account', () => {
    function connect(token: string | null) {
      return new Promise<{ ws: WebSocket; events: Record<string, unknown>[] }>(
        (resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`);
          sockets.push(ws);
          const events: Record<string, unknown>[] = [];
          ws.on('message', (data) => {
            const event = JSON.parse(String(data)) as Record<string, unknown>;
            events.push(event);
            if (event['type'] === 'ready') resolve({ ws, events });
          });
          ws.on('open', () => {
            if (token) ws.send(JSON.stringify({ type: 'auth', token }));
          });
          ws.on('error', reject);
          ws.on('close', () => resolve({ ws, events }));
        },
      );
    }

    it('a stranger’s socket receives nothing from a match it is not in', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      const stranger = await registerWithProfile(t);
      const id = await t.app.get(MatchesService).createMatch({
        gameId: 'tictactoe',
        kind: 'PRIVATE',
        seats: [{ userId: a.id }, { userId: b.id }],
        openingSeat: 0,
      });
      const watching = await connect(stranger.token);
      const playing = await connect(a.token);
      const before = watching.events.length;
      for (const user of [a, b]) {
        await request(t.server).post(`/v1/matches/${id}/ready`).set(user.auth).send({}).expect(200);
      }
      const current = await request(t.server).get(`/v1/matches/${id}`).set(a.auth).expect(200);
      const view = current.body as MatchView;
      const mover = view.series?.seatToMove === view.mySeat ? a : b;
      await request(t.server)
        .post(`/v1/matches/${id}/moves`)
        .set(mover.auth)
        .send({
          cell: 0,
          clientActionId: randomUUID(),
          expectedVersion: view.version,
        })
        .expect(200);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(playing.events.some((e) => JSON.stringify(e).includes(id))).toBe(true);
      expect(watching.events.slice(before)).toEqual([]);
      expect(JSON.stringify(watching.events)).not.toContain(id);
    });

    it('a socket cannot subscribe to rooms or act: only ping is understood', async () => {
      const user = await registerWithProfile(t);
      const { ws, events } = await connect(user.token);
      ws.send(JSON.stringify({ type: 'subscribe', room: `match:${NOBODY}` }));
      ws.send(JSON.stringify({ type: 'move', matchId: NOBODY, cell: 0 }));
      await new Promise((resolve) => setTimeout(resolve, 200));
      const replies = events.filter((e) => e['type'] !== 'ready');
      expect(replies.length).toBe(2);
      for (const reply of replies) expect(reply).toEqual({ type: 'error', code: 'UNSUPPORTED' });
    });

    it('sending anything before authenticating closes the socket', async () => {
      const closed = await new Promise<number>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`);
        sockets.push(ws);
        ws.on('open', () => ws.send(JSON.stringify({ type: 'ping' })));
        ws.on('close', (code) => resolve(code));
      });
      expect(closed).toBe(4401);
    });

    it('a token in the URL is ignored; the socket still has to authenticate in a frame', async () => {
      const user = await registerWithProfile(t);
      const closed = await new Promise<number>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/ws?token=${user.token}`);
        sockets.push(ws);
        ws.on('open', () => ws.send(JSON.stringify({ type: 'ping' })));
        ws.on('close', (code) => resolve(code));
      });
      expect(closed).toBe(4401);
    });
  });
});
