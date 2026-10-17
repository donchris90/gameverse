import { z } from 'zod';

/** Games the server can host. Only tic-tac-toe is playable so far. */
export const GAME_IDS = ['tictactoe'] as const;
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

export interface MatchPlayerView {
  seat: 0 | 1;
  /** Null for a bot. */
  userId: string | null;
  /** Always set for a bot so clients can label it; null for a human. */
  bot: BotLevelName | null;
  username: string;
  avatarId: string;
  ready: boolean;
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

export interface MatchView {
  id: string;
  gameId: GameId;
  kind: MatchKind;
  status: MatchStatus;
  /** Increases with every change; send it back as `expectedVersion` with each move. */
  version: number;
  /** The viewer's seat. */
  mySeat: 0 | 1;
  players: MatchPlayerView[];
  /** Null until the match is active. */
  series: MatchSeriesView | null;
  deadline: { kind: MatchDeadlineKind; at: string } | null;
  serverTime: string;
  /** Why the match stopped early or finished: score, forfeit, timeout, left, expired. */
  endReason: string | null;
  winnerSeat: 0 | 1 | null;
  /** Seats that have asked for a rematch. */
  rematchRequestedBy: (0 | 1)[];
  /** Set once the rematch exists. */
  rematchMatchId: string | null;
  createdAt: string;
  endedAt: string | null;
}

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

export const emptyActionSchema = z.object({}).strict();
