import { z } from 'zod';
import type { MatchResultView } from './progress.js';

/** Games the server can host. A game is offered to players only once its `games` row is enabled. */
export const GAME_IDS = ['tictactoe', 'ludo', 'draughts'] as const;
export type GameId = (typeof GAME_IDS)[number];

export const MATCH_STATUSES = [
  'WAITING',
  'READY',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'ABANDONED',
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const MATCH_KINDS = ['QUICK', 'PRIVATE', 'FRIEND', 'BOT'] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

export type BotLevelName = 'easy' | 'medium' | 'hard';

/** What the server is currently waiting for, and by when (server clock, ISO time). */
export type MatchDeadlineKind = 'READY' | 'TURN' | 'NEXT_GAME';

/** A seat is a player's fixed place in a match (tic-tac-toe uses 0-1, Ludo 0-3). */
export type PlayerSeat = 0 | 1 | 2 | 3;

export interface MatchPlayerView {
  seat: PlayerSeat;
  /** Null for a bot. */
  userId: string | null;
  /** Always set for a bot so clients can label it; null for a human. */
  bot: BotLevelName | null;
  username: string;
  avatarId: string;
  ready: boolean;
  /** False while a human has no live connection during an active match. Bots are always true. */
  connected: boolean;
  /** While disconnected: when the series is forfeited unless they come back. */
  reconnectBy: string | null;
  /** True once the player has left or been removed from a game that goes on without them (Ludo). */
  out: boolean;
}

export interface MatchSeriesView {
  phase: 'playing' | 'between_games' | 'completed';
  gameNumber: number;
  /** The seat that opens (plays X) in the current or just-finished game. */
  firstSeat: 0 | 1;
  /** 'X' | 'O' | null for each of the nine cells, row by row. */
  board: (string | null)[];
  /** Seat whose move is awaited, or null when nobody is on turn. */
  seatToMove: 0 | 1 | null;
  winLine: number[] | null;
  wins: [number, number];
  draws: number;
  history: {
    gameNumber: number;
    firstSeat: 0 | 1;
    result: 0 | 1 | 'draw';
    reason: 'line' | 'full_board' | 'timeout' | 'forfeit';
  }[];
  winner: 0 | 1 | 'draw' | null;
  endReason: 'score' | 'forfeit' | null;
}

/** One thing that happened in the last change to a Ludo game, for animation. */
export interface LudoEventView {
  type: string;
  seat?: PlayerSeat;
  value?: number;
  token?: number;
  from?: number;
  to?: number;
  victim?: PlayerSeat;
  place?: number;
}

export interface LudoMoveView {
  token: number;
  from: number;
  to: number;
  capturesSeat: PlayerSeat | null;
  entersFromBase: boolean;
  reachesHome: boolean;
}

/**
 * Ludo state as the phone sees it. Positions are per token and relative to the owner: -1 base,
 * 0-51 the shared track from the owner's start square, 52-56 the home column, 57 home. The
 * server computes `moves`, so the phone never has to know the rules.
 */
export interface LudoView {
  phase: 'roll' | 'move' | 'finished';
  players: 2 | 3 | 4;
  /** Board colour (0-3) of each seat. */
  colours: number[];
  tokens: number[][];
  /** Seat on turn, or null once the game is over. */
  toMove: PlayerSeat | null;
  /** The die waiting to be used (phase 'move'), else null. */
  roll: number | null;
  sixes: number;
  /** Legal moves for the die in `roll`; empty unless phase is 'move'. */
  moves: LudoMoveView[];
  finished: PlayerSeat[];
  removed: PlayerSeat[];
  /** Final order, first place first, once the game is over. */
  placings: PlayerSeat[] | null;
  endReason: 'completed' | 'forfeit' | null;
  rolls: number;
  /** What the last change did, oldest first. */
  lastEvents: LudoEventView[];
}

/** One legal draughts move: the starting square, the landing squares, and what it jumps. */
export interface DraughtsMoveView {
  from: number;
  path: number[];
  captures: number[];
}

/**
 * Draughts state as the phone sees it. Squares are 0-63 (`row * 8 + col`, row 0 at the top).
 * Board cells: 0 empty, 1 seat 0 man, 2 seat 0 king, 3 seat 1 man, 4 seat 1 king. The server
 * computes `moves`, so the phone never has to know the rules.
 */
export interface DraughtsView {
  phase: 'playing' | 'finished';
  board: number[];
  /** Seat on turn, or null once the game is over. */
  toMove: PlayerSeat | null;
  /** Every legal move for the seat on turn (captures only when a capture exists). */
  moves: DraughtsMoveView[];
  winner: PlayerSeat | 'draw' | null;
  endReason: 'no_pieces' | 'no_moves' | 'repetition' | 'forty_moves' | 'timeout' | 'forfeit' | null;
  plies: number;
  /** Plies since the last capture or man move (the draw counter). */
  sinceProgress: number;
  /** The move that was just played, for highlighting. */
  last: DraughtsMoveView | null;
}

export interface MatchView {
  id: string;
  gameId: GameId;
  kind: MatchKind;
  status: MatchStatus;
  /** Increases with every change; send it back as `expectedVersion` with each move. */
  version: number;
  /** The viewer's seat. */
  mySeat: PlayerSeat;
  players: MatchPlayerView[];
  /** Tic-tac-toe state; null until the match is active and for other games. */
  series: MatchSeriesView | null;
  /** Ludo state; null until the match is active and for other games. */
  ludo: LudoView | null;
  /** Draughts state; null until the match is active and for other games. */
  draughts: DraughtsView | null;
  deadline: { kind: MatchDeadlineKind; at: string } | null;
  serverTime: string;
  /** Why the match stopped early or finished: score, forfeit, timeout, left, expired. */
  endReason: string | null;
  winnerSeat: PlayerSeat | null;
  /** What the finished match did to ratings and XP; null while open or if nothing was recorded. */
  result: MatchResultView | null;
  /** Seats that have asked for a rematch. */
  rematchRequestedBy: PlayerSeat[];
  /** Set once the rematch exists. */
  rematchMatchId: string | null;
  createdAt: string;
  endedAt: string | null;
}

/** How long a disconnected player has to come back before the series is forfeited. */
export const DISCONNECT_GRACE_MS = 30_000;

export const matchIdSchema = z.uuid();

export const moveSchema = z
  .object({
    cell: z.number().int().min(0).max(8),
    /** Client-generated idempotency key: a retry of the same move is ignored, never applied twice. */
    clientActionId: z.uuid(),
    /** The match version the client saw when it chose the move. */
    expectedVersion: z.number().int().min(0),
  })
  // Unknown fields (for example a "winner") are rejected, never silently ignored.
  .strict();
export type MoveRequest = z.input<typeof moveSchema>;

export const BOT_LEVELS = ['easy', 'medium', 'hard'] as const;

/** Starts a practice match against a labelled bot. The server picks who opens. */
export const botMatchSchema = z
  .object({
    gameId: z.enum(GAME_IDS),
    level: z.enum(BOT_LEVELS),
    /** Ludo only: total seats including the human (the rest are bots). Default 2. */
    players: z.number().int().min(2).max(4).optional(),
  })
  .strict();
export type BotMatchRequest = z.input<typeof botMatchSchema>;

export const emptyActionSchema = z.object({}).strict();

/** Ludo: ask the server to roll the die for you. The phone never chooses a number. */
export const rollSchema = z
  .object({
    clientActionId: z.uuid(),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export type RollRequest = z.input<typeof rollSchema>;

/** Ludo: move one of your four tokens by the die you rolled. */
export const tokenMoveSchema = z
  .object({
    token: z.number().int().min(0).max(3),
    clientActionId: z.uuid(),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export type TokenMoveRequest = z.input<typeof tokenMoveSchema>;

/** Draughts: play a move. The phone sends squares only; the server works out the captures. */
export const draughtsMoveSchema = z
  .object({
    from: z.number().int().min(0).max(63),
    path: z.array(z.number().int().min(0).max(63)).min(1).max(16),
    clientActionId: z.uuid(),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export type DraughtsMoveRequest = z.input<typeof draughtsMoveSchema>;
