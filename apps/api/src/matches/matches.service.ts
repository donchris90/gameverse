import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  DISCONNECT_GRACE_MS,
  ErrorCode,
  type AyoEndRequest,
  type AyoMoveRequest,
  type BotLevelName,
  type DraughtsMoveRequest,
  type GameId,
  type MatchKind,
  type MatchView,
  type MoveRequest,
  type RollRequest,
  type TokenMoveRequest,
} from '@gameverse/shared-types';
import type { WebSocket } from 'ws';
import { randomInt } from 'node:crypto';
import { ResultsService } from '../progress/results.service.js';
import { AppException } from '../common/app.exception.js';
import type { BotLevel, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeHub } from '../realtime/realtime.hub.js';
import { isBlockedEitherWay } from '../social/relationships.js';
import { runOptimistic, runSerializable, type Tx } from '../social/serializable.js';
import { ActionLimiter } from './action-limiter.js';
import { driverFor, findDriver, type DriverAction } from './game-driver.js';
import {
  BOT_THINK_MS,
  ACTION_LIMIT,
  ACTION_WINDOW_MS,
  OPEN_STATUSES,
  READY_TIMEOUT_MS,
  SWEEP_BATCH,
} from './matches.constants.js';
import { invalidState, notFound, staleVersion } from './match-errors.js';
import { toMatchView, type MatchRecord, type ProfileLookup } from './match.view.js';
import type { AnySeat, Change, EventDraft, Outcome } from './match-changes.js';

export type SeatSpec = { userId: string } | { bot: BotLevel };

export interface CreateMatchInput {
  gameId: GameId;
  kind: MatchKind;
  /** Every seat in order: two for tic-tac-toe, two to four for Ludo. */
  seats: readonly SeatSpec[];
  /** Which seat opens game 1. Rematches pass the alternated seat. */
  openingSeat?: AnySeat;
}

const BOT_TO_DB: Record<'easy' | 'medium' | 'hard', BotLevel> = {
  easy: 'EASY',
  medium: 'MEDIUM',
  hard: 'HARD',
};
export { BOT_TO_DB };

@Injectable()
export class MatchesService implements OnModuleInit {
  private readonly limiter = new ActionLimiter(ACTION_LIMIT, ACTION_WINDOW_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hub: RealtimeHub,
    private readonly results: ResultsService,
  ) {}

  onModuleInit(): void {
    // A client that (re)connects gets the exact current state of its match straight away.
    this.hub.onSocketReady((userId, socket) => {
      void this.sendSnapshot(userId, socket);
    });
  }

