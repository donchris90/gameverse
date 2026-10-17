import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MatchView } from '@gameverse/shared-types';
import { MatchesService } from '../src/matches/matches.service.js';
import { registerWithProfile, type SocialUser } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

// Cell orders. The opener plays X and moves first.
const OPENER_WINS = [0, 3, 1, 4, 2]; // X: 0,1,2
const SECOND_WINS = [0, 3, 1, 4, 8, 5]; // X: 0,1,8  O: 3,4,5
const DRAW = [0, 1, 2, 4, 3, 5, 7, 6, 8];

interface Pair {
  a: SocialUser; // seat 0
  b: SocialUser; // seat 1
  id: string;
}

describe('matches (session service over REST)', () => {
  let t: TestApp;
  let port = 0;
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.listen(0);
    port = (t.app.getHttpServer().address() as AddressInfo).port;
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });
  afterEach(() => {
    for (const ws of sockets.splice(0)) ws.terminate();
  });

  const service = () => t.app.get(MatchesService);

  async function newPair(): Promise<Pair> {
    const a = await registerWithProfile(t);
    const b = await registerWithProfile(t);
    const id = await service().createMatch({
      gameId: 'tictactoe',
      kind: 'PRIVATE',
      seats: [{ userId: a.id }, { userId: b.id }],
    });
    return { a, b, id };
  }

  const getView = (user: SocialUser, id: string) =>
    request(t.server).get(`/v1/matches/${id}`).set(user.auth);
  const ready = (user: SocialUser, id: string) =>
    request(t.server).post(`/v1/matches/${id}/ready`).set(user.auth).send({});
  const move = (
    user: SocialUser,
    id: string,
    cell: number,
    expectedVersion: number,
    actionId = randomUUID(),
  ) =>
    request(t.server)
      .post(`/v1/matches/${id}/moves`)
      .set(user.auth)
      .send({ cell, clientActionId: actionId, expectedVersion });
  const leave = (user: SocialUser, id: string) =>
    request(t.server).post(`/v1/matches/${id}/leave`).set(user.auth).send({});
  const rematch = (user: SocialUser, id: string) =>
    request(t.server).post(`/v1/matches/${id}/rematch`).set(user.auth).send({});

  async function startPair(): Promise<Pair> {
    const pair = await newPair();
    await ready(pair.a, pair.id).expect(200);
    const started = await ready(pair.b, pair.id).expect(200);
    expect((started.body as MatchView).status).toBe('ACTIVE');
    return pair;
  }

  async function current(pair: Pair): Promise<MatchView> {
    return (await getView(pair.a, pair.id).expect(200)).body as MatchView;
  }

  /** Plays cells in order; whoever is on turn moves. Returns the final view. */
  async function playCells(pair: Pair, cells: number[]): Promise<MatchView> {
    let view = await current(pair);
    for (const cell of cells) {
      const seat = view.series?.seatToMove;
      if (seat === null || seat === undefined) throw new Error('nobody to move');
      const user = seat === 0 ? pair.a : pair.b;
      const response = await move(user, pair.id, cell, view.version);
      if (response.status !== 200) {
        throw new Error(`move ${String(cell)} failed: ${JSON.stringify(response.body)}`);
      }
      view = response.body as MatchView;
    }
    return view;
  }

  /** Makes the stored deadline overdue, then runs the sweeper once. */
  async function makeDueAndSweep(id: string): Promise<number> {
    await t.prisma.gameMatch.update({
      where: { id },
      data: { deadlineAt: new Date(Date.now() - 1000) },
    });
    return service().runDueTimers();
  }

  async function eventTypes(id: string): Promise<string[]> {
    const events = await t.prisma.gameEvent.findMany({
      where: { matchId: id },
      orderBy: { seq: 'asc' },
    });
    return events.map((event) => event.type);
  }

  async function moveCount(id: string): Promise<number> {
    return t.prisma.gameEvent.count({ where: { matchId: id, type: 'MOVE' } });
  }

  describe('access', () => {
    it.each([
      ['get', '/v1/matches/current'],
      ['get', '/v1/matches/0198a000-0000-7000-8000-000000000001'],
      ['post', '/v1/matches/0198a000-0000-7000-8000-000000000001/ready'],
      ['post', '/v1/matches/0198a000-0000-7000-8000-000000000001/moves'],
      ['post', '/v1/matches/0198a000-0000-7000-8000-000000000001/leave'],
      ['post', '/v1/matches/0198a000-0000-7000-8000-000000000001/rematch'],
    ] as const)('%s %s requires a token', async (method, path) => {
      await request(t.server)[method](path).send({}).expect(401);
    });

    it('answers 404 to someone who is not in the match, on every route', async () => {
      const { id } = await startPair();
      const stranger = await registerWithProfile(t);
      await getView(stranger, id).expect(404);
      await ready(stranger, id).expect(404);
      await move(stranger, id, 0, 2).expect(404);
      await leave(stranger, id).expect(404);
      await rematch(stranger, id).expect(404);
    });

    it('rejects a malformed match id with 400', async () => {
      const a = await registerWithProfile(t);
      await getView(a, 'not-a-uuid').expect(400);
    });

    it('a match that does not exist looks the same as one you are not in', async () => {
      const a = await registerWithProfile(t);
      const missing = await getView(a, randomUUID()).expect(404);
      const { id } = await newPair();
      const notYours = await getView(a, id).expect(404);
      expect(missing.body.error).toEqual(notYours.body.error);
    });
  });

  describe('creating and starting', () => {
    it('a new match is READY with both players, a ready deadline and no email anywhere', async () => {
      const pair = await newPair();
      const response = await getView(pair.a, pair.id).expect(200);
      const view = response.body as MatchView;
      expect(view.status).toBe('READY');
      expect(view.version).toBe(1);
      expect(view.mySeat).toBe(0);
      expect(view.series).toBeNull();
      expect(view.deadline?.kind).toBe('READY');
      expect(view.players.map((p) => p.username)).toEqual([pair.a.username, pair.b.username]);
      expect(view.players.every((p) => !p.ready)).toBe(true);
      expect(JSON.stringify(response.body)).not.toContain(pair.a.email);
      expect(JSON.stringify(response.body)).not.toContain(pair.b.email);
      expect(((await getView(pair.b, pair.id)).body as MatchView).mySeat).toBe(1);
    });

    it('starts only when both players are ready', async () => {
      const pair = await newPair();
      const first = (await ready(pair.a, pair.id).expect(200)).body as MatchView;
      expect(first.status).toBe('READY');
      expect(first.players[0]?.ready).toBe(true);
      const second = (await ready(pair.b, pair.id).expect(200)).body as MatchView;
      expect(second.status).toBe('ACTIVE');
      expect(second.series?.gameNumber).toBe(1);
      expect(second.series?.seatToMove).toBe(0);
      expect(second.deadline?.kind).toBe('TURN');
      const secondsLeft =
        (Date.parse(second.deadline?.at ?? '') - Date.parse(second.serverTime)) / 1000;
      expect(secondsLeft).toBeGreaterThan(18);
      expect(secondsLeft).toBeLessThanOrEqual(20);
    });

    it('pressing ready twice changes nothing', async () => {
      const pair = await newPair();
      await ready(pair.a, pair.id).expect(200);
      const versionAfterFirst = (await current(pair)).version;
      await ready(pair.a, pair.id).expect(200);
      expect((await current(pair)).version).toBe(versionAfterFirst);
      expect((await eventTypes(pair.id)).filter((type) => type === 'PLAYER_READY')).toHaveLength(1);
    });

    it('both players pressing ready at the same instant starts the game exactly once', async () => {
      const pair = await newPair();
      const [x, y] = await Promise.all([ready(pair.a, pair.id), ready(pair.b, pair.id)]);
      expect(x.status).toBe(200);
      expect(y.status).toBe(200);
      const types = await eventTypes(pair.id);
      expect(types.filter((type) => type === 'GAME_STARTED')).toHaveLength(1);
      expect(types.filter((type) => type === 'PLAYER_READY')).toHaveLength(2);
      expect((await current(pair)).status).toBe('ACTIVE');
    });

    it('a ready window that runs out expires the match', async () => {
      const pair = await newPair();
      await ready(pair.a, pair.id).expect(200);
      expect(await makeDueAndSweep(pair.id)).toBe(1);
      const view = await current(pair);
      expect(view.status).toBe('EXPIRED');
      expect(view.endReason).toBe('expired');
      await ready(pair.b, pair.id).expect(409);
    });

    it('a deadline that is not yet due is left alone', async () => {
      const pair = await startPair();
      expect(await service().runDueTimers()).toBe(0);
      expect((await current(pair)).status).toBe('ACTIVE');
    });
  });

  describe('a player is in at most one open match', () => {
    it('refuses a second match while one is open', async () => {
      const pair = await newPair();
      const c = await registerWithProfile(t);
      await expect(
        service().createMatch({
          gameId: 'tictactoe',
          kind: 'QUICK',
          seats: [{ userId: pair.a.id }, { userId: c.id }],
        }),
      ).rejects.toMatchObject({ code: 'ALREADY_IN_MATCH' });
    });

    it('two simultaneous attempts for the same player create exactly one match', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      const c = await registerWithProfile(t);
      const results = await Promise.allSettled([
        service().createMatch({
          gameId: 'tictactoe',
          kind: 'QUICK',
          seats: [{ userId: a.id }, { userId: b.id }],
        }),
        service().createMatch({
          gameId: 'tictactoe',
          kind: 'QUICK',
          seats: [{ userId: c.id }, { userId: a.id }],
        }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await t.prisma.gameMatch.count()).toBe(1);
    });

    it('a finished match no longer blocks a new one', async () => {
      const pair = await startPair();
      await leave(pair.a, pair.id).expect(200);
      await expect(
        service().createMatch({
          gameId: 'tictactoe',
          kind: 'QUICK',
          seats: [{ userId: pair.a.id }, { userId: pair.b.id }],
        }),
      ).resolves.toBeTypeOf('string');
    });

    it('will not match players who blocked each other', async () => {
      const a = await registerWithProfile(t);
      const b = await registerWithProfile(t);
      await request(t.server).post('/v1/blocks').set(a.auth).send({ userId: b.id }).expect(204);
      await expect(
        service().createMatch({
          gameId: 'tictactoe',
          kind: 'QUICK',
          seats: [{ userId: a.id }, { userId: b.id }],
        }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('GET /matches/current returns the open match, then null once it is over', async () => {
      const pair = await newPair();
      const mine = await request(t.server).get('/v1/matches/current').set(pair.a.auth).expect(200);
      expect(mine.body.match.id).toBe(pair.id);
      const stranger = await registerWithProfile(t);
      const none = await request(t.server)
        .get('/v1/matches/current')
        .set(stranger.auth)
        .expect(200);
      expect(none.body.match).toBeNull();
      await leave(pair.a, pair.id).expect(200);
      const after = await request(t.server).get('/v1/matches/current').set(pair.a.auth).expect(200);
      expect(after.body.match).toBeNull();
    });
  });

  describe('moves', () => {
    it('applies a move, bumps the version and gives the turn to the other seat', async () => {
      const pair = await startPair();
      const before = await current(pair);
      const after = (await move(pair.a, pair.id, 4, before.version).expect(200)).body as MatchView;
      expect(after.series?.board[4]).toBe('X');
      expect(after.series?.seatToMove).toBe(1);
      expect(after.version).toBe(before.version + 1);
      expect(after.deadline?.kind).toBe('TURN');
      // the other player sees the same position
      expect(((await getView(pair.b, pair.id)).body as MatchView).series?.board[4]).toBe('X');
    });

    it('refuses a move out of turn without changing anything', async () => {
      const pair = await startPair();
      const before = await current(pair);
      const response = await move(pair.b, pair.id, 0, before.version).expect(409);
      expect(response.body.error.code).toBe('NOT_YOUR_TURN');
      expect(await moveCount(pair.id)).toBe(0);
      expect((await current(pair)).version).toBe(before.version);
    });

    it('refuses an occupied cell', async () => {
      const pair = await startPair();
      let view = await current(pair);
      view = (await move(pair.a, pair.id, 4, view.version).expect(200)).body as MatchView;
      const response = await move(pair.b, pair.id, 4, view.version).expect(409);
      expect(response.body.error.code).toBe('INVALID_MOVE');
      expect(response.body.error.details.reason).toBe('CELL_TAKEN');
    });

    it.each([
      ['a cell off the board', { cell: 9 }],
      ['a negative cell', { cell: -1 }],
      ['a fractional cell', { cell: 1.5 }],
      ['a text cell', { cell: '3' }],
      ['a missing action id', { cell: 1, omit: 'clientActionId' }],
      ['a bad action id', { cell: 1, clientActionId: 'nope' }],
      ['a missing version', { cell: 1, omit: 'expectedVersion' }],
    ])('rejects %s with 400', async (_label, overrides) => {
      const pair = await startPair();
      const version = (await current(pair)).version;
      const { omit, ...rest } = overrides as { omit?: string } & Record<string, unknown>;
      const body: Record<string, unknown> = {
        cell: 1,
        clientActionId: randomUUID(),
        expectedVersion: version,
        ...rest,
      };
      if (omit) delete body[omit];
      const response = await request(t.server)
        .post(`/v1/matches/${pair.id}/moves`)
        .set(pair.a.auth)
        .send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(await moveCount(pair.id)).toBe(0);
    });

    it('the client cannot choose a winner, a mark or a seat: unknown fields are refused', async () => {
      const pair = await startPair();
      const version = (await current(pair)).version;
      for (const extra of [{ winner: 0 }, { mark: 'O' }, { seat: 1 }, { status: 'COMPLETED' }]) {
        const response = await request(t.server)
          .post(`/v1/matches/${pair.id}/moves`)
          .set(pair.a.auth)
          .send({ cell: 0, clientActionId: randomUUID(), expectedVersion: version, ...extra });
        expect(response.status).toBe(400);
      }
      const view = await current(pair);
      expect(view.status).toBe('ACTIVE');
      expect(view.series?.board.every((cell) => cell === null)).toBe(true);
    });

    it('refuses a move made on stale information and says what the version is now', async () => {
      const pair = await startPair();
      const stale = (await current(pair)).version;
      await move(pair.a, pair.id, 4, stale).expect(200);
      const response = await move(pair.b, pair.id, 0, stale).expect(409);
      expect(response.body.error.code).toBe('STALE_MATCH_VERSION');
      expect(response.body.error.details.version).toBe(stale + 1);
    });

    it('a retried move (same action id) is acknowledged once and applied once', async () => {
      const pair = await startPair();
      const version = (await current(pair)).version;
      const actionId = randomUUID();
      const first = await move(pair.a, pair.id, 4, version, actionId).expect(200);
      const retry = await move(pair.a, pair.id, 4, version, actionId).expect(200);
      expect((retry.body as MatchView).version).toBe((first.body as MatchView).version);
      expect(await moveCount(pair.id)).toBe(1);
    });

    it('five identical requests at the same moment still produce one move', async () => {
      const pair = await startPair();
      const version = (await current(pair)).version;
      const actionId = randomUUID();
      const responses = await Promise.all(
        Array.from({ length: 5 }, () => move(pair.a, pair.id, 4, version, actionId)),
      );
      expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      expect(await moveCount(pair.id)).toBe(1);
      expect((await current(pair)).series?.board.filter((cell) => cell !== null)).toHaveLength(1);
    });

    it('two different moves racing for the same turn: exactly one lands', async () => {
      const pair = await startPair();
      const version = (await current(pair)).version;
      const [x, y] = await Promise.all([
        move(pair.a, pair.id, 0, version),
        move(pair.a, pair.id, 1, version),
      ]);
      expect([x.status, y.status].sort()).toEqual([200, 409]);
      expect(await moveCount(pair.id)).toBe(1);
    });

    it('refuses moves before the match starts and after it ends', async () => {
      const pair = await newPair();
      await move(pair.a, pair.id, 0, 1).expect(409);
      await ready(pair.a, pair.id);
      await ready(pair.b, pair.id);
      await leave(pair.b, pair.id).expect(200);
      const view = await current(pair);
      await move(pair.a, pair.id, 0, view.version).expect(409);
    });
  });

  describe('a full best-of-three', () => {
    it('plays through to a 2-0 or 2-1 result with a complete, gap-free event log', async () => {
      const pair = await startPair();

      // Game 1: the opener (seat 0, user a) wins.
      let view = await playCells(pair, OPENER_WINS);
      expect(view.status).toBe('ACTIVE');
      expect(view.series?.phase).toBe('between_games');
      expect(view.series?.wins).toEqual([1, 0]);
      expect(view.series?.winLine).toEqual([0, 1, 2]);
      expect(view.deadline?.kind).toBe('NEXT_GAME');
      await move(pair.b, pair.id, 5, view.version).expect(409); // nobody may move between games

      // The pause ends: game 2 starts and the other seat opens.
      expect(await makeDueAndSweep(pair.id)).toBe(1);
      view = await current(pair);
      expect(view.series?.phase).toBe('playing');
      expect(view.series?.gameNumber).toBe(2);
      expect(view.series?.firstSeat).toBe(1);
      expect(view.series?.board.every((cell) => cell === null)).toBe(true);
      expect(view.deadline?.kind).toBe('TURN');

      // Game 2: seat 1 opens (X) and seat 0 (O) wins it, which wins the series 2-0.
      view = await playCells(pair, SECOND_WINS);
      expect(view.status).toBe('COMPLETED');
      expect(view.series?.phase).toBe('completed');
      expect(view.series?.winner).toBe(0);
      expect(view.series?.wins).toEqual([2, 0]);
      expect(view.winnerSeat).toBe(0);
      expect(view.endReason).toBe('score');
      expect(view.deadline).toBeNull();
      expect(view.endedAt).not.toBeNull();

      // The log is complete, in order and has no gaps; the version equals its last number.
      const events = await t.prisma.gameEvent.findMany({
        where: { matchId: pair.id },
        orderBy: { seq: 'asc' },
      });
      expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
      expect(view.version).toBe(events.length);
      const types = events.map((event) => event.type);
      expect(types.slice(0, 4)).toEqual([
        'MATCH_CREATED',
        'PLAYER_READY',
        'PLAYER_READY',
        'GAME_STARTED',
      ]);
      expect(types.filter((type) => type === 'GAME_STARTED')).toHaveLength(2);
      expect(types.filter((type) => type === 'GAME_ENDED')).toHaveLength(2);
      expect(types.filter((type) => type === 'MOVE')).toHaveLength(
        OPENER_WINS.length + SECOND_WINS.length,
      );
      expect(types.at(-1)).toBe('SERIES_ENDED');
    });

    it('goes to a third game when it is 1-1, and a drawn game counts as played', async () => {
      const pair = await startPair();
      await playCells(pair, DRAW);
      await makeDueAndSweep(pair.id);
      await playCells(pair, DRAW);
      await makeDueAndSweep(pair.id);
      const view = await playCells(pair, DRAW);
      expect(view.status).toBe('COMPLETED');
      expect(view.series?.winner).toBe('draw');
      expect(view.winnerSeat).toBeNull();
      expect(view.series?.draws).toBe(3);
      expect(view.endReason).toBe('score');
    });
  });

  describe('timers', () => {
    it('a turn that runs out loses that game', async () => {
      const pair = await startPair();
      expect(await makeDueAndSweep(pair.id)).toBe(1);
      const view = await current(pair);
      expect(view.series?.wins).toEqual([0, 1]); // seat 0 was on turn
      expect(view.series?.history[0]?.reason).toBe('timeout');
      expect(view.series?.phase).toBe('between_games');
      expect(await eventTypes(pair.id)).toContain('TIMEOUT');
    });

    it('the same overdue deadline is never resolved twice', async () => {
      const pair = await startPair();
      await t.prisma.gameMatch.update({
        where: { id: pair.id },
        data: { deadlineAt: new Date(Date.now() - 1000) },
      });
      const results = await Promise.all([
        service().runDueTimers(),
        service().runDueTimers(),
        service().runDueTimers(),
      ]);
      expect(results.reduce((sum, n) => sum + n, 0)).toBe(1);
      expect((await eventTypes(pair.id)).filter((type) => type === 'TIMEOUT')).toHaveLength(1);
    });

    it('two timeouts in a row by the same player forfeit the series', async () => {
      const pair = await startPair();
      await makeDueAndSweep(pair.id); // seat 0 times out in game 1
      await makeDueAndSweep(pair.id); // pause ends, game 2 starts (seat 1 opens)
      let view = await current(pair);
      expect(view.series?.firstSeat).toBe(1);
      view = (await move(pair.b, pair.id, 4, view.version).expect(200)).body as MatchView;
      await makeDueAndSweep(pair.id); // seat 0 is on turn and times out again
      view = await current(pair);
      expect(view.status).toBe('COMPLETED');
      expect(view.endReason).toBe('forfeit');
      expect(view.winnerSeat).toBe(1);
    });

    it('a real move in between resets the timeout count', async () => {
      const pair = await startPair();
      await makeDueAndSweep(pair.id); // seat 0 times out in game 1 (seat 1 wins it)
      await makeDueAndSweep(pair.id); // game 2 starts, seat 1 opens
      let view = await current(pair);
      view = (await move(pair.b, pair.id, 4, view.version).expect(200)).body as MatchView;
      view = (await move(pair.a, pair.id, 0, view.version).expect(200)).body as MatchView; // seat 0 moves
      await makeDueAndSweep(pair.id); // now seat 1 times out: its first timeout in a row
      view = await current(pair);
      expect(view.status).toBe('ACTIVE');
    });
  });

  describe('leaving', () => {
    it('leaving before the start cancels the match for both', async () => {
      const pair = await newPair();
      const view = (await leave(pair.a, pair.id).expect(200)).body as MatchView;
      expect(view.status).toBe('CANCELLED');
      expect(view.endReason).toBe('cancelled');
      expect(view.winnerSeat).toBeNull();
      expect(((await getView(pair.b, pair.id)).body as MatchView).status).toBe('CANCELLED');
    });

    it('leaving mid-match forfeits it to the other player', async () => {
      const pair = await startPair();
      const view = (await leave(pair.a, pair.id).expect(200)).body as MatchView;
      expect(view.status).toBe('COMPLETED');
      expect(view.endReason).toBe('left');
      expect(view.winnerSeat).toBe(1);
      expect(view.series?.endReason).toBe('forfeit');
    });

    it('leaving twice is harmless', async () => {
      const pair = await startPair();
      await leave(pair.a, pair.id).expect(200);
      const versionAfter = (await current(pair)).version;
      await leave(pair.a, pair.id).expect(200);
      await leave(pair.b, pair.id).expect(200);
      expect((await current(pair)).version).toBe(versionAfter);
    });
  });

  describe('rematch', () => {
    async function finished(): Promise<Pair> {
      const pair = await startPair();
      await playCells(pair, OPENER_WINS);
      await makeDueAndSweep(pair.id);
      await playCells(pair, SECOND_WINS);
      return pair;
    }

    it('is refused while the match is still going', async () => {
      const pair = await startPair();
      await rematch(pair.a, pair.id).expect(409);
    });

    it('needs both players: one asking only records the request', async () => {
      const pair = await finished();
      const view = (await rematch(pair.a, pair.id).expect(200)).body as MatchView;
      expect(view.rematchRequestedBy).toEqual([0]);
      expect(view.rematchMatchId).toBeNull();
      const again = (await rematch(pair.a, pair.id).expect(200)).body as MatchView;
      expect(again.version).toBe(view.version);
      expect(await t.prisma.gameMatch.count()).toBe(1);
    });

    it('creates one new match when both agree, with the opener alternating', async () => {
      const pair = await finished();
      await rematch(pair.a, pair.id).expect(200);
      const view = (await rematch(pair.b, pair.id).expect(200)).body as MatchView;
      expect(view.rematchMatchId).not.toBeNull();
      expect(await t.prisma.gameMatch.count()).toBe(2);

      const next = view.rematchMatchId ?? '';
      const fresh = (await getView(pair.a, next).expect(200)).body as MatchView;
      expect(fresh.status).toBe('READY');
      expect(fresh.players.map((p) => p.userId)).toEqual([pair.a.id, pair.b.id]);
      await ready(pair.a, next).expect(200);
      const started = (await ready(pair.b, next).expect(200)).body as MatchView;
      // The last game of the previous match was opened by seat 1, so seat 0 opens now.
      expect(started.series?.firstSeat).toBe(0);
    });

    it('asking again after the rematch exists changes nothing and makes no third match', async () => {
      const pair = await finished();
      await rematch(pair.a, pair.id).expect(200);
      const created = (await rematch(pair.b, pair.id).expect(200)).body as MatchView;
      const again = await rematch(pair.a, pair.id).expect(200);
      expect((again.body as MatchView).rematchMatchId).toBe(created.rematchMatchId);
      expect((again.body as MatchView).version).toBe(created.version);
      expect(await t.prisma.gameMatch.count()).toBe(2);
    });

    it('the opener keeps alternating: a match that ended in game 1 gives seat 1 the first move', async () => {
      const pair = await startPair(); // seat 0 opens game 1
      await leave(pair.b, pair.id).expect(200);
      await rematch(pair.a, pair.id).expect(200);
      const view = (await rematch(pair.b, pair.id).expect(200)).body as MatchView;
      const next = view.rematchMatchId ?? '';
      await ready(pair.a, next).expect(200);
      const started = (await ready(pair.b, next).expect(200)).body as MatchView;
      expect(started.series?.firstSeat).toBe(1);
      expect(started.series?.seatToMove).toBe(1);
    });

    it('both asking at the same instant still creates only one new match', async () => {
      const pair = await finished();
      const [x, y] = await Promise.all([rematch(pair.a, pair.id), rematch(pair.b, pair.id)]);
      expect(x.status).toBe(200);
      expect(y.status).toBe(200);
      expect(await t.prisma.gameMatch.count()).toBe(2);
      const first = (x.body as MatchView).rematchMatchId;
      const final = ((await getView(pair.a, pair.id)).body as MatchView).rematchMatchId;
      expect(final).not.toBeNull();
      expect(first === null || first === final).toBe(true);
    });

    it('is refused for someone already in another open match', async () => {
      const pair = await finished();
      const c = await registerWithProfile(t);
      await service().createMatch({
        gameId: 'tictactoe',
        kind: 'QUICK',
        seats: [{ userId: pair.a.id }, { userId: c.id }],
      });
      await rematch(pair.a, pair.id).expect(200);
      const response = await rematch(pair.b, pair.id);
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('ALREADY_IN_MATCH');
      expect(await t.prisma.gameMatch.count()).toBe(2);
    });
  });

  describe('bots are labelled', () => {
    it('a bot seat is marked as a bot in the data, is always ready, and has no user', async () => {
      const a = await registerWithProfile(t);
      const id = await service().createMatch({
        gameId: 'tictactoe',
        kind: 'BOT',
        seats: [{ userId: a.id }, { bot: 'HARD' }],
      });
      const view = (await getView(a, id).expect(200)).body as MatchView;
      expect(view.players[1]).toMatchObject({
        userId: null,
        bot: 'hard',
        username: 'Bot',
        ready: true,
      });
      const started = (await ready(a, id).expect(200)).body as MatchView;
      expect(started.status).toBe('ACTIVE');
    });
  });

  describe('live updates', () => {
    function connect(
      user: SocialUser,
    ): Promise<{ ws: WebSocket; events: Record<string, unknown>[] }> {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`);
        sockets.push(ws);
        const events: Record<string, unknown>[] = [];
        ws.on('message', (data) => {
          const event = JSON.parse(String(data)) as Record<string, unknown>;
          events.push(event);
          if (event['type'] === 'ready') resolve({ ws, events });
        });
        ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: user.token })));
        ws.on('error', reject);
      });
    }

    async function waitFor(
      events: Record<string, unknown>[],
      predicate: (e: Record<string, unknown>) => boolean,
    ) {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const found = events.find(predicate);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('timed out waiting for a websocket event');
    }

    it('pushes each change to both players, each with their own seat', async () => {
      const pair = await startPair();
      const [ca, cb] = await Promise.all([connect(pair.a), connect(pair.b)]);
      const version = (await current(pair)).version;
      await move(pair.a, pair.id, 4, version).expect(200);

      // A connecting client first receives a snapshot (slice 2D); the move is the later update.
      const isMove = (e: Record<string, unknown>) =>
        e['type'] === 'match.update' && (e['match'] as MatchView).version === version + 1;
      const seenByB = (await waitFor(cb.events, isMove)) as unknown as {
        match: MatchView;
      };
      const seenByA = (await waitFor(ca.events, isMove)) as unknown as {
        match: MatchView;
      };
      expect(seenByA.match.mySeat).toBe(0);
      expect(seenByB.match.mySeat).toBe(1);
      expect(seenByB.match.series?.board[4]).toBe('X');
      expect(seenByB.match.version).toBe(version + 1);
    });

    it('does not push to someone who is not in the match', async () => {
      const pair = await startPair();
      const stranger = await registerWithProfile(t);
      const cs = await connect(stranger);
      const version = (await current(pair)).version;
      await move(pair.a, pair.id, 4, version).expect(200);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(cs.events.some((e) => e['type'] === 'match.update')).toBe(false);
    });
  });
});
