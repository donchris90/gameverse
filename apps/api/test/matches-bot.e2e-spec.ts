import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createSeries,
  playMove,
  startNextGame,
  TURN_TIMER_MS,
  type Seat,
  type SeriesState,
} from '@gameverse/game-rules';
import type { BotLevelName, MatchView, RoomView } from '@gameverse/shared-types';
import { botActionId } from '../src/matches/bot-action-id.js';
import { BOT_THINK_MS } from '../src/matches/matches.constants.js';
import { MatchesService } from '../src/matches/matches.service.js';
import { registerUser, registerWithProfile, type SocialUser } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

describe('bots in matches', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });

  const service = () => t.app.get(MatchesService);
  const startBot = (user: SocialUser, level: string = 'medium', gameId = 'tictactoe') =>
    request(t.server).post('/v1/matches/bot').set(user.auth).send({ gameId, level });
  const view = async (user: SocialUser, id: string) =>
    (await request(t.server).get(`/v1/matches/${id}`).set(user.auth).expect(200)).body as MatchView;
  const ready = (user: SocialUser, id: string) =>
    request(t.server).post(`/v1/matches/${id}/ready`).set(user.auth).send({});
  const move = (user: SocialUser, id: string, cell: number, expectedVersion: number) =>
    request(t.server)
      .post(`/v1/matches/${id}/moves`)
      .set(user.auth)
      .send({ cell, clientActionId: randomUUID(), expectedVersion });
  const events = (id: string) =>
    t.prisma.gameEvent.findMany({ where: { matchId: id }, orderBy: { seq: 'asc' } });

  /** A clock that only moves forward, so repeated sweeps never go back in time. */
  let clock = 0;
  const tick = (ms = 5_000) => {
    clock = Math.max(clock, Date.now()) + ms;
    return new Date(clock);
  };

  async function newMatch(level: BotLevelName = 'medium') {
    const user = await registerWithProfile(t);
    const body = (await startBot(user, level).expect(201)).body as MatchView;
    return { user, id: body.id, body };
  }

  /** Creates a started bot match where the bot opens (seat 1 opens), to test bot-first play. */
  async function botOpens(level: 'EASY' | 'MEDIUM' | 'HARD' = 'EASY') {
    const user = await registerWithProfile(t);
    const id = await service().createMatch({
      gameId: 'tictactoe',
      kind: 'BOT',
      seats: [{ userId: user.id }, { bot: level }],
      openingSeat: 1,
    });
    await ready(user, id).expect(200);
    return { user, id };
  }

  describe('starting a bot match', () => {
    it('labels the bot as a bot everywhere and has no user behind it', async () => {
      const { body } = await newMatch('hard');
      expect(body).toMatchObject({ kind: 'BOT', status: 'READY', mySeat: 0 });
      expect(body.players[1]).toEqual({
        seat: 1,
        userId: null,
        bot: 'hard',
        username: 'Bot',
        avatarId: 'bot',
        ready: true,
        connected: true,
        reconnectBy: null,
        out: false,
      });
      expect(body.players[0]?.bot).toBeNull();
      const row = await t.prisma.gameMatchPlayer.findUniqueOrThrow({
        where: { matchId_seat: { matchId: body.id, seat: 1 } },
      });
      expect(row).toMatchObject({ userId: null, botLevel: 'HARD', ready: true });
    });

    it.each(['easy', 'medium', 'hard'] as const)('records the %s level', async (level) => {
      const { id } = await newMatch(level);
      const row = await t.prisma.gameMatchPlayer.findUniqueOrThrow({
        where: { matchId_seat: { matchId: id, seat: 1 } },
      });
      expect(row.botLevel).toBe(level.toUpperCase());
    });

    it('starts when the human presses ready, with no second human needed', async () => {
      const { user, id } = await newMatch();
      const started = (await ready(user, id).expect(200)).body as MatchView;
      expect(started.status).toBe('ACTIVE');
      expect(started.series?.phase).toBe('playing');
    });

    it('rejects unknown levels, games and fields, and needs sign-in and a profile', async () => {
      const user = await registerWithProfile(t);
      expect((await startBot(user, 'impossible')).status).toBe(400);
      expect((await startBot(user, 'easy', 'chess')).status).toBe(400);
      const extra = await request(t.server)
        .post('/v1/matches/bot')
        .set(user.auth)
        .send({ gameId: 'tictactoe', level: 'easy', winner: 0 });
      expect(extra.status).toBe(400);
      await request(t.server)
        .post('/v1/matches/bot')
        .send({ gameId: 'tictactoe', level: 'easy' })
        .expect(401);
      const bare = await registerUser(t);
      const noProfile = await request(t.server)
        .post('/v1/matches/bot')
        .set({ Authorization: `Bearer ${bare.session.accessToken}` })
        .send({ gameId: 'tictactoe', level: 'easy' });
      expect(noProfile.status).toBe(409);
      expect(noProfile.body.error.code).toBe('PROFILE_REQUIRED');
    });

    it('refuses while already in a match', async () => {
      const { user } = await newMatch();
      const again = await startBot(user);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('ALREADY_IN_MATCH');
      expect(await t.prisma.gameMatch.count()).toBe(1);
    });

    it('ends a running search, but refuses while a room is open', async () => {
      const searcher = await registerWithProfile(t);
      await request(t.server)
        .post('/v1/matchmaking/join')
        .set(searcher.auth)
        .send({ gameId: 'tictactoe' })
        .expect(200);
      await startBot(searcher).expect(201);
      expect(await t.prisma.matchQueueEntry.count()).toBe(0);

      const host = await registerWithProfile(t);
      const room = (
        await request(t.server)
          .post('/v1/rooms')
          .set(host.auth)
          .send({ gameId: 'tictactoe' })
          .expect(201)
      ).body as RoomView;
      const refused = await startBot(host);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('INVALID_STATE');
      expect(room.status).toBe('OPEN');
    });

    it('is not a quick-match result', async () => {
      const { user } = await newMatch();
      const status = await request(t.server).get('/v1/matchmaking').set(user.auth).expect(200);
      expect(status.body.state).toBe('idle');
    });
  });

  describe('bot moves', () => {
    it('does not move before it has had time to think, and moves once afterwards', async () => {
      const { user, id } = await botOpens();
      const match = await t.prisma.gameMatch.findUniqueOrThrow({ where: { id } });
      const turnStart = (match.deadlineAt as Date).getTime() - TURN_TIMER_MS;
      expect(await service().runBotMoves(new Date(turnStart + BOT_THINK_MS - 1))).toBe(0);
      expect((await view(user, id)).series?.board.every((cell) => cell === null)).toBe(true);

      expect(await service().runBotMoves(new Date(turnStart + BOT_THINK_MS))).toBe(1);
      const after = await view(user, id);
      expect(after.series?.board.filter((cell) => cell !== null)).toHaveLength(1);
      expect(after.series?.seatToMove).toBe(0);
    });

    it('answers a human move exactly once and then waits for the human', async () => {
      const { user, id } = await newMatch();
      await ready(user, id).expect(200);
      let current = await view(user, id);
      if (current.series?.seatToMove === 1) {
        await service().runBotMoves(tick());
        current = await view(user, id);
      }
      // The bot may have opened on cell 0, so play the first free cell.
      const free = current.series?.board.findIndex((cell) => cell === null) ?? -1;
      expect(free).toBeGreaterThanOrEqual(0);
      await move(user, id, free, current.version).expect(200);
      const before = (await view(user, id)).version;
      expect(await service().runBotMoves(tick())).toBe(1);
      expect(await service().runBotMoves(tick())).toBe(0);
      const after = await view(user, id);
      expect(after.version).toBe(before + 1);
      expect(after.series?.seatToMove).toBe(0);
    });

    it('three sweepers at the same instant make one move', async () => {
      const { user, id } = await botOpens();
      const now = tick();
      const results = await Promise.all([1, 2, 3].map(() => service().runBotMoves(now)));
      expect(results.reduce((sum, n) => sum + n, 0)).toBe(1);
      const botMoves = (await events(id)).filter((e) => e.type === 'MOVE' && e.seat === 1);
      expect(botMoves).toHaveLength(1);
      expect((await view(user, id)).series?.board.filter((c) => c !== null)).toHaveLength(1);
    });

    it('reports no move when a rolled-back attempt is retried and the retry finds nothing to do', async () => {
      const { id } = await botOpens();
      // First attempt: the bot "moves" but the transaction is rolled back with a conflict, and
      // meanwhile the match is cancelled by someone else. The retry must report that no move was made.
      const original = t.prisma.$transaction.bind(t.prisma) as (
        work: (tx: unknown) => Promise<unknown>,
        options?: unknown,
      ) => Promise<unknown>;
      let first = true;
      (t.prisma as unknown as { $transaction: unknown }).$transaction = async (
        work: (tx: unknown) => Promise<unknown>,
        options?: unknown,
      ) => {
        if (!first) return original(work, options);
        first = false;
        await original(async (tx) => {
          await work(tx);
          throw new Error('rollback');
        }, options).catch(() => undefined);
        await t.prisma.gameMatch.update({ where: { id }, data: { status: 'CANCELLED' } });
        throw Object.assign(new Error('conflict'), { code: 'P2034' });
      };
      try {
        expect(await service().runBotMoves(tick())).toBe(0);
      } finally {
        (t.prisma as unknown as { $transaction: unknown }).$transaction = original;
      }
      expect(first).toBe(false);
      expect((await events(id)).filter((e) => e.type === 'MOVE')).toHaveLength(0);
    });

    it('records the move like a human one, with a deterministic action id', async () => {
      const { id } = await botOpens();
      const match0 = await t.prisma.gameMatch.findUniqueOrThrow({ where: { id } });
      await service().runBotMoves(tick());
      const log = await events(id);
      const botMove = log.find((e) => e.type === 'MOVE');
      expect(botMove).toMatchObject({ seat: 1 });
      expect(botMove?.clientActionId).toBe(botActionId(id, match0.version));
      expect(log.map((e) => e.seq)).toEqual(log.map((_, index) => index + 1));
      const match = await t.prisma.gameMatch.findUniqueOrThrow({ where: { id } });
      expect(log.at(-1)?.seq).toBe(match.version);
    });

    it('never moves in a match that is not active, or when it is the human’s turn', async () => {
      const { user, id } = await newMatch();
      expect(await service().runBotMoves(tick())).toBe(0); // READY, not ACTIVE
      await ready(user, id).expect(200);
      const current = await view(user, id);
      if (current.series?.seatToMove === 0) {
        expect(await service().runBotMoves(tick())).toBe(0); // human to move
      }
      await request(t.server).post(`/v1/matches/${id}/leave`).set(user.auth).send({}).expect(200);
      expect(await service().runBotMoves(tick())).toBe(0); // finished
    });

    it('a human cannot move for the bot or out of turn', async () => {
      const { user, id } = await botOpens();
      const current = await view(user, id);
      const response = await move(user, id, 4, current.version);
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('NOT_YOUR_TURN');
      expect((await view(user, id)).series?.board.every((cell) => cell === null)).toBe(true);
    });

    it('a stranger cannot see or move in a bot match', async () => {
      const { id } = await botOpens();
      const stranger = await registerWithProfile(t);
      await request(t.server).get(`/v1/matches/${id}`).set(stranger.auth).expect(404);
      await move(stranger, id, 0, 2).expect(404);
    });
  });

  describe('whole series against a bot', () => {
    /** Plays a series with a random human until the match is over; returns the final view. */
    async function playOut(user: SocialUser, id: string): Promise<MatchView> {
      for (let step = 0; step < 120; step += 1) {
        const current = await view(user, id);
        if (current.status === 'COMPLETED') return current;
        const series = current.series;
        if (series === null) throw new Error('match is not running');
        if (series.phase === 'between_games') {
          await service().runDueTimers(tick());
        } else if (series.seatToMove === current.mySeat) {
          const open = series.board.flatMap((cell, index) => (cell === null ? [index] : []));
          const cell = open[Math.floor(Math.random() * open.length)] as number;
          await move(user, id, cell, current.version).expect(200);
        } else {
          await service().runBotMoves(tick());
        }
      }
      throw new Error('series did not finish');
    }

    it('the hard bot never loses a game to a random player, and every bot move is legal and logged', async () => {
      for (let round = 0; round < 4; round += 1) {
        const user = await registerWithProfile(t);
        const created = (await startBot(user, 'hard').expect(201)).body as MatchView;
        await ready(user, created.id).expect(200);
        const done = await playOut(user, created.id);

        expect(done.status).toBe('COMPLETED');
        for (const game of done.series?.history ?? []) expect(game.result).not.toBe(0);
        expect(done.winnerSeat === 1 || done.series?.winner === 'draw').toBe(true);

        // Replay the log through the same rules: the stored result must equal the replayed one.
        const log = await events(created.id);
        const match = await t.prisma.gameMatch.findUniqueOrThrow({ where: { id: created.id } });
        let series: SeriesState = createSeries(match.openingSeat as Seat);
        for (const event of log.filter((e) => e.type === 'MOVE')) {
          if (series.phase === 'between_games') {
            const next = startNextGame(series);
            if (!next.ok) throw new Error('cannot start next game');
            series = next.series;
          }
          const result = playMove(
            series,
            event.seat as Seat,
            (event.data as { cell: number }).cell,
          );
          expect(result.ok, `event ${String(event.seq)} must be legal`).toBe(true);
          if (result.ok) series = result.series;
        }
        expect(series.wins).toEqual(done.series?.wins);
        expect(series.phase).toBe('completed');
        const botEvents = log.filter((e) => e.type === 'MOVE' && e.seat === 1);
        expect(new Set(botEvents.map((e) => e.clientActionId)).size).toBe(botEvents.length);
      }
    }, 60_000);

    it('an easy bot also finishes a series without ever making an illegal move', async () => {
      const { user, id } = await newMatch('easy');
      await ready(user, id).expect(200);
      const done = await playOut(user, id);
      expect(done.status).toBe('COMPLETED');
      expect(['score', 'forfeit']).toContain(done.endReason);
    }, 30_000);

    it('leaving a bot match forfeits it to the bot', async () => {
      const { user, id } = await botOpens('HARD');
      const left = (
        await request(t.server).post(`/v1/matches/${id}/leave`).set(user.auth).send({}).expect(200)
      ).body as MatchView;
      expect(left).toMatchObject({ status: 'COMPLETED', endReason: 'left', winnerSeat: 1 });
    });

    it('a human who stops playing loses on the turn timer, not the bot', async () => {
      const { user, id } = await newMatch();
      await ready(user, id).expect(200);
      let current = await view(user, id);
      if (current.series?.seatToMove === 1) {
        await service().runBotMoves(tick());
        current = await view(user, id);
      }
      expect(current.series?.seatToMove).toBe(0);
      await service().runDueTimers(tick(60_000));
      const after = await view(user, id);
      expect(after.series?.history.at(-1)).toMatchObject({ result: 1, reason: 'timeout' });
    });

    it('a rematch is created at once because the bot always agrees, and the opener alternates', async () => {
      const { user, id } = await newMatch('easy');
      await ready(user, id).expect(200);
      const first = await playOut(user, id);
      const lastOpener = first.series?.history.at(-1)?.firstSeat as 0 | 1;

      const asked = (
        await request(t.server)
          .post(`/v1/matches/${id}/rematch`)
          .set(user.auth)
          .send({})
          .expect(200)
      ).body as MatchView;
      expect(asked.rematchMatchId).not.toBeNull();
      const next = await view(user, asked.rematchMatchId as string);
      expect(next).toMatchObject({ kind: 'BOT', status: 'READY' });
      expect(next.players[1]).toMatchObject({ bot: 'easy', username: 'Bot', userId: null });
      const openerAfter = (await t.prisma.gameMatch.findUniqueOrThrow({ where: { id: next.id } }))
        .openingSeat;
      // The seat that did not open the last game opens the rematch.
      expect(openerAfter).toBe(lastOpener === 0 ? 1 : 0);
      expect(first.status).toBe('COMPLETED');
    }, 30_000);
  });

  describe('interaction with the rest of the match system', () => {
    it('a bot is never reported as disconnected, and only the human is tracked', async () => {
      const { user, id } = await botOpens();
      expect(await service().runConnectionChecks(new Date())).toBe(0);
      const current = await view(user, id);
      expect(current.players[1]).toMatchObject({ connected: true, reconnectBy: null });
      expect(current.players[0]?.connected).toBe(false); // no socket in this test
      const rows = await t.prisma.gameMatchPlayer.findMany({ where: { matchId: id } });
      expect(rows.find((r) => r.userId === null)?.disconnectedAt).toBeNull();
    });

    it('a human who stays away for the grace period forfeits to the bot', async () => {
      const { user, id } = await botOpens();
      await service().runConnectionChecks(new Date());
      const since = (
        await t.prisma.gameMatchPlayer.findUniqueOrThrow({
          where: { matchId_seat: { matchId: id, seat: 0 } },
        })
      ).disconnectedAt as Date;
      expect(await service().runConnectionChecks(new Date(since.getTime() + 30_000))).toBe(1);
      expect(await view(user, id)).toMatchObject({
        status: 'COMPLETED',
        endReason: 'disconnected',
        winnerSeat: 1,
      });
    });

    it('counts bot-match actions against the per-account limit', async () => {
      const { user, id } = await newMatch();
      let refused = 0;
      for (let i = 0; i < 40; i += 1) {
        const response = await ready(user, id);
        if (response.status === 429) refused += 1;
      }
      expect(refused).toBeGreaterThan(0);
    });
  });
});
