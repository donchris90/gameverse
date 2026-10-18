import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  COIN_SETTING_DEFAULTS,
  ErrorCode,
  type MatchView,
  type RoomJoinResult,
  type RoomView,
} from '@gameverse/shared-types';
import { EntryService } from '../src/matches/entry.service.js';
import { MatchesService } from '../src/matches/matches.service.js';
import { WalletService } from '../src/wallet/wallet.service.js';
import { registerWithProfile, type SocialUser } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

const OPENER_WINS = [0, 3, 1, 4, 2];
const SECOND_WINS = [0, 3, 1, 4, 8, 5];
const DRAW = [0, 1, 2, 4, 3, 5, 7, 6, 8];
const FEE = 100;
const START = COIN_SETTING_DEFAULTS.starter;

describe('entry fees and pots (bonus coins)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  const restore = async () => {
    for (const [key, value] of Object.entries(COIN_SETTING_DEFAULTS)) {
      await t.prisma.coinSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    }
  };
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await restore();
  });
  afterEach(restore);

  const matches = () => t.app.get(MatchesService);
  const balance = async (user: SocialUser) =>
    (await t.prisma.coinWallet.findUnique({ where: { userId: user.id } }))?.balance ?? 0;
  const ledger = (matchId: string, reason: string) =>
    t.prisma.coinLedger.findMany({ where: { reference: matchId, reason: reason as never } });
  const ready = (user: SocialUser, id: string) =>
    request(t.server).post(`/v1/matches/${id}/ready`).set(user.auth).send({});
  const view = async (user: SocialUser, id: string) =>
    (await request(t.server).get(`/v1/matches/${id}`).set(user.auth).expect(200)).body as MatchView;

  async function paidPair(fee = FEE) {
    const a = await registerWithProfile(t);
    const b = await registerWithProfile(t);
    const id = await matches().createMatch({
      gameId: 'tictactoe',
      kind: 'PRIVATE',
      seats: [{ userId: a.id }, { userId: b.id }],
      entryFee: fee,
    });
    return { a, b, id };
  }
  async function start(pair: { a: SocialUser; b: SocialUser; id: string }) {
    await ready(pair.a, pair.id).expect(200);
    await ready(pair.b, pair.id).expect(200);
  }
  async function play(pair: { a: SocialUser; b: SocialUser; id: string }, cells: number[]) {
    let current = await view(pair.a, pair.id);
    for (const cell of cells) {
      const user = current.series?.seatToMove === 0 ? pair.a : pair.b;
      const res = await request(t.server)
        .post(`/v1/matches/${pair.id}/moves`)
        .set(user.auth)
        .send({ cell, clientActionId: randomUUID(), expectedVersion: current.version })
        .expect(200);
      current = res.body as MatchView;
    }
    return current;
  }
  const sweep = async (id: string) => {
    await t.prisma.gameMatch.update({
      where: { id },
      data: { deadlineAt: new Date(Date.now() - 1000) },
    });
    await matches().runDueTimers();
  };
  /** Seat 0 wins game 1 and game 2, which ends the best-of-three series. */
  async function seatZeroWinsSeries(pair: { a: SocialUser; b: SocialUser; id: string }) {
    await play(pair, OPENER_WINS);
    await sweep(pair.id);
    return play(pair, SECOND_WINS);
  }
  /** Three drawn games end the series as a draw. */
  async function drawSeries(pair: { a: SocialUser; b: SocialUser; id: string }) {
    await play(pair, DRAW);
    await sweep(pair.id);
    await play(pair, DRAW);
    await sweep(pair.id);
    return play(pair, DRAW);
  }
  /** Every coin ever granted is either in a wallet or the ledger says where it went. */
  async function assertConserved() {
    const wallets = await t.prisma.coinWallet.aggregate({ _sum: { balance: true } });
    const entries = await t.prisma.coinLedger.aggregate({ _sum: { delta: true } });
    expect(wallets._sum.balance ?? 0).toBe(entries._sum.delta ?? 0);
  }

  it('takes the fee from each player when the match is created, and shows entry and pot', async () => {
    const pair = await paidPair();
    expect(await balance(pair.a)).toBe(START - FEE);
    expect(await balance(pair.b)).toBe(START - FEE);
    expect(await ledger(pair.id, 'ENTRY')).toHaveLength(2);
    const seen = await view(pair.a, pair.id);
    expect(seen.entryFee).toBe(FEE);
    expect(seen.pot).toBe(FEE * 2);
    await assertConserved();
  });

  it('pays the whole pot to the winner exactly once', async () => {
    const pair = await paidPair();
    await start(pair);
    const done = await seatZeroWinsSeries(pair);
    expect(done.status).toBe('COMPLETED');
    expect(done.winnerSeat).toBe(0);
    const winner = pair.a;
    const loser = pair.b;
    expect(await balance(winner)).toBe(START + FEE);
    expect(await balance(loser)).toBe(START - FEE);
    expect(await ledger(pair.id, 'POT')).toHaveLength(1);
    expect(await ledger(pair.id, 'REFUND')).toHaveLength(0);

    // Settling again (a replay, a retry) changes nothing.
    const record = await t.prisma.gameMatch.findUniqueOrThrow({
      where: { id: pair.id },
      include: { players: true },
    });
    await t.prisma.$transaction((tx) => t.app.get(EntryService).settle(tx, record));
    await t.prisma.$transaction((tx) => t.app.get(EntryService).settle(tx, record));
    expect(await balance(winner)).toBe(START + FEE);
    expect(await ledger(pair.id, 'POT')).toHaveLength(1);
    await assertConserved();
  });

  it('returns every fee on a draw', async () => {
    const pair = await paidPair();
    await start(pair);
    const done = await drawSeries(pair);
    expect(done.status).toBe('COMPLETED');
    expect(done.winnerSeat).toBeNull();
    expect(await balance(pair.a)).toBe(START);
    expect(await balance(pair.b)).toBe(START);
    expect(await ledger(pair.id, 'REFUND')).toHaveLength(2);
    expect(await ledger(pair.id, 'POT')).toHaveLength(0);
    await assertConserved();
  });

  it('returns the fee when a player leaves before the match starts', async () => {
    const pair = await paidPair();
    const left = await request(t.server)
      .post(`/v1/matches/${pair.id}/leave`)
      .set(pair.a.auth)
      .send({})
      .expect(200);
    expect((left.body as MatchView).status).toBe('CANCELLED');
    expect(await balance(pair.a)).toBe(START);
    expect(await balance(pair.b)).toBe(START);
    await assertConserved();
  });

  it('returns the fees when nobody gets ready in time', async () => {
    const pair = await paidPair();
    await t.prisma.gameMatch.update({
      where: { id: pair.id },
      data: { deadlineAt: new Date(Date.now() - 1000) },
    });
    await matches().runDueTimers();
    expect((await view(pair.a, pair.id)).status).toBe('EXPIRED');
    expect(await balance(pair.a)).toBe(START);
    expect(await balance(pair.b)).toBe(START);
    await assertConserved();
  });

  it('gives the pot to the player who stays when the other forfeits mid-match', async () => {
    const pair = await paidPair();
    await start(pair);
    const left = await request(t.server)
      .post(`/v1/matches/${pair.id}/leave`)
      .set(pair.a.auth)
      .send({})
      .expect(200);
    const done = left.body as MatchView;
    expect(done.status).toBe('COMPLETED');
    expect(done.winnerSeat).toBe(1);
    expect(await balance(pair.b)).toBe(START + FEE);
    expect(await balance(pair.a)).toBe(START - FEE);
    await assertConserved();
  });

  it('refuses a player who cannot pay, and creates nothing', async () => {
    const a = await registerWithProfile(t);
    const b = await registerWithProfile(t);
    await t.prisma.$transaction((tx) => t.app.get(WalletService).ensureStarter(tx, b.id));
    await t.prisma.coinWallet.update({ where: { userId: b.id }, data: { balance: FEE - 1 } });
    await t.prisma.coinLedger.create({
      data: {
        userId: b.id,
        delta: -(START - FEE + 1),
        balanceAfter: FEE - 1,
        reason: 'ADMIN_GRANT',
        idempotencyKey: `test:drain:${b.id}`,
      },
    });
    await expect(
      matches().createMatch({
        gameId: 'tictactoe',
        kind: 'PRIVATE',
        seats: [{ userId: a.id }, { userId: b.id }],
        entryFee: FEE,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_COINS });
    expect(await t.prisma.gameMatch.count()).toBe(0);
    expect(await t.prisma.coinLedger.count({ where: { reason: 'ENTRY' } })).toBe(0);
    // Nothing for the other player either: the whole attempt rolled back, starter grant included.
    expect(await t.prisma.coinLedger.count({ where: { userId: a.id } })).toBe(0);
    await assertConserved();
  });

  it('never goes below zero when two matches race for the same coins', async () => {
    const a = await registerWithProfile(t);
    const others = await Promise.all([registerWithProfile(t), registerWithProfile(t)]);
    const attempts = await Promise.allSettled(
      others.map((other) =>
        matches().createMatch({
          gameId: 'tictactoe',
          kind: 'PRIVATE',
          seats: [{ userId: a.id }, { userId: other.id }],
          entryFee: 500,
        }),
      ),
    );
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await balance(a)).toBe(START - 500);
    await assertConserved();
  });

  it('keeps bot matches free and refuses a fee with a bot', async () => {
    const a = await registerWithProfile(t);
    await expect(
      matches().createMatch({
        gameId: 'tictactoe',
        kind: 'BOT',
        seats: [{ userId: a.id }, { bot: 'EASY' }],
        entryFee: FEE,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    const free = await matches().createMatch({
      gameId: 'tictactoe',
      kind: 'BOT',
      seats: [{ userId: a.id }, { bot: 'EASY' }],
    });
    expect((await view(a, free)).pot).toBe(0);
    expect(await t.prisma.coinLedger.count({ where: { reason: 'ENTRY' } })).toBe(0);
  });

  it('refuses an unlisted fee and honours the admin kill switch', async () => {
    const a = await registerWithProfile(t);
    const b = await registerWithProfile(t);
    const seats = [{ userId: a.id }, { userId: b.id }];
    await expect(
      matches().createMatch({ gameId: 'tictactoe', kind: 'PRIVATE', seats, entryFee: 75 }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    await t.prisma.coinSetting.update({ where: { key: 'paidEntry' }, data: { value: 0 } });
    await expect(
      matches().createMatch({ gameId: 'tictactoe', kind: 'PRIVATE', seats, entryFee: FEE }),
    ).rejects.toMatchObject({ code: ErrorCode.PAID_ENTRY_UNAVAILABLE });
    // Free matches still work with the switch off.
    await matches().createMatch({ gameId: 'tictactoe', kind: 'PRIVATE', seats });
  });

  it('charges the same fee again for a rematch', async () => {
    const pair = await paidPair();
    await start(pair);
    await seatZeroWinsSeries(pair);
    const first = await request(t.server)
      .post(`/v1/matches/${pair.id}/rematch`)
      .set(pair.a.auth)
      .send({})
      .expect(200);
    expect((first.body as MatchView).rematchMatchId).toBeNull();
    const second = await request(t.server)
      .post(`/v1/matches/${pair.id}/rematch`)
      .set(pair.b.auth)
      .send({})
      .expect(200);
    const next = second.body as MatchView;
    expect(next.entryFee).toBe(FEE);
    expect(next.pot).toBe(FEE * 2);
    const total = (await balance(pair.a)) + (await balance(pair.b));
    expect(total).toBe(START * 2 - FEE * 2);
    await assertConserved();
  });

  describe('quick match', () => {
    const join = (user: SocialUser, entryFee?: number) =>
      request(t.server)
        .post('/v1/matchmaking/join')
        .set(user.auth)
        .send({ gameId: 'tictactoe', ...(entryFee === undefined ? {} : { entryFee }) });

    it('pairs players who chose the same fee and charges them', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      await join(a, FEE).expect(200);
      const res = await join(b, FEE);
      const matched = res.body as { state: string; match: MatchView };
      expect(matched.state).toBe('matched');
      expect(matched.match.entryFee).toBe(FEE);
      expect(await balance(a)).toBe(START - FEE);
      expect(await balance(b)).toBe(START - FEE);
    });

    it('does not pair players who chose different fees', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      const c = await registerWithProfile(t);
      await join(a, FEE).expect(200);
      expect(((await join(b, 50)).body as { state: string }).state).toBe('searching');
      expect(((await join(c)).body as { state: string }).state).toBe('searching');
      expect(await t.prisma.gameMatch.count()).toBe(0);
      expect(await balance(a)).toBe(START);
    });

    it('refuses to start a search the player cannot pay for', async () => {
      const a = await registerWithProfile(t);
      await t.prisma.$transaction((tx) => t.app.get(WalletService).ensureStarter(tx, a.id));
      await t.prisma.coinWallet.update({ where: { userId: a.id }, data: { balance: 10 } });
      const res = await join(a, FEE).expect(409);
      expect(res.body.error?.code ?? res.body.code).toBe(ErrorCode.INSUFFICIENT_COINS);
      expect(await t.prisma.matchQueueEntry.count()).toBe(0);
    });
  });

  describe('private rooms', () => {
    it('makes the joiner confirm the fee, then starts a paid match', async () => {
      const host = await registerWithProfile(t);
      const guest = await registerWithProfile(t);
      const room = (
        await request(t.server)
          .post('/v1/rooms')
          .set(host.auth)
          .send({ gameId: 'tictactoe', entryFee: FEE })
          .expect(201)
      ).body as RoomView;
      expect(room.entryFee).toBe(FEE);

      const unconfirmed = await request(t.server)
        .post('/v1/rooms/join')
        .set(guest.auth)
        .send({ code: room.code })
        .expect(409);
      const err = unconfirmed.body.error ?? unconfirmed.body;
      expect(err.code).toBe(ErrorCode.ENTRY_FEE_CONFIRMATION_REQUIRED);
      expect(err.details).toEqual({ entryFee: FEE });
      await request(t.server)
        .post('/v1/rooms/join')
        .set(guest.auth)
        .send({ code: room.code, entryFee: 50 })
        .expect(409);
      expect(await t.prisma.coinLedger.count({ where: { reason: 'ENTRY' } })).toBe(0);

      const joined = (
        await request(t.server)
          .post('/v1/rooms/join')
          .set(guest.auth)
          .send({ code: room.code, entryFee: FEE })
          .expect(200)
      ).body as RoomJoinResult;
      expect(joined.match?.entryFee).toBe(FEE);
      expect(await balance(host)).toBe(START - FEE);
      expect(await balance(guest)).toBe(START - FEE);
    });

    it('refuses a host start against bots in a paid room', async () => {
      const host = await registerWithProfile(t);
      const room = (
        await request(t.server)
          .post('/v1/rooms')
          .set(host.auth)
          .send({ gameId: 'tictactoe', entryFee: FEE })
          .expect(201)
      ).body as RoomView;
      await request(t.server)
        .post(`/v1/rooms/${room.id}/start`)
        .set(host.auth)
        .send({ bots: 'easy' })
        .expect((res) => expect(res.status).toBeGreaterThanOrEqual(400));
      expect(await t.prisma.gameMatch.count()).toBe(0);
      expect(await balance(host)).toBe(START);
    });
  });
});