  /** Per-account cap on match actions; the per-IP throttler alone would punish shared carrier IPs. */
  private consumeAction(userId: string): void {
    if (!this.limiter.tryConsume(userId)) {
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorCode.RATE_LIMITED,
        'Too many actions. Slow down a little.',
      );
    }
  }

  // ---------------------------------------------------------------- reading

  private async profilesFor(db: Tx, match: MatchRecord): Promise<ProfileLookup> {
    const ids = match.players.flatMap((player) => (player.userId === null ? [] : [player.userId]));
    const profiles = await db.userProfile.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, username: true, avatarId: true },
    });
    return new Map(profiles.map((profile) => [profile.userId, profile]));
  }

  private async viewFor(db: Tx, match: MatchRecord, userId: string): Promise<MatchView> {
    const seat = this.seatOf(match, userId);
    if (seat === null) throw notFound();
    return toMatchView(match, seat, await this.profilesFor(db, match), new Date());
  }

  private seatOf(match: MatchRecord, userId: string): AnySeat | null {
    const player = match.players.find((candidate) => candidate.userId === userId);
    return player === undefined ? null : (player.seat as AnySeat);
  }

  private async load(db: Tx, matchId: string): Promise<MatchRecord | null> {
    return db.gameMatch.findUnique({
      where: { id: matchId },
      include: { players: true, result: { include: { players: true } } },
    });
  }

  private async loadForMember(db: Tx, matchId: string, userId: string): Promise<MatchRecord> {
    const match = await this.load(db, matchId);
    if (!match || this.seatOf(match, userId) === null) throw notFound();
    return match;
  }

  async get(userId: string, matchId: string): Promise<MatchView> {
    const match = await this.loadForMember(this.prisma, matchId, userId);
    return this.viewFor(this.prisma, match, userId);
  }

  /** The match the user is in right now (waiting, ready or active), if any. */
  async current(userId: string): Promise<{ match: MatchView | null }> {
    const match = await this.prisma.gameMatch.findFirst({
      where: {
        status: { in: [...OPEN_STATUSES] },
        players: { some: { userId, outAt: null } },
      },
      orderBy: { createdAt: 'desc' },
      include: { players: true },
    });
    return { match: match === null ? null : await this.viewFor(this.prisma, match, userId) };
  }

  // --------------------------------------------------------------- publishing

  /** Pushes the new state to every human seat. Best effort: the REST response is the truth. */
  async publish(matchId: string): Promise<void> {
    try {
      const match = await this.load(this.prisma, matchId);
      if (!match) return;
      const profiles = await this.profilesFor(this.prisma, match);
      const now = new Date();
      for (const player of match.players) {
        if (player.userId === null) continue;
        this.hub.publishToUser(player.userId, {
          type: 'match.update',
          match: toMatchView(match, player.seat as AnySeat, profiles, now),
        });
      }
    } catch {
      // delivery is best effort; clients re-fetch on reconnect
    }
  }

  // ------------------------------------------------------------------ writing

  /**
   * Applies a change and its events in one step. The row must still be at the version the caller
   * read; the serializable transaction already guarantees that, and the check makes it explicit.
   */
  private async commit(tx: Tx, match: MatchRecord, change: Change): Promise<void> {
    const version = match.version + change.events.length;
    const updated = await tx.gameMatch.updateMany({
      where: { id: match.id, version: match.version },
      data: { ...change.patch, version },
    });
    if (updated.count !== 1) {
      // Another change landed first. Surface it as a retryable conflict.
      throw Object.assign(new Error('match changed concurrently'), { code: 'P2034' });
    }
    if (change.readySeat !== undefined) {
      await tx.gameMatchPlayer.update({
        where: { matchId_seat: { matchId: match.id, seat: change.readySeat } },
        data: { ready: true },
      });
    }
    for (const seat of change.outSeats ?? []) {
      await tx.gameMatchPlayer.updateMany({
        where: { matchId: match.id, seat, outAt: null },
        data: { outAt: new Date() },
      });
    }
    await tx.gameEvent.createMany({
      data: change.events.map((event, index) => ({
        matchId: match.id,
        seq: match.version + index + 1,
        type: event.type,
        seat: event.seat ?? null,
        clientActionId: event.clientActionId ?? null,
        data: event.data ?? undefined,
      })),
    });
    // Completing a match and recording its result are one atomic step.
    if (change.patch.status === 'COMPLETED') {
      const finished = await this.load(tx, match.id);
      if (finished) await this.results.record(tx, finished);
    }
  }

  private async mutate(
    matchId: string,
    userId: string | null,
    decide: (match: MatchRecord, tx: Tx) => Promise<Outcome> | Outcome,
    /**
     * 'optimistic' is for in-match actions whose every invariant lives on the match row (its
     * version is compare-and-set in `commit`). Anything that can create another match, such as a
     * rematch, must stay 'serializable' so the one-open-match rule is checked safely.
     */
    mode: 'serializable' | 'optimistic' = 'serializable',
  ): Promise<MatchRecord | null> {
    const run = mode === 'optimistic' ? runOptimistic : runSerializable;
    const result = await run(this.prisma, async (tx) => {
      const match =
        userId === null
          ? await this.load(tx, matchId)
          : await this.loadForMember(tx, matchId, userId);
      if (!match) return null;
      const outcome = await decide(match, tx);
      if (outcome.changed) await this.commit(tx, match, outcome.change);
      return { changed: outcome.changed };
    });
    if (result === null) return null;
    const after = await this.load(this.prisma, matchId);
    if (after !== null && result.changed) await this.publish(matchId);
    return after;
  }

  // ----------------------------------------------------------------- creating

  /**
   * Creates a match with every seat filled. Used by quick match, private rooms, friend invites,
   * bot games and rematches. Each human must be an active player with a profile, must not be
   * blocked by the other, and must not already be in an open match.
   */
  async createMatch(input: CreateMatchInput, existingTx?: Tx): Promise<string> {
    const run = async (tx: Tx): Promise<string> => {
      const game = await tx.game.findUnique({ where: { id: input.gameId } });
      // A game with no driver cannot be played end to end, so it cannot start a match.
      if (!game || !game.enabled || findDriver(input.gameId) === null) {
        throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Game not found');
      }
      const humans = input.seats.flatMap((seat) => ('userId' in seat ? [seat.userId] : []));
      if (
        humans.length === 0 ||
        new Set(humans).size !== humans.length ||
        input.seats.length < game.minPlayers ||
        input.seats.length > game.maxPlayers
      ) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_FAILED,
          'Invalid seats',
        );
      }
      for (const humanId of humans) {
        const user = await tx.user.findUnique({
          where: { id: humanId },
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
          where: { userId: humanId, outAt: null, match: { status: { in: [...OPEN_STATUSES] } } },
        });
        if (open > 0) {
          throw new AppException(
            HttpStatus.CONFLICT,
            ErrorCode.ALREADY_IN_MATCH,
            'Finish or leave your current match first',
          );
        }
      }
      for (let i = 0; i < humans.length; i += 1) {
        for (let j = i + 1; j < humans.length; j += 1) {
          if (await isBlockedEitherWay(tx, humans[i] ?? '', humans[j] ?? '')) {
            throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'User not found');
          }
        }
      }

      const created = await tx.gameMatch.create({
        data: {
          gameId: input.gameId,
          kind: input.kind,
          status: 'READY',
          version: 1,
          openingSeat: input.openingSeat ?? 0,
          deadlineKind: 'READY',
          deadlineAt: new Date(Date.now() + READY_TIMEOUT_MS),
          players: {
            create: input.seats.map((seat, index) =>
              'userId' in seat
                ? { seat: index, userId: seat.userId, ready: false }
                : { seat: index, botLevel: seat.bot, ready: true },
            ),
          },
        },
      });
      await tx.gameEvent.create({
        data: {
          matchId: created.id,
          seq: 1,
          type: 'MATCH_CREATED',
          data: { kind: input.kind, openingSeat: input.openingSeat ?? 0 },
        },
      });
      return created.id;
    };
    const matchId = existingTx ? await run(existingTx) : await runSerializable(this.prisma, run);
    if (!existingTx) await this.publish(matchId);
    return matchId;
  }

  // ----------------------------------------------------------------- actions

  async ready(userId: string, matchId: string): Promise<MatchView> {
    this.consumeAction(userId);
    const match = await this.mutate(
      matchId,
      userId,
      (current): Outcome => {
        const seat = this.seatOf(current, userId);
        if (seat === null) throw notFound();
        const me = current.players.find((player) => player.seat === seat);
        if (me?.ready === true) return { changed: false }; // already ready: a retry changes nothing
        if (current.status !== 'READY') throw invalidState('This match can no longer be started');

        const everyoneReady = current.players.every(
          (player) => player.seat === seat || player.ready,
        );
        const events: EventDraft[] = [{ type: 'PLAYER_READY', seat }];
        const patch: Prisma.GameMatchUncheckedUpdateManyInput = {};
        if (everyoneReady) {
          const now = new Date();
          patch.status = 'ACTIVE';
          patch.startedAt = now;
          patch.deadlineKind = 'TURN';
          const started = driverFor(current.gameId).start(current, now);
          events.push(...started.events);
          patch.state = started.state;
          patch.deadlineAt = started.deadlineAt;
        }
        return { changed: true, change: { patch, readySeat: seat, events } };
      },
      'optimistic',
    );
    if (match === null) throw notFound();
    return this.viewFor(this.prisma, match, userId);
  }

  async move(userId: string, matchId: string, request: MoveRequest): Promise<MatchView> {
    return this.act(userId, matchId, request, { kind: 'place', cell: request.cell });
  }

  /** Draughts: play a move given as squares; the server works out the captures. */
  async moveDraughts(
    userId: string,
    matchId: string,
    request: DraughtsMoveRequest,
  ): Promise<MatchView> {
    return this.act(userId, matchId, request, {
      kind: 'draughts',
      from: request.from,
      path: [...request.path],
    });
  }

  /** Ayo: lift a pit; the server plays the whole turn. */
  async moveAyo(userId: string, matchId: string, request: AyoMoveRequest): Promise<MatchView> {
    return this.act(userId, matchId, request, { kind: 'ayo', pit: request.pit });
  }

  /** Ayo: offer to end the game by agreement, or answer an offer. */
  async endAyo(userId: string, matchId: string, request: AyoEndRequest): Promise<MatchView> {
    return this.act(userId, matchId, request, { kind: 'ayo-end', action: request.action });
  }

  /** Ludo: the server rolls the die for the player on turn. The phone sends no number. */
  async roll(userId: string, matchId: string, request: RollRequest): Promise<MatchView> {
    return this.act(userId, matchId, request, { kind: 'roll' });
  }

  /** Ludo: move one token by the die that was rolled. */
  async moveToken(userId: string, matchId: string, request: TokenMoveRequest): Promise<MatchView> {
    return this.act(userId, matchId, request, { kind: 'token', token: request.token });
  }

  /**
   * The one path for every human game action: a retried action id is acknowledged and never
   * applied twice, a stale version is refused, and the game's driver decides whether the move is
   * legal. The phone never sends an outcome.
   */
  private async act(
    userId: string,
    matchId: string,
    request: { clientActionId: string; expectedVersion: number },
    action: DriverAction,
  ): Promise<MatchView> {
    this.consumeAction(userId);
    const match = await this.mutate(
      matchId,
      userId,
      async (current, tx): Promise<Outcome> => {
        const seat = this.seatOf(current, userId);
        if (seat === null) throw notFound();

        const seen = await tx.gameEvent.findUnique({
          where: {
            matchId_seat_clientActionId: {
              matchId: current.id,
              seat,
              clientActionId: request.clientActionId,
            },
          },
          select: { id: true },
        });
        if (seen) return { changed: false };

        if (current.status !== 'ACTIVE') throw invalidState('The match is not in progress');
        if (request.expectedVersion !== current.version) throw staleVersion(current.version);

        const change = driverFor(current.gameId).act(
          current,
          seat,
          action,
          request.clientActionId,
          new Date(),
        );
        return { changed: true, change };
      },
      'optimistic',
    );
    if (match === null) throw notFound();
    return this.viewFor(this.prisma, match, userId);
  }

  async leave(userId: string, matchId: string): Promise<MatchView> {
    this.consumeAction(userId);
    const match = await this.mutate(matchId, userId, (current): Outcome => {
      const seat = this.seatOf(current, userId);
      if (seat === null) throw notFound();
      const now = new Date();

      if (current.status === 'WAITING' || current.status === 'READY') {
        return {
          changed: true,
          change: {
            patch: {
              status: 'CANCELLED',
              endReason: 'cancelled',
              deadlineKind: null,
              deadlineAt: null,
              endedAt: now,
            },
            events: [{ type: 'PLAYER_LEFT', seat }, { type: 'MATCH_CANCELLED' }],
          },
        };
      }
      if (current.status !== 'ACTIVE') return { changed: false }; // already over: nothing to leave

      const change = driverFor(current.gameId).leave(current, seat, now, 'left');
      return change === null ? { changed: false } : { changed: true, change };
    });
    if (match === null) throw notFound();
    return this.viewFor(this.prisma, match, userId);
  }

  /**
   * Asks for a rematch. The new match exists once both seats have asked (a bot always agrees), the
   * opener alternates, and asking twice - or both asking at the same instant - makes only one.
   */
  async rematch(userId: string, matchId: string): Promise<MatchView> {
    this.consumeAction(userId);
    let created: string | null = null;
    const match = await this.mutate(matchId, userId, async (current, tx): Promise<Outcome> => {
      const seat = this.seatOf(current, userId);
      if (seat === null) throw notFound();
      if (current.status !== 'COMPLETED')
        throw invalidState('Only a finished match can be replayed');
      if (current.rematchMatchId !== null) return { changed: false };

      const bit = 1 << seat;
      const mask = current.rematchRequestedMask | bit;
      const events: EventDraft[] = [];
      if (mask !== current.rematchRequestedMask) events.push({ type: 'REMATCH_REQUESTED', seat });

      const everyoneAgreed = current.players.every(
        (player) => player.userId === null || (mask & (1 << player.seat)) !== 0,
      );
      const patch: Prisma.GameMatchUncheckedUpdateManyInput = { rematchRequestedMask: mask };
      if (everyoneAgreed) {
        const seats = [...current.players]
          .sort((a, b) => a.seat - b.seat)
          .map((player): SeatSpec =>
            player.userId === null ? { bot: player.botLevel ?? 'EASY' } : { userId: player.userId },
          );
        const openingSeat = driverFor(current.gameId).rematchOpening(current, seats.length);
        const newId = await this.createMatch(
          {
            gameId: current.gameId as GameId,
            kind: current.kind,
            seats,
            openingSeat,
          },
          tx,
        );
        created = newId;
        patch.rematchMatchId = newId;
        events.push({ type: 'REMATCH_CREATED', data: { matchId: newId } });
      }
      if (events.length === 0) return { changed: false };
      return { changed: true, change: { patch, events } };
    });
    if (match === null) throw notFound();
    if (created !== null) await this.publish(created);
    return this.viewFor(this.prisma, match, userId);
  }

  // ------------------------------------------------------------------ timers

  /** Resolves one overdue deadline (ready window, turn timer, or the pause between games). */
  async processDeadline(matchId: string, now = new Date()): Promise<boolean> {
    const decide = (current: MatchRecord): Outcome => {
      if (current.deadlineAt === null || current.deadlineAt > now) return { changed: false };

      if (current.deadlineKind === 'READY') {
        if (current.status !== 'READY' && current.status !== 'WAITING') return { changed: false };
        return {
          changed: true,
          change: {
            patch: {
              status: 'EXPIRED',
              endReason: 'expired',
              deadlineKind: null,
              deadlineAt: null,
              endedAt: now,
            },
            events: [{ type: 'MATCH_EXPIRED' }],
          },
        };
      }

      const change = driverFor(current.gameId).deadline(current, now);
      return change === null ? { changed: false } : { changed: true, change };
    };

    // The decision is re-run if the transaction is retried, so only the last run's answer counts.
    let changed = false;
    await this.mutate(matchId, null, (current): Outcome => {
      const outcome = decide(current);
      changed = outcome.changed;
      return outcome;
    });
    return changed;
  }

  /** Finds overdue deadlines and resolves them. Safe to call at any time and from any instance. */
  async runDueTimers(now = new Date()): Promise<number> {
    const due = await this.prisma.gameMatch.findMany({
      where: { deadlineAt: { lte: now }, status: { in: ['WAITING', 'READY', 'ACTIVE'] } },
      select: { id: true },
      orderBy: { deadlineAt: 'asc' },
      take: SWEEP_BATCH,
    });
    let handled = 0;
    for (const { id } of due) {
      try {
        if (await this.processDeadline(id, now)) handled += 1;
      } catch {
        // one failing match must not stop the others; it is retried on the next sweep
      }
    }
    return handled;
  }
  // -------------------------------------------------------------- connections

  /**
   * Sent to a socket that has just authenticated. Reconnecting also ends any disconnect countdown
   * for this player at once, instead of waiting for the next sweep.
   */
  private async sendSnapshot(userId: string, socket: WebSocket): Promise<void> {
    try {
      const reconnected = await this.prisma.gameMatchPlayer.findMany({
        where: { userId, disconnectedAt: { not: null }, match: { status: 'ACTIVE' } },
        select: { matchId: true },
      });
      if (reconnected.length > 0) {
        await this.prisma.gameMatchPlayer.updateMany({
          where: { userId, disconnectedAt: { not: null }, match: { status: 'ACTIVE' } },
          data: { disconnectedAt: null },
        });
        for (const { matchId } of reconnected) await this.publish(matchId);
      }
      const { match } = await this.current(userId);
      if (match !== null) this.hub.sendToSocket(socket, { type: 'match.update', match });
    } catch {
      // best effort: the client can always GET /v1/matches/current
    }
  }

  /**
   * Sweeper step. For every human in an active match: note when their last socket went away,
   * clear the note when they are back, and forfeit the series once they have been gone for the
   * whole grace period. Turn timers keep running meanwhile, so a missing player also times out.
   * Returns how many series were forfeited.
   */
  async runConnectionChecks(now = new Date()): Promise<number> {
    this.limiter.prune(now.getTime());
    const active = await this.prisma.gameMatch.findMany({
      where: { status: 'ACTIVE' },
      include: { players: true },
      take: SWEEP_BATCH * 4,
    });
    let forfeited = 0;
    for (const match of active) {
      try {
        let changed = false;
        const gone: { seat: AnySeat; since: Date }[] = [];
        for (const player of match.players) {
          if (player.userId === null || player.outAt !== null) continue;
          const online = this.hub.isOnline(player.userId);
          if (online && player.disconnectedAt !== null) {
            await this.prisma.gameMatchPlayer.update({
              where: { matchId_seat: { matchId: match.id, seat: player.seat } },
              data: { disconnectedAt: null },
            });
            changed = true;
          } else if (!online && player.disconnectedAt === null) {
            await this.prisma.gameMatchPlayer.update({
              where: { matchId_seat: { matchId: match.id, seat: player.seat } },
              data: { disconnectedAt: now },
            });
            changed = true;
          } else if (!online && player.disconnectedAt !== null) {
            gone.push({ seat: player.seat as AnySeat, since: player.disconnectedAt });
          }
        }
        const overdue = gone
          .filter((entry) => now.getTime() - entry.since.getTime() >= DISCONNECT_GRACE_MS)
          .sort((a, b) => a.since.getTime() - b.since.getTime() || a.seat - b.seat)[0];
        if (
          overdue !== undefined &&
          (await this.forfeitDisconnected(match.id, overdue.seat, now))
        ) {
          forfeited += 1;
        } else if (changed) {
          await this.publish(match.id);
        }
      } catch {
        // one failing match must not stop the others; the next sweep retries
      }
    }
    return forfeited;
  }

  private async forfeitDisconnected(matchId: string, seat: AnySeat, now: Date): Promise<boolean> {
    let ended = false;
    await this.mutate(matchId, null, (current): Outcome => {
      ended = false; // the decision may run again after a rolled-back attempt
      if (current.status !== 'ACTIVE') return { changed: false };
      const player = current.players.find((candidate) => candidate.seat === seat);
      // Re-checked inside the transaction: a reconnect that landed meanwhile cancels the forfeit.
      if (
        !player ||
        player.disconnectedAt === null ||
        now.getTime() - player.disconnectedAt.getTime() < DISCONNECT_GRACE_MS
      ) {
        return { changed: false };
      }
      const change = driverFor(current.gameId).leave(current, seat, now, 'disconnected');
      if (change === null) return { changed: false };
      ended = true;
      return { changed: true, change };
    });
    return ended;
  }
  // --------------------------------------------------------------------- bots

  /**
   * Starts a practice match against a labelled bot. Any search or hosted room the player had is
   * ended first, because they chose to play now. The human sits in seat 0; who opens is a coin flip.
   */
  async startBotMatch(
    userId: string,
    gameId: GameId,
    level: BotLevelName,
    players = 2,
  ): Promise<MatchView> {
    this.consumeAction(userId);
    const fixed = driverFor(gameId).fixedPlayerCount;
    if (fixed !== undefined && players !== fixed) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'This game is for two players',
      );
    }
    const matchId = await runSerializable(this.prisma, async (tx) => {
      const hosting = await tx.gameRoom.count({
        where: { hostId: userId, status: 'OPEN', expiresAt: { gt: new Date() } },
      });
      if (hosting > 0) throw invalidState('Close your open room before starting a bot match');
      const inRoom = await tx.gameRoomMember.count({
        where: { userId, room: { status: 'OPEN', expiresAt: { gt: new Date() } } },
      });
      if (inRoom > 0) throw invalidState('Leave your room before starting a bot match');
      await tx.matchQueueEntry.deleteMany({ where: { userId } });
      return this.createMatch(
        {
          gameId,
          kind: 'BOT',
          seats: [
            { userId },
            ...Array.from({ length: players - 1 }, (): SeatSpec => ({ bot: BOT_TO_DB[level] })),
          ],
          openingSeat: randomInt(0, players) as AnySeat,
        },
        tx,
      );
    });
    await this.publish(matchId);
    return this.get(userId, matchId);
  }

  /**
   * Sweeper step: lets every bot whose turn it is, and who has "thought" long enough, move.
   * Returns how many moves were made.
   */
  async runBotMoves(now = new Date()): Promise<number> {
    const waiting = await this.prisma.gameMatch.findMany({
      where: { status: 'ACTIVE', players: { some: { userId: null } } },
      select: { id: true },
      take: SWEEP_BATCH,
    });
    let moved = 0;
    for (const { id } of waiting) {
      try {
        if (await this.botMove(id, now)) moved += 1;
      } catch {
        // one failing match must not stop the others; the next sweep retries
      }
    }
    return moved;
  }

  /**
   * One bot move. It goes through exactly the validator a human move goes through (`playMove`), is
   * recorded in the same event log, and carries a deterministic action id so two sweepers racing
   * for the same turn make one move.
   */
  private async botMove(matchId: string, now: Date): Promise<boolean> {
    let made = false;
    await this.mutate(matchId, null, (current): Outcome => {
      made = false; // the decision may run again after a rolled-back attempt
      if (current.status !== 'ACTIVE' || current.deadlineKind !== 'TURN') return { changed: false };
      if (current.deadlineAt === null) return { changed: false };
      const driver = driverFor(current.gameId);
      const turnStartedAt = current.deadlineAt.getTime() - driver.turnTimerMs;
      if (now.getTime() < turnStartedAt + BOT_THINK_MS) return { changed: false };

      const change = driver.botMove(current, now);
      if (change === null) return { changed: false };
      made = true;
      return { changed: true, change };
    });
    return made;
  }
}
