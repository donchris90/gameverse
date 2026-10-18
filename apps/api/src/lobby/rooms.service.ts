import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type GameId,
  type LobbyOverview,
  type MatchView,
  type RoomJoinResult,
  type RoomView,
} from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';
import type { GameRoom } from '../generated/prisma/client.js';
import type { BotLevel } from '../generated/prisma/enums.js';
import { OPEN_STATUSES } from '../matches/matches.constants.js';
import { BOT_TO_DB, MatchesService } from '../matches/matches.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushService } from '../push/push.service.js';
import { EntryService } from '../matches/entry.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { RealtimeHub } from '../realtime/realtime.hub.js';
import { areFriends, isBlockedEitherWay } from '../social/relationships.js';
import { runSerializable, type Tx } from '../social/serializable.js';
import {
  INVITE_TTL_MS,
  JOIN_FAILURE_LIMIT,
  JOIN_FAILURE_WINDOW_MS,
  MAX_INVITES_SHOWN,
  ROOM_TTL_MS,
  STARTED_VISIBLE_MS,
} from './lobby.constants.js';
import { toRoomView } from './room.view.js';

function roomNotFound(): AppException {
  // One answer for "no such code", "expired", "not for you" and "already taken".
  return new AppException(HttpStatus.NOT_FOUND, ErrorCode.ROOM_NOT_FOUND, 'Room not found');
}

function generateCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET.charAt(randomInt(0, ROOM_CODE_ALPHABET.length));
  }
  return code;
}

export type { LobbyOverview };

const GAME_NAMES: Record<GameId, string> = {
  tictactoe: 'Tic-Tac-Toe',
  ludo: 'Ludo',
  draughts: 'Draughts',
  ayo: 'Ayo',
};

