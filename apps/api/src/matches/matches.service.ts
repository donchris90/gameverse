import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  DISCONNECT_GRACE_MS,
  ErrorCode,
  type BotLevelName,
  type GameId,
  type MatchKind,
  type MatchView,
  type MoveRequest,
  type RollRequest,
  type TokenMoveRequest,
} from '@gameverse/shared-types';
import {
  LUDO_TURN_TIMER_MS,
  TURN_TIMER_MS,
  applyLudoMove,
  applyLudoRoll,
  applyLudoTimeout,
  chooseBotMove,
  chooseLudoMove,
  createLudo,
  removeLudoSeat,
  type LudoError,
  type LudoPlayerCount,
  type LudoSeat,
  createRematch,
  createSeries,
  forfeitSeries,
  playMove,
  seatToMove,
  startNextGame,
  timeoutTurn,
  type Seat,
  type SeriesError,
  type SeriesState,
} from '@gameverse/game-rules';
import type { WebSocket } from 'ws';
import { randomInt } from 'node:crypto';
import { ResultsService } from '../progress/results.service.js';
import { AppException } from '../common/app.exception.js';
import type { BotLevel, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeHub } from '../realtime/realtime.hub.js';
import { isBlockedEitherWay } from '../social/relationships.js';
import { runSerializable, type Tx } from '../social/serializable.js';
import { botActionId } from './bot-action-id.js';
import { ActionLimiter } from './action-limiter.js';
import {
  BOT_THINK_MS,
  ACTION_LIMIT,
  ACTION_WINDOW_MS,
  NEXT_GAME_DELAY_MS,
  OPEN_STATUSES,
  READY_TIMEOUT_MS,
  SWEEP_BATCH,
} from './matches.constants.js';
import { seriesOf, toMatchView, type MatchRecord, type ProfileLookup } from './match.view.js';
import type { AnySeat, Change, EventDraft, Outcome } from './match-changes.js';
import {
  afterLudoChange,
  ludoEventDrafts,
  ludoOf,
  ludoState,
  ludoToJson,
  rollDie,
} from './ludo-driver.js';

export type SeatSpec = { userId: string } | { bot: BotLevel };

export interface CreateMatchInput {
  gameId: GameId;
  kind: MatchKind;
  /** Every seat in order: two for tic-tac-toe, two to four for Ludo. */
  seats: readonly SeatSpec[];
  /** Which seat opens game 1. Rematches pass the alternated seat. */
  openingSeat?: AnySeat;
}

function ludoError(error: LudoError): AppException {
  switch (error) {
    case 'NOT_YOUR_TURN':
      return new AppException(HttpStatus.CONFLICT, ErrorCode.NOT_YOUR_TURN, 'It is not your turn');
    case 'WRONG_PHASE':
      return invalidState('Not now: roll the die first, then move a token');
    case 'GAME_FINISHED':
    case 'INVALID_SEAT':
      return invalidState('The match is not accepting moves right now');
    case 'INVALID_DIE':
    case 'INVALID_TOKEN':
    case 'ILLEGAL_MOVE':
      return new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_MOVE,
        'That move is not allowed',
        { reason: error },
      );
  }
}

/** Seats that have just finished or been removed no longer count as being in the match. */
function departedSeats(events: readonly { type: string; seat?: unknown }[]): AnySeat[] {
  return events.flatMap((event) =>
    (event.type === 'SEAT_REMOVED' || event.type === 'SEAT_FINISHED') &&
    typeof event.seat === 'number'
      ? [event.seat as AnySeat]
      : [],
  );
}

function notFound(): AppException {
  // One answer for "no such match" and "not your match".
  return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Match not found');
}

function invalidState(message: string): AppException {
  return new AppException(HttpStatus.CONFLICT, ErrorCode.INVALID_STATE, message);
}

function seriesError(error: SeriesError): AppException {
  switch (error) {
    case 'NOT_YOUR_TURN':
      return new AppException(HttpStatus.CONFLICT, ErrorCode.NOT_YOUR_TURN, 'It is not your turn');
    case 'CELL_TAKEN':
    case 'INVALID_CELL':
    case 'GAME_OVER':
      return new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_MOVE,
        'That move is not allowed',
        {
          reason: error,
        },
      );
    case 'SERIES_NOT_PLAYING':
      return invalidState('The match is not accepting moves right now');
  }
}

const BOT_TO_DB: Record<'easy' | 'medium' | 'hard', BotLevel> = {
  easy: 'EASY',
  medium: 'MEDIUM',
  hard: 'HARD',
};
export { BOT_TO_DB };

