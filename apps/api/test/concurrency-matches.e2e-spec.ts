import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MatchView } from '@gameverse/shared-types';
import { NEXT_GAME_DELAY_MS } from '../src/matches/matches.constants.js';
import { MatchesService } from '../src/matches/matches.service.js';
import { registerWithProfile, type SocialUser } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

/**
 * In-match actions run with READ COMMITTED plus a compare-and-set on the match row. These tests
 * hammer that path with many matches at once and check nothing is lost, doubled or mixed up.
 */
describe('concurrency: many matches progressing and finishing at the same time', () => {
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

  const view = async (user: SocialUser, id: string) =>
    (await request(t.server).get(`/v1/matches/${id}`).set(user.auth).expect(200)).body as MatchView;

  async function playToTheEnd(a: SocialUser, b: SocialUser, id: string): Promise<MatchView> {
    for (let guard = 0; guard < 80; guard += 1) {
      const current = await view(a, id);
      if (current.status === 'COMPLETED') return current;
      const series = current.series;
      if (series?.phase === 'between_games') {
        // Sweepers are off in tests: step just past the pause between games.
        await t.app
          .get(MatchesService)
          .runDueTimers(new Date(Date.now() + NEXT_GAME_DELAY_MS + 500));
        continue;
      }
      if (current.status !== 'ACTIVE' || series?.phase !== 'playing') continue;
      const actor = series.seatToMove === current.mySeat ? a : b;
      const empty = series.board.flatMap((cell, i) => (cell === null ? [i] : []));
      const cell = empty[Math.floor(Math.random() * empty.length)];
      await request(t.server)
        .post(`/v1/matches/${id}/moves`)
        .set(actor.auth)
        .send({ cell, clientActionId: randomUUID(), expectedVersion: current.version });
    }
    throw new Error('match did not finish');
  }

  it('12 ranked matches played and finished in parallel: every result recorded exactly once, ratings zero-sum per pair', async () => {
    const pairs: { a: SocialUser; b: SocialUser; id: string }[] = [];
    for (let i = 0; i < 12; i += 1) {
      const [a, b] = await Promise.all([registerWithProfile(t), registerWithProfile(t)]);
      const id = await t.app.get(MatchesService).createMatch({
        gameId: 'tictactoe',
        kind: 'QUICK',
        seats: [{ userId: a.id }, { userId: b.id }],
        openingSeat: 0,
      });
      pairs.push({ a, b, id });
    }
    await Promise.all(
      pairs.flatMap(({ a, b, id }) =>
        [a, b].map((user) =>
          request(t.server).post(`/v1/matches/${id}/ready`).set(user.auth).send({}).expect(200),
        ),
      ),
    );
    const finished = await Promise.all(pairs.map(({ a, b, id }) => playToTheEnd(a, b, id)));
    expect(finished.every((match) => match.status === 'COMPLETED')).toBe(true);

    const results = await t.prisma.gameResult.findMany({ include: { players: true } });
    expect(results).toHaveLength(12);
    expect(new Set(results.map((result) => result.matchId)).size).toBe(12);
    for (const result of results) {
      expect(result.players).toHaveLength(2);
      const delta = result.players.reduce(
        (sum, player) => sum + ((player.ratingAfter ?? 0) - (player.ratingBefore ?? 0)),
        0,
      );
      expect(Math.abs(delta), `rating deltas of ${result.matchId}`).toBeLessThanOrEqual(1);
    }
    const ratings = await t.prisma.playerRating.findMany();
    expect(ratings).toHaveLength(24);
    expect(ratings.every((row) => row.ratedGames === 1)).toBe(true);
    // The event log of every match is contiguous and has no gaps or repeats.
    for (const { id } of pairs) {
      const events = await t.prisma.gameEvent.findMany({
        where: { matchId: id },
        orderBy: { seq: 'asc' },
        select: { seq: true },
      });
      expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
    }
  });

  it('the same move sent 8 times at once is applied once and every copy is answered', async () => {
    const [a, b] = await Promise.all([registerWithProfile(t), registerWithProfile(t)]);
    const id = await t.app.get(MatchesService).createMatch({
      gameId: 'tictactoe',
      kind: 'PRIVATE',
      seats: [{ userId: a.id }, { userId: b.id }],
      openingSeat: 0,
    });
    for (const user of [a, b]) {
      await request(t.server).post(`/v1/matches/${id}/ready`).set(user.auth).send({}).expect(200);
    }
    const before = await view(a, id);
    const opener = before.series?.seatToMove === before.mySeat ? a : b;
    const body = { cell: 4, clientActionId: randomUUID(), expectedVersion: before.version };
    const replies = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(t.server).post(`/v1/matches/${id}/moves`).set(opener.auth).send(body),
      ),
    );
    expect(replies.map((reply) => reply.status).every((status) => status === 200)).toBe(true);
    const after = await view(a, id);
    expect(after.series?.board.filter((cell) => cell !== null)).toHaveLength(1);
    expect(after.version).toBe(before.version + 1);
  });
});