@Injectable()
export class RoomsService {
  private readonly joinFailures = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly matches: MatchesService,
    private readonly hub: RealtimeHub,
    private readonly push: PushService,
    private readonly wallet: WalletService,
    private readonly entry: EntryService,
  ) {}

  // ----------------------------------------------------------------- reading

  private async viewsFor(rooms: readonly GameRoom[], viewerId: string, now: Date) {
    const memberRows = await this.prisma.gameRoomMember.findMany({
      where: { roomId: { in: rooms.map((r) => r.id) } },
      orderBy: { joinedAt: 'asc' },
      select: { roomId: true, userId: true },
    });
    const membersOf = (roomId: string) =>
      memberRows.filter((row) => row.roomId === roomId).map((row) => row.userId);
    const ids = [
      ...new Set([
        ...rooms.flatMap((r) => [r.hostId, ...(r.invitedUserId ? [r.invitedUserId] : [])]),
        ...memberRows.map((row) => row.userId),
      ]),
    ];
    const profiles = await this.prisma.userProfile.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, username: true, avatarId: true },
    });
    const lookup = new Map(profiles.map((p) => [p.userId, p]));
    return rooms.map((room) => toRoomView(room, viewerId, lookup, now, membersOf(room.id)));
  }

  async overview(userId: string, now: Date = new Date()): Promise<LobbyOverview> {
    const hosted = await this.prisma.gameRoom.findFirst({
      where: {
        hostId: userId,
        OR: [
          { status: 'OPEN', expiresAt: { gt: now } },
          { status: 'STARTED', respondedAt: { gt: new Date(now.getTime() - STARTED_VISIBLE_MS) } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    const invites = await this.prisma.gameRoom.findMany({
      where: { invitedUserId: userId, status: 'OPEN', expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      take: MAX_INVITES_SHOWN,
    });
    const joined = await this.prisma.gameRoom.findFirst({
      where: {
        members: { some: { userId } },
        OR: [
          { status: 'OPEN', expiresAt: { gt: now } },
          { status: 'STARTED', respondedAt: { gt: new Date(now.getTime() - STARTED_VISIBLE_MS) } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    const [hostedView] = hosted ? await this.viewsFor([hosted], userId, now) : [];
    const [joinedView] = joined ? await this.viewsFor([joined], userId, now) : [];
    return {
      hosted: hostedView ?? null,
      joined: joinedView ?? null,
      invites: await this.viewsFor(invites, userId, now),
    };
  }

  /** Tells both parties the room changed. Best effort: REST is the truth. */
  private async announce(roomId: string): Promise<void> {
    try {
      const room = await this.prisma.gameRoom.findUnique({ where: { id: roomId } });
      if (!room) return;
      const now = new Date();
      const members = await this.prisma.gameRoomMember.findMany({
        where: { roomId: room.id },
        select: { userId: true },
      });
      const audience = new Set([
        room.hostId,
        ...(room.invitedUserId ? [room.invitedUserId] : []),
        ...members.map((member) => member.userId),
      ]);
      for (const userId of audience) {
        const [view] = await this.viewsFor([room], userId, now);
        if (view) this.hub.publishToUser(userId, { type: 'room.update', room: view });
      }
    } catch {
      // clients refresh on reconnect
    }
  }

  // ---------------------------------------------------------------- creating

  private async assertCanHost(tx: Tx, userId: string): Promise<void> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { status: true, profile: { select: { userId: true } } },
    });
    if (!user || user.status !== 'ACTIVE' || !user.profile) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.PROFILE_REQUIRED,
        'Choose a username first',
      );
    }
    const open = await tx.gameMatchPlayer.count({
      where: { userId, outAt: null, match: { status: { in: [...OPEN_STATUSES] } } },
    });
    if (open > 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.ALREADY_IN_MATCH,
        'Finish or leave your current match first',
      );
    }
    if ((await tx.matchQueueEntry.count({ where: { userId } })) > 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.ALREADY_QUEUED,
        'Cancel your search before creating a room',
      );
    }
    await this.assertNotInOpenRoom(tx, userId, new Date());
  }

  /** Someone who joined a room with a code cannot also host or join another until they leave it. */
  private async assertNotInOpenRoom(tx: Tx, userId: string, now: Date): Promise<void> {
    const joined = await tx.gameRoomMember.count({
      where: { userId, room: { status: 'OPEN', expiresAt: { gt: now } } },
    });
    if (joined > 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE,
        'Leave your current room first',
      );
    }
  }

  private async open(
    hostId: string,
    gameId: GameId,
    invitedUserId: string | null,
    now: Date,
    players = 2,
    entryFee = 0,
  ): Promise<GameRoom> {
    const room = await runSerializable(this.prisma, async (tx) => {
      const game = await tx.game.findUnique({ where: { id: gameId } });
      if (!game || !game.enabled) {
        throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Game not found');
      }
      if (players < game.minPlayers || players > game.maxPlayers) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_FAILED,
          `This game is for ${game.minPlayers === game.maxPlayers ? game.minPlayers : `${game.minPlayers} to ${game.maxPlayers}`} players`,
        );
      }
      await this.assertCanHost(tx, hostId);
      if (entryFee > 0) {
        await this.entry.assertAllowed(tx, { fee: entryFee, kind: 'PRIVATE', allHuman: true });
        await this.wallet.assertCanPay(tx, hostId, entryFee);
      }
      if (invitedUserId !== null) {
        // Same answer whether the person does not exist, is not a friend, or blocked you.
        const invitee = await tx.user.findUnique({
          where: { id: invitedUserId },
          select: { status: true },
        });
        if (
          !invitee ||
          invitee.status !== 'ACTIVE' ||
          !(await areFriends(tx, hostId, invitedUserId))
        ) {
          throw new AppException(
            HttpStatus.FORBIDDEN,
            ErrorCode.FORBIDDEN,
            'You can only invite friends',
          );
        }
      }
      // A new room replaces the previous one: a host has at most one open room.
      await tx.gameRoom.updateMany({
        where: { hostId, status: 'OPEN' },
        data: { status: 'CLOSED', respondedAt: now },
      });
      return tx.gameRoom.create({
        data: {
          code: generateCode(),
          gameId,
          hostId,
          invitedUserId,
          seats: players,
          entryFee,
          expiresAt: new Date(now.getTime() + (invitedUserId ? INVITE_TTL_MS : ROOM_TTL_MS)),
          createdAt: now,
        },
      });
    });
    await this.announce(room.id);
    return room;
  }

  async create(
    hostId: string,
    gameId: GameId,
    players = 2,
    now: Date = new Date(),
    entryFee = 0,
  ): Promise<RoomView> {
    const room = await this.open(hostId, gameId, null, now, players, entryFee);
    const [view] = await this.viewsFor([room], hostId, now);
    return view as RoomView;
  }

  async invite(
    hostId: string,
    friendUserId: string,
    gameId: GameId,
    now: Date = new Date(),
    entryFee = 0,
  ): Promise<RoomView> {
    if (friendUserId === hostId) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'You cannot invite yourself',
      );
    }
    const room = await this.open(hostId, gameId, friendUserId, now, 2, entryFee);
    const host = await this.prisma.userProfile.findUnique({
      where: { userId: hostId },
      select: { username: true },
    });
    this.push.notify(friendUserId, {
      title: 'GameVerse',
      body: `${host?.username ?? 'A friend'} invited you to play ${GAME_NAMES[gameId]}`,
      data: { type: 'GAME_INVITE', roomId: room.id },
    });
    const [view] = await this.viewsFor([room], hostId, now);
    return view as RoomView;
  }

  // ----------------------------------------------------------------- joining

  private checkNotGuessing(userId: string, now: Date): void {
    const entry = this.joinFailures.get(userId);
    if (entry && entry.resetAt > now.getTime() && entry.count >= JOIN_FAILURE_LIMIT) {
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorCode.RATE_LIMITED,
        'Too many wrong room codes. Try again in a few minutes.',
      );
    }
  }

  private recordFailure(userId: string, now: Date): void {
    const entry = this.joinFailures.get(userId);
    if (!entry || entry.resetAt <= now.getTime()) {
      this.joinFailures.set(userId, { count: 1, resetAt: now.getTime() + JOIN_FAILURE_WINDOW_MS });
    } else {
      entry.count += 1;
    }
  }

  /**
   * Starts the match for an OPEN room with the host in seat 0 and the guests behind them in the
   * order they joined. `bots` fills the seats nobody took with labelled bots (and makes the match
   * a bot match: practice XP, no rating). Runs inside the caller's SERIALIZABLE transaction.
   */
  private async startRoom(
    tx: Tx,
    room: GameRoom,
    guestIds: readonly string[],
    now: Date,
    bots: BotLevel | null = null,
  ): Promise<string> {
    // The guests chose this game: any search or other room they had is over.
    await tx.matchQueueEntry.deleteMany({ where: { userId: { in: [...guestIds] } } });
    await tx.gameRoomMember.deleteMany({
      where: { userId: { in: [...guestIds] }, roomId: { not: room.id } },
    });
    const humans = 1 + guestIds.length;
    const botSeats = bots === null ? 0 : Math.max(0, room.seats - humans);
    const seats = [
      { userId: room.hostId },
      ...guestIds.map((userId) => ({ userId })),
      ...Array.from({ length: botSeats }, () => ({ bot: bots as BotLevel })),
    ];
    const matchId = await this.matches.createMatch(
      {
        gameId: room.gameId as GameId,
        kind: botSeats > 0 ? 'BOT' : room.invitedUserId === null ? 'PRIVATE' : 'FRIEND',
        seats,
        openingSeat: randomInt(0, seats.length) as 0 | 1 | 2 | 3,
        entryFee: room.entryFee,
      },
      tx,
    );
    await tx.gameRoom.update({
      where: { id: room.id },
      data: { status: 'STARTED', matchId, respondedAt: now },
    });
    return matchId;
  }

  /**
   * Adds the player to an open room, and starts the match when that fills the last seat.
   * Joining twice is harmless. Every "no" is the same room-not-found answer.
   */
  private async enter(
    userId: string,
    find: (tx: Tx) => Promise<GameRoom | null>,
    now: Date,
    confirmedFee: number | null,
  ): Promise<{ matchId: string | null; roomId: string }> {
    return runSerializable(this.prisma, async (tx) => {
      const room = await find(tx);
      if (
        !room ||
        room.status !== 'OPEN' ||
        room.expiresAt.getTime() <= now.getTime() ||
        (room.invitedUserId !== null && room.invitedUserId !== userId)
      ) {
        throw roomNotFound();
      }
      if (room.hostId === userId) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATE,
          'You cannot join your own room',
        );
      }
      const members = await tx.gameRoomMember.findMany({
        where: { roomId: room.id },
        orderBy: { joinedAt: 'asc' },
        select: { userId: true },
      });
      if (members.some((member) => member.userId === userId)) {
        return { matchId: null, roomId: room.id };
      }
      if (room.entryFee > 0) {
        // Joining a paid room by code must be a deliberate yes to this exact fee. Accepting an
        // invitation passes null: the invitation itself showed the fee.
        if (confirmedFee !== null && confirmedFee !== room.entryFee) {
          throw new AppException(
            HttpStatus.CONFLICT,
            ErrorCode.ENTRY_FEE_CONFIRMATION_REQUIRED,
            'This room has an entry fee. Confirm it to join.',
            { entryFee: room.entryFee },
          );
        }
        await this.wallet.assertCanPay(tx, userId, room.entryFee);
      }
      await this.assertNotInOpenRoom(tx, userId, now);
      for (const other of [room.hostId, ...members.map((member) => member.userId)]) {
        if (await isBlockedEitherWay(tx, userId, other)) throw roomNotFound();
      }
      await tx.gameRoomMember.create({ data: { roomId: room.id, userId, joinedAt: now } });
      const guestIds = [...members.map((member) => member.userId), userId];
      if (1 + guestIds.length < room.seats) return { matchId: null, roomId: room.id };
      return { matchId: await this.startRoom(tx, room, guestIds, now), roomId: room.id };
    });
  }

  private async startAndShow(
    userId: string,
    find: (tx: Tx) => Promise<GameRoom | null>,
    now: Date,
    confirmedFee: number | null,
  ): Promise<RoomJoinResult> {
    const { matchId, roomId } = await this.enter(userId, find, now, confirmedFee);
    if (matchId !== null) await this.matches.publish(matchId);
    await this.announce(roomId);
    const room = await this.prisma.gameRoom.findUniqueOrThrow({ where: { id: roomId } });
    const [view] = await this.viewsFor([room], userId, now);
    return {
      room: view as RoomView,
      match: matchId === null ? null : await this.matches.get(userId, matchId),
    };
  }

  async joinByCode(
    userId: string,
    code: string,
    now: Date = new Date(),
    confirmedFee = 0,
  ): Promise<RoomJoinResult> {
    this.checkNotGuessing(userId, now);
    try {
      return await this.startAndShow(
        userId,
        (tx) => tx.gameRoom.findUnique({ where: { code } }),
        now,
        confirmedFee,
      );
    } catch (error) {
      if (error instanceof AppException && error.getStatus() === HttpStatus.NOT_FOUND) {
        this.recordFailure(userId, now);
      }
      throw error;
    }
  }

  async accept(userId: string, roomId: string, now: Date = new Date()): Promise<MatchView> {
    const result = await this.startAndShow(
      userId,
      async (tx) => {
        const room = await tx.gameRoom.findUnique({ where: { id: roomId } });
        return room !== null && room.invitedUserId === userId ? room : null;
      },
      now,
      null,
    );
    if (result.match === null) throw roomNotFound();
    return result.match;
  }

  /**
   * The host starts the room now: with the guests who are here, or with labelled bots in the empty
   * seats. Starting twice returns the same match.
   */
  async hostStart(
    userId: string,
    roomId: string,
    bots: 'easy' | 'medium' | 'hard' | null,
    now: Date = new Date(),
  ): Promise<MatchView> {
    const level: BotLevel | null = bots === null ? null : (BOT_TO_DB[bots] as BotLevel);
    const started = await runSerializable(this.prisma, async (tx) => {
      const room = await tx.gameRoom.findUnique({ where: { id: roomId } });
      if (!room || room.hostId !== userId) throw roomNotFound();
      if (room.status === 'STARTED' && room.matchId !== null) {
        return { matchId: room.matchId, fresh: false };
      }
      if (room.status !== 'OPEN' || room.expiresAt.getTime() <= now.getTime()) throw roomNotFound();
      const members = await tx.gameRoomMember.findMany({
        where: { roomId: room.id },
        orderBy: { joinedAt: 'asc' },
        select: { userId: true },
      });
      if (members.length === 0) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATE,
          'Wait for another player to join, or start a game against bots from the Play tab',
        );
      }
      const matchId = await this.startRoom(
        tx,
        room,
        members.map((member) => member.userId),
        now,
        level,
      );
      return { matchId, fresh: true };
    });
    if (started.fresh) {
      await this.matches.publish(started.matchId);
      await this.announce(roomId);
    }
    return this.matches.get(userId, started.matchId);
  }

  /** A guest leaves a room they joined, before it starts. */
  async leave(userId: string, roomId: string, now: Date = new Date()): Promise<RoomView> {
    await runSerializable(this.prisma, async (tx) => {
      const room = await tx.gameRoom.findUnique({ where: { id: roomId } });
      const member = room
        ? await tx.gameRoomMember.findUnique({
            where: { roomId_userId: { roomId, userId } },
          })
        : null;
      if (!room || !member || room.status !== 'OPEN') throw roomNotFound();
      await tx.gameRoomMember.delete({ where: { id: member.id } });
    });
    await this.announce(roomId);
    const room = await this.prisma.gameRoom.findUniqueOrThrow({ where: { id: roomId } });
    const [view] = await this.viewsFor([room], userId, now);
    return view as RoomView;
  }

  // ------------------------------------------------------------------ closing

  async decline(userId: string, roomId: string, now: Date = new Date()): Promise<RoomView> {
    const room = await runSerializable(this.prisma, async (tx) => {
      const found = await tx.gameRoom.findUnique({ where: { id: roomId } });
      if (!found || found.invitedUserId !== userId) throw roomNotFound();
      if (found.status === 'DECLINED') return found;
      if (found.status !== 'OPEN') throw roomNotFound();
      return tx.gameRoom.update({
        where: { id: found.id },
        data: { status: 'DECLINED', respondedAt: now },
      });
    });
    await this.announce(room.id);
    const [view] = await this.viewsFor([room], userId, now);
    return view as RoomView;
  }

  /** Host closes their own room or cancels their invite. Closing twice is harmless. */
  async close(userId: string, roomId: string, now: Date = new Date()): Promise<RoomView> {
    const room = await runSerializable(this.prisma, async (tx) => {
      const found = await tx.gameRoom.findUnique({ where: { id: roomId } });
      if (!found || found.hostId !== userId) throw roomNotFound();
      if (found.status === 'CLOSED') return found;
      if (found.status !== 'OPEN') {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATE,
          'This room can no longer be closed',
        );
      }
      return tx.gameRoom.update({
        where: { id: found.id },
        data: { status: 'CLOSED', respondedAt: now },
      });
    });
    await this.announce(room.id);
    const [view] = await this.viewsFor([room], userId, now);
    return view as RoomView;
  }

  /** Sweeper step: writes down expiry for rooms and invites nobody joined. */
  async expireRooms(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.gameRoom.findMany({
      where: { status: 'OPEN', expiresAt: { lte: now } },
      select: { id: true },
      take: 100,
    });
    if (due.length === 0) return 0;
    const result = await this.prisma.gameRoom.updateMany({
      where: { id: { in: due.map((r) => r.id) }, status: 'OPEN', expiresAt: { lte: now } },
      data: { status: 'EXPIRED', respondedAt: now },
    });
    for (const room of due) await this.announce(room.id);
    return result.count;
  }
}