function toJson(series: SeriesState): Prisma.InputJsonValue {
  return series as unknown as Prisma.InputJsonValue;
}

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
  ): Promise<MatchRecord | null> {
    const result = await runSerializable(this.prisma, async (tx) => {
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
      if (!game || !game.enabled) {
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

  private afterSeriesChange(series: SeriesState, events: EventDraft[], now: Date): Change['patch'] {
    const patch: Prisma.GameMatchUncheckedUpdateManyInput = { state: toJson(series) };
    if (series.phase === 'playing') {
      patch.deadlineKind = 'TURN';
      patch.deadlineAt = new Date(now.getTime() + TURN_TIMER_MS);
    } else if (series.phase === 'between_games') {
      patch.deadlineKind = 'NEXT_GAME';
      patch.deadlineAt = new Date(now.getTime() + NEXT_GAME_DELAY_MS);
    } else {
      patch.status = 'COMPLETED';
      patch.deadlineKind = null;
      patch.deadlineAt = null;
      patch.endedAt = now;
      patch.endReason = series.endReason === 'forfeit' ? 'forfeit' : 'score';
      patch.winnerSeat = series.winner === 'draw' || series.winner === null ? null : series.winner;
      events.push({
        type: 'SERIES_ENDED',
        data: { winner: series.winner, reason: series.endReason, wins: [...series.wins] },
      });
    }
    return patch;
  }

  /** Events for a game that just ended, derived from the new history entries. */
  private gameEndedEvents(before: SeriesState, after: SeriesState): EventDraft[] {
    return after.history.slice(before.history.length).map((record) => ({
      type: 'GAME_ENDED',
      data: {
        gameNumber: record.gameNumber,
        result: record.result,
        reason: record.reason,
      },
    }));
  }

  async ready(userId: string, matchId: string): Promise<MatchView> {
    this.consumeAction(userId);
    const match = await this.mutate(matchId, userId, (current): Outcome => {
      const seat = this.seatOf(current, userId);
      if (seat === null) throw notFound();
      const me = current.players.find((player) => player.seat === seat);
      if (me?.ready === true) return { changed: false }; // already ready: a retry changes nothing
      if (current.status !== 'READY') throw invalidState('This match can no longer be started');

      const everyoneReady = current.players.every((player) => player.seat === seat || player.ready);
      const events: EventDraft[] = [{ type: 'PLAYER_READY', seat }];
      const patch: Prisma.GameMatchUncheckedUpdateManyInput = {};
      if (everyoneReady) {
        const now = new Date();
        patch.status = 'ACTIVE';
        patch.startedAt = now;
        patch.deadlineKind = 'TURN';
        if (current.gameId === 'ludo') {
          const players = current.players.length as LudoPlayerCount;
          const game = createLudo(players, current.openingSeat as LudoSeat);
          events.push({
            type: 'GAME_STARTED',
            data: { players, openingSeat: game.toMove },
          });
          patch.state = ludoToJson(game, []);
          patch.deadlineAt = new Date(now.getTime() + LUDO_TURN_TIMER_MS);
        } else {
          const series = createSeries(current.openingSeat as Seat);
          events.push({
            type: 'GAME_STARTED',
            data: { gameNumber: 1, firstSeat: series.firstSeat },
          });
          patch.state = toJson(series);
          patch.deadlineAt = new Date(now.getTime() + TURN_TIMER_MS);
        }
      }
      return { changed: true, change: { patch, readySeat: seat, events } };
    });
    if (match === null) throw notFound();
    return this.viewFor(this.prisma, match, userId);
  }

  async move(userId: string, matchId: string, request: MoveRequest): Promise<MatchView> {
    this.consumeAction(userId);
    const match = await this.mutate(matchId, userId, async (current, tx): Promise<Outcome> => {
      const seat = this.seatOf(current, userId);
      if (seat === null) throw notFound();

      // A retry of a move that already went through is acknowledged, never applied twice.
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
      if (request.expectedVersion !== current.version) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.STALE_MATCH_VERSION,
          'The match changed; reload it and try again',
          { version: current.version },
        );
      }
      const before = seriesOf(current);
      if (before === null) throw invalidState('The match is not in progress');

      const moved = playMove(before, seat as Seat, request.cell);
      if (!moved.ok) throw seriesError(moved.error);

      const events: EventDraft[] = [
        {
          type: 'MOVE',
          seat,
          clientActionId: request.clientActionId,
          data: { cell: request.cell },
        },
        ...this.gameEndedEvents(before, moved.series),
      ];
      const patch = this.afterSeriesChange(moved.series, events, new Date());
      return { changed: true, change: { patch, events } };
    });
    if (match === null) throw notFound();
    return this.viewFor(this.prisma, match, userId);
  }

  /** Ludo: the server rolls the die for the player on turn. The phone sends no number. */
  async roll(userId: string, matchId: string, request: RollRequest): Promise<MatchView> {
    return this.ludoAction(userId, matchId, request, 'ROLLED', (state, seat) =>
      applyLudoRoll(state, seat, rollDie()),
    );
  }

  /** Ludo: move one token by the die that was rolled. */
  async moveToken(userId: string, matchId: string, request: TokenMoveRequest): Promise<MatchView> {
    return this.ludoAction(userId, matchId, request, 'MOVED', (state, seat) =>
      applyLudoMove(state, seat, request.token),
    );
  }

  /**
   * The shared path for the two Ludo actions: same idempotency (a retried action id is
   * acknowledged, never applied twice), same stale-version refusal, same event log as tic-tac-toe.
   */
  private async ludoAction(
    userId: string,
    matchId: string,
    request: { clientActionId: string; expectedVersion: number },
    eventType: 'ROLLED' | 'MOVED',
    apply: (
      state: ReturnType<typeof ludoState>,
      seat: LudoSeat,
    ) => ReturnType<typeof applyLudoRoll>,
  ): Promise<MatchView> {
    this.consumeAction(userId);
    const match = await this.mutate(matchId, userId, async (current, tx): Promise<Outcome> => {
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
      if (request.expectedVersion !== current.version) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.STALE_MATCH_VERSION,
          'The match changed; reload it and try again',
          { version: current.version },
        );
      }
      const stored = ludoOf(current);
      if (stored === null) throw invalidState('This match has no dice');

      const result = apply(ludoState(stored), seat as LudoSeat);
      if (!result.ok) throw ludoError(result.error);
      const events = ludoEventDrafts(result.events, {
        type: eventType,
        seat: seat as LudoSeat,
        clientActionId: request.clientActionId,
      });
      const patch = afterLudoChange(result.state, result.events, new Date());
      return {
        changed: true,
        change: { patch, events, outSeats: departedSeats(result.events) },
      };
    });
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

      const ludo = ludoOf(current);
      if (ludo !== null) {
        const removed = removeLudoSeat(ludoState(ludo), seat as LudoSeat, 'forfeit');
        if (!removed.ok) return { changed: false }; // already out of the game: nothing to leave
        const events: EventDraft[] = [
          { type: 'PLAYER_LEFT', seat },
          ...ludoEventDrafts(removed.events),
        ];
        const patch = afterLudoChange(
          removed.state,
          removed.events,
          now,
          removed.state.phase === 'finished' ? 'left' : undefined,
        );
        return {
          changed: true,
          change: { patch, events, outSeats: departedSeats(removed.events) },
        };
      }

      const before = seriesOf(current);
      if (before === null) return { changed: false };
      const forfeited = forfeitSeries(before, seat as Seat);
      if (!forfeited.ok) return { changed: false };
      const events: EventDraft[] = [{ type: 'PLAYER_LEFT', seat }];
      const patch = this.afterSeriesChange(forfeited.series, events, now);
      patch.endReason = 'left';
      return { changed: true, change: { patch, events } };
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
        const series = seriesOf(current);
        const seats = [...current.players]
          .sort((a, b) => a.seat - b.seat)
          .map((player): SeatSpec =>
            player.userId === null ? { bot: player.botLevel ?? 'EASY' } : { userId: player.userId },
          );
        // Tic-tac-toe alternates the opener by series; Ludo passes the opening turn clockwise.
        const openingSeat: AnySeat =
          current.gameId === 'ludo'
            ? (((current.openingSeat + 1) % seats.length) as AnySeat)
            : series === null
              ? 0
              : createRematch(series).firstSeat;
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

      const ludo = ludoOf(current);
      if (ludo !== null) {
        if (current.status !== 'ACTIVE' || current.deadlineKind !== 'TURN')
          return { changed: false };
        const timedOut = ludo.toMove;
        const result = applyLudoTimeout(ludoState(ludo), rollDie());
        if (!result.ok) return { changed: false };
        const events: EventDraft[] = [
          { type: 'TIMEOUT', seat: timedOut },
          ...ludoEventDrafts(result.events),
        ];
        const patch = afterLudoChange(result.state, result.events, now);
        return {
          changed: true,
          change: { patch, events, outSeats: departedSeats(result.events) },
        };
      }

      const before = seriesOf(current);
      if (current.status !== 'ACTIVE' || before === null) return { changed: false };

      if (current.deadlineKind === 'TURN') {
        const seat = seatToMove(before);
        if (seat === null) return { changed: false };
        const result = timeoutTurn(before, seat);
        if (!result.ok) return { changed: false };
        const events: EventDraft[] = [
          { type: 'TIMEOUT', seat },
          ...this.gameEndedEvents(before, result.series),
        ];
        const patch = this.afterSeriesChange(result.series, events, now);
        return { changed: true, change: { patch, events } };
      }

      if (current.deadlineKind === 'NEXT_GAME') {
        const next = startNextGame(before);
        if (!next.ok) return { changed: false };
        const events: EventDraft[] = [
          {
            type: 'GAME_STARTED',
            data: { gameNumber: next.series.gameNumber, firstSeat: next.series.firstSeat },
          },
        ];
        const patch = this.afterSeriesChange(next.series, events, now);
        return { changed: true, change: { patch, events } };
      }
      return { changed: false };
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
      const ludo = ludoOf(current);
      if (ludo !== null) {
        const removed = removeLudoSeat(ludoState(ludo), seat as LudoSeat, 'forfeit');
        if (!removed.ok) return { changed: false };
        const events: EventDraft[] = [
          { type: 'PLAYER_DISCONNECTED', seat },
          ...ludoEventDrafts(removed.events),
        ];
        const patch = afterLudoChange(
          removed.state,
          removed.events,
          now,
          removed.state.phase === 'finished' ? 'disconnected' : undefined,
        );
        ended = true;
        return {
          changed: true,
          change: { patch, events, outSeats: departedSeats(removed.events) },
        };
      }

      const before = seriesOf(current);
      if (before === null) return { changed: false };
      const forfeit = forfeitSeries(before, seat as Seat);
      if (!forfeit.ok) return { changed: false };
      const events: EventDraft[] = [{ type: 'PLAYER_DISCONNECTED', seat }];
      const patch = this.afterSeriesChange(forfeit.series, events, now);
      patch.endReason = 'disconnected';
      ended = true;
      return { changed: true, change: { patch, events } };
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
    if (gameId !== 'ludo' && players !== 2) {
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
      const turnStartedAt = current.deadlineAt.getTime() - TURN_TIMER_MS;
      if (now.getTime() < turnStartedAt + BOT_THINK_MS) return { changed: false };

      const ludo = ludoOf(current);
      if (ludo !== null) {
        const seat = ludo.toMove;
        const bot = current.players.find((candidate) => candidate.seat === seat);
        if (!bot || bot.userId !== null || bot.botLevel === null) return { changed: false };
        const state = ludoState(ludo);
        const eventType = state.phase === 'roll' ? 'ROLLED' : 'MOVED';
        const level = bot.botLevel.toLowerCase() as BotLevelName;
        let result;
        if (state.phase === 'roll') {
          result = applyLudoRoll(state, seat, rollDie());
        } else {
          const token = chooseLudoMove(state, level, () => randomInt(0, 2 ** 30) / 2 ** 30);
          if (token === null) return { changed: false };
          result = applyLudoMove(state, seat, token); // the same validator a human move goes through
        }
        if (!result.ok) return { changed: false };
        const events = ludoEventDrafts(result.events, {
          type: eventType,
          seat,
          clientActionId: botActionId(current.id, current.version),
        });
        const patch = afterLudoChange(result.state, result.events, now);
        made = true;
        return {
          changed: true,
          change: { patch, events, outSeats: departedSeats(result.events) },
        };
      }

      const before = seriesOf(current);
      if (before === null) return { changed: false };
      const seat = seatToMove(before);
      if (seat === null) return { changed: false };
      const player = current.players.find((candidate) => candidate.seat === seat);
      if (!player || player.userId !== null || player.botLevel === null) return { changed: false };

      const level = player.botLevel.toLowerCase() as BotLevelName;
      const cell = chooseBotMove(before.game, level, () => randomInt(0, 2 ** 30) / 2 ** 30);
      const result = playMove(before, seat, cell);
      if (!result.ok) return { changed: false }; // a bot may never force an illegal move through

      const events: EventDraft[] = [
        {
          type: 'MOVE',
          seat,
          clientActionId: botActionId(current.id, current.version),
          data: { cell },
        },
        ...this.gameEndedEvents(before, result.series),
      ];
      const patch = this.afterSeriesChange(result.series, events, now);
      made = true;
      return { changed: true, change: { patch, events } };
    });
    return made;
  }
}
