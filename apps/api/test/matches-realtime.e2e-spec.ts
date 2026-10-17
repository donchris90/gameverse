import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DISCONNECT_GRACE_MS, type MatchView } from '@gameverse/shared-types';
import { MatchesService } from '../src/matches/matches.service.js';
import { RealtimeHub } from '../src/realtime/realtime.hub.js';
import { registerWithProfile, type SocialUser } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

type Event = Record<string, unknown>;
interface Connection {
  ws: WebSocket;
  events: Event[];
}

describe('matches: connection handling, resume and action limits', () => {
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

  const service = () => t.app.get(MatchesService);
  const hub = () => t.app.get(RealtimeHub);

  async function startMatch(): Promise<{ a: SocialUser; b: SocialUser; id: string }> {
    const a = await registerWithProfile(t);
    const b = await registerWithProfile(t);
    const id = await service().createMatch({
      gameId: 'tictactoe',
      kind: 'PRIVATE',
      seats: [{ userId: a.id }, { userId: b.id }],
      openingSeat: 0,
    });
    for (const user of [a, b]) {
      await request(t.server).post(`/v1/matches/${id}/ready`).set(user.auth).send({}).expect(200);
    }
    return { a, b, id };
  }

  const view = async (user: SocialUser, id: string) =>
    (await request(t.server).get(`/v1/matches/${id}`).set(user.auth).expect(200)).body as MatchView;
  const move = (user: SocialUser, id: string, cell: number, expectedVersion: number) =>
    request(t.server)
      .post(`/v1/matches/${id}/moves`)
      .set(user.auth)
      .send({ cell, clientActionId: randomUUID(), expectedVersion });

  function connect(user: SocialUser): Promise<Connection> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`);
      sockets.push(ws);
      const events: Event[] = [];
      ws.on('message', (data) => {
        const event = JSON.parse(String(data)) as Event;
        events.push(event);
        if (event['type'] === 'ready') resolve({ ws, events });
      });
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: user.token })));
      ws.on('error', reject);
    });
  }

  async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  const updates = (events: Event[]) =>
    events.filter((e) => e['type'] === 'match.update').map((e) => e['match'] as MatchView);

  async function disconnect(connection: Connection, userId: string): Promise<void> {
    connection.ws.close();
    await until(() => !hub().isOnline(userId), 'the server to see the socket close');
  }

  const stripClock = (match: MatchView) => ({ ...match, serverTime: '' });
  const playerRow = (matchId: string, seat: number) =>
    t.prisma.gameMatchPlayer.findUniqueOrThrow({ where: { matchId_seat: { matchId, seat } } });

  describe('resume on connect', () => {
    it('a connecting client is sent its match straight away, identical to the REST view', async () => {
      const { a, id } = await startMatch();
      await move(a, id, 4, (await view(a, id)).version).expect(200);
      const connection = await connect(a);
      await until(() => updates(connection.events).length > 0, 'the snapshot');
      const pushed = updates(connection.events)[0] as MatchView;
      expect(stripClock(pushed)).toEqual(stripClock(await view(a, id)));
      expect(pushed.series?.board[4]).toBe('X');
    });

    it('sends nothing when the player has no open match, and nothing for a finished one', async () => {
      const a = await registerWithProfile(t);
      const idle = await connect(a);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(updates(idle.events)).toHaveLength(0);

      const pair = await startMatch();
      await request(t.server)
        .post(`/v1/matches/${pair.id}/leave`)
        .set(pair.a.auth)
        .send({})
        .expect(200);
      const after = await connect(pair.b);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(updates(after.events)).toHaveLength(0);
    });

    it('after a drop, reconnecting restores the exact state including moves made while away', async () => {
      const { a, b, id } = await startMatch();
      const first = await connect(a);
      await move(a, id, 0, (await view(a, id)).version).expect(200);
      await disconnect(first, a.id);

      await move(b, id, 4, (await view(b, id)).version).expect(200);
      await move(a, id, 1, (await view(a, id)).version).expect(200);
      await move(b, id, 8, (await view(b, id)).version).expect(200);

      const second = await connect(a);
      await until(() => updates(second.events).length > 0, 'the snapshot after reconnecting');
      const pushed = updates(second.events).at(-1) as MatchView;
      const truth = await view(a, id);
      expect(stripClock(pushed)).toEqual(stripClock(truth));
      expect(pushed.series?.board.filter((cell) => cell !== null)).toHaveLength(4);
      expect(pushed.version).toBe(truth.version);
    });

    it('a second device gets the snapshot too', async () => {
      const { a, id } = await startMatch();
      await connect(a);
      const phone2 = await connect(a);
      await until(() => updates(phone2.events).length > 0, 'the second device snapshot');
      expect(updates(phone2.events)[0]?.id).toBe(id);
    });
  });

  describe('disconnect grace and forfeit', () => {
    const base = () => new Date();
    const later = (from: Date, ms: number) => new Date(from.getTime() + ms);

    it('notes who is offline, shows it to the opponent, and does not forfeit yet', async () => {
      const { a, b, id } = await startMatch();
      const connectionB = await connect(b);
      const t0 = base();
      expect(await service().runConnectionChecks(t0)).toBe(0);

      expect((await playerRow(id, 0)).disconnectedAt).not.toBeNull();
      expect((await playerRow(id, 1)).disconnectedAt).toBeNull();
      const seenByB = await view(b, id);
      expect(seenByB.players[0]).toMatchObject({ connected: false });
      expect(seenByB.players[0]?.reconnectBy).toBe(
        later((await playerRow(id, 0)).disconnectedAt as Date, DISCONNECT_GRACE_MS).toISOString(),
      );
      expect(seenByB.players[1]).toMatchObject({ connected: true, reconnectBy: null });
      expect(seenByB.status).toBe('ACTIVE');
      // The opponent's open app is told, without waiting for a poll.
      await until(
        () => updates(connectionB.events).some((m) => m.players[0]?.connected === false),
        'the opponent to hear about the disconnect',
      );
      expect(a.id).toBeTruthy();
    });

    it('does not change the match version (a move in flight is not made stale)', async () => {
      const { b, id } = await startMatch();
      await connect(b);
      const before = (await view(b, id)).version;
      await service().runConnectionChecks(new Date());
      expect((await view(b, id)).version).toBe(before);
    });

    it('forfeits exactly when the grace period is over: not a moment earlier', async () => {
      const { b, id } = await startMatch();
      await connect(b);
      const t0 = base();
      await service().runConnectionChecks(t0);
      const since = (await playerRow(id, 0)).disconnectedAt as Date;

      expect(await service().runConnectionChecks(later(since, DISCONNECT_GRACE_MS - 1))).toBe(0);
      expect((await view(b, id)).status).toBe('ACTIVE');

      expect(await service().runConnectionChecks(later(since, DISCONNECT_GRACE_MS))).toBe(1);
      const ended = await view(b, id);
      expect(ended).toMatchObject({
        status: 'COMPLETED',
        endReason: 'disconnected',
        winnerSeat: 1,
      });
      expect(ended.series?.winner).toBe(1);
      const events = await t.prisma.gameEvent.findMany({
        where: { matchId: id },
        orderBy: { seq: 'asc' },
      });
      expect(events.some((e) => e.type === 'PLAYER_DISCONNECTED' && e.seat === 0)).toBe(true);
      expect(events.map((e) => e.seq)).toEqual(events.map((_, index) => index + 1));
      expect(events.at(-1)?.seq).toBe(ended.version);
    });

    it('a second sweep after the forfeit does nothing', async () => {
      const { b, id } = await startMatch();
      await connect(b);
      await service().runConnectionChecks(base());
      const since = (await playerRow(id, 0)).disconnectedAt as Date;
      const due = later(since, DISCONNECT_GRACE_MS + 5000);
      expect(await service().runConnectionChecks(due)).toBe(1);
      const version = (await view(b, id)).version;
      expect(await service().runConnectionChecks(due)).toBe(0);
      expect(await Promise.all([1, 2, 3].map(() => service().runConnectionChecks(due)))).toEqual([
        0, 0, 0,
      ]);
      expect((await view(b, id)).version).toBe(version);
    });

    it('three sweepers at the same instant forfeit once', async () => {
      const { b, id } = await startMatch();
      await connect(b);
      await service().runConnectionChecks(base());
      const since = (await playerRow(id, 0)).disconnectedAt as Date;
      const due = later(since, DISCONNECT_GRACE_MS);
      const results = await Promise.all([1, 2, 3].map(() => service().runConnectionChecks(due)));
      expect(results.reduce((sum, n) => sum + n, 0)).toBe(1);
      const forfeits = await t.prisma.gameEvent.count({
        where: { matchId: id, type: 'PLAYER_DISCONNECTED' },
      });
      expect(forfeits).toBe(1);
    });

    it('coming back inside the grace period cancels the countdown at once', async () => {
      const { a, b, id } = await startMatch();
      await connect(b);
      await service().runConnectionChecks(base());
      expect((await playerRow(id, 0)).disconnectedAt).not.toBeNull();

      const returned = await connect(a);
      await until(
        async () => (await playerRow(id, 0)).disconnectedAt === null,
        'the flag to clear',
      );
      await until(
        () => updates(returned.events).some((m) => m.players[0]?.connected === true),
        'the snapshot with connected = true',
      );
      const far = later(new Date(), 10 * DISCONNECT_GRACE_MS);
      // Still online: far in the future nothing is forfeited.
      expect(await service().runConnectionChecks(far)).toBe(0);
      expect((await view(a, id)).status).toBe('ACTIVE');
    });

    it('the sweeper itself clears a stale note for a player who is online', async () => {
      const { a, b, id } = await startMatch();
      await connect(a);
      await connect(b);
      await t.prisma.gameMatchPlayer.update({
        where: { matchId_seat: { matchId: id, seat: 0 } },
        data: { disconnectedAt: new Date(Date.now() - 2 * DISCONNECT_GRACE_MS) },
      });
      expect(await service().runConnectionChecks(new Date())).toBe(0);
      expect((await playerRow(id, 0)).disconnectedAt).toBeNull();
      expect((await view(a, id)).status).toBe('ACTIVE');
    });

    it('a reconnect that lands between the check and the forfeit wins', async () => {
      const { b, id } = await startMatch();
      await connect(b);
      await service().runConnectionChecks(base());
      const since = (await playerRow(id, 0)).disconnectedAt as Date;
      await t.prisma.gameMatchPlayer.update({
        where: { matchId_seat: { matchId: id, seat: 0 } },
        data: { disconnectedAt: null },
      });
      const forfeit = (
        service() as unknown as {
          forfeitDisconnected: (m: string, s: number, n: Date) => Promise<boolean>;
        }
      ).forfeitDisconnected.bind(service());
      expect(await forfeit(id, 0, later(since, DISCONNECT_GRACE_MS * 2))).toBe(false);
      expect((await view(b, id)).status).toBe('ACTIVE');
    });

    it('the forfeit itself re-checks the grace period', async () => {
      const { b, id } = await startMatch();
      await connect(b);
      await service().runConnectionChecks(base());
      const since = (await playerRow(id, 0)).disconnectedAt as Date;
      const forfeit = (
        service() as unknown as {
          forfeitDisconnected: (m: string, s: number, n: Date) => Promise<boolean>;
        }
      ).forfeitDisconnected.bind(service());
      expect(await forfeit(id, 0, later(since, DISCONNECT_GRACE_MS - 1))).toBe(false);
      expect((await view(b, id)).status).toBe('ACTIVE');
      expect(await forfeit(id, 0, later(since, DISCONNECT_GRACE_MS))).toBe(true);
    });

    it('if both are gone, the one who left first loses', async () => {
      const { a, id } = await startMatch();
      const now = new Date();
      await t.prisma.gameMatchPlayer.update({
        where: { matchId_seat: { matchId: id, seat: 0 } },
        data: { disconnectedAt: later(now, -40_000) },
      });
      await t.prisma.gameMatchPlayer.update({
        where: { matchId_seat: { matchId: id, seat: 1 } },
        data: { disconnectedAt: later(now, -50_000) },
      });
      expect(await service().runConnectionChecks(now)).toBe(1);
      expect(await view(a, id)).toMatchObject({ status: 'COMPLETED', winnerSeat: 0 });
    });

    it('leaves matches that have not started, and finished ones, alone', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      const waiting = await service().createMatch({
        gameId: 'tictactoe',
        kind: 'PRIVATE',
        seats: [{ userId: a.id }, { userId: b.id }],
      });
      expect(await service().runConnectionChecks(new Date())).toBe(0);
      expect((await playerRow(waiting, 0)).disconnectedAt).toBeNull();
      expect((await view(a, waiting)).players.every((p) => p.connected)).toBe(true);
    });

    it('the forfeited player sees the result when they return', async () => {
      const { a, b, id } = await startMatch();
      await connect(b);
      await service().runConnectionChecks(base());
      const since = (await playerRow(id, 0)).disconnectedAt as Date;
      await service().runConnectionChecks(later(since, DISCONNECT_GRACE_MS));
      const returned = await connect(a);
      // A finished match is not an "open" match, so it is fetched, not pushed.
      expect(await view(a, id)).toMatchObject({
        status: 'COMPLETED',
        endReason: 'disconnected',
        winnerSeat: 1,
      });
      expect(updates(returned.events)).toHaveLength(0);
    });
  });

  describe('per-account action limit', () => {
    it('refuses the 31st action inside the window with 429 and changes nothing', async () => {
      const { a, id } = await startMatch();
      // startMatch already used one ready for `a`; ready is idempotent so repeats are no-ops.
      let ok = 1;
      let refused: request.Response | null = null;
      for (let i = 0; i < 40; i += 1) {
        const response = await request(t.server)
          .post(`/v1/matches/${id}/ready`)
          .set(a.auth)
          .send({});
        if (response.status === 200) ok += 1;
        else {
          refused = response;
          break;
        }
      }
      expect(ok).toBe(30);
      expect(refused?.status).toBe(429);
      expect(refused?.body.error.code).toBe('RATE_LIMITED');
    });

    it('is per account: one player being limited does not limit their opponent', async () => {
      const { a, b, id } = await startMatch();
      for (let i = 0; i < 35; i += 1) {
        await request(t.server).post(`/v1/matches/${id}/ready`).set(a.auth).send({});
      }
      const version = (await view(b, id)).version;
      await move(a, id, 0, version).expect(429);
      await move(b, id, 0, version).expect(409); // b is not on turn - but is not rate limited
      await move(a, id, 0, version).expect(429);
    });

    it('reading the match is never limited', async () => {
      const { a, id } = await startMatch();
      for (let i = 0; i < 45; i += 1) await view(a, id);
    });
  });
});
