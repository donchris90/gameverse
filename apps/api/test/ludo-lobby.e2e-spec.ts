import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  MatchView,
  MatchmakingStatus,
  RoomJoinResult,
  RoomView,
} from '@gameverse/shared-types';
import { RoomsService } from '../src/lobby/rooms.service.js';
import { befriend, registerWithProfile, type SocialUser } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

describe('ludo lobby', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    await t.prisma.game.update({ where: { id: 'ludo' }, data: { enabled: true } });
  });
  afterAll(async () => {
    // Other test files rely on Ludo being off, as it ships.
    await t.prisma.game.update({ where: { id: 'ludo' }, data: { enabled: false } });
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });

  const people = async (n: number) => {
    const out: SocialUser[] = [];
    for (let i = 0; i < n; i += 1) out.push(await registerWithProfile(t));
    return out;
  };
  const createRoom = (user: SocialUser, players?: number, gameId = 'ludo') =>
    request(t.server).post('/v1/rooms').set(user.auth).send({ gameId, players });
  const joinCode = (user: SocialUser, code: string) =>
    request(t.server).post('/v1/rooms/join').set(user.auth).send({ code });
  const start = (user: SocialUser, id: string, bots?: string | null) =>
    request(t.server)
      .post(`/v1/rooms/${id}/start`)
      .set(user.auth)
      .send(bots === undefined ? {} : { bots });
  const leaveRoom = (user: SocialUser, id: string) =>
    request(t.server).post(`/v1/rooms/${id}/leave`).set(user.auth).send({});
  const overview = async (user: SocialUser) =>
    (await request(t.server).get('/v1/rooms').set(user.auth).expect(200)).body as {
      hosted: RoomView | null;
      joined: RoomView | null;
      invites: RoomView[];
    };
  const queue = (user: SocialUser, players?: number, gameId = 'ludo') =>
    request(t.server).post('/v1/matchmaking/join').set(user.auth).send({ gameId, players });
  const matchOf = async (user: SocialUser, id: string) =>
    (await request(t.server).get(`/v1/matches/${id}`).set(user.auth).expect(200)).body as MatchView;

  describe('private rooms for 2 to 4', () => {
    it.each([2, 3, 4])('a room for %i starts when the last seat is taken', async (n) => {
      const users = await people(n);
      const [host, ...guests] = users as [SocialUser, ...SocialUser[]];
      const room = (await createRoom(host, n).expect(201)).body as RoomView;
      expect(room).toMatchObject({ seats: n, members: [], status: 'OPEN' });

      let last: RoomJoinResult | null = null;
      for (const [index, guest] of guests.entries()) {
        last = (await joinCode(guest, room.code ?? '').expect(200)).body as RoomJoinResult;
        if (index < guests.length - 1) {
          expect(last.match).toBeNull();
          expect(last.room.members).toHaveLength(index + 1);
          expect(last.room.status).toBe('OPEN');
        }
      }
      const match = last?.match;
      if (!match) throw new Error('the last guest should have started the match');
      expect(match).toMatchObject({ gameId: 'ludo', kind: 'PRIVATE', status: 'READY' });
      expect(match.players.map((p) => p.userId)).toEqual(users.map((u) => u.id));
      expect(match.mySeat).toBe(n - 1);
      expect(last?.room).toMatchObject({ status: 'STARTED', matchId: match.id });
      for (const user of users) {
        const mine = await overview(user);
        expect(mine.hosted?.status ?? mine.joined?.status).toBe('STARTED');
        expect((await matchOf(user, match.id)).id).toBe(match.id);
      }
    });

    it('defaults to two seats, and refuses sizes the game does not allow', async () => {
      const [host] = await people(1);
      expect(((await createRoom(host as SocialUser).expect(201)).body as RoomView).seats).toBe(2);
      await createRoom(host as SocialUser, 5).expect(400);
      await createRoom(host as SocialUser, 1).expect(400);
      expect((await createRoom(host as SocialUser, 3, 'tictactoe')).status).toBe(400);
    });

    it('lets waiting guests see the room, and treats a second join as a no-op', async () => {
      const [host, a, b] = (await people(3)) as [SocialUser, SocialUser, SocialUser];
      const room = (await createRoom(host, 4).expect(201)).body as RoomView;
      await joinCode(a, room.code ?? '').expect(200);
      const again = (await joinCode(a, room.code ?? '').expect(200)).body as RoomJoinResult;
      expect(again.room.members).toHaveLength(1);
      await joinCode(b, room.code ?? '').expect(200);

      const mine = await overview(a);
      expect(mine.joined).toMatchObject({ id: room.id, status: 'OPEN', code: null });
      expect(mine.joined?.members.map((m) => m.userId)).toEqual([a.id, b.id]);
      expect((await overview(host)).hosted?.members).toHaveLength(2);
    });

    it('lets the host start early with the people who are there', async () => {
      const [host, a, b] = (await people(3)) as [SocialUser, SocialUser, SocialUser];
      const room = (await createRoom(host, 4).expect(201)).body as RoomView;
      await joinCode(a, room.code ?? '').expect(200);
      await joinCode(b, room.code ?? '').expect(200);
      const match = (await start(host, room.id).expect(200)).body as MatchView;
      expect(match).toMatchObject({ kind: 'PRIVATE', status: 'READY' });
      expect(match.players).toHaveLength(3);
      expect(match.players.every((p) => p.bot === null)).toBe(true);
      // Starting again gives the same match and creates nothing new.
      const again = (await start(host, room.id).expect(200)).body as MatchView;
      expect(again.id).toBe(match.id);
      expect(await t.prisma.gameMatch.count()).toBe(1);
    });

    it('fills the empty seats with labelled bots only when the host asks, as a bot match', async () => {
      const [host, a] = (await people(2)) as [SocialUser, SocialUser];
      const room = (await createRoom(host, 4).expect(201)).body as RoomView;
      await joinCode(a, room.code ?? '').expect(200);
      const match = (await start(host, room.id, 'hard').expect(200)).body as MatchView;
      expect(match.kind).toBe('BOT');
      expect(match.players).toHaveLength(4);
      const bots = match.players.filter((p) => p.bot !== null);
      expect(bots).toHaveLength(2);
      for (const bot of bots) {
        expect(bot).toMatchObject({ username: 'Bot', userId: null, bot: 'hard' });
      }
      const humans = match.players.filter((p) => p.bot === null).map((p) => p.userId);
      expect(humans).toEqual([host.id, a.id]);
    });

    it('does not start a room with only the host', async () => {
      const [host] = (await people(1)) as [SocialUser];
      const room = (await createRoom(host, 3).expect(201)).body as RoomView;
      expect((await start(host, room.id)).status).toBe(409);
      expect((await start(host, room.id, 'easy')).status).toBe(409);
      expect(await t.prisma.gameMatch.count()).toBe(0);
    });

    it('lets only the host start, and only an open room', async () => {
      const [host, a, outsider] = (await people(3)) as [SocialUser, SocialUser, SocialUser];
      const room = (await createRoom(host, 3).expect(201)).body as RoomView;
      await joinCode(a, room.code ?? '').expect(200);
      expect((await start(a, room.id)).status).toBe(404);
      expect((await start(outsider, room.id)).status).toBe(404);
      await request(t.server).delete(`/v1/rooms/${room.id}`).set(host.auth).expect(200);
      expect((await start(host, room.id)).status).toBe(404);
    });

    it('lets a guest leave, then join something else', async () => {
      const [host, a, other] = (await people(3)) as [SocialUser, SocialUser, SocialUser];
      const room = (await createRoom(host, 3).expect(201)).body as RoomView;
      await joinCode(a, room.code ?? '').expect(200);
      const left = (await leaveRoom(a, room.id).expect(200)).body as RoomView;
      expect(left.members).toEqual([]);
      expect((await overview(a)).joined).toBeNull();
      expect((await leaveRoom(a, room.id)).status).toBe(404); // not a member any more
      expect((await leaveRoom(other, room.id)).status).toBe(404);

      const otherRoom = (await createRoom(other, 2).expect(201)).body as RoomView;
      await joinCode(a, otherRoom.code ?? '').expect(200);
    });

    it('keeps a guest from hosting, searching or playing bots while they sit in a room', async () => {
      const [host, a] = (await people(2)) as [SocialUser, SocialUser];
      const room = (await createRoom(host, 3).expect(201)).body as RoomView;
      await joinCode(a, room.code ?? '').expect(200);
      expect((await createRoom(a, 2)).status).toBe(409);
      expect((await queue(a)).status).toBe(409);
      expect(
        (
          await request(t.server)
            .post('/v1/matches/bot')
            .set(a.auth)
            .send({ gameId: 'ludo', level: 'easy', players: 2 })
        ).status,
      ).toBe(409);
      const second = (await people(1))[0] as SocialUser;
      const other = (await createRoom(second, 2).expect(201)).body as RoomView;
      expect((await joinCode(a, other.code ?? '')).status).toBe(409);
    });

    it('answers a blocked guest exactly like a room that does not exist', async () => {
      const [host, a, blockedGuest] = (await people(3)) as [SocialUser, SocialUser, SocialUser];
      const room = (await createRoom(host, 4).expect(201)).body as RoomView;
      await joinCode(a, room.code ?? '').expect(200);
      await request(t.server)
        .post('/v1/blocks')
        .set(a.auth)
        .send({ userId: blockedGuest.id })
        .expect(204);
      const blocked = await joinCode(blockedGuest, room.code ?? '');
      expect(blocked.status).toBe(404);
      expect(blocked.body.error.code).toBe('ROOM_NOT_FOUND');
      expect((await overview(host)).hosted?.members).toHaveLength(1);
    });

    it('frees guests when the host closes the room or it expires', async () => {
      const [host, a, b] = (await people(3)) as [SocialUser, SocialUser, SocialUser];
      const room = (await createRoom(host, 4).expect(201)).body as RoomView;
      await joinCode(a, room.code ?? '').expect(200);
      await request(t.server).delete(`/v1/rooms/${room.id}`).set(host.auth).expect(200);
      expect((await overview(a)).joined).toBeNull();
      await queue(a).expect(200); // no longer blocked by the closed room

      const second = (await createRoom(host, 4).expect(201)).body as RoomView;
      await joinCode(b, second.code ?? '').expect(200);
      const later = new Date(Date.now() + 11 * 60_000);
      expect(await t.app.get(RoomsService).expireRooms(later)).toBe(1);
      expect((await overview(b)).joined).toBeNull();
    });

    it('turns a friend invite into a two-player friend match', async () => {
      const [host, friend] = (await people(2)) as [SocialUser, SocialUser];
      await befriend(t, host, friend);
      const invited = (
        await request(t.server)
          .post('/v1/rooms/invite')
          .set(host.auth)
          .send({ gameId: 'ludo', friendUserId: friend.id })
          .expect(201)
      ).body as RoomView;
      expect(invited.seats).toBe(2);
      const match = (
        await request(t.server)
          .post(`/v1/rooms/${invited.id}/accept`)
          .set(friend.auth)
          .send({})
          .expect(200)
      ).body as MatchView;
      expect(match).toMatchObject({ gameId: 'ludo', kind: 'FRIEND' });
      expect(match.players).toHaveLength(2);
    });
  });

  describe('quick match for 2 to 4', () => {
    const status = async (user: SocialUser) =>
      (await request(t.server).get('/v1/matchmaking').set(user.auth).expect(200))
        .body as MatchmakingStatus;

    it('waits for a full table and then seats everyone together', async () => {
      const users = await people(4);
      for (const user of users.slice(0, 3)) {
        const joined = (await queue(user, 4).expect(200)).body as MatchmakingStatus;
        expect(joined.state).toBe('searching');
        expect(joined.searching?.players).toBe(4);
      }
      expect(await t.prisma.gameMatch.count()).toBe(0);
      const last = (await queue(users[3] as SocialUser, 4).expect(200)).body as MatchmakingStatus;
      expect(last.state).toBe('matched');
      expect(last.match).toMatchObject({ gameId: 'ludo', kind: 'QUICK' });
      expect(last.match?.players).toHaveLength(4);
      for (const user of users) expect((await status(user)).state).toBe('matched');
      expect(await t.prisma.matchQueueEntry.count()).toBe(0);
      // The longest waiter takes seat 0.
      expect(last.match?.players[0]?.userId).toBe((users[0] as SocialUser).id);
    });

    it('keeps tables of different sizes apart', async () => {
      const [a, b, c, d] = (await people(4)) as [SocialUser, SocialUser, SocialUser, SocialUser];
      // The wrong-sized searches waited longest, so a size-blind pairing would pick them first.
      await queue(b, 3).expect(200);
      await queue(c, 4).expect(200);
      await queue(a, 2).expect(200);
      expect(await t.prisma.gameMatch.count()).toBe(0);
      const second = (await queue(d, 2).expect(200)).body as MatchmakingStatus;
      expect(second.match?.players.map((p) => p.userId).sort()).toEqual([a.id, d.id].sort());
      expect((await status(b)).state).toBe('searching');
      expect((await status(c)).state).toBe('searching');
    });

    it('does not seat a blocked pair at the same table', async () => {
      const [a, b, c] = (await people(3)) as [SocialUser, SocialUser, SocialUser];
      await request(t.server).post('/v1/blocks').set(a.auth).send({ userId: b.id }).expect(204);
      await queue(a, 3).expect(200);
      await queue(b, 3).expect(200);
      const third = (await queue(c, 3).expect(200)).body as MatchmakingStatus;
      expect(third.state).toBe('searching');
      expect(await t.prisma.gameMatch.count()).toBe(0);
    });

    it('refuses sizes the game does not allow and a changed size mid-search', async () => {
      const [a] = (await people(1)) as [SocialUser];
      await queue(a, 5).expect(400);
      expect((await queue(a, 3, 'tictactoe')).status).toBe(400);
      await queue(a, 3).expect(200);
      const changed = await queue(a, 4);
      expect(changed.status).toBe(409);
      expect(changed.body.error.code).toBe('ALREADY_QUEUED');
      await queue(a, 3).expect(200); // the same search again is harmless
      expect(await t.prisma.matchQueueEntry.count()).toBe(1);
    });

    it('defaults to a two-player search', async () => {
      const [a, b] = (await people(2)) as [SocialUser, SocialUser];
      await queue(a).expect(200);
      const matched = (await queue(b).expect(200)).body as MatchmakingStatus;
      expect(matched.match?.players).toHaveLength(2);
    });

    it('offers a bot after the wait, and the bot game keeps the chosen size', async () => {
      const [a] = (await people(1)) as [SocialUser];
      await queue(a, 3).expect(200);
      const entry = await t.prisma.matchQueueEntry.findUniqueOrThrow({ where: { userId: a.id } });
      const waited = await t.app
        .get((await import('../src/lobby/matchmaking.service.js')).MatchmakingService)
        .status(a.id, new Date(entry.joinedAt.getTime() + 21_000));
      expect(waited.searching).toMatchObject({ players: 3, botOffer: true });
      const bot = (
        await request(t.server)
          .post('/v1/matches/bot')
          .set(a.auth)
          .send({ gameId: 'ludo', level: 'medium', players: 3 })
          .expect(201)
      ).body as MatchView;
      expect(bot.players.filter((p) => p.bot !== null)).toHaveLength(2);
      expect(await t.prisma.matchQueueEntry.count()).toBe(0); // starting a bot game ends the search
    });
  });
});
