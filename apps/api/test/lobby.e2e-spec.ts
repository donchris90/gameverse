import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  QUEUE_BOT_OFFER_AFTER_MS,
  QUEUE_TTL_MS,
  ROOM_CODE_PATTERN,
  type MatchView,
  type MatchmakingStatus,
  type RoomView,
} from '@gameverse/shared-types';
import { MatchmakingService } from '../src/lobby/matchmaking.service.js';
import { RoomsService } from '../src/lobby/rooms.service.js';
import { MatchesService } from '../src/matches/matches.service.js';
import { PushService } from '../src/push/push.service.js';
import { MemoryPushProvider, PushProvider } from '../src/push/push.provider.js';
import {
  befriend,
  registerUser,
  registerWithProfile,
  type SocialUser,
} from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

describe('lobby (matchmaking, private rooms, friend invites)', () => {
  let t: TestApp;
  let port = 0;
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    t = await createTestApp({ PUSH_PROVIDER: 'memory' });
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

  const matchmaking = () => t.app.get(MatchmakingService);
  const rooms = () => t.app.get(RoomsService);

  const join = (user: SocialUser, gameId = 'tictactoe') =>
    request(t.server).post('/v1/matchmaking/join').set(user.auth).send({ gameId });
  const cancel = (user: SocialUser) =>
    request(t.server).post('/v1/matchmaking/cancel').set(user.auth).send({});
  const status = async (user: SocialUser) =>
    (await request(t.server).get('/v1/matchmaking').set(user.auth).expect(200))
      .body as MatchmakingStatus;
  const createRoom = (user: SocialUser) =>
    request(t.server).post('/v1/rooms').set(user.auth).send({ gameId: 'tictactoe' });
  const joinCode = (user: SocialUser, code: string) =>
    request(t.server).post('/v1/rooms/join').set(user.auth).send({ code });
  const invite = (host: SocialUser, friend: SocialUser) =>
    request(t.server)
      .post('/v1/rooms/invite')
      .set(host.auth)
      .send({ gameId: 'tictactoe', friendUserId: friend.id });
  const overview = async (user: SocialUser) =>
    (await request(t.server).get('/v1/rooms').set(user.auth).expect(200)).body as {
      hosted: RoomView | null;
      invites: RoomView[];
    };
  const matchCount = () => t.prisma.gameMatch.count();
  const openMatchesOf = (userId: string) =>
    t.prisma.gameMatchPlayer.count({
      where: { userId, match: { status: { in: ['WAITING', 'READY', 'ACTIVE'] } } },
    });

  async function players(count: number): Promise<SocialUser[]> {
    const list: SocialUser[] = [];
    for (let i = 0; i < count; i += 1) list.push(await registerWithProfile(t));
    return list;
  }

  describe('access', () => {
    it('requires sign-in on every route', async () => {
      const routes: [string, string][] = [
        ['get', '/v1/matchmaking'],
        ['post', '/v1/matchmaking/join'],
        ['post', '/v1/matchmaking/cancel'],
        ['get', '/v1/rooms'],
        ['post', '/v1/rooms'],
        ['post', '/v1/rooms/join'],
        ['post', '/v1/rooms/invite'],
        ['post', `/v1/rooms/${randomUUID()}/accept`],
        ['post', `/v1/rooms/${randomUUID()}/decline`],
        ['delete', `/v1/rooms/${randomUUID()}`],
      ];
      for (const [method, path] of routes) {
        const response = await (
          request(t.server) as unknown as Record<string, (p: string) => request.Test>
        )[method]?.(path);
        expect(response?.status, `${method} ${path}`).toBe(401);
      }
    });

    it('needs a profile before searching, hosting or joining', async () => {
      const bare = await registerUser(t);
      const auth = { Authorization: `Bearer ${bare.session.accessToken}` };
      const noProfile = { auth } as SocialUser;
      const joined = await join(noProfile);
      expect(joined.status).toBe(409);
      expect(joined.body.error.code).toBe('PROFILE_REQUIRED');
      const created = await createRoom(noProfile);
      expect(created.status).toBe(409);
      expect(created.body.error.code).toBe('PROFILE_REQUIRED');
    });

    it('rejects unknown games and unknown fields', async () => {
      const [a] = await players(1);
      const unknownGame = await join(a as SocialUser, 'chess');
      expect(unknownGame.status).toBe(400);
      const extra = await request(t.server)
        .post('/v1/matchmaking/join')
        .set((a as SocialUser).auth)
        .send({ gameId: 'tictactoe', rating: 3000 });
      expect(extra.status).toBe(400);
      const badBody = await request(t.server)
        .post('/v1/matchmaking/cancel')
        .set((a as SocialUser).auth)
        .send({ x: 1 });
      expect(badBody.status).toBe(400);
    });
  });

  describe('quick match', () => {
    it('one player alone keeps searching', async () => {
      const [a] = (await players(1)) as [SocialUser];
      const response = await join(a).expect(200);
      const body = response.body as MatchmakingStatus;
      expect(body.state).toBe('searching');
      expect(body.searching).toMatchObject({
        gameId: 'tictactoe',
        ratingBand: 100,
        botOffer: false,
      });
      expect(await matchCount()).toBe(0);
    });

    it('two searching players are matched together, each seeing the same match', async () => {
      const [a, b] = (await players(2)) as [SocialUser, SocialUser];
      await join(a).expect(200);
      const second = (await join(b).expect(200)).body as MatchmakingStatus;
      expect(second.state).toBe('matched');

      const first = await status(a);
      expect(first.state).toBe('matched');
      expect(first.match?.id).toBe(second.match?.id);
      expect(first.match).toMatchObject({ kind: 'QUICK', status: 'READY', mySeat: 0 });
      expect(second.match?.mySeat).toBe(1);
      expect(first.match?.players.map((p) => p.bot)).toEqual([null, null]);
      expect(await t.prisma.matchQueueEntry.count()).toBe(0);
      expect(await matchCount()).toBe(1);
    });

    it('seats the player who waited longest first', async () => {
      const [a, b] = (await players(2)) as [SocialUser, SocialUser];
      await join(b);
      await join(a);
      expect((await status(b)).match?.mySeat).toBe(0);
      expect((await status(a)).match?.mySeat).toBe(1);
    });

    it('joining twice is harmless and keeps the original place in the queue', async () => {
      const [a] = (await players(1)) as [SocialUser];
      await join(a).expect(200);
      const before = await t.prisma.matchQueueEntry.findUniqueOrThrow({ where: { userId: a.id } });
      await join(a).expect(200);
      const after = await t.prisma.matchQueueEntry.findUniqueOrThrow({ where: { userId: a.id } });
      expect(await t.prisma.matchQueueEntry.count()).toBe(1);
      expect(after.joinedAt.getTime()).toBe(before.joinedAt.getTime());
    });

    it('cancel ends the search, is repeatable, and a cancelled player is never matched', async () => {
      const [a, b] = (await players(2)) as [SocialUser, SocialUser];
      await join(a);
      expect(((await cancel(a).expect(200)).body as MatchmakingStatus).state).toBe('idle');
      expect(((await cancel(a).expect(200)).body as MatchmakingStatus).state).toBe('idle');
      expect(((await join(b).expect(200)).body as MatchmakingStatus).state).toBe('searching');
      expect(await matchCount()).toBe(0);
    });

    it('can search again after cancelling', async () => {
      const [a, b] = (await players(2)) as [SocialUser, SocialUser];
      await join(a);
      await cancel(a);
      await join(a);
      expect(((await join(b).expect(200)).body as MatchmakingStatus).state).toBe('matched');
    });

    it('offers a bot only after the wait is long enough, and the offer is just a flag', async () => {
      const [a] = (await players(1)) as [SocialUser];
      await join(a);
      const entry = await t.prisma.matchQueueEntry.findUniqueOrThrow({ where: { userId: a.id } });
      const at = (ms: number) => new Date(entry.joinedAt.getTime() + ms);
      const early = await matchmaking().status(a.id, at(QUEUE_BOT_OFFER_AFTER_MS - 1));
      expect(early.searching?.botOffer).toBe(false);
      const late = await matchmaking().status(a.id, at(QUEUE_BOT_OFFER_AFTER_MS));
      expect(late.searching?.botOffer).toBe(true);
      expect(await matchCount()).toBe(0); // nothing is created behind the player's back
    });

    it('a search nobody answers ends by itself', async () => {
      const [a] = (await players(1)) as [SocialUser];
      await join(a);
      const entry = await t.prisma.matchQueueEntry.findUniqueOrThrow({ where: { userId: a.id } });
      const later = new Date(entry.joinedAt.getTime() + QUEUE_TTL_MS);
      expect((await matchmaking().status(a.id, later)).state).toBe('idle');
      await matchmaking().runMatchmaking(later);
      expect(await t.prisma.matchQueueEntry.count()).toBe(0);
    });

    it('a timed-out entry that was not swept yet does not block a new search', async () => {
      const [a] = (await players(1)) as [SocialUser];
      await join(a);
      const entry = await t.prisma.matchQueueEntry.findUniqueOrThrow({ where: { userId: a.id } });
      const later = new Date(entry.joinedAt.getTime() + QUEUE_TTL_MS + 1);
      const fresh = await matchmaking().join(a.id, 'tictactoe', later);
      expect(fresh.state).toBe('searching');
      expect(fresh.searching?.waitedMs).toBe(0);
    });

    it('does not match people whose ratings are too far apart until the band widens', async () => {
      const [a, b] = (await players(2)) as [SocialUser, SocialUser];
      const base = new Date();
      await t.prisma.matchQueueEntry.createMany({
        data: [
          { userId: a.id, gameId: 'tictactoe', rating: 1000, joinedAt: base },
          { userId: b.id, gameId: 'tictactoe', rating: 1400, joinedAt: base },
        ],
      });
      const at = (ms: number) => new Date(base.getTime() + ms);
      expect(await matchmaking().runMatchmaking(at(1_000))).toBe(0);
      expect(await matchmaking().runMatchmaking(at(25_000))).toBe(0); // band 350 < 400
      expect(await matchmaking().runMatchmaking(at(30_000))).toBe(1); // band 400
      expect((await status(a)).state).toBe('matched');
      expect(await t.prisma.matchQueueEntry.count()).toBe(0);
    });

    it('never matches blocked players with each other', async () => {
      const [a, b] = (await players(2)) as [SocialUser, SocialUser];
      await request(t.server).post('/v1/blocks').set(a.auth).send({ userId: b.id });
      await join(a);
      expect(((await join(b).expect(200)).body as MatchmakingStatus).state).toBe('searching');
      expect(await matchmaking().runMatchmaking(new Date())).toBe(0);
      expect(await matchCount()).toBe(0);
    });

    it('a blocked pair is skipped but a third player is still matched', async () => {
      const [a, b, c] = (await players(3)) as [SocialUser, SocialUser, SocialUser];
      await request(t.server).post('/v1/blocks').set(a.auth).send({ userId: b.id });
      await join(a);
      await join(b);
      const third = (await join(c).expect(200)).body as MatchmakingStatus;
      expect(third.state).toBe('matched');
      const partner = third.match?.players.find((p) => p.seat !== third.match?.mySeat);
      expect([a.id, b.id]).toContain(partner?.userId);
      expect(await t.prisma.matchQueueEntry.count()).toBe(1);
    });

    it('skips a leftover queue entry whose owner is already in a match', async () => {
      const [a, b, c] = (await players(3)) as [SocialUser, SocialUser, SocialUser];
      await join(a);
      await join(b);
      // A stale row (for example from a crash between two writes) must not drag A into a second match.
      await t.prisma.matchQueueEntry.create({
        data: { userId: a.id, gameId: 'tictactoe', rating: 1000 },
      });
      const result = (await join(c).expect(200)).body as MatchmakingStatus;
      expect(result.state).toBe('searching');
      expect(await openMatchesOf(a.id)).toBe(1);
      expect(await matchCount()).toBe(1);
    });

    it('refuses to search while already in a match', async () => {
      const [a, b] = (await players(2)) as [SocialUser, SocialUser];
      await join(a);
      await join(b);
      const again = await join(a);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('ALREADY_IN_MATCH');
    });

    it('refuses to search while hosting an open room', async () => {
      const [a] = (await players(1)) as [SocialUser];
      await createRoom(a).expect(201);
      const response = await join(a);
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVALID_STATE');
    });

    it('leaving a finished match lets the player search again', async () => {
      const [a, b, c] = (await players(3)) as [SocialUser, SocialUser, SocialUser];
      await join(a);
      const matched = (await join(b).expect(200)).body as MatchmakingStatus;
      await request(t.server)
        .post(`/v1/matches/${matched.match?.id}/leave`)
        .set(a.auth)
        .send({})
        .expect(200);
      await join(a).expect(200);
      expect(((await join(c).expect(200)).body as MatchmakingStatus).state).toBe('matched');
    });

    it('pushes the new match to both players over the socket', async () => {
      const [a, b] = (await players(2)) as [SocialUser, SocialUser];
      const events: Record<string, unknown>[] = [];
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`);
        sockets.push(ws);
        ws.on('message', (data) => {
          const event = JSON.parse(String(data)) as Record<string, unknown>;
          events.push(event);
          if (event['type'] === 'ready') resolve();
        });
        ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: a.token })));
        ws.on('error', reject);
      });
      await join(a);
      await join(b);
      const deadline = Date.now() + 3000;
      while (!events.some((e) => e['type'] === 'match.update') && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const update = events.find((e) => e['type'] === 'match.update') as
        { match: MatchView } | undefined;
      expect(update?.match).toMatchObject({ kind: 'QUICK', mySeat: 0, status: 'READY' });
    });

    describe('simultaneous searches', () => {
      it('two players joining at the same instant end up in exactly one match', async () => {
        for (let round = 0; round < 6; round += 1) {
          await resetDatabase(t.prisma);
          const [a, b] = (await players(2)) as [SocialUser, SocialUser];
          const results = await Promise.all([join(a), join(b)]);
          for (const response of results) expect(response.status).toBe(200);
          expect(await matchCount(), `round ${String(round)}`).toBe(1);
          expect(await openMatchesOf(a.id)).toBe(1);
          expect(await openMatchesOf(b.id)).toBe(1);
          expect(await t.prisma.matchQueueEntry.count()).toBe(0);
          expect((await status(a)).match?.id).toBe((await status(b)).match?.id);
        }
      });

      it('eight players joining at once make four matches and nobody is in two', async () => {
        const group = await players(8);
        const results = await Promise.all(group.map((user) => join(user)));
        for (const response of results) expect(response.status).toBe(200);
        // Anything the burst left unpaired is picked up by the sweeper pass.
        await matchmaking().runMatchmaking(new Date());
        expect(await matchCount()).toBe(4);
        expect(await t.prisma.matchQueueEntry.count()).toBe(0);
        for (const user of group) expect(await openMatchesOf(user.id)).toBe(1);
      });

      it('the same player joining from two devices at once creates one search', async () => {
        const [a] = (await players(1)) as [SocialUser];
        const results = await Promise.all([join(a), join(a), join(a)]);
        for (const response of results) expect(response.status).toBe(200);
        expect(await t.prisma.matchQueueEntry.count()).toBe(1);
      });

      it('a player cannot be queued and matched at the same time as joining a room', async () => {
        const [host, guest, other] = (await players(3)) as [SocialUser, SocialUser, SocialUser];
        const room = (await createRoom(host).expect(201)).body as RoomView;
        await join(guest);
        const [roomJoin, queueJoin] = await Promise.all([
          joinCode(guest, room.code ?? ''),
          join(other),
        ]);
        expect(roomJoin.status).toBe(200);
        expect(queueJoin.status).toBe(200);
        expect(await openMatchesOf(guest.id)).toBe(1);
        expect(await t.prisma.matchQueueEntry.count({ where: { userId: guest.id } })).toBe(0);
      });
    });
  });

  describe('private rooms', () => {
    it('creates a room with a readable code that only the host sees', async () => {
      const [host] = (await players(1)) as [SocialUser];
      const room = (await createRoom(host).expect(201)).body as RoomView;
      expect(room.code).toMatch(ROOM_CODE_PATTERN);
      expect(room).toMatchObject({
        status: 'OPEN',
        gameId: 'tictactoe',
        invited: null,
        matchId: null,
      });
      expect(room.host.userId).toBe(host.id);
      const mine = await overview(host);
      expect(mine.hosted?.id).toBe(room.id);
      expect(mine.hosted?.code).toBe(room.code);
      const ttl = new Date(room.expiresAt).getTime() - new Date(room.createdAt).getTime();
      expect(ttl).toBe(10 * 60_000);
    });

    it('a guest joins by code (any case, with spaces) and both get a private match', async () => {
      const [host, guest] = (await players(2)) as [SocialUser, SocialUser];
      const room = (await createRoom(host).expect(201)).body as RoomView;
      const response = await joinCode(guest, `  ${(room.code ?? '').toLowerCase()} `).expect(200);
      const match = response.body as MatchView;
      expect(match).toMatchObject({ kind: 'PRIVATE', status: 'READY', mySeat: 1 });
      expect(match.players.map((p) => p.userId)).toEqual([host.id, guest.id]);

      const hosted = (await overview(host)).hosted;
      expect(hosted).toMatchObject({ status: 'STARTED', matchId: match.id });
      const current = await request(t.server).get('/v1/matches/current').set(host.auth).expect(200);
      expect(current.body.match).toMatchObject({ id: match.id, mySeat: 0 });
    });

    it('a code works once: the second guest and the host themselves are refused', async () => {
      const [host, guest, late] = (await players(3)) as [SocialUser, SocialUser, SocialUser];
      const room = (await createRoom(host).expect(201)).body as RoomView;
      const own = await joinCode(host, room.code ?? '');
      expect(own.status).toBe(409);
      await joinCode(guest, room.code ?? '').expect(200);
      const second = await joinCode(late, room.code ?? '');
      expect(second.status).toBe(404);
      expect(second.body.error.code).toBe('ROOM_NOT_FOUND');
    });

    it('two guests racing for one code: exactly one gets the match', async () => {
      const [host, g1, g2] = (await players(3)) as [SocialUser, SocialUser, SocialUser];
      const room = (await createRoom(host).expect(201)).body as RoomView;
      const results = await Promise.all([
        joinCode(g1, room.code ?? ''),
        joinCode(g2, room.code ?? ''),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
      expect(await matchCount()).toBe(1);
      const loser = results.find((r) => r.status === 404);
      expect(loser?.body.error.code).toBe('ROOM_NOT_FOUND');
    });

    it('unknown codes get the same answer as expired or closed ones', async () => {
      const [host, guest] = (await players(2)) as [SocialUser, SocialUser];
      const unknown = await joinCode(guest, 'ZZZZZZ');
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('ROOM_NOT_FOUND');

      const room = (await createRoom(host).expect(201)).body as RoomView;
      await request(t.server).delete(`/v1/rooms/${room.id}`).set(host.auth).expect(200);
      const closed = await joinCode(guest, room.code ?? '');
      expect(closed.status).toBe(404);
      expect(closed.body.error).toMatchObject({
        code: 'ROOM_NOT_FOUND',
        message: unknown.body.error.message,
      });
    });

    it('rejects malformed codes before touching the database', async () => {
      const [guest] = (await players(1)) as [SocialUser];
      for (const code of ['', 'ABC', 'ABCDEFG', 'ABC0EF', 'ABCI1F', 'AB CDE']) {
        const response = await joinCode(guest, code);
        expect(response.status, code).toBe(400);
      }
    });

    it('a room past its time cannot be joined, and the sweeper records the expiry', async () => {
      const [host, guest] = (await players(2)) as [SocialUser, SocialUser];
      const room = (await createRoom(host).expect(201)).body as RoomView;
      const later = new Date(new Date(room.expiresAt).getTime() + 1);
      await expect(rooms().joinByCode(guest.id, room.code ?? '', later)).rejects.toMatchObject({
        code: 'ROOM_NOT_FOUND',
      });
      expect((await rooms().overview(host.id, later)).hosted).toBeNull();
      expect(await rooms().expireRooms(later)).toBe(1);
      const row = await t.prisma.gameRoom.findUniqueOrThrow({ where: { id: room.id } });
      expect(row.status).toBe('EXPIRED');
      expect(await rooms().expireRooms(later)).toBe(0);
      expect(await matchCount()).toBe(0);
    });

    it('a new room replaces the previous one', async () => {
      const [host, guest] = (await players(2)) as [SocialUser, SocialUser];
      const first = (await createRoom(host).expect(201)).body as RoomView;
      const second = (await createRoom(host).expect(201)).body as RoomView;
      expect(second.code).not.toBe(first.code);
      expect((await joinCode(guest, first.code ?? '')).status).toBe(404);
      await joinCode(guest, second.code ?? '').expect(200);
      expect(await t.prisma.gameRoom.count({ where: { status: 'OPEN' } })).toBe(0);
    });

    it('only the host can close a room, closing twice is fine, and a started room cannot be closed', async () => {
      const [host, guest] = (await players(2)) as [SocialUser, SocialUser];
      const room = (await createRoom(host).expect(201)).body as RoomView;
      await request(t.server).delete(`/v1/rooms/${room.id}`).set(guest.auth).expect(404);
      const closed = await request(t.server)
        .delete(`/v1/rooms/${room.id}`)
        .set(host.auth)
        .expect(200);
      expect(closed.body.status).toBe('CLOSED');
      await request(t.server).delete(`/v1/rooms/${room.id}`).set(host.auth).expect(200);

      const next = (await createRoom(host).expect(201)).body as RoomView;
      await joinCode(guest, next.code ?? '').expect(200);
      const late = await request(t.server).delete(`/v1/rooms/${next.id}`).set(host.auth);
      expect(late.status).toBe(409);
      expect(late.body.error.code).toBe('INVALID_STATE');
    });

    it('joining fails cleanly when the guest is already in a match, and the room stays open', async () => {
      const [host, guest, x] = (await players(3)) as [SocialUser, SocialUser, SocialUser];
      await matchmaking().join(guest.id, 'tictactoe');
      await matchmaking().join(x.id, 'tictactoe');
      const room = (await createRoom(host).expect(201)).body as RoomView;
      const response = await joinCode(guest, room.code ?? '');
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('ALREADY_IN_MATCH');
      const row = await t.prisma.gameRoom.findUniqueOrThrow({ where: { id: room.id } });
      expect(row.status).toBe('OPEN');
      expect(row.matchId).toBeNull();
      expect(await matchCount()).toBe(1); // only the quick match
    });

    it('creating a room is refused while in a match or searching', async () => {
      const [a, b, c] = (await players(3)) as [SocialUser, SocialUser, SocialUser];
      await join(c);
      const searching = await createRoom(c);
      expect(searching.status).toBe(409);
      expect(searching.body.error.code).toBe('ALREADY_QUEUED');
      await join(a);
      await join(b);
      const inMatch = await createRoom(a);
      expect(inMatch.status).toBe(409);
      expect(inMatch.body.error.code).toBe('ALREADY_IN_MATCH');
    });

    it('a guest who was searching has the search cancelled when they join a room', async () => {
      const [host, guest] = (await players(2)) as [SocialUser, SocialUser];
      await join(guest);
      const room = (await createRoom(host).expect(201)).body as RoomView;
      await joinCode(guest, room.code ?? '').expect(200);
      expect(await t.prisma.matchQueueEntry.count()).toBe(0);
    });

    it('a blocked pair cannot start a match through a room, and the room stays open', async () => {
      const [host, guest] = (await players(2)) as [SocialUser, SocialUser];
      const room = (await createRoom(host).expect(201)).body as RoomView;
      await request(t.server).post('/v1/blocks').set(host.auth).send({ userId: guest.id });
      const response = await joinCode(guest, room.code ?? '');
      expect(response.status).toBe(404);
      expect(await matchCount()).toBe(0);
      const row = await t.prisma.gameRoom.findUniqueOrThrow({ where: { id: room.id } });
      expect(row.status).toBe('OPEN');
    });

    it('slows down someone who keeps guessing codes, even if a later code is right', async () => {
      const [host, guesser] = (await players(2)) as [SocialUser, SocialUser];
      const room = (await createRoom(host).expect(201)).body as RoomView;
      for (let i = 0; i < 10; i += 1) {
        expect((await joinCode(guesser, 'ZZZZZZ')).status).toBe(404);
      }
      const blocked = await joinCode(guesser, room.code ?? '');
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
      expect(await matchCount()).toBe(0);
    });

    it('failed guesses by one player do not slow down another', async () => {
      const [host, guesser, honest] = (await players(3)) as [SocialUser, SocialUser, SocialUser];
      const room = (await createRoom(host).expect(201)).body as RoomView;
      for (let i = 0; i < 10; i += 1) await joinCode(guesser, 'ZZZZZZ');
      await joinCode(honest, room.code ?? '').expect(200);
    });
  });

  describe('friend invites', () => {
    it('invites only friends', async () => {
      const [host, stranger] = (await players(2)) as [SocialUser, SocialUser];
      const response = await invite(host, stranger);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      const self = await invite(host, host);
      expect(self.status).toBe(400);
      const ghost = await request(t.server)
        .post('/v1/rooms/invite')
        .set(host.auth)
        .send({ gameId: 'tictactoe', friendUserId: randomUUID() });
      expect(ghost.status).toBe(403);
    });

    it('a friend sees the invite (without the code) and accepts it into a friend match', async () => {
      const [host, friend] = (await players(2)) as [SocialUser, SocialUser];
      await befriend(t, host, friend);
      const sent = (await invite(host, friend).expect(201)).body as RoomView;
      expect(sent.invited?.userId).toBe(friend.id);
      expect(new Date(sent.expiresAt).getTime() - new Date(sent.createdAt).getTime()).toBe(
        2 * 60_000,
      );

      const incoming = (await overview(friend)).invites;
      expect(incoming).toHaveLength(1);
      expect(incoming[0]).toMatchObject({ id: sent.id, code: null, host: { userId: host.id } });

      const match = (
        await request(t.server)
          .post(`/v1/rooms/${sent.id}/accept`)
          .set(friend.auth)
          .send({})
          .expect(200)
      ).body as MatchView;
      expect(match).toMatchObject({ kind: 'FRIEND', status: 'READY', mySeat: 1 });
      expect((await overview(friend)).invites).toHaveLength(0);
      expect((await overview(host)).hosted).toMatchObject({ status: 'STARTED', matchId: match.id });
    });

    it('the invitee can decline, the host is told, and accepting afterwards fails', async () => {
      const [host, friend] = (await players(2)) as [SocialUser, SocialUser];
      await befriend(t, host, friend);
      const sent = (await invite(host, friend).expect(201)).body as RoomView;
      const declined = await request(t.server)
        .post(`/v1/rooms/${sent.id}/decline`)
        .set(friend.auth)
        .send({})
        .expect(200);
      expect(declined.body.status).toBe('DECLINED');
      await request(t.server)
        .post(`/v1/rooms/${sent.id}/decline`)
        .set(friend.auth)
        .send({})
        .expect(200);
      expect((await overview(host)).hosted).toBeNull();
      await request(t.server)
        .post(`/v1/rooms/${sent.id}/accept`)
        .set(friend.auth)
        .send({})
        .expect(404);
      expect(await matchCount()).toBe(0);
    });

    it('the host can withdraw an invite before it is answered', async () => {
      const [host, friend] = (await players(2)) as [SocialUser, SocialUser];
      await befriend(t, host, friend);
      const sent = (await invite(host, friend).expect(201)).body as RoomView;
      await request(t.server).delete(`/v1/rooms/${sent.id}`).set(host.auth).expect(200);
      expect((await overview(friend)).invites).toHaveLength(0);
      await request(t.server)
        .post(`/v1/rooms/${sent.id}/accept`)
        .set(friend.auth)
        .send({})
        .expect(404);
    });

    it('nobody else can accept, decline, or use the code of someone else’s invite', async () => {
      const [host, friend, other] = (await players(3)) as [SocialUser, SocialUser, SocialUser];
      await befriend(t, host, friend);
      const sent = (await invite(host, friend).expect(201)).body as RoomView;
      await request(t.server)
        .post(`/v1/rooms/${sent.id}/accept`)
        .set(other.auth)
        .send({})
        .expect(404);
      await request(t.server)
        .post(`/v1/rooms/${sent.id}/decline`)
        .set(other.auth)
        .send({})
        .expect(404);
      await request(t.server)
        .post(`/v1/rooms/${sent.id}/accept`)
        .set(host.auth)
        .send({})
        .expect(404);
      expect((await joinCode(other, sent.code ?? '')).status).toBe(404);
      // The invitee can also use the code from the host.
      await joinCode(friend, sent.code ?? '').expect(200);
    });

    it('an invite expires after two minutes', async () => {
      const [host, friend] = (await players(2)) as [SocialUser, SocialUser];
      await befriend(t, host, friend);
      const sent = (await invite(host, friend).expect(201)).body as RoomView;
      const later = new Date(new Date(sent.expiresAt).getTime());
      expect((await rooms().overview(friend.id, later)).invites).toHaveLength(0);
      await expect(rooms().accept(friend.id, sent.id, later)).rejects.toMatchObject({
        code: 'ROOM_NOT_FOUND',
      });
    });

    it('accepting fails if the invitee is already in a match, leaving the invite open', async () => {
      const [host, friend, x] = (await players(3)) as [SocialUser, SocialUser, SocialUser];
      await befriend(t, host, friend);
      const sent = (await invite(host, friend).expect(201)).body as RoomView;
      await join(friend);
      await join(x);
      const response = await request(t.server)
        .post(`/v1/rooms/${sent.id}/accept`)
        .set(friend.auth)
        .send({});
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('ALREADY_IN_MATCH');
      const row = await t.prisma.gameRoom.findUniqueOrThrow({ where: { id: sent.id } });
      expect(row.status).toBe('OPEN');
    });

    it('blocking after the invite stops the match', async () => {
      const [host, friend] = (await players(2)) as [SocialUser, SocialUser];
      await befriend(t, host, friend);
      const sent = (await invite(host, friend).expect(201)).body as RoomView;
      await request(t.server).post('/v1/blocks').set(friend.auth).send({ userId: host.id });
      const response = await request(t.server)
        .post(`/v1/rooms/${sent.id}/accept`)
        .set(friend.auth)
        .send({});
      expect(response.status).toBe(404);
      expect(await matchCount()).toBe(0);
    });

    it('sends the friend a push that carries no personal data beyond the inviter’s username', async () => {
      const [host, friend] = (await players(2)) as [SocialUser, SocialUser];
      await befriend(t, host, friend);
      const provider = t.app.get(PushProvider) as MemoryPushProvider;
      await t.prisma.deviceToken.create({
        data: { userId: friend.id, token: 'ExponentPushToken[friend-device]', platform: 'ANDROID' },
      });
      const sent = (await invite(host, friend).expect(201)).body as RoomView;
      await t.app.get(PushService).idle();
      expect(provider.to('ExponentPushToken[friend-device]')).toEqual([
        expect.objectContaining({
          body: `${host.username} invited you to play Tic-Tac-Toe`,
          data: { type: 'GAME_INVITE', roomId: sent.id },
        }),
      ]);
      expect(JSON.stringify(provider.sent)).not.toMatch(/@example|email|code/i);
    });

    it('tells the invitee live over the socket', async () => {
      const [host, friend] = (await players(2)) as [SocialUser, SocialUser];
      await befriend(t, host, friend);
      const events: Record<string, unknown>[] = [];
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`);
        sockets.push(ws);
        ws.on('message', (data) => {
          const event = JSON.parse(String(data)) as Record<string, unknown>;
          events.push(event);
          if (event['type'] === 'ready') resolve();
        });
        ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: friend.token })));
        ws.on('error', reject);
      });
      const sent = (await invite(host, friend).expect(201)).body as RoomView;
      const deadline = Date.now() + 3000;
      while (!events.some((e) => e['type'] === 'room.update') && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const update = events.find((e) => e['type'] === 'room.update') as
        { room: RoomView } | undefined;
      expect(update?.room).toMatchObject({ id: sent.id, code: null, status: 'OPEN' });
    });

    it('a friend who was searching can still accept; the search is cancelled', async () => {
      const [host, friend] = (await players(2)) as [SocialUser, SocialUser];
      await befriend(t, host, friend);
      await join(friend);
      const sent = (await invite(host, friend).expect(201)).body as RoomView;
      await request(t.server)
        .post(`/v1/rooms/${sent.id}/accept`)
        .set(friend.auth)
        .send({})
        .expect(200);
      expect(await t.prisma.matchQueueEntry.count()).toBe(0);
    });
  });

  describe('the match produced here is the same match the session service plays', () => {
    it('a quick match can be readied and started by both players', async () => {
      const [a, b] = (await players(2)) as [SocialUser, SocialUser];
      await join(a);
      const id = ((await join(b)).body as MatchmakingStatus).match?.id ?? '';
      await request(t.server).post(`/v1/matches/${id}/ready`).set(a.auth).send({}).expect(200);
      const started = await request(t.server)
        .post(`/v1/matches/${id}/ready`)
        .set(b.auth)
        .send({})
        .expect(200);
      expect(started.body).toMatchObject({ status: 'ACTIVE' });
      expect(await t.app.get(MatchesService).runDueTimers(new Date())).toBe(0);
    });
  });
});
