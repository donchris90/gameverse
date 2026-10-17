import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type GameId,
  type MatchView,
  type RoomView,
} from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';
import type { GameRoom } from '../generated/prisma/client.js';
import { OPEN_STATUSES } from '../matches/matches.constants.js';
import { MatchesService } from '../matches/matches.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushService } from '../push/push.service.js';
import { RealtimeHub } from '../realtime/realtime.hub.js';
import { areFriends } from '../social/relationships.js';
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

export interface LobbyOverview {
  /** The room I am hosting (waiting for a guest, or just started), if any. */
  hosted: RoomView | null;
  /** Friend invites waiting for my answer. */
  invites: RoomView[];
}

@Injectable()
export class RoomsService {
  private readonly joinFailures = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly matches: MatchesService,
    private readonly hub: RealtimeHub,
    private readonly push: PushService,
  ) {}

  // ----------------------------------------------------------------- reading

  private async viewsFor(rooms: readonly GameRoom[], viewerId: string, now: Date) {
    const ids = [
      ...new Set(rooms.flatMap((r) => [r.hostId, ...(r.invitedUserId ? [r.invitedUserId] : [])])),
    ];
    const profiles = await this.prisma.userProfile.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, username: true, avatarId: true },
    });
    const lookup = new Map(profiles.map((p) => [p.userId, p]));
    return rooms.map((room) => toRoomView(room, viewerId, lookup, now));
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
    const [hostedView] = hosted ? await this.viewsFor([hosted], userId, now) : [];
    return { hosted: hostedView ?? null, invites: await this.viewsFor(invites, userId, now) };
  }

  /** Tells both parties the room changed. Best effort: REST is the truth. */
  private async announce(roomId: string): Promise<void> {
    try {
      const room = await this.prisma.gameRoom.findUnique({ where: { id: roomId } });
      if (!room) return;
      const now = new Date();
      for (const userId of [room.hostId, ...(room.invitedUserId ? [room.invitedUserId] : [])]) {
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
      where: { userId, match: { status: { in: [...OPEN_STATUSES] } } },
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
  }

  private async open(
    hostId: string,
    gameId: GameId,
    invitedUserId: string | null,
    now: Date,
  ): Promise<GameRoom> {
    const room = await runSerializable(this.prisma, async (tx) => {
      const game = await tx.game.findUnique({ where: { id: gameId } });
      if (!game || !game.enabled) {
        throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Game not found');
      }
      await this.assertCanHost(tx, hostId);
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
          expiresAt: new Date(now.getTime() + (invitedUserId ? INVITE_TTL_MS : ROOM_TTL_MS)),
          createdAt: now,
        },
      });
    });
    await this.announce(room.id);
    return room;
  }

  async create(hostId: string, gameId: GameId, now: Date = new Date()): Promise<RoomView> {
    const room = await this.open(hostId, gameId, null, now);
    const [view] = await this.viewsFor([room], hostId, now);
    return view as RoomView;
  }

  async invite(
    hostId: string,
    friendUserId: string,
    gameId: GameId,
    now: Date = new Date(),
  ): Promise<RoomView> {
    if (friendUserId === hostId) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'You cannot invite yourself',
      );
    }
    const room = await this.open(hostId, gameId, friendUserId, now);
    const host = await this.prisma.userProfile.findUnique({
      where: { userId: hostId },
      select: { username: true },
    });
    this.push.notify(friendUserId, {
      title: 'GameVerse',
      body: `${host?.username ?? 'A friend'} invited you to play Tic-Tac-Toe`,
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

  /** Starts the match for an OPEN room. Runs inside the caller's SERIALIZABLE transaction. */
  private async start(tx: Tx, room: GameRoom, guestId: string, now: Date): Promise<string> {
    if (room.hostId === guestId) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE,
        'You cannot join your own room',
      );
    }
    // The guest chose this game: any search they had running is over.
    await tx.matchQueueEntry.deleteMany({ where: { userId: guestId } });
    const matchId = await this.matches.createMatch(
      {
        gameId: room.gameId as GameId,
        kind: room.invitedUserId === null ? 'PRIVATE' : 'FRIEND',
        // The host sits in seat 0; who opens is a coin flip.
        seats: [{ userId: room.hostId }, { userId: guestId }],
        openingSeat: randomInt(0, 2) === 0 ? 0 : 1,
      },
      tx,
    );
    await tx.gameRoom.update({
      where: { id: room.id },
      data: { status: 'STARTED', matchId, respondedAt: now },
    });
    return matchId;
  }

  private async startAndShow(
    userId: string,
    find: (tx: Tx) => Promise<GameRoom | null>,
    now: Date,
  ): Promise<MatchView> {
    const { matchId, roomId } = await runSerializable(this.prisma, async (tx) => {
      const room = await find(tx);
      if (
        !room ||
        room.status !== 'OPEN' ||
        room.expiresAt.getTime() <= now.getTime() ||
        (room.invitedUserId !== null && room.invitedUserId !== userId)
      ) {
        throw roomNotFound();
      }
      return { matchId: await this.start(tx, room, userId, now), roomId: room.id };
    });
    await this.matches.publish(matchId);
    await this.announce(roomId);
    return this.matches.get(userId, matchId);
  }

  async joinByCode(userId: string, code: string, now: Date = new Date()): Promise<MatchView> {
    this.checkNotGuessing(userId, now);
    try {
      return await this.startAndShow(
        userId,
        (tx) => tx.gameRoom.findUnique({ where: { code } }),
        now,
      );
    } catch (error) {
      if (error instanceof AppException && error.getStatus() === HttpStatus.NOT_FOUND) {
        this.recordFailure(userId, now);
      }
      throw error;
    }
  }

  async accept(userId: string, roomId: string, now: Date = new Date()): Promise<MatchView> {
    return this.startAndShow(
      userId,
      async (tx) => {
        const room = await tx.gameRoom.findUnique({ where: { id: roomId } });
        return room !== null && room.invitedUserId === userId ? room : null;
      },
      now,
    );
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
