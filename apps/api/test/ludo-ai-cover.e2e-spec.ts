import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LUDO_AI_COVER_MAX_TURNS, LUDO_TURN_TIMER_MS } from '@gameverse/game-rules';
import { ErrorCode, type MatchView } from '@gameverse/shared-types';
import { BOT_THINK_MS } from '../src/matches/matches.constants.js';
import { MatchesService } from '../src/matches/matches.service.js';
import { registerWithProfile, type SocialUser } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

const FEE = 100;

describe('ludo AI cover and pots', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    await t.prisma.game.update({ where: { id: 'ludo' }, data: { enabled: true } });
  });
  afterAll(async () => {
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
  const resume = (user: SocialUser, id: string, expectedVersion: number, actionId = randomUUID()) =>
    request(t.server)
      .post(`/v1/matches/${id}/resume`)
      .set(user.auth)
      .send({ clientActionId: actionId, expectedVersion });
  const roll = (user: SocialUser, id: string, expectedVersion: number) =>
    request(t.server)
      .post(`/v1/matches/${id}/roll`)
      .set(user.auth)
      .send({ clientActionId: randomUUID(), expectedVersion });
  const balance = async (user: SocialUser) =>
    (await t.prisma.coinWallet.findUnique({ where: { userId: user.id } }))?.balance ?? 0;
  const resetActionBudget = () =>
    (service() as unknown as { limiter: { hits: Map<string, number[]> } }).limiter.hits.clear();

  let clock = 0;
  const tick = (ms: number) => {
    clock = Math.max(clock, Date.now()) + ms;
    return new Date(clock);
  };

  async function start(count: 2 | 3 | 4, entryFee = 0) {
    const users: SocialUser[] = [];
    for (let i = 0; i < count; i += 1) users.push(await registerWithProfile(t));
    const id = await service().createMatch({
      gameId: 'ludo',
      kind: 'PRIVATE',
      seats: users.map((user) => ({ userId: user.id })),
      openingSeat: 0,
      entryFee,
    });
    for (const user of users) await ready(user, id).expect(200);
    return { users, id };
  }

  /** Whoever is on turn does one step: roll, or move the first legal token. */
  async function step(users: SocialUser[], id: string): Promise<MatchView> {
    resetActionBudget();
    const view = await get(users[0] as SocialUser, id);
    const ludo = view.ludo;
    if (!ludo || ludo.toMove === null) return view;
    const user = users[ludo.toMove] as SocialUser;
    if (ludo.phase === 'roll') return (await roll(user, id, view.version).expect(200)).body;
    const choice = ludo.moves[0];
    if (!choice) throw new Error('a move phase with no legal moves');
    return (
      await request(t.server)
        .post(`/v1/matches/${id}/token-moves`)
        .set(user.auth)
        .send({ token: choice.token, clientActionId: randomUUID(), expectedVersion: view.version })
        .expect(200)
    ).body as MatchView;
  }

  it('starts AI cover for a player who misses their turn and labels it in the view', async () => {
    const { users, id } = await start(2);
    expect(await service().runDueTimers(tick(LUDO_TURN_TIMER_MS + 1))).toBe(1);
    const view = await get(users[1] as SocialUser, id);
    expect(view.ludo?.ai).toEqual([true, false]);
    expect(view.players[0]?.out).toBe(false);
    expect(await t.prisma.gameMatch.findUnique({ where: { id } })).toMatchObject({ aiCover: true });
    const types = (await t.prisma.gameEvent.findMany({ where: { matchId: id } })).map(
      (e) => e.type,
    );
    expect(types).toContain('AI_COVER_STARTED');
  });

  it('lets the bot sweeper play the covered seat through the same rules, after the think time', async () => {
    const { users, id } = await start(2);
    await service().runDueTimers(tick(LUDO_TURN_TIMER_MS + 1));
    // After seat 0's covered turn it is usually seat 1's turn (an extra roll keeps it with seat 0).
    // The sweeper must never play for a human who is not covered.
    const before = await get(users[1] as SocialUser, id);
    if (before.ludo?.toMove === 1) {
      expect(await service().runBotMoves(tick(BOT_THINK_MS + 1))).toBe(0);
      expect((await get(users[1] as SocialUser, id)).version).toBe(before.version);
    }

    // Give the turn back to the covered seat by playing seat 1 until it passes.
    let view = before;
    for (let i = 0; i < 40 && view.ludo?.toMove !== 0; i += 1) {
      view = await step(users, id);
    }
    expect(view.ludo?.toMove).toBe(0);
    const versionBefore = view.version;
    const turnStart = new Date(view.deadline?.at ?? Date.now()).getTime() - LUDO_TURN_TIMER_MS;
    expect(await service().runBotMoves(new Date(turnStart + BOT_THINK_MS + 1))).toBe(1);
    const after = await get(users[1] as SocialUser, id);
    expect(after.version).toBeGreaterThan(versionBefore);
    expect(after.ludo?.ai[0]).toBe(true);
  });

  it('ends cover when the player rolls themselves', async () => {
    const { users, id } = await start(2);
    await service().runDueTimers(tick(LUDO_TURN_TIMER_MS + 1));
    let view = await get(users[0] as SocialUser, id);
    for (let i = 0; i < 40 && view.ludo?.toMove !== 0; i += 1) view = await step(users, id);
    resetActionBudget();
    const res = await roll(users[0] as SocialUser, id, view.version).expect(200);
    expect((res.body as MatchView).ludo?.ai).toEqual([false, false]);
    expect(await t.prisma.gameMatch.findUnique({ where: { id } })).toMatchObject({
      aiCover: false,
    });
  });

  it('takes control back on request, acknowledges a retry once, and refuses when not covered', async () => {
    const { users, id } = await start(2);
    await service().runDueTimers(tick(LUDO_TURN_TIMER_MS + 1));
    const covered = await get(users[0] as SocialUser, id);
    expect(covered.ludo?.ai[0]).toBe(true);

    const actionId = randomUUID();
    const first = await resume(users[0] as SocialUser, id, covered.version, actionId).expect(200);
    expect((first.body as MatchView).ludo?.ai).toEqual([false, false]);
    const versionAfter = (first.body as MatchView).version;
    // The same action id again is acknowledged, not applied twice.
    const retry = await resume(users[0] as SocialUser, id, covered.version, actionId).expect(200);
    expect((retry.body as MatchView).version).toBe(versionAfter);

    // No longer covered: a fresh resume is refused.
    const refused = await resume(users[0] as SocialUser, id, versionAfter).expect(409);
    expect((refused.body as { error?: { code?: string } }).error?.code).toBe(
      ErrorCode.INVALID_STATE,
    );
    const types = (await t.prisma.gameEvent.findMany({ where: { matchId: id } })).map(
      (e) => e.type,
    );
    expect(types.filter((x) => x === 'AI_COVER_ENDED')).toHaveLength(1);
  });

  it('refuses resume from someone who is not seated, and without a login', async () => {
    const { users, id } = await start(2);
    const stranger = await registerWithProfile(t);
    const view = await get(users[0] as SocialUser, id);
    await resume(stranger, id, view.version).expect(404);
    await request(t.server)
      .post(`/v1/matches/${id}/resume`)
      .send({ clientActionId: randomUUID(), expectedVersion: view.version })
      .expect(401);
  });

  it('removes a seat the AI has played for more than the cap, without ending the match', async () => {
    const { users, id } = await start(3);
    for (let i = 0; i < LUDO_AI_COVER_MAX_TURNS * 8; i += 1) {
      await service().runDueTimers(tick(LUDO_TURN_TIMER_MS + 1));
      const view = await get(users[1] as SocialUser, id);
      if (view.status !== 'ACTIVE' || (view.ludo?.removed.length ?? 0) > 0) break;
    }
    const view = await get(users[1] as SocialUser, id);
    if (view.status === 'ACTIVE') {
      expect(view.ludo?.removed.length).toBeGreaterThan(0);
      const out = view.ludo?.removed[0] as number;
      expect(view.players[out]?.out).toBe(true);
    } else {
      expect(['COMPLETED']).toContain(view.status);
    }
  }, 120_000);

  describe('pots', () => {
    it('gives a two-player pot to the winner and nothing to the seat that left', async () => {
      const { users, id } = await start(2, FEE);
      const [a, b] = users as [SocialUser, SocialUser];
      const startA = await balance(a);
      const startB = await balance(b);
      await request(t.server).post(`/v1/matches/${id}/leave`).set(b.auth).send({}).expect(200);
      // The entry fees were taken before these balances were read, so the winner gains both.
      expect(await balance(a)).toBe(startA + FEE * 2);
      expect(await balance(b)).toBe(startB);
      const view = await get(a, id);
      expect(view.status).toBe('COMPLETED');
      expect(view.payout).toBe(FEE * 2);
      expect((await get(b, id)).payout).toBe(0);
    });

    it('splits a four-player pot two thirds to first and one third to second, once', async () => {
      const { users, id } = await start(4, FEE);
      const before = await Promise.all(users.map(balance));
      let view = await get(users[0] as SocialUser, id);
      for (let i = 0; i < 4_000 && view.status === 'ACTIVE'; i += 1) view = await step(users, id);
      expect(view.status).toBe('COMPLETED');
      const placings = view.ludo?.placings ?? [];
      const pot = FEE * 4;
      const first = Math.floor((pot * 2) / 3);
      const after = await Promise.all(users.map(balance));
      const net = after.map((value, seat) => value - (before[seat] ?? 0));
      expect(net[placings[0] as number]).toBe(first);
      expect(net[placings[1] as number]).toBe(pot - first);
      expect(net[placings[2] as number]).toBe(0);
      expect(net[placings[3] as number]).toBe(0);
      // Entry fees were already taken before `before`; payouts sum to the whole pot.
      expect(net.reduce((x, y) => x + y, 0)).toBe(pot);
      // One pot payment per paid seat, written once.
      const rows = await t.prisma.coinLedger.count({
        where: { reference: id, reason: 'POT' as never },
      });
      expect(rows).toBe(2);
      for (const seat of [0, 1, 2, 3]) {
        expect((await get(users[seat] as SocialUser, id)).payout).toBe(net[seat]);
      }
    }, 180_000);
  });
});
