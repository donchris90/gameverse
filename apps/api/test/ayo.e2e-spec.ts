import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AYO_TURN_TIMER_MS, type AyoState } from '@gameverse/game-rules';
import type { MatchView } from '@gameverse/shared-types';
import type { Prisma } from '../src/generated/prisma/client.js';
import { MatchesService } from '../src/matches/matches.service.js';
import { registerWithProfile, type SocialUser } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

describe('ayo matches', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    // Ayo ships disabled until the owner has played it on a phone; the tests exercise the server.
    await t.prisma.game.update({ where: { id: 'ayo' }, data: { enabled: true } });
  });
  afterAll(async () => {
    await t.prisma.game.update({ where: { id: 'ayo' }, data: { enabled: false } });
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
    pit: number,
    expectedVersion: number,
    clientActionId = randomUUID(),
  ) =>
    request(t.server)
      .post(`/v1/matches/${id}/ayo-moves`)
      .set(user.auth)
      .send({ pit, clientActionId, expectedVersion });
  const endGame = (
    user: SocialUser,
    id: string,
    action: 'offer' | 'accept' | 'decline',
    expectedVersion: number,
    clientActionId = randomUUID(),
  ) =>
    request(t.server)
      .post(`/v1/matches/${id}/ayo-end`)
      .set(user.auth)
      .send({ action, clientActionId, expectedVersion });
  const events = (id: string) =>
    t.prisma.gameEvent.findMany({ where: { matchId: id }, orderBy: { seq: 'asc' } });
  const resetActionBudget = () =>
    (service() as unknown as { limiter: { hits: Map<string, number[]> } }).limiter.hits.clear();
  const total = (view: MatchView) =>
    (view.ayo?.pits.reduce((a, b) => a + b, 0) ?? 0) +
    (view.ayo?.stores[0] ?? 0) +
    (view.ayo?.stores[1] ?? 0);

  async function start(openingSeat: 0 | 1 = 0) {
    const a = await registerWithProfile(t);
    const b = await registerWithProfile(t);
    const id = await service().createMatch({
      gameId: 'ayo',
      kind: 'PRIVATE',
      seats: [{ userId: a.id }, { userId: b.id }],
      openingSeat,
    });
    await ready(a, id).expect(200);
    await ready(b, id).expect(200);
    return { users: [a, b] as const, id };
  }

  /** Puts the match into a chosen position (the rules decide everything after that). */
  async function setState(
    id: string,
    over: Partial<Omit<AyoState, 'pits'>> & { pits?: Record<number, number> },
  ) {
    const match = await t.prisma.gameMatch.findUniqueOrThrow({ where: { id } });
    const current = match.state as unknown as AyoState;
    const { pits, ...rest } = over;
    const next: AyoState = {
      ...current,
      ...rest,
      pits: pits ? Array.from({ length: 12 }, (_unused, pit) => pits[pit] ?? 0) : current.pits,
    };
    await t.prisma.gameMatch.update({
      where: { id },
      data: { state: next as unknown as Prisma.InputJsonValue },
    });
  }

  it('is added switched off by the migration', async () => {
    await t.prisma.game.update({ where: { id: 'ayo' }, data: { enabled: false } });
    try {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      await expect(
        service().createMatch({
          gameId: 'ayo',
          kind: 'PRIVATE',
          seats: [{ userId: a.id }, { userId: b.id }],
        }),
      ).rejects.toMatchObject({ status: 404 });
      const row = await t.prisma.game.findUnique({ where: { id: 'ayo' } });
      expect(row).toMatchObject({ name: 'Ayo', minPlayers: 2, maxPlayers: 2 });
    } finally {
      await t.prisma.game.update({ where: { id: 'ayo' }, data: { enabled: true } });
    }
  });

  it('starts with the opener on turn, 48 seeds and the server-computed pits to lift', async () => {
    const { users, id } = await start(1);
    const view = await get(users[0], id);
    expect(view.status).toBe('ACTIVE');
    expect(view.ayo).toMatchObject({ phase: 'playing', toMove: 1, round: 1, canOfferEnd: false });
    expect(view.ayo?.moves).toEqual([6, 7, 8, 9, 10, 11]);
    expect(view.ayo?.pits).toEqual(Array(12).fill(4));
    expect(total(view)).toBe(48);
    expect(view.series).toBeNull();
    expect(view.draughts).toBeNull();
    expect(view.deadline).not.toBeNull();
  });

  it('plays a turn for the seat on turn, with the sowing steps, and passes the turn', async () => {
    const { users, id } = await start(0);
    const view = await get(users[0], id);
    const after = (await move(users[0], id, 0, view.version).expect(200)).body as MatchView;
    expect(after.ayo?.pits).toEqual([2, 7, 1, 6, 1, 6, 6, 6, 0, 1, 6, 6]);
    expect(after.ayo?.toMove).toBe(1);
    expect(after.ayo?.last).toMatchObject({ seat: 0, pit: 0 });
    expect(after.ayo?.last?.steps[0]).toEqual({ k: 'lift', pit: 0, count: 4 });
    expect(total(after)).toBe(48);
    const logged = (await events(id)).filter((e) => e.type === 'MOVE');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ seat: 0 });
  });

  it('refuses illegal, out-of-turn, stale and malformed moves and leaves the match untouched', async () => {
    const { users, id } = await start(0);
    const view = await get(users[0], id);

    const foreign = await move(users[0], id, 7, view.version).expect(409);
    expect(foreign.body).toMatchObject({ error: { code: 'INVALID_MOVE' } });
    const early = await move(users[1], id, 6, view.version).expect(409);
    expect(early.body).toMatchObject({ error: { code: 'NOT_YOUR_TURN' } });
    const stale = await move(users[0], id, 0, view.version + 5).expect(409);
    expect(stale.body).toMatchObject({ error: { code: 'STALE_MATCH_VERSION' } });
    await request(t.server)
      .post(`/v1/matches/${id}/ayo-moves`)
      .set(users[0].auth)
      .send({
        pit: 0,
        stores: [48, 0],
        clientActionId: randomUUID(),
        expectedVersion: view.version,
      })
      .expect(400);
    await move(users[0], id, 12, view.version).expect(400);
    await move(users[0], id, -1, view.version).expect(400);

    const unchanged = await get(users[0], id);
    expect(unchanged.version).toBe(view.version);
    expect(unchanged.ayo?.plies).toBe(0);
  });

  it('applies a retried move once and acknowledges the retry', async () => {
    const { users, id } = await start(0);
    const view = await get(users[0], id);
    const actionId = randomUUID();
    await move(users[0], id, 2, view.version, actionId).expect(200);
    const afterFirst = await get(users[0], id);
    const again = await move(users[0], id, 2, view.version, actionId).expect(200);
    expect((again.body as MatchView).version).toBe(afterFirst.version);
    expect((await events(id)).filter((e) => e.type === 'MOVE')).toHaveLength(1);
  });

  it('refuses moves meant for other games and access by strangers', async () => {
    const { users, id } = await start(0);
    const view = await get(users[0], id);
    await request(t.server)
      .post(`/v1/matches/${id}/moves`)
      .set(users[0].auth)
      .send({ cell: 0, clientActionId: randomUUID(), expectedVersion: view.version })
      .expect(409);
    await request(t.server)
      .post(`/v1/matches/${id}/draughts-moves`)
      .set(users[0].auth)
      .send({ from: 40, path: [33], clientActionId: randomUUID(), expectedVersion: view.version })
      .expect(409);
    const stranger = await registerWithProfile(t);
    await request(t.server).get(`/v1/matches/${id}`).set(stranger.auth).expect(404);
    await move(stranger, id, 0, view.version).expect(404);
  });

  it('plays many turns in a row with the seeds always adding up to 48', async () => {
    const { users, id } = await start(0);
    let view = await get(users[0], id);
    let seed = 7;
    for (let i = 0; i < 40 && view.status === 'ACTIVE'; i += 1) {
      resetActionBudget();
      const ayo = view.ayo;
      if (!ayo || ayo.toMove === null) break;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const pit = ayo.moves[seed % ayo.moves.length] as number;
      view = (await move(users[ayo.toMove === 0 ? 0 : 1], id, pit, view.version).expect(200))
        .body as MatchView;
      expect(total(view)).toBe(48);
    }
    expect(view.ayo?.plies).toBeGreaterThan(5);
  });

  it('ends a round when the last eight seeds are reaped, then starts the next', async () => {
    const { users, id } = await start(0);
    await setState(id, { pits: { 0: 1, 1: 3, 6: 4 }, stores: [18, 22] });
    const view = await get(users[0], id);
    const after = (await move(users[0], id, 0, view.version).expect(200)).body as MatchView;
    expect(after.status).toBe('ACTIVE');
    expect(after.ayo).toMatchObject({
      round: 2,
      toMove: 1,
      lastRound: { round: 1, winner: 0, took: 8 },
      stores: [2, 2],
    });
    expect(after.ayo?.alive.filter(Boolean)).toHaveLength(11); // six pits and five pits
    expect(total(after)).toBe(48);
    const types = (await events(id)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['ROUND_ENDED', 'ROUND_STARTED']));
  });

  it('ends the match when a player can fill only one pit, and records the result once', async () => {
    const { users, id } = await start(0);
    await setState(id, { pits: { 0: 1, 1: 3, 6: 4 }, stores: [38, 2] });
    const view = await get(users[0], id);
    const after = (await move(users[0], id, 0, view.version).expect(200)).body as MatchView;
    expect(after).toMatchObject({ status: 'COMPLETED', endReason: 'score', winnerSeat: 0 });
    expect(after.ayo).toMatchObject({ phase: 'finished', winner: 0, endReason: 'one_pit' });
    const results = await t.prisma.gameResult.findMany({
      where: { matchId: id },
      include: { players: true },
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.players.map((p) => p.seat).sort()).toEqual([0, 1]);
    // finishing again changes nothing
    await request(t.server).post(`/v1/matches/${id}/leave`).set(users[0].auth).expect(200);
    expect(await t.prisma.gameResult.count({ where: { matchId: id } })).toBe(1);
  });

  describe('ending by agreement', () => {
    async function twoPits() {
      const { users, id } = await start(0);
      const alive = Array.from({ length: 12 }, (_unused, pit) => pit < 8);
      await setState(id, {
        alive,
        pits: { 0: 4, 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4, 7: 4 },
        stores: [16, 0],
      });
      return { users, id };
    }

    it('is refused while nobody has exactly two pits', async () => {
      const { users, id } = await start(0);
      const view = await get(users[0], id);
      const refused = await endGame(users[0], id, 'offer', view.version).expect(409);
      expect(refused.body).toMatchObject({ error: { code: 'INVALID_STATE' } });
    });

    it('needs the other player to accept, then the bigger total wins', async () => {
      const { users, id } = await twoPits();
      let view = await get(users[0], id);
      expect(view.ayo?.canOfferEnd).toBe(true);
      view = (await endGame(users[1], id, 'offer', view.version).expect(200)).body as MatchView;
      expect(view.ayo?.endOffer).toBe(1);
      // the offerer cannot accept their own offer
      await endGame(users[1], id, 'accept', view.version).expect(409);
      view = (await endGame(users[0], id, 'accept', view.version).expect(200)).body as MatchView;
      expect(view).toMatchObject({ status: 'COMPLETED', endReason: 'agreement', winnerSeat: 0 });
      expect(view.ayo).toMatchObject({ phase: 'finished', endReason: 'agreement' });
      expect(await t.prisma.gameResult.count({ where: { matchId: id } })).toBe(1);
    });

    it('can be declined, and playing on counts as declining', async () => {
      const { users, id } = await twoPits();
      let view = await get(users[0], id);
      view = (await endGame(users[1], id, 'offer', view.version).expect(200)).body as MatchView;
      view = (await endGame(users[0], id, 'decline', view.version).expect(200)).body as MatchView;
      expect(view.ayo?.endOffer).toBeNull();
      expect(view.status).toBe('ACTIVE');
      view = (await endGame(users[1], id, 'offer', view.version).expect(200)).body as MatchView;
      const pit = view.ayo?.moves[0] as number;
      view = (await move(users[0], id, pit, view.version).expect(200)).body as MatchView;
      expect(view.ayo?.endOffer).toBeNull();
      expect(view.status).toBe('ACTIVE');
    });

    it('does not let a bot agree: offering to a bot is refused', async () => {
      const me = await registerWithProfile(t);
      const started = (
        await request(t.server)
          .post('/v1/matches/bot')
          .set(me.auth)
          .send({ gameId: 'ayo', level: 'easy' })
          .expect(201)
      ).body as MatchView;
      await ready(me, started.id).expect(200);
      const alive = Array.from({ length: 12 }, (_unused, pit) => pit < 8);
      await setState(started.id, {
        alive,
        pits: { 0: 4, 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4, 7: 4 },
        stores: [16, 0],
      });
      const view = await get(me, started.id);
      await endGame(me, started.id, 'offer', view.version).expect(409);
    });
  });

  it('gives the match to the other player when the turn clock runs out', async () => {
    const { users, id } = await start(0);
    const match = await t.prisma.gameMatch.findUniqueOrThrow({ where: { id } });
    const late = new Date((match.deadlineAt as Date).getTime() + 1_000);
    expect(
      (match.deadlineAt as Date).getTime() - (match.startedAt as Date).getTime(),
    ).toBeLessThanOrEqual(AYO_TURN_TIMER_MS);
    expect(await service().processDeadline(id, late)).toBe(true);
    const view = await get(users[0], id);
    expect(view).toMatchObject({ status: 'COMPLETED', endReason: 'timeout', winnerSeat: 1 });
    expect((await events(id)).map((e) => e.type)).toContain('TIMEOUT');
    expect(await service().processDeadline(id, late)).toBe(false);
    expect(await t.prisma.gameResult.count({ where: { matchId: id } })).toBe(1);
  });

  it('forfeits when a player leaves, and when one stays disconnected', async () => {
    const left = await start(0);
    await request(t.server)
      .post(`/v1/matches/${left.id}/leave`)
      .set(left.users[1].auth)
      .expect(200);
    expect(await get(left.users[0], left.id)).toMatchObject({
      status: 'COMPLETED',
      endReason: 'left',
      winnerSeat: 0,
    });
    await request(t.server)
      .post(`/v1/matches/${left.id}/leave`)
      .set(left.users[1].auth)
      .expect(200);
    expect(await t.prisma.gameResult.count({ where: { matchId: left.id } })).toBe(1);

    const gone = await start(0);
    await service().runConnectionChecks(new Date(Date.now() + 1_000));
    await service().runConnectionChecks(new Date(Date.now() + 10 * 60_000));
    const view = await get(gone.users[0], gone.id);
    expect(view.status).toBe('COMPLETED');
    expect(view.endReason).toBe('disconnected');
  });

  it('makes one rematch when both ask, and the other seat opens it', async () => {
    const { users, id } = await start(0);
    await request(t.server).post(`/v1/matches/${id}/leave`).set(users[0].auth).expect(200);
    const rematch = (user: SocialUser) =>
      request(t.server).post(`/v1/matches/${id}/rematch`).set(user.auth).send({}).expect(200);
    expect(((await rematch(users[0])).body as MatchView).rematchMatchId).toBeNull();
    const second = (await rematch(users[1])).body as MatchView;
    expect(second.rematchMatchId).not.toBeNull();
    expect(((await rematch(users[1])).body as MatchView).rematchMatchId).toBe(
      second.rematchMatchId,
    );
    const created = await t.prisma.gameMatch.findUniqueOrThrow({
      where: { id: second.rematchMatchId as string },
    });
    expect(created).toMatchObject({ gameId: 'ayo', openingSeat: 1 });
  });

  describe('against a bot', () => {
    it('starts a labelled bot game, and the bot answers through the same validator', async () => {
      const me = await registerWithProfile(t);
      const started = (
        await request(t.server)
          .post('/v1/matches/bot')
          .set(me.auth)
          .send({ gameId: 'ayo', level: 'medium' })
          .expect(201)
      ).body as MatchView;
      expect(started.gameId).toBe('ayo');
      expect(started.players[1]).toMatchObject({ username: 'Bot', bot: 'medium', userId: null });
      await ready(me, started.id).expect(200);

      for (let i = 0; i < 6; i += 1) {
        resetActionBudget();
        let view = await get(me, started.id);
        if (view.status !== 'ACTIVE') break;
        if (view.ayo?.toMove === view.mySeat) {
          const pit = view.ayo.moves[0] as number;
          view = (await move(me, started.id, pit, view.version).expect(200)).body as MatchView;
        }
        const plies = view.ayo?.plies ?? 0;
        await service().runBotMoves(new Date(Date.now() + 5_000));
        const after = await get(me, started.id);
        if (after.status === 'ACTIVE' && view.ayo?.toMove !== view.mySeat) {
          expect(after.ayo?.plies).toBeGreaterThan(plies);
        }
        expect(total(after)).toBe(48);
      }
      const logged = (await events(started.id)).filter((e) => e.type === 'MOVE' && e.seat === 1);
      expect(logged.length).toBeGreaterThan(0);
    });

    it('is two players only', async () => {
      const me = await registerWithProfile(t);
      await request(t.server)
        .post('/v1/matches/bot')
        .set(me.auth)
        .send({ gameId: 'ayo', level: 'easy', players: 3 })
        .expect(400);
    });
  });
});
