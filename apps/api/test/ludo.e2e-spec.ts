import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LUDO_TURN_TIMER_MS } from '@gameverse/game-rules';
import type { MatchView } from '@gameverse/shared-types';
import { BOT_THINK_MS } from '../src/matches/matches.constants.js';
import { MatchesService } from '../src/matches/matches.service.js';
import { registerWithProfile, type SocialUser } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

describe('ludo matches', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    // Ludo ships disabled until it is playable end to end; the tests exercise the server.
    await t.prisma.game.update({ where: { id: 'ludo' }, data: { enabled: true } });
  });
  afterAll(async () => {
    // Other test files rely on Ludo being off, as it ships.
    await t.prisma.game.update({ where: { id: 'ludo' }, data: { enabled: false } });
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });

  const service = () => t.app.get(MatchesService);
  const get = async (user: SocialUser, id: string) =>
    (await request(t.server).get(`/v1/matches/${id}`).set(user.auth).expect(200)).body as MatchView;
  const ready = (user: SocialUser, id: string) =>
    request(t.server).post(`/v1/matches/${id}/ready`).set(user.auth).send({});
  const roll = (
    user: SocialUser,
    id: string,
    expectedVersion: number,
    clientActionId = randomUUID(),
  ) =>
    request(t.server)
      .post(`/v1/matches/${id}/roll`)
      .set(user.auth)
      .send({ clientActionId, expectedVersion });
  const moveToken = (
    user: SocialUser,
    id: string,
    token: number,
    expectedVersion: number,
    clientActionId = randomUUID(),
  ) =>
    request(t.server)
      .post(`/v1/matches/${id}/token-moves`)
      .set(user.auth)
      .send({ token, clientActionId, expectedVersion });
  const events = (id: string) =>
    t.prisma.gameEvent.findMany({ where: { matchId: id }, orderBy: { seq: 'asc' } });

  let clock = 0;
  const tick = (ms = 5_000) => {
    clock = Math.max(clock, Date.now()) + ms;
    return new Date(clock);
  };

  /** Creates and starts a match of `count` humans. */
  async function startHumans(count: 2 | 3 | 4, openingSeat = 0) {
    const users: SocialUser[] = [];
    for (let i = 0; i < count; i += 1) users.push(await registerWithProfile(t));
    const id = await service().createMatch({
      gameId: 'ludo',
      kind: 'PRIVATE',
      seats: users.map((user) => ({ userId: user.id })),
      openingSeat: openingSeat as 0 | 1 | 2 | 3,
    });
    for (const user of users) await ready(user, id).expect(200);
    return { users, id };
  }

  /** Long loops play far faster than a person, so they start each step with a fresh action budget. */
  const resetActionBudget = () =>
    (service() as unknown as { limiter: { hits: Map<string, number[]> } }).limiter.hits.clear();

  /** Whoever is on turn does one step: roll, or move the first legal token. */
  async function step(users: SocialUser[], id: string): Promise<MatchView> {
    resetActionBudget();
    const first = users[0] as SocialUser;
    const view = await get(first, id);
    const ludo = view.ludo;
    if (!ludo || ludo.toMove === null) return view;
    const user = users[ludo.toMove] as SocialUser;
    if (ludo.phase === 'roll') {
      return (await roll(user, id, view.version).expect(200)).body as MatchView;
    }
    const choice = ludo.moves[0];
    if (!choice) throw new Error('a move phase with no legal moves');
    return (await moveToken(user, id, choice.token, view.version).expect(200)).body as MatchView;
  }

  describe('availability', () => {
    it('shows Ludo in progress and leaderboards only while the game is enabled', async () => {
      const user = await registerWithProfile(t);
      const ids = async () =>
        (
          (await request(t.server).get('/v1/me/progress').set(user.auth).expect(200)).body as {
            games: { gameId: string }[];
          }
        ).games.map((g) => g.gameId);
      expect(await ids()).toContain('ludo');
      await request(t.server).get('/v1/leaderboards/ludo').set(user.auth).expect(200);
      await t.prisma.game.update({ where: { id: 'ludo' }, data: { enabled: false } });
      try {
        expect(await ids()).not.toContain('ludo');
        await request(t.server).get('/v1/leaderboards/ludo').set(user.auth).expect(404);
      } finally {
        await t.prisma.game.update({ where: { id: 'ludo' }, data: { enabled: true } });
      }
    });
  });

  describe('starting', () => {
    it.each([2, 3, 4] as const)('starts a %i-player match with the opener on turn', async (n) => {
      const { users, id } = await startHumans(n, 1);
      const view = await get(users[0] as SocialUser, id);
      expect(view.status).toBe('ACTIVE');
      expect(view.players).toHaveLength(n);
      expect(view.ludo).toMatchObject({ phase: 'roll', toMove: 1, players: n, rolls: 0 });
      expect(view.deadline).not.toBeNull();
    });

    it('rejects a Ludo match with one seat or five', async () => {
      const [a, b, c, d, e] = await Promise.all([1, 2, 3, 4, 5].map(() => registerWithProfile(t)));
      const make = (seats: SocialUser[]) =>
        service().createMatch({
          gameId: 'ludo',
          kind: 'PRIVATE',
          seats: seats.map((user) => ({ userId: user.id })),
        });
      await expect(make([a as SocialUser])).rejects.toMatchObject({ status: 400 });
      await expect(
        make([a, b, c, d, e].filter((u): u is SocialUser => u !== undefined)),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('does not start a match for a disabled game', async () => {
      await t.prisma.game.update({ where: { id: 'ludo' }, data: { enabled: false } });
      try {
        const [a, b] = await Promise.all([registerWithProfile(t), registerWithProfile(t)]);
        await expect(
          service().createMatch({
            gameId: 'ludo',
            kind: 'PRIVATE',
            seats: [{ userId: a.id }, { userId: b.id }],
          }),
        ).rejects.toMatchObject({ status: 404 });
      } finally {
        await t.prisma.game.update({ where: { id: 'ludo' }, data: { enabled: true } });
      }
    });
  });

  describe('rolling and moving', () => {
    it('rolls on the server, logs the roll, and advances the version', async () => {
      const { users, id } = await startHumans(2);
      const before = await get(users[0] as SocialUser, id);
      const res = await roll(users[0] as SocialUser, id, before.version).expect(200);
      const after = res.body as MatchView;
      expect(after.version).toBeGreaterThan(before.version);
      expect(after.ludo?.rolls).toBe(1);
      const rolled = (await events(id)).filter((e) => e.type === 'ROLLED');
      expect(rolled).toHaveLength(1);
      const value = (rolled[0]?.data as { value: number } | undefined)?.value ?? 0;
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
      expect(rolled[0]?.seat).toBe(0);
    });

    it('never accepts a die value from the client', async () => {
      const { users, id } = await startHumans(2);
      const view = await get(users[0] as SocialUser, id);
      await request(t.server)
        .post(`/v1/matches/${id}/roll`)
        .set((users[0] as SocialUser).auth)
        .send({ clientActionId: randomUUID(), expectedVersion: view.version, value: 6 })
        .expect(400);
      expect((await get(users[0] as SocialUser, id)).version).toBe(view.version);
    });

    it('refuses the wrong player, and the wrong phase', async () => {
      const { users, id } = await startHumans(3);
      const view = await get(users[0] as SocialUser, id);
      const notYou = await roll(users[1] as SocialUser, id, view.version);
      expect(notYou.status).toBe(409);
      expect(notYou.body.error.code).toBe('NOT_YOUR_TURN');
      const early = await moveToken(users[0] as SocialUser, id, 0, view.version);
      expect(early.status).toBe(409);
      expect((await get(users[0] as SocialUser, id)).version).toBe(view.version);
    });

    it('refuses an illegal token and leaves the match untouched', async () => {
      const { users, id } = await startHumans(2);
      let view = await get(users[0] as SocialUser, id);
      // Roll until the turn is a move phase with at least one token that cannot move.
      for (let i = 0; i < 40 && view.ludo?.phase === 'roll'; i += 1) {
        view = await step(users, id);
      }
      for (let i = 0; i < 200; i += 1) {
        const ludo = view.ludo;
        if (ludo?.phase === 'move' && ludo.toMove !== null) {
          const legal = new Set(ludo.moves.map((m) => m.token));
          const illegal = [0, 1, 2, 3].find((tk) => !legal.has(tk));
          if (illegal !== undefined) {
            const user = users[ludo.toMove] as SocialUser;
            const res = await moveToken(user, id, illegal, view.version);
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('INVALID_MOVE');
            expect((await get(user, id)).version).toBe(view.version);
            return;
          }
        }
        view = await step(users, id);
      }
      throw new Error('never reached a move phase with an illegal token');
    });

    it('rejects a token outside 0..3', async () => {
      const { users, id } = await startHumans(2);
      const view = await get(users[0] as SocialUser, id);
      await moveToken(users[0] as SocialUser, id, 4, view.version).expect(400);
    });

    it('acknowledges a retried action id without rolling twice', async () => {
      const { users, id } = await startHumans(2);
      const view = await get(users[0] as SocialUser, id);
      const actionId = randomUUID();
      const first = (await roll(users[0] as SocialUser, id, view.version, actionId).expect(200))
        .body as MatchView;
      const second = (await roll(users[0] as SocialUser, id, view.version, actionId).expect(200))
        .body as MatchView;
      expect(second.version).toBe(first.version);
      expect((await events(id)).filter((e) => e.type === 'ROLLED')).toHaveLength(1);
    });

    it('answers 409 for a stale version', async () => {
      const { users, id } = await startHumans(2);
      const view = await get(users[0] as SocialUser, id);
      const res = await roll(users[0] as SocialUser, id, view.version + 5);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('STALE_MATCH_VERSION');
    });

    it('rate-limits a player who hammers the roll button', async () => {
      const { users, id } = await startHumans(2);
      resetActionBudget();
      const statuses: number[] = [];
      for (let i = 0; i < 40; i += 1) {
        statuses.push((await roll(users[1] as SocialUser, id, 2)).status);
      }
      expect(statuses).toContain(429);
      expect(statuses[0]).toBe(409); // not their turn, but still counted
    });

    it('hides the match from someone who is not seated', async () => {
      const { id } = await startHumans(2);
      const stranger = await registerWithProfile(t);
      await roll(stranger, id, 2).expect(404);
      await request(t.server).get(`/v1/matches/${id}`).set(stranger.auth).expect(404);
    });

    it('keeps the event sequence contiguous through a stretch of play', async () => {
      const { users, id } = await startHumans(3);
      for (let i = 0; i < 40; i += 1) await step(users, id);
      const log = await events(id);
      expect(log.map((e) => e.seq)).toEqual(log.map((_, index) => index + 1));
    });
  });

  describe('timers', () => {
    it('plays for a player who runs out of time, then removes them after twenty covered turns in a row', async () => {
      const { users, id } = await startHumans(3);
      const first = await get(users[0] as SocialUser, id);
      expect(first.ludo?.toMove).toBe(0);
      let now = tick(LUDO_TURN_TIMER_MS + 1);
      expect(await service().runDueTimers(now)).toBe(1);
      const after = await get(users[1] as SocialUser, id);
      expect(after.version).toBeGreaterThan(first.version);
      // Seat 0 keeps timing out while the others are slow too; eventually someone is removed.
      for (let i = 0; i < 60; i += 1) {
        now = tick(LUDO_TURN_TIMER_MS + 1);
        await service().runDueTimers(now);
        const view = await get(users[1] as SocialUser, id);
        if (view.ludo && view.ludo.removed.length > 0) {
          const removedSeat = view.ludo.removed[0] as number;
          expect(view.players[removedSeat]?.out).toBe(true);
          const rows = await t.prisma.gameMatchPlayer.findMany({
            where: { matchId: id, outAt: { not: null } },
          });
          expect(rows.length).toBeGreaterThan(0);
          return;
        }
      }
      throw new Error('nobody was removed after repeated timeouts');
    });

    it('does nothing before the deadline', async () => {
      const { id } = await startHumans(2);
      expect(await service().runDueTimers(new Date(Date.now() + 1_000))).toBe(0);
      expect(await t.prisma.gameMatch.findUnique({ where: { id } })).toMatchObject({
        status: 'ACTIVE',
      });
    });
  });

  describe('leaving', () => {
    it('gives the win to the other player in a two-player game', async () => {
      const { users, id } = await startHumans(2);
      const res = await request(t.server)
        .post(`/v1/matches/${id}/leave`)
        .set((users[0] as SocialUser).auth)
        .send({})
        .expect(200);
      const view = res.body as MatchView;
      expect(view.status).toBe('COMPLETED');
      expect(view.winnerSeat).toBe(1);
      expect(view.endReason).toBe('left');
    });

    it('lets a three- or four-player game carry on without the leaver', async () => {
      const { users, id } = await startHumans(4);
      const leaver = users[2] as SocialUser;
      const res = await request(t.server)
        .post(`/v1/matches/${id}/leave`)
        .set(leaver.auth)
        .send({})
        .expect(200);
      expect((res.body as MatchView).status).toBe('ACTIVE');
      const view = await get(users[0] as SocialUser, id);
      expect(view.ludo?.removed).toEqual([2]);
      expect(view.players[2]?.out).toBe(true);
      expect(view.ludo?.tokens[2]).toEqual([-1, -1, -1, -1]);
      // The leaver is free to start another match; the rest are still busy.
      const other = await registerWithProfile(t);
      await expect(
        service().createMatch({
          gameId: 'tictactoe',
          kind: 'PRIVATE',
          seats: [{ userId: leaver.id }, { userId: other.id }],
        }),
      ).resolves.toEqual(expect.any(String));
      await expect(
        service().createMatch({
          gameId: 'tictactoe',
          kind: 'PRIVATE',
          seats: [
            { userId: (users[0] as SocialUser).id },
            { userId: (await registerWithProfile(t)).id },
          ],
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('skips a removed seat when turns pass', async () => {
      const { users, id } = await startHumans(3);
      await request(t.server)
        .post(`/v1/matches/${id}/leave`)
        .set((users[1] as SocialUser).auth)
        .send({})
        .expect(200);
      for (let i = 0; i < 60; i += 1) {
        const view = await step(users, id);
        expect(view.ludo?.toMove).not.toBe(1);
      }
    });

    it('ends the game when only one player is left', async () => {
      const { users, id } = await startHumans(3);
      for (const index of [1, 2]) {
        await request(t.server)
          .post(`/v1/matches/${id}/leave`)
          .set((users[index] as SocialUser).auth)
          .send({})
          .expect(200);
      }
      const view = await get(users[0] as SocialUser, id);
      expect(view.status).toBe('COMPLETED');
      expect(view.winnerSeat).toBe(0);
      expect(view.ludo?.placings?.[0]).toBe(0);
    });
  });

  describe('disconnects', () => {
    it('hands a seat that stays offline past the grace period to the AI instead of removing it', async () => {
      const { users, id } = await startHumans(3);
      // No socket is connected in tests, so every human is offline once the grace passes.
      await t.prisma.gameMatchPlayer.updateMany({
        where: { matchId: id },
        data: { disconnectedAt: new Date(Date.now() - 10 * 60_000) },
      });
      await service().runConnectionChecks(tick(10 * 60_000));
      const view = await get(users[0] as SocialUser, id);
      expect(view.status).toBe('ACTIVE');
      expect(view.ludo?.removed ?? []).toEqual([]);
      expect(view.ludo?.ai).toEqual([true, true, true]);
      expect(await t.prisma.gameMatch.findUnique({ where: { id } })).toMatchObject({
        aiCover: true,
      });
    });
  });

  describe('bots', () => {
    it.each([2, 3, 4])('starts a %i-player game against labelled bots', async (n) => {
      const user = await registerWithProfile(t);
      const res = await request(t.server)
        .post('/v1/matches/bot')
        .set(user.auth)
        .send({ gameId: 'ludo', level: 'medium', players: n })
        .expect(201);
      const body = res.body as MatchView;
      expect(body.kind).toBe('BOT');
      expect(body.players).toHaveLength(n);
      expect(body.players.filter((p) => p.bot !== null && p.username === 'Bot')).toHaveLength(
        n - 1,
      );
      expect(body.players.every((p) => p.bot === null || p.userId === null)).toBe(true);
    });

    it('refuses a player count for tic-tac-toe', async () => {
      const user = await registerWithProfile(t);
      await request(t.server)
        .post('/v1/matches/bot')
        .set(user.auth)
        .send({ gameId: 'tictactoe', level: 'easy', players: 3 })
        .expect(400);
    });

    it('plays a whole game with bots rolling through the same rules', async () => {
      const user = await registerWithProfile(t);
      const created = (
        await request(t.server)
          .post('/v1/matches/bot')
          .set(user.auth)
          .send({ gameId: 'ludo', level: 'hard', players: 3 })
          .expect(201)
      ).body as MatchView;
      const id = created.id;
      await ready(user, id).expect(200);
      let view = await get(user, id);
      for (let i = 0; i < 3_000 && view.status === 'ACTIVE'; i += 1) {
        if (view.ludo?.toMove === 0) {
          view = await step([user], id);
        } else {
          await service().runBotMoves(tick(BOT_THINK_MS + 1));
          view = await get(user, id);
        }
      }
      expect(view.status).toBe('COMPLETED');
      expect(view.ludo?.placings).toHaveLength(3);
      const bots = (await events(id)).filter((e) => e.seat !== null && e.seat !== 0);
      expect(bots.length).toBeGreaterThan(0);
    }, 120_000);
  });

  describe('a full four-player game', () => {
    it('completes with a winner, logged dice and a result for everyone', async () => {
      const { users, id } = await startHumans(4);
      let view = await get(users[0] as SocialUser, id);
      let steps = 0;
      while (view.status === 'ACTIVE' && steps < 4_000) {
        view = await step(users, id);
        steps += 1;
      }
      expect(view.status).toBe('COMPLETED');
      expect(view.endReason).toBe('score');
      const ludo = view.ludo;
      expect(ludo?.phase).toBe('finished');
      expect([...(ludo?.placings ?? [])].sort()).toEqual([0, 1, 2, 3]);
      expect(view.winnerSeat).toBe(ludo?.placings?.[0]);
      expect(ludo?.rolls).toBeGreaterThan(0);

      const log = await events(id);
      expect(log.map((e) => e.seq)).toEqual(log.map((_, index) => index + 1));
      expect(log.filter((e) => e.type === 'ROLLED').length).toBe(ludo?.rolls);

      const result = await t.prisma.gameResult.findUnique({
        where: { matchId: id },
        include: { players: { orderBy: { seat: 'asc' } } },
      });
      expect(result?.players).toHaveLength(4);
      expect(result?.ranked).toBe(false); // private match
      const scores = result?.players.map((p) => p.score) ?? [];
      expect(scores[view.winnerSeat as number]).toBe(1);
      expect(Math.min(...scores)).toBe(0);
      // Score and XP follow the finishing order exactly.
      const order = ludo?.placings ?? [];
      order.forEach((seat, place) => {
        expect(scores[seat], `score of place ${place + 1}`).toBeCloseTo((3 - place) / 3, 10);
        expect(result?.players[seat]?.xp, `xp of place ${place + 1}`).toBe([20, 12, 8, 5][place]);
      });
    }, 180_000);

    it('rates a quick match between four humans by finishing order', async () => {
      const users: SocialUser[] = [];
      for (let i = 0; i < 4; i += 1) users.push(await registerWithProfile(t));
      const id = await service().createMatch({
        gameId: 'ludo',
        kind: 'QUICK',
        seats: users.map((user) => ({ userId: user.id })),
      });
      for (const user of users) await ready(user, id).expect(200);
      let view = await get(users[0] as SocialUser, id);
      for (let i = 0; i < 4_000 && view.status === 'ACTIVE'; i += 1) view = await step(users, id);
      expect(view.status).toBe('COMPLETED');
      const result = await t.prisma.gameResult.findUnique({
        where: { matchId: id },
        include: { players: { orderBy: { seat: 'asc' } } },
      });
      expect(result).toMatchObject({ ranked: true, ratingApplied: true });
      const placings = view.ludo?.placings ?? [];
      const winner = result?.players[placings[0] as number];
      const last = result?.players[placings[3] as number];
      expect(winner?.ratingAfter).toBeGreaterThan(winner?.ratingBefore ?? 0);
      expect(last?.ratingAfter).toBeLessThan(last?.ratingBefore ?? 0);
    }, 180_000);
  });

  describe('walking away', () => {
    it('pays nothing to a player who left, and places them last', async () => {
      const { users, id } = await startHumans(3);
      await request(t.server)
        .post(`/v1/matches/${id}/leave`)
        .set((users[1] as SocialUser).auth)
        .send({})
        .expect(200);
      let view = await get(users[0] as SocialUser, id);
      for (let i = 0; i < 4_000 && view.status === 'ACTIVE'; i += 1) view = await step(users, id);
      expect(view.status).toBe('COMPLETED');
      expect(view.ludo?.placings?.[2]).toBe(1);
      const result = await t.prisma.gameResult.findUniqueOrThrow({
        where: { matchId: id },
        include: { players: { orderBy: { seat: 'asc' } } },
      });
      expect(result.players[1]).toMatchObject({ xp: 0, score: 0 });
      expect(result.players[0]?.xp).toBeGreaterThan(0);
      expect(result.players[2]?.xp).toBeGreaterThan(0);
    }, 180_000);
  });

  describe('rematch', () => {
    it('needs every remaining seat, then starts a new match with the opener rotated', async () => {
      const { users, id } = await startHumans(3, 0);
      // End it quickly: two players leave, which finishes the game.
      for (const index of [1, 2]) {
        await request(t.server)
          .post(`/v1/matches/${id}/leave`)
          .set((users[index] as SocialUser).auth)
          .send({})
          .expect(200);
      }
      const rematch = (user: SocialUser) =>
        request(t.server).post(`/v1/matches/${id}/rematch`).set(user.auth).send({});
      const one = (await rematch(users[0] as SocialUser).expect(200)).body as MatchView;
      expect(one.rematchMatchId).toBeNull();
      expect(one.rematchRequestedBy).toContain(0);
      await rematch(users[1] as SocialUser).expect(200);
      const done = (await rematch(users[2] as SocialUser).expect(200)).body as MatchView;
      expect(done.rematchMatchId).not.toBeNull();
      const next = await get(users[0] as SocialUser, done.rematchMatchId as string);
      expect(next.players).toHaveLength(3);
      expect(next.status).toBe('READY');
    });
  });
});
