import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSeries, type Seat, type SeriesState } from '@gameverse/game-rules';
import type { LeaderboardView, MatchKind, MatchView, MyProgress } from '@gameverse/shared-types';
import { MatchmakingService } from '../src/lobby/matchmaking.service.js';
import { MatchesService } from '../src/matches/matches.service.js';
import { ResultsService } from '../src/progress/results.service.js';
import { registerWithProfile, type SocialUser } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

describe('ratings, XP, statistics and leaderboards', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await t.prisma.playerRating.deleteMany();
    clock = 0;
  });

  const service = () => t.app.get(MatchesService);
  const view = async (user: SocialUser, id: string) =>
    (await request(t.server).get(`/v1/matches/${id}`).set(user.auth).expect(200)).body as MatchView;
  const ready = (user: SocialUser, id: string) =>
    request(t.server).post(`/v1/matches/${id}/ready`).set(user.auth).send({});
  const leave = (user: SocialUser, id: string) =>
    request(t.server).post(`/v1/matches/${id}/leave`).set(user.auth).send({});
  const progress = async (user: SocialUser) =>
    (await request(t.server).get('/v1/me/progress').set(user.auth).expect(200)).body as MyProgress;
  const board = (user: SocialUser, query = '') =>
    request(t.server).get(`/v1/leaderboards/tictactoe${query}`).set(user.auth);

  let clock = 0;
  const tick = (ms = 60_000) => {
    clock = Math.max(clock, Date.now()) + ms;
    return new Date(clock);
  };

  async function twoPlayers() {
    return [await registerWithProfile(t), await registerWithProfile(t)] as const;
  }

  /** An ACTIVE match between two people (both pressed ready). */
  async function active(a: SocialUser, b: SocialUser, kind: MatchKind = 'QUICK'): Promise<string> {
    const id = await service().createMatch({
      gameId: 'tictactoe',
      kind,
      seats: [{ userId: a.id }, { userId: b.id }],
      openingSeat: 0,
    });
    await ready(a, id).expect(200);
    await ready(b, id).expect(200);
    return id;
  }

  /** `loser` stops playing and `winner` keeps moving: the series ends by two timeouts in a row. */
  async function winByTimeouts(
    winner: SocialUser,
    id: string,
    winnerSeat: Seat,
  ): Promise<MatchView> {
    for (let step = 0; step < 60; step += 1) {
      const current = await view(winner, id);
      if (current.status === 'COMPLETED') return current;
      if (current.series?.phase === 'playing' && current.series.seatToMove === winnerSeat) {
        const cell = current.series.board.findIndex((c) => c === null);
        await request(t.server)
          .post(`/v1/matches/${id}/moves`)
          .set(winner.auth)
          .send({ cell, clientActionId: randomUUID(), expectedVersion: current.version })
          .expect(200);
      } else {
        await service().runDueTimers(tick());
      }
    }
    throw new Error('match did not finish');
  }

  /** The human never moves; the bot plays and the turn timer ends the series. */
  async function idleAgainstBot(human: SocialUser, id: string): Promise<MatchView> {
    for (let step = 0; step < 60; step += 1) {
      const current = await view(human, id);
      if (current.status === 'COMPLETED') return current;
      await service().runBotMoves(tick(5_000));
      await service().runDueTimers(tick());
    }
    throw new Error('match did not finish');
  }

  async function setRating(user: SocialUser, rating: number, ratedGames: number) {
    await t.prisma.playerRating.upsert({
      where: { userId_gameId: { userId: user.id, gameId: 'tictactoe' } },
      create: { userId: user.id, gameId: 'tictactoe', rating, ratedGames },
      update: { rating, ratedGames },
    });
  }

  describe('a decided quick match', () => {
    it('moves both ratings by Elo, pays XP, counts statistics, and shows the change to both players', async () => {
      const [a, b] = await twoPlayers();
      const id = await active(a, b);
      expect((await view(a, id)).result).toBeNull(); // nothing while the match is open
      await leave(b, id).expect(200);

      for (const user of [a, b]) {
        const done = await view(user, id);
        expect(done.result).toMatchObject({ ranked: true });
        expect(done.result?.players).toEqual([
          { seat: 0, userId: a.id, ratingBefore: 1000, ratingAfter: 1016, xp: 30 },
          { seat: 1, userId: b.id, ratingBefore: 1000, ratingAfter: 984, xp: 0 },
        ]);
      }
      expect(await progress(a)).toMatchObject({
        xp: 30,
        level: 1,
        games: [
          { gameId: 'tictactoe', rating: 1016, ratedGames: 1, played: 1, wins: 1, winStreak: 1 },
        ],
      });
      expect(await progress(b)).toMatchObject({
        xp: 0,
        games: [{ rating: 984, ratedGames: 1, played: 1, losses: 1, winStreak: 0 }],
      });
    });

    it('a series lost by timeouts still pays the loser participation XP (only quitting pays nothing)', async () => {
      const [a, b] = await twoPlayers();
      const id = await active(a, b);
      const done = await winByTimeouts(a, id, 0);
      expect(done.endReason).toBe('score');
      expect(done.result?.players.map((p) => p.xp)).toEqual([30, 15]);
      expect(done.result?.players.map((p) => p.ratingAfter)).toEqual([1016, 984]);
    });

    it('win streaks build and reset, and the best one is kept', async () => {
      const [a, b] = await twoPlayers();
      for (const leaver of [b, b, a, b]) {
        const id = await active(a, b, 'FRIEND'); // FRIEND: counts statistics, never moves ratings
        await leave(leaver, id).expect(200);
      }
      const mine = (await progress(a)).games[0];
      expect(mine).toMatchObject({ played: 4, wins: 3, losses: 1, winStreak: 1, bestWinStreak: 2 });
    });

    it('a drawn series is worth half a point to each side', async () => {
      const [a, b] = await twoPlayers();
      await setRating(a, 1200, 5);
      await setRating(b, 1000, 5);
      const id = await active(a, b);
      const draw: SeriesState = {
        ...createSeries(0),
        phase: 'completed',
        winner: 'draw',
        endReason: 'score',
      };
      await t.prisma.gameMatch.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          state: draw as never,
          endedAt: new Date(),
          endReason: 'score',
        },
      });
      const match = await t.prisma.gameMatch.findUniqueOrThrow({
        where: { id },
        include: { players: true },
      });
      await t.prisma.$transaction((tx) => t.app.get(ResultsService).record(tx, match));
      const result = (await view(a, id)).result;
      // The 200 point favourite loses points on a draw, the underdog gains them.
      expect(result?.players[0]?.ratingAfter).toBeLessThan(1200);
      expect(result?.players[1]?.ratingAfter).toBeGreaterThan(1000);
      expect(result?.players.map((p) => p.xp)).toEqual([20, 20]);
      expect((await progress(a)).games[0]).toMatchObject({ draws: 1, wins: 0, losses: 0 });
    });

    it('an upset moves the underdog more than the favourite would have moved', async () => {
      const [a, b] = await twoPlayers();
      await setRating(a, 1000, 5);
      await setRating(b, 1400, 5);
      const id = await active(a, b);
      await leave(b, id).expect(200); // the favourite loses
      const result = (await view(a, id)).result;
      expect(result?.players[0]).toMatchObject({ ratingBefore: 1000, ratingAfter: 1029 });
      expect(result?.players[1]).toMatchObject({ ratingBefore: 1400, ratingAfter: 1371 });
    });
  });

  describe('what does not move ratings', () => {
    it.each(['PRIVATE', 'FRIEND'] as const)(
      '%s matches count statistics and pay less XP, never rating',
      async (kind) => {
        const [a, b] = await twoPlayers();
        const id = await active(a, b, kind);
        const done = await (async () => {
          await leave(b, id).expect(200);
          return view(a, id);
        })();
        expect(done.result).toMatchObject({ ranked: false });
        expect(done.result?.players.map((p) => p.ratingAfter)).toEqual([null, null]);
        expect(done.result?.players.map((p) => p.xp)).toEqual([15, 0]);
        expect(await t.prisma.playerRating.count()).toBe(0);
        expect((await progress(a)).games[0]).toMatchObject({
          rating: 1000,
          ratedGames: 0,
          played: 1,
          wins: 1,
        });
      },
    );

    it('bot matches pay small XP but touch neither rating nor statistics', async () => {
      const [a] = await twoPlayers();
      const id = await service().createMatch({
        gameId: 'tictactoe',
        kind: 'BOT',
        seats: [{ userId: a.id }, { bot: 'EASY' }],
        openingSeat: 0,
      });
      await ready(a, id).expect(200);
      const done = await idleAgainstBot(a, id);
      expect(done.result).toMatchObject({ ranked: false });
      expect(done.result?.players).toEqual([
        { seat: 0, userId: a.id, ratingBefore: null, ratingAfter: null, xp: 5 },
        { seat: 1, userId: null, ratingBefore: null, ratingAfter: null, xp: 0 },
      ]);
      expect(await t.prisma.playerStatistics.count()).toBe(0);
      expect(await t.prisma.playerRating.count()).toBe(0);
    }, 30_000);

    it('bot XP is capped at ten matches per day', async () => {
      // Fake time stays inside one UTC day (midday), so the test does not depend on when it runs.
      clock = Date.UTC(2030, 0, 1, 12, 0, 0);
      const [a] = await twoPlayers();
      let paid = 0;
      for (let i = 0; i < 12; i += 1) {
        const id = await service().createMatch({
          gameId: 'tictactoe',
          kind: 'BOT',
          seats: [{ userId: a.id }, { bot: 'EASY' }],
          openingSeat: 0,
        });
        await t.prisma.gameMatch.update({ where: { id }, data: { openingSeat: 0 } });
        await ready(a, id).expect(200);
        const done = await idleAgainstBot(a, id);
        paid += done.result?.players[0]?.xp ?? 0;
      }
      expect(paid).toBe(50);
      expect((await progress(a)).xp).toBe(50);
    }, 90_000);

    it('matches that never started produce no result', async () => {
      const [a, b] = await twoPlayers();
      const id = await service().createMatch({
        gameId: 'tictactoe',
        kind: 'QUICK',
        seats: [{ userId: a.id }, { userId: b.id }],
      });
      await leave(a, id).expect(200); // cancelled before it began
      await service().runDueTimers(tick());
      expect(await t.prisma.gameResult.count()).toBe(0);
      expect(await t.prisma.playerExperience.count()).toBe(0);
    });
  });

  describe('exactly once, all or nothing', () => {
    it('finishing a match many times at once records one result and applies everything once', async () => {
      const [a, b] = await twoPlayers();
      const id = await active(a, b);
      await Promise.all([leave(b, id), leave(b, id), leave(a, id), service().runDueTimers(tick())]);
      expect(await t.prisma.gameResult.count({ where: { matchId: id } })).toBe(1);
      const a1 = await progress(a);
      const b1 = await progress(b);
      expect(a1.games[0]?.ratedGames).toBe(1);
      expect(b1.games[0]?.ratedGames).toBe(1);
      expect(a1.xp + b1.xp).toBe(30);
      expect((a1.games[0]?.rating ?? 0) + (b1.games[0]?.rating ?? 0)).toBe(2000);
    });

    it('recording the same finished match again changes nothing', async () => {
      const [a, b] = await twoPlayers();
      const id = await active(a, b);
      await leave(b, id).expect(200);
      const before = await progress(a);
      const match = await t.prisma.gameMatch.findUniqueOrThrow({
        where: { id },
        include: { players: true },
      });
      await t.prisma.$transaction((tx) => t.app.get(ResultsService).record(tx, match));
      await t.prisma.$transaction((tx) => t.app.get(ResultsService).record(tx, match));
      expect(await progress(a)).toEqual(before);
      expect(await t.prisma.gameResult.count()).toBe(1);
    });

    it('if recording the result fails, the match does not complete either', async () => {
      const [a, b] = await twoPlayers();
      const id = await active(a, b);
      const results = t.app.get(ResultsService);
      const original = results.record.bind(results);
      results.record = () => Promise.reject(new Error('disk on fire'));
      try {
        const response = await leave(b, id);
        expect(response.status).toBe(500);
      } finally {
        results.record = original;
      }
      expect((await view(a, id)).status).toBe('ACTIVE');
      expect(await t.prisma.gameResult.count()).toBe(0);
      expect(await t.prisma.playerRating.count()).toBe(0);
      expect(await t.prisma.gameEvent.count({ where: { matchId: id, type: 'PLAYER_LEFT' } })).toBe(
        0,
      );
      // And once the fault is gone the same action works.
      await leave(b, id).expect(200);
      expect(await t.prisma.gameResult.count()).toBe(1);
    });

    it('deleting an account keeps the opponent’s history and rating', async () => {
      const [a, b] = await twoPlayers();
      const id = await active(a, b);
      await leave(b, id).expect(200);
      await t.prisma.user.delete({ where: { id: b.id } });
      const rows = await t.prisma.gameResultPlayer.findMany({ orderBy: { seat: 'asc' } });
      expect(rows.map((r) => r.userId)).toEqual([a.id, null]);
      expect((await progress(a)).games[0]?.rating).toBe(1016);
    });
  });

  describe('repeat opponents cannot farm rating', () => {
    it('after three rated matches in a day the same pair stops moving ratings, but still counts statistics', async () => {
      const [a, b] = await twoPlayers();
      const ranked: boolean[] = [];
      for (let i = 0; i < 5; i += 1) {
        const id = await active(a, b);
        await leave(b, id).expect(200);
        ranked.push((await view(a, id)).result?.ranked ?? false);
      }
      expect(ranked).toEqual([true, true, true, false, false]);
      const mine = (await progress(a)).games[0];
      expect(mine).toMatchObject({ ratedGames: 3, played: 5, wins: 5 });
      expect(mine?.rating).toBeLessThan(1016 * 3); // three increases only, shrinking each time
      expect(mine?.rating).toBe(
        (
          await t.prisma.playerRating.findUniqueOrThrow({
            where: { userId_gameId: { userId: a.id, gameId: 'tictactoe' } },
          })
        ).rating,
      );
    });

    it('other opponents are not affected by the allowance', async () => {
      const [a, b] = await twoPlayers();
      const c = await registerWithProfile(t);
      for (let i = 0; i < 4; i += 1) await leave(b, await active(a, b)).expect(200);
      const id = await active(a, c);
      await leave(c, id).expect(200);
      expect((await view(a, id)).result?.ranked).toBe(true);
    });
  });

  describe('ratings decide who is matched', () => {
    it('players far apart in rating wait, and are paired once the band has widened enough', async () => {
      const [a, b] = await twoPlayers();
      await setRating(a, 1400, 10);
      await setRating(b, 1000, 10);
      const mm = t.app.get(MatchmakingService);
      await mm.join(a.id, 'tictactoe');
      const second = await mm.join(b.id, 'tictactoe');
      expect(second.state).toBe('searching');
      const entries = await t.prisma.matchQueueEntry.findMany({ orderBy: { rating: 'desc' } });
      expect(entries.map((e) => e.rating)).toEqual([1400, 1000]);
      const base = entries[0]?.joinedAt as Date;
      expect(await mm.runMatchmaking(new Date(base.getTime() + 20_000))).toBe(0); // band 300
      expect(await mm.runMatchmaking(new Date(base.getTime() + 30_000))).toBe(1); // band 400
    });
  });

  describe('progress', () => {
    it('starts every player at rating 1000, level 1, nothing played', async () => {
      const [a] = await twoPlayers();
      expect(await progress(a)).toEqual({
        xp: 0,
        level: 1,
        levelStartXp: 0,
        nextLevelXp: 50,
        games: [
          {
            gameId: 'tictactoe',
            rating: 1000,
            ratedGames: 0,
            played: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            winStreak: 0,
            bestWinStreak: 0,
          },
        ],
      });
    });

    it('levels follow XP', async () => {
      const [a] = await twoPlayers();
      await t.prisma.playerExperience.create({ data: { userId: a.id, xp: 210 } });
      expect(await progress(a)).toMatchObject({
        xp: 210,
        level: 3,
        levelStartXp: 200,
        nextLevelXp: 450,
      });
    });

    it('needs sign-in', async () => {
      await request(t.server).get('/v1/me/progress').expect(401);
      await request(t.server).get('/v1/leaderboards/tictactoe').expect(401);
    });

    it('a stranger cannot see a match result', async () => {
      const [a, b] = await twoPlayers();
      const stranger = await registerWithProfile(t);
      const id = await active(a, b);
      await leave(b, id).expect(200);
      await request(t.server).get(`/v1/matches/${id}`).set(stranger.auth).expect(404);
    });
  });

  describe('leaderboard', () => {
    async function ranked(count: number, base = 1000, step = 10, games = 5): Promise<SocialUser[]> {
      const users: SocialUser[] = [];
      for (let i = 0; i < count; i += 1) {
        const user = await registerWithProfile(t);
        await setRating(user, base + i * step, games);
        users.push(user);
      }
      return users;
    }

    it('lists players best first, with the viewer’s own place', async () => {
      const users = await ranked(5);
      const response = await board(users[1] as SocialUser).expect(200);
      const lb = response.body as LeaderboardView;
      expect(lb.entries.map((e) => e.rating)).toEqual([1040, 1030, 1020, 1010, 1000]);
      expect(lb.entries.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5]);
      expect(lb.entries[0]).toMatchObject({
        userId: users[4]?.id,
        username: users[4]?.username,
        ratedGames: 5,
      });
      expect(lb.me).toEqual({ rank: 4, rating: 1010, ratedGames: 5 });
      expect(lb.hasMore).toBe(false);
      expect(lb.minRatedGames).toBe(3);
    });

    it('hides players with too few rated games, and gives them no rank', async () => {
      const users = await ranked(3);
      const rookie = await registerWithProfile(t);
      await setRating(rookie, 2000, 2);
      const lb = (await board(rookie).expect(200)).body as LeaderboardView;
      expect(lb.entries.map((e) => e.userId)).not.toContain(rookie.id);
      expect(lb.me).toEqual({ rank: null, rating: 2000, ratedGames: 2 });
      expect(lb.entries).toHaveLength(users.length);
    });

    it('a player with no games yet still gets a default row for themselves', async () => {
      await ranked(2);
      const newcomer = await registerWithProfile(t);
      const lb = (await board(newcomer).expect(200)).body as LeaderboardView;
      expect(lb.me).toEqual({ rank: null, rating: 1000, ratedGames: 0 });
    });

    it('breaks ties by rated games, then by user id, the same way for the list and for ranks', async () => {
      const [x, y, z] = [
        await registerWithProfile(t),
        await registerWithProfile(t),
        await registerWithProfile(t),
      ];
      await setRating(x, 1100, 4);
      await setRating(y, 1100, 9);
      await setRating(z, 1100, 4);
      const lb = (await board(x).expect(200)).body as LeaderboardView;
      expect(lb.entries[0]?.userId).toBe(y.id); // more games first
      const [low, high] = [x, z].sort((p, q) => (p.id < q.id ? -1 : 1));
      expect(lb.entries.map((e) => e.userId)).toEqual([y.id, low?.id, high?.id]);
      for (const user of [x, y, z]) {
        const own = (await board(user).expect(200)).body as LeaderboardView;
        expect(own.me?.rank).toBe(own.entries.findIndex((e) => e.userId === user.id) + 1);
      }
    });

    it('pages with limit and offset and says when there is more', async () => {
      const users = await ranked(7);
      const first = (await board(users[0] as SocialUser, '?limit=3').expect(200))
        .body as LeaderboardView;
      expect(first.entries.map((e) => e.rank)).toEqual([1, 2, 3]);
      expect(first.hasMore).toBe(true);
      const last = (await board(users[0] as SocialUser, '?limit=3&offset=6').expect(200))
        .body as LeaderboardView;
      expect(last.entries.map((e) => e.rank)).toEqual([7]);
      expect(last.hasMore).toBe(false);
      expect(first.me?.rank).toBe(7);
    });

    it('rejects bad paging, unknown games and unknown query keys', async () => {
      const [a] = await ranked(1);
      for (const query of ['?limit=0', '?limit=51', '?offset=-1', '?limit=abc', '?sort=wins']) {
        expect((await board(a as SocialUser, query)).status, query).toBe(400);
      }
      await request(t.server)
        .get('/v1/leaderboards/chess')
        .set((a as SocialUser).auth)
        .expect(400);
    });

    it('leaves out suspended players and people blocked either way, and ranks the visible list', async () => {
      const users = await ranked(5);
      const [u0, u1, u2, u3, u4] = users as [
        SocialUser,
        SocialUser,
        SocialUser,
        SocialUser,
        SocialUser,
      ];
      await t.prisma.user.update({ where: { id: u4.id }, data: { status: 'SUSPENDED' } });
      await request(t.server).post('/v1/blocks').set(u0.auth).send({ userId: u3.id }).expect(204);
      await request(t.server).post('/v1/blocks').set(u2.auth).send({ userId: u0.id }).expect(204);
      const lb = (await board(u0).expect(200)).body as LeaderboardView;
      expect(lb.entries.map((e) => e.userId)).toEqual([u1.id, u0.id]);
      expect(lb.entries.map((e) => e.rank)).toEqual([1, 2]);
      expect(lb.me?.rank).toBe(2);
    });

    it('shows wins from the statistics', async () => {
      const [a, b] = await twoPlayers();
      await setRating(a, 1100, 5);
      await setRating(b, 1050, 5);
      await t.prisma.playerStatistics.create({
        data: { userId: a.id, gameId: 'tictactoe', played: 9, wins: 7, losses: 2 },
      });
      const lb = (await board(b).expect(200)).body as LeaderboardView;
      expect(lb.entries.map((e) => e.wins)).toEqual([7, 0]);
    });
  });
});
