import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COIN_SETTING_DEFAULTS, type MatchView, type RoomView } from '@gameverse/shared-types';
import { MatchesService } from '../src/matches/matches.service.js';
import { registerWithProfile, type SocialUser } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

const OPENER_WINS = [0, 3, 1, 4, 2];
const DRAW = [0, 1, 2, 4, 3, 5, 7, 6, 8];

describe('tic-tac-toe: single game or best of three', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    for (const [key, value] of Object.entries(COIN_SETTING_DEFAULTS)) {
      await t.prisma.coinSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    }
  });

  const matches = () => t.app.get(MatchesService);
  const ready = (user: SocialUser, id: string) =>
    request(t.server).post(`/v1/matches/${id}/ready`).set(user.auth).send({});
  const view = async (user: SocialUser, id: string) =>
    (await request(t.server).get(`/v1/matches/${id}`).set(user.auth).expect(200)).body as MatchView;

  async function pair(bestOf?: 1 | 3, entryFee = 0) {
    const a = await registerWithProfile(t);
    const b = await registerWithProfile(t);
    const id = await matches().createMatch({
      gameId: 'tictactoe',
      kind: 'PRIVATE',
      seats: [{ userId: a.id }, { userId: b.id }],
      ...(bestOf ? { bestOf } : {}),
      entryFee,
    });
    await ready(a, id).expect(200);
    await ready(b, id).expect(200);
    return { a, b, id };
  }
  async function play(p: { a: SocialUser; b: SocialUser; id: string }, cells: number[]) {
    let current = await view(p.a, p.id);
    for (const cell of cells) {
      const user = current.series?.seatToMove === 0 ? p.a : p.b;
      current = (
        await request(t.server)
          .post(`/v1/matches/${p.id}/moves`)
          .set(user.auth)
          .send({ cell, clientActionId: randomUUID(), expectedVersion: current.version })
          .expect(200)
      ).body as MatchView;
    }
    return current;
  }

  it('is best of three unless asked otherwise', async () => {
    const p = await pair();
    const done = await play(p, OPENER_WINS);
    expect(done.series?.bestOf).toBe(3);
    expect(done.status).toBe('ACTIVE');
    expect(done.series?.phase).toBe('between_games');
  });

  it('ends the whole match after one game when it is a single game', async () => {
    const p = await pair(1);
    const done = await play(p, OPENER_WINS);
    expect(done.series?.bestOf).toBe(1);
    expect(done.status).toBe('COMPLETED');
    expect(done.winnerSeat).toBe(0);
    expect(done.series?.phase).toBe('completed');
  });

  it('counts a drawn single game as a drawn match and returns the entry fees', async () => {
    const p = await pair(1, 100);
    const done = await play(p, DRAW);
    expect(done.status).toBe('COMPLETED');
    expect(done.winnerSeat).toBeNull();
    const wallets = await t.prisma.coinWallet.findMany({
      where: { userId: { in: [p.a.id, p.b.id] } },
    });
    expect(wallets.map((w) => w.balance)).toEqual([
      COIN_SETTING_DEFAULTS.starter,
      COIN_SETTING_DEFAULTS.starter,
    ]);
  });

  it('pays the pot after a single game', async () => {
    const p = await pair(1, 100);
    await play(p, OPENER_WINS);
    const winner = await t.prisma.coinWallet.findUniqueOrThrow({ where: { userId: p.a.id } });
    expect(winner.balance).toBe(COIN_SETTING_DEFAULTS.starter + 100);
  });

  it('a rematch keeps the match length', async () => {
    const p = await pair(1);
    await play(p, OPENER_WINS);
    await request(t.server).post(`/v1/matches/${p.id}/rematch`).set(p.a.auth).send({}).expect(200);
    const next = (
      await request(t.server).post(`/v1/matches/${p.id}/rematch`).set(p.b.auth).send({}).expect(200)
    ).body as MatchView;
    expect(next.rematchMatchId).not.toBeNull();
    const created = await t.prisma.gameMatch.findUniqueOrThrow({
      where: { id: next.rematchMatchId as string },
    });
    expect(created.bestOf).toBe(1);
  });

  it('bot practice can be a single game', async () => {
    const a = await registerWithProfile(t);
    const started = (
      await request(t.server)
        .post('/v1/matches/bot')
        .set(a.auth)
        .send({ gameId: 'tictactoe', level: 'easy', bestOf: 1 })
    ).body as MatchView;
    expect((await t.prisma.gameMatch.findUniqueOrThrow({ where: { id: started.id } })).bestOf).toBe(
      1,
    );
  });

  it('refuses a single game for any other game', async () => {
    const a = await registerWithProfile(t);
    const b = await registerWithProfile(t);
    await t.prisma.game.update({ where: { id: 'draughts' }, data: { enabled: true } });
    try {
      await expect(
        matches().createMatch({
          gameId: 'draughts',
          kind: 'PRIVATE',
          seats: [{ userId: a.id }, { userId: b.id }],
          bestOf: 1,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally {
      await t.prisma.game.update({ where: { id: 'draughts' }, data: { enabled: false } });
    }
    await request(t.server)
      .post('/v1/matchmaking/join')
      .set(a.auth)
      .send({ gameId: 'ludo', bestOf: 1 })
      .expect(400);
  });

  it('rejects any other length', async () => {
    const a = await registerWithProfile(t);
    await request(t.server)
      .post('/v1/rooms')
      .set(a.auth)
      .send({ gameId: 'tictactoe', bestOf: 2 })
      .expect(400);
  });

  it('quick match pairs only players who chose the same length', async () => {
    const a = await registerWithProfile(t);
    const b = await registerWithProfile(t);
    const c = await registerWithProfile(t);
    const join = (u: SocialUser, bestOf?: number) =>
      request(t.server)
        .post('/v1/matchmaking/join')
        .set(u.auth)
        .send({ gameId: 'tictactoe', ...(bestOf ? { bestOf } : {}) })
        .expect(200);
    await join(a, 1);
    expect(((await join(b)).body as { state: string }).state).toBe('searching');
    const matched = (await join(c, 1)).body as { state: string; match: MatchView };
    expect(matched.state).toBe('matched');
    expect(matched.match.series).toBeNull(); // READY: no series yet
    const row = await t.prisma.gameMatch.findUniqueOrThrow({ where: { id: matched.match.id } });
    expect(row.bestOf).toBe(1);
  });

  it('rooms carry the length into the match', async () => {
    const host = await registerWithProfile(t);
    const guest = await registerWithProfile(t);
    const room = (
      await request(t.server)
        .post('/v1/rooms')
        .set(host.auth)
        .send({ gameId: 'tictactoe', bestOf: 1 })
        .expect(201)
    ).body as RoomView;
    expect(room.bestOf).toBe(1);
    const joined = (
      await request(t.server)
        .post('/v1/rooms/join')
        .set(guest.auth)
        .send({ code: room.code })
        .expect(200)
    ).body as { match: MatchView };
    expect(
      (await t.prisma.gameMatch.findUniqueOrThrow({ where: { id: joined.match.id } })).bestOf,
    ).toBe(1);
  });
});
