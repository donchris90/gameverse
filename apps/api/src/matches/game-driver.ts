import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { AnySeat, Change, EventDraft } from './match-changes.js';
import type { MatchRecord } from './match.view.js';
import { ludoDriver } from './ludo.driver.js';
import { ticTacToeDriver } from './tictactoe.driver.js';
import { draughtsDriver } from './draughts.driver.js';
import { ayoDriver } from './ayo.driver.js';

/**
 * What a player can ask a game to do. The transport (REST route, later a socket) maps its request
 * onto one of these; the driver decides whether it is legal. The client never sends an outcome.
 */
export type DriverAction =
  | { kind: 'place'; cell: number }
  | { kind: 'roll' }
  | { kind: 'token'; token: number }
  | { kind: 'resume' }
  | { kind: 'draughts'; from: number; path: number[] }
  | { kind: 'ayo'; pit: number }
  | { kind: 'ayo-end'; action: 'offer' | 'accept' | 'decline' };

/** What starting a match produces: the first state, its opening events and the first turn clock. */
export interface StartResult {
  state: Prisma.InputJsonValue;
  deadlineAt: Date;
  events: EventDraft[];
}

/**
 * The server-side contract every game implements. `MatchesService` owns everything that is the
 * same for all games (authorization, idempotency by action id, stale-version refusal, the
 * transaction, the event log, results, timers, publishing). A driver owns only the game: it turns
 * a stored match plus an intent into the next `Change`, using the pure rules in `game-rules`.
 *
 * Drivers never touch the database and never read the clock or random numbers on their own:
 * `now` is passed in, and dice, shuffles and bot choices use the server's CSPRNG helpers.
 * A refused human action throws an `AppException`; "nothing to do" is `null`.
 */
export interface GameDriver {
  readonly gameId: string;
  /** Length of one turn clock; the bots' "thinking" delay is measured from its start. */
  readonly turnTimerMs: number;
  /** Set when the game is always played with exactly this many seats. */
  readonly fixedPlayerCount?: number;
  /** First state of a match whose seats are all ready. */
  start(match: MatchRecord, now: Date): StartResult;
  /** A human action. Throws an `AppException` when the action is refused. */
  act(
    match: MatchRecord,
    seat: AnySeat,
    action: DriverAction,
    clientActionId: string,
    now: Date,
  ): Change;
  /** A player leaves ('left') or is dropped after the disconnect grace ('disconnected'). */
  leave(
    match: MatchRecord,
    seat: AnySeat,
    now: Date,
    reason: 'left' | 'disconnected',
  ): Change | null;
  /** An overdue TURN or NEXT_GAME deadline. READY and expiry are handled by the service. */
  deadline(match: MatchRecord, now: Date): Change | null;
  /** One move for the bot whose turn it is, through the same validators as a human move. */
  botMove(match: MatchRecord, now: Date): Change | null;
  /** Which seat opens the rematch of a finished match. */
  rematchOpening(match: MatchRecord, seatCount: number): AnySeat;
}

const DRIVERS: readonly GameDriver[] = [ticTacToeDriver, ludoDriver, draughtsDriver, ayoDriver];

/** The driver for a game, or null when the server cannot run it. */
export function findDriver(gameId: string): GameDriver | null {
  return DRIVERS.find((driver) => driver.gameId === gameId) ?? null;
}

export function driverFor(gameId: string): GameDriver {
  const driver = findDriver(gameId);
  if (driver === null) {
    throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Game not found');
  }
  return driver;
}

export type { Change };
