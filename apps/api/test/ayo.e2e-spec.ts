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
  const decide = (
    user: SocialUser,
    id: string,
    quit: boolean,
    expectedVersion: number,
    clientActionId = randomUUID(),
  ) =>
    request(t.server)
      .post(`/v1/matches/${id}/ayo-decision`)
      .set(user.auth)
      .send({ quit, clientActionId, expectedVersion });
  const events = (id: string) =>
    t.prisma.gameEvent.findMany({ where: { matchId: id }, orderBy: { seq: 'asc' } });
  const resetActionBudget = () =>
    (service() as unknown as { limiter: { hits: Map<string, number[]> } }).limiter.hits.clear();
  const total = (view: MatchView) =>
    (view.ayo?.pits.reduce((a, b) => a + b, 0) ?? 0) +
    (view.ayo?.packed[0] ?? 0) +
    (view.ayo?.packed[1] ?? 0);

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
    expect(view.ayo).toMatchObject({ phase: 'playing', toMove: 1, round: 1, decision: null });
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
    expect(after.ayo?.last?.before.pits).toEqual(Array(12).fill(4));
    expect(after.ayo?.last?.animMs).toBeGreaterThan(1000);
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

  it('starts the next turn clock only after the move has been replayed', async () => {
    const { users, id } = await start(0);
    const view = await get(users[0], id);
    const after = (await move(users[0], id, 0, view.version).expect(200)).body as MatchView;
    const animMs = after.ayo?.last?.animMs ?? 0;
    expect(animMs).toBeGreaterThan(0);
    const wait = Date.parse(after.deadline?.at ?? '') - Date.parse(after.serverTime);
    expect(wait).toBeGreaterThanOrEqual(animMs + AYO_TURN_TIMER_MS - 1_500);
    expect(wait).toBeLessThanOrEqual(animMs + AYO_TURN_TIMER_MS + 1_500);
  });

  it('ends a round when four seeds are left, gives them to the last packer and starts the next', async () => {
    const { users, id } = await start(0);
    await setState(id, {
      pits: { 2: 1, 7: 1, 8: 1, 9: 1 },
      packed: [24, 20],
      lastPacker: 1,
    });
    const view = await get(users[0], id);
    const after = (await move(users[0], id, 2, view.version).expect(200)).body as MatchView;
    expect(after.status).toBe('ACTIVE');
    expect(after.ayo).toMatchObject({
      round: 2,
      toMove: 1,
      starter: 1,
      decision: null,
      lastRound: { round: 1, packed: [24, 24], pits: [6, 6], finalTo: 1 },
      packed: [0, 0],
    });
    expect(after.ayo?.pits).toEqual(Array(12).fill(4));
    expect(after.ayo?.last?.steps.map((step) => step.k)).toEqual([
      'lift',
      'drop',
      'final',
      'round',
    ]);
    expect(total(after)).toBe(48);
    const types = (await events(id)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['ROUND_ENDED', 'ROUND_STARTED']));
  });

  it('gives the next round 7 pits to the player who packed 28 and 5 to the other', async () => {
    const { users, id } = await start(0);
    await setState(id, {
      pits: { 2: 1, 7: 1, 8: 1, 9: 1 },
      packed: [24, 20],
      lastPacker: 0,
    });
    const view = await get(users[0], id);
    const after = (await move(users[0], id, 2, view.version).expect(200)).body as MatchView;
    expect(after.ayo?.lastRound?.pits).toEqual([7, 5]);
    expect(after.ayo?.owners.filter((owner) => owner === 0)).toHaveLength(7);
    expect(after.ayo?.moves).toEqual([7, 8, 9, 10, 11]); // seat 1 starts round 2 with 5 pits
  });

  it('ends the match when a player has no pit left, and records the result once', async () => {
    const { users, id } = await start(0);
    await setState(id, { pits: { 2: 1, 7: 1, 8: 1, 9: 1 }, packed: [0, 44], lastPacker: 1 });
    const view = await get(users[0], id);
    const after = (await move(users[0], id, 2, view.version).expect(200)).body as MatchView;
    expect(after).toMatchObject({ status: 'COMPLETED', endReason: 'score', winnerSeat: 1 });
    expect(after.ayo).toMatchObject({ phase: 'finished', winner: 1, endReason: 'no_pits' });
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

  describe('one pit left: quit or continue', () => {
    /** Seat 0 packs its last pit of four; it starts round 2 (as the loser of the toss) with one pit. */
    async function onePit() {
      const { users, id } = await start(0);
      await setState(id, { pits: { 2: 1, 7: 1, 8: 1, 9: 1 }, packed: [4, 40], lastPacker: 1 });
      const view = await get(users[0], id);
      const after = (await move(users[0], id, 2, view.version).expect(200)).body as MatchView;
      return { users, id, after };
    }

    it('waits for the player with one pit, and nobody can move meanwhile', async () => {
      const { users, id, after } = await onePit();
      expect(after.ayo).toMatchObject({ round: 2, decision: 0, moves: [] });
      const mover = users[after.ayo?.toMove === 0 ? 0 : 1];
      const refused = await move(
        mover,
        id,
        after.ayo?.owners.indexOf(after.ayo.toMove ?? 0) ?? 0,
        after.version,
      ).expect(409);
      expect(refused.body).toMatchObject({ error: { code: 'INVALID_STATE' } });
      // only the player who has to choose may answer
      await decide(users[1], id, false, after.version).expect(409);
    });

    it('continues: the round is played on', async () => {
      const { users, id, after } = await onePit();
      const view = (await decide(users[0], id, false, after.version).expect(200)).body as MatchView;
      expect(view.status).toBe('ACTIVE');
      expect(view.ayo?.decision).toBeNull();
      expect(view.ayo?.moves.length).toBeGreaterThan(0);
      expect((await events(id)).map((e) => e.type)).toContain('CONTINUED');
    });

    it('quits: the player loses and the other wins', async () => {
      const { users, id, after } = await onePit();
      const view = (await decide(users[0], id, true, after.version).expect(200)).body as MatchView;
      expect(view).toMatchObject({ status: 'COMPLETED', winnerSeat: 1 });
      expect(view.ayo).toMatchObject({ phase: 'finished', endReason: 'quit' });
      expect(await t.prisma.gameResult.count({ where: { matchId: id } })).toBe(1);
    });

    it('is continued for the player when their 30 seconds run out', async () => {
      const { id } = await onePit();
      const match = await t.prisma.gameMatch.findUniqueOrThrow({ where: { id } });
      const late = new Date((match.deadlineAt as Date).getTime() + 1_000);
      expect(await service().processDeadline(id, late)).toBe(true);
      const state = (await t.prisma.gameMatch.findUniqueOrThrow({ where: { id } }))
        .state as unknown as AyoState;
      expect(state.decision).toBeNull();
      expect(state.phase).toBe('playing');
      expect(state.autoPlays[0]).toBe(1);
    });
  });

  it('plays for a player whose clock runs out, and forfeits them after three in a row', async () => {
    const { users, id } = await start(0);
    const pastDeadline = async () => {
      const match = await t.prisma.gameMatch.findUniqueOrThrow({ where: { id } });
      return new Date((match.deadlineAt as Date).getTime() + 1_000);
    };
    for (let round = 1; round <= 2; round += 1) {
      expect(await service().processDeadline(id, await pastDeadline())).toBe(true);
      let view = await get(users[0], id);
      expect(view.status).toBe('ACTIVE');
      expect(view.ayo?.plies).toBe(round * 2 - 1);
      expect(view.ayo?.toMove).toBe(1);
      resetActionBudget();
      view = (await move(users[1], id, view.ayo?.moves[0] as number, view.version).expect(200))
        .body as MatchView;
    }
    const lastLate = await pastDeadline();
    expect(await service().processDeadline(id, lastLate)).toBe(true);
    const view = await get(users[0], id);
    expect(view).toMatchObject({ status: 'COMPLETED', endReason: 'timeout', winnerSeat: 1 });
    expect((await events(id)).map((e) => e.type)).toEqual(
      expect.arrayContaining(['TIMEOUT', 'AUTO_PLAYED']),
    );
    expect(await service().processDeadline(id, lastLate)).toBe(false);
    expect(await t.prisma.gameResult.count({ where: { matchId: id } })).toBe(1);
  });

  it('clears the run of automatic plays when the player moves for real', async () => {
    const { users, id } = await start(0);
    const match = await t.prisma.gameMatch.findUniqueOrThrow({ where: { id } });
    await service().processDeadline(id, new Date((match.deadlineAt as Date).getTime() + 1_000));
    let view = await get(users[0], id);
    view = (await move(users[1], id, view.ayo?.moves[0] as number, view.version).expect(200))
      .body as MatchView;
    resetActionBudget();
    view = (await move(users[0], id, view.ayo?.moves[0] as number, view.version).expect(200))
      .body as MatchView;
    const state = (await t.prisma.gameMatch.findUniqueOrThrow({ where: { id } }))
      .state as unknown as AyoState;
    expect(state.autoPlays).toEqual([0, 0]);
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

  it('gives a disconnected Ayo player a full minute to come back', async () => {
    const { users, id } = await start(0);
    const t0 = Date.now() + 1_000;
    await service().runConnectionChecks(new Date(t0)); // both phones are offline: the clock starts
    await service().runConnectionChecks(new Date(t0 + 45_000));
    expect((await get(users[0], id)).status).toBe('ACTIVE');
    const view = await get(users[0], id);
    expect(view.players[0]?.reconnectBy).not.toBeNull();
    await service().runConnectionChecks(new Date(t0 + 61_000));
    expect((await get(users[0], id)).status).toBe('COMPLETED');
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
        await service().runBotMoves(new Date(Date.now() + 60_000));
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
