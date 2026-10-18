import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DRAUGHTS_TURN_TIMER_MS } from '@gameverse/game-rules';
import type { MatchView } from '@gameverse/shared-types';
import { MatchesService } from '../src/matches/matches.service.js';
import { registerWithProfile, type SocialUser } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

describe('draughts matches', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    // Draughts ships disabled until the owner has played it on a phone; the tests exercise the server.
    await t.prisma.game.update({ where: { id: 'draughts' }, data: { enabled: true } });
  });
  afterAll(async () => {
    await t.prisma.game.update({ where: { id: 'draughts' }, data: { enabled: false } });
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
  const move = (
    user: SocialUser,
    id: string,
    from: number,
    path: number[],
    expectedVersion: number,
    clientActionId = randomUUID(),
  ) =>
    request(t.server)
      .post(`/v1/matches/${id}/draughts-moves`)
      .set(user.auth)
      .send({ from, path, clientActionId, expectedVersion });
  const events = (id: string) =>
    t.prisma.gameEvent.findMany({ where: { matchId: id }, orderBy: { seq: 'asc' } });
  const resetActionBudget = () =>
    (service() as unknown as { limiter: { hits: Map<string, number[]> } }).limiter.hits.clear();

  async function start(openingSeat: 0 | 1 = 0) {
    const a = await registerWithProfile(t);
    const b = await registerWithProfile(t);
    const id = await service().createMatch({
      gameId: 'draughts',
      kind: 'PRIVATE',
      seats: [{ userId: a.id }, { userId: b.id }],
      openingSeat,
    });
    await ready(a, id).expect(200);
    await ready(b, id).expect(200);
    return { users: [a, b] as const, id };
  }

  function seeded(seed: number): () => number {
    let x = seed >>> 0;
    return () => {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      return x / 4294967296;
    };
  }

  it('is added switched off by the migration', async () => {
    await t.prisma.game.update({ where: { id: 'draughts' }, data: { enabled: false } });
    try {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      await expect(
        service().createMatch({
          gameId: 'draughts',
          kind: 'PRIVATE',
          seats: [{ userId: a.id }, { userId: b.id }],
        }),
      ).rejects.toMatchObject({ status: 404 });
      const row = await t.prisma.game.findUnique({ where: { id: 'draughts' } });
      expect(row).toMatchObject({ minPlayers: 2, maxPlayers: 2 });
    } finally {
      await t.prisma.game.update({ where: { id: 'draughts' }, data: { enabled: true } });
    }
  });

  it('starts with the opener on turn and the server-computed legal moves', async () => {
    const { users, id } = await start(1);
    const view = await get(users[0], id);
    expect(view.status).toBe('ACTIVE');
    expect(view.draughts).toMatchObject({ phase: 'playing', toMove: 1, plies: 0 });
    expect(view.draughts?.moves).toHaveLength(7);
    expect(view.draughts?.board.filter((c) => c === 1 || c === 3)).toHaveLength(24);
    expect(view.series).toBeNull();
    expect(view.ludo).toBeNull();
    expect(view.deadline).not.toBeNull();
  });

  it('plays a move for the seat on turn and passes the turn', async () => {
    const { users, id } = await start(0);
    const view = await get(users[0], id);
    const choice = view.draughts?.moves[0];
    if (!choice) throw new Error('no legal move');
    const after = (await move(users[0], id, choice.from, choice.path, view.version).expect(200))
      .body as MatchView;
    expect(after.draughts?.toMove).toBe(1);
    expect(after.draughts?.plies).toBe(1);
    expect(after.draughts?.last).toMatchObject({ from: choice.from, path: choice.path });
    expect(after.version).toBeGreaterThan(view.version);
    const logged = (await events(id)).filter((e) => e.type === 'MOVE');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ seat: 0 });
  });

  it('refuses illegal, out-of-turn, stale and malformed moves and leaves the match untouched', async () => {
    const { users, id } = await start(0);
    const view = await get(users[0], id);
    const legal = view.draughts?.moves[0];
    if (!legal) throw new Error('no legal move');

    // a man that tries to move two squares
    const illegal = await move(users[0], id, 40, [26], view.version).expect(409);
    expect(illegal.body).toMatchObject({ error: { code: 'INVALID_MOVE' } });
    // seat 1 moving on seat 0's turn
    const early = await move(users[1], id, 17, [24], view.version).expect(409);
    expect(early.body).toMatchObject({ error: { code: 'NOT_YOUR_TURN' } });
    // a wrong version
    const stale = await move(users[0], id, legal.from, legal.path, view.version + 5).expect(409);
    expect(stale.body).toMatchObject({ error: { code: 'STALE_MATCH_VERSION' } });
    // a client can't claim a result or a capture list
    await request(t.server)
      .post(`/v1/matches/${id}/draughts-moves`)
      .set(users[0].auth)
      .send({
        from: legal.from,
        path: legal.path,
        winner: 0,
        clientActionId: randomUUID(),
        expectedVersion: view.version,
      })
      .expect(400);
    await move(users[0], id, 99, [1], view.version).expect(400);
    await move(users[0], id, legal.from, [], view.version).expect(400);

    const unchanged = await get(users[0], id);
    expect(unchanged.version).toBe(view.version);
    expect(unchanged.draughts?.plies).toBe(0);
  });

  it('applies a retried move once and acknowledges the retry', async () => {
    const { users, id } = await start(0);
    const view = await get(users[0], id);
    const choice = view.draughts?.moves[0];
    if (!choice) throw new Error('no legal move');
    const actionId = randomUUID();
    await move(users[0], id, choice.from, choice.path, view.version, actionId).expect(200);
    const afterFirst = await get(users[0], id);
    const again = await move(users[0], id, choice.from, choice.path, view.version, actionId).expect(
      200,
    );
    expect((again.body as MatchView).version).toBe(afterFirst.version);
    expect((await events(id)).filter((e) => e.type === 'MOVE')).toHaveLength(1);
  });

  it('refuses moves meant for other games and members-only access', async () => {
    const { users, id } = await start(0);
    const view = await get(users[0], id);
    await request(t.server)
      .post(`/v1/matches/${id}/moves`)
      .set(users[0].auth)
      .send({ cell: 0, clientActionId: randomUUID(), expectedVersion: view.version })
      .expect(409);
    await request(t.server)
      .post(`/v1/matches/${id}/roll`)
      .set(users[0].auth)
      .send({ clientActionId: randomUUID(), expectedVersion: view.version })
      .expect(409);
    const stranger = await registerWithProfile(t);
    await request(t.server).get(`/v1/matches/${id}`).set(stranger.auth).expect(404);
    await move(stranger, id, 40, [33], view.version).expect(404);
  });

  it('plays a whole game to the end, records the result once, and follows every rule', async () => {
    const { users, id } = await start(0);
    const random = seeded(11);
    let view = await get(users[0], id);
    for (let i = 0; i < 1500 && view.status === 'ACTIVE'; i += 1) {
      resetActionBudget();
      const game = view.draughts;
      if (!game || game.toMove === null) break;
      const choices = game.moves;
      const capture = choices.some((m) => m.captures.length > 0);
      if (capture) expect(choices.every((m) => m.captures.length > 0)).toBe(true);
      const choice = choices[Math.floor(random() * choices.length)];
      if (!choice) throw new Error('no legal move');
      view = (
        await move(
          users[game.toMove === 0 ? 0 : 1],
          id,
          choice.from,
          choice.path,
          view.version,
        ).expect(200)
      ).body as MatchView;
    }
    expect(view.status).toBe('COMPLETED');
    expect(view.draughts?.phase).toBe('finished');
    expect(view.draughts?.winner).not.toBeNull();
    const results = await t.prisma.gameResult.findMany({
      where: { matchId: id },
      include: { players: true },
    });
    expect(results).toHaveLength(1);
    const scores = (results[0]?.players ?? []).map((p) => p.seat).sort();
    expect(scores).toEqual([0, 1]);
    // finishing again changes nothing
    await request(t.server).post(`/v1/matches/${id}/leave`).set(users[0].auth).expect(200);
    expect(await t.prisma.gameResult.count({ where: { matchId: id } })).toBe(1);
  }, 120_000);

  it('gives the game to the other player when the turn clock runs out', async () => {
    const { users, id } = await start(0);
    const match = await t.prisma.gameMatch.findUniqueOrThrow({ where: { id } });
    const late = new Date((match.deadlineAt as Date).getTime() + 1_000);
    expect(
      (match.deadlineAt as Date).getTime() - (match.startedAt as Date).getTime(),
    ).toBeLessThanOrEqual(DRAUGHTS_TURN_TIMER_MS);
    expect(await service().processDeadline(id, late)).toBe(true);
    const view = await get(users[0], id);
    expect(view).toMatchObject({ status: 'COMPLETED', endReason: 'timeout', winnerSeat: 1 });
    expect(view.draughts).toMatchObject({ phase: 'finished', winner: 1, endReason: 'timeout' });
    expect((await events(id)).map((e) => e.type)).toContain('TIMEOUT');
    expect(await service().processDeadline(id, late)).toBe(false);
    expect(await t.prisma.gameResult.count({ where: { matchId: id } })).toBe(1);
  });

  it('forfeits when a player leaves', async () => {
    const { users, id } = await start(0);
    await request(t.server).post(`/v1/matches/${id}/leave`).set(users[1].auth).expect(200);
    const view = await get(users[0], id);
    expect(view).toMatchObject({ status: 'COMPLETED', endReason: 'left', winnerSeat: 0 });
    // leaving twice changes nothing
    await request(t.server).post(`/v1/matches/${id}/leave`).set(users[1].auth).expect(200);
    expect(await t.prisma.gameResult.count({ where: { matchId: id } })).toBe(1);
  });

  it('forfeits a player who stays disconnected past the grace period', async () => {
    const { users, id } = await start(0);
    await service().runConnectionChecks(new Date(Date.now() + 1_000));
    await service().runConnectionChecks(new Date(Date.now() + 10 * 60_000));
    const view = await get(users[0], id);
    expect(view.status).toBe('COMPLETED');
    expect(view.endReason).toBe('disconnected');
  });

  it('makes one rematch when both ask, and the other seat opens it', async () => {
    const { users, id } = await start(0);
    await request(t.server).post(`/v1/matches/${id}/leave`).set(users[0].auth).expect(200);
    const first = (
      await request(t.server)
        .post(`/v1/matches/${id}/rematch`)
        .set(users[0].auth)
        .send({})
        .expect(200)
    ).body as MatchView;
    expect(first.rematchMatchId).toBeNull();
    const second = (
      await request(t.server)
        .post(`/v1/matches/${id}/rematch`)
        .set(users[1].auth)
        .send({})
        .expect(200)
    ).body as MatchView;
    expect(second.rematchMatchId).not.toBeNull();
    const again = (
      await request(t.server)
        .post(`/v1/matches/${id}/rematch`)
        .set(users[1].auth)
        .send({})
        .expect(200)
    ).body as MatchView;
    expect(again.rematchMatchId).toBe(second.rematchMatchId);
    const created = await t.prisma.gameMatch.findUniqueOrThrow({
      where: { id: second.rematchMatchId as string },
    });
    expect(created).toMatchObject({ gameId: 'draughts', openingSeat: 1 });
  });

  describe('against a bot', () => {
    it('starts a labelled bot game, and the bot answers through the same validator', async () => {
      const me = await registerWithProfile(t);
      const started = (
        await request(t.server)
          .post('/v1/matches/bot')
          .set(me.auth)
          .send({ gameId: 'draughts', level: 'medium' })
          .expect(201)
      ).body as MatchView;
      expect(started.gameId).toBe('draughts');
      expect(started.players[1]).toMatchObject({ username: 'Bot', bot: 'medium', userId: null });
      await ready(me, started.id).expect(200);

      for (let i = 0; i < 6; i += 1) {
        resetActionBudget();
        let view = await get(me, started.id);
        if (view.status !== 'ACTIVE') break;
        if (view.draughts?.toMove === view.mySeat) {
          const choice = view.draughts.moves[0];
          if (!choice) throw new Error('no legal move');
          view = (await move(me, started.id, choice.from, choice.path, view.version).expect(200))
            .body as MatchView;
        }
        const plies = view.draughts?.plies ?? 0;
        await service().runBotMoves(new Date(Date.now() + 5_000));
        const after = await get(me, started.id);
        if (after.status === 'ACTIVE' && view.draughts?.toMove !== view.mySeat) {
          expect(after.draughts?.plies).toBeGreaterThan(plies);
        }
      }
      const logged = (await events(started.id)).filter((e) => e.type === 'MOVE' && e.seat === 1);
      expect(logged.length).toBeGreaterThan(0);
    });

    it('is two players only', async () => {
      const me = await registerWithProfile(t);
      await request(t.server)
        .post('/v1/matches/bot')
        .set(me.auth)
        .send({ gameId: 'draughts', level: 'easy', players: 3 })
        .expect(400);
    });
  });
});
