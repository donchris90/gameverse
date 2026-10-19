import {
  applyMove,
  createGame,
  type MoveError,
  type Mark,
  type TicTacToeState,
} from './tictactoe.js';

/**
 * A match is one game or best of three (first to two wins), played the RRYDA way (decision #120):
 * a drawn game does not count and is played again with the other player opening; three draws in a
 * row end the match as a draw (the fees are returned). A turn that runs out of time loses that game.
 * Best of three is the default.
 */
export type BestOf = 1 | 3;
export const BEST_OF_VALUES: readonly BestOf[] = [1, 3];
export const DEFAULT_BEST_OF: BestOf = 3;
export const WINS_NEEDED = 2;

/** Wins that settle a series of this length. */
export function winsNeeded(bestOf: BestOf): number {
  return bestOf === 1 ? 1 : WINS_NEEDED;
}
/** RRYDA's turn clock for tic-tac-toe. */
export const TURN_TIMER_MS = 15_000;
/** Draws in a row after which the match ends as a draw. */
export const DRAW_REPLAY_LIMIT = 3;

/** A seat is a player's fixed place in the match. Marks move between seats; seats never do. */
export type Seat = 0 | 1;

export type GameEndReason = 'line' | 'full_board' | 'timeout' | 'forfeit';
export type SeriesEndReason = 'score' | 'forfeit' | 'draw_limit';
export type SeriesPhase = 'playing' | 'between_games' | 'completed';

export interface GameRecord {
  readonly gameNumber: number;
  readonly firstSeat: Seat;
  readonly result: Seat | 'draw';
  readonly reason: GameEndReason;
}

export interface SeriesState {
  /** Games in the series: 1 (one game decides) or 3 (first to two wins). */
  readonly bestOf: BestOf;
  readonly phase: SeriesPhase;
  /** The seat that moves first (plays X) in the current or just-finished game. */
  readonly firstSeat: Seat;
  readonly gameNumber: number;
  readonly game: TicTacToeState;
  readonly wins: readonly [number, number];
  /** Drawn games in all (they are replayed and do not count towards the score). */
  readonly draws: number;
  /** Drawn games in a row; DRAW_REPLAY_LIMIT of them end the match. */
  readonly drawStreak: number;
  readonly history: readonly GameRecord[];
  readonly winner: Seat | 'draw' | null;
  readonly endReason: SeriesEndReason | null;
}

export type SeriesError = MoveError | 'SERIES_NOT_PLAYING' | 'NOT_YOUR_TURN';

export type SeriesResult =
  | { readonly ok: true; readonly series: SeriesState }
  | { readonly ok: false; readonly error: SeriesError };

export function otherSeat(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

export function createSeries(firstSeat: Seat = 0, bestOf: BestOf = DEFAULT_BEST_OF): SeriesState {
  return {
    bestOf,
    phase: 'playing',
    firstSeat,
    gameNumber: 1,
    game: createGame(),
    wins: [0, 0],
    draws: 0,
    drawStreak: 0,
    history: [],
    winner: null,
    endReason: null,
  };
}

/** Mark a seat plays in the current game. */
export function markOf(series: SeriesState, seat: Seat): Mark {
  return seat === series.firstSeat ? 'X' : 'O';
}

export function seatOf(series: SeriesState, mark: Mark): Seat {
  return mark === 'X' ? series.firstSeat : otherSeat(series.firstSeat);
}

/** The seat whose move is awaited, or null when no move is expected. */
export function seatToMove(series: SeriesState): Seat | null {
  if (series.phase !== 'playing') return null;
  return seatOf(series, series.game.next);
}

function bump(pair: readonly [number, number], seat: Seat): [number, number] {
  return seat === 0 ? [pair[0] + 1, pair[1]] : [pair[0], pair[1] + 1];
}

/** Closes the current game with `result`, then decides whether the series is over. */
function finishGame(
  series: SeriesState,
  game: TicTacToeState,
  result: Seat | 'draw',
  reason: GameEndReason,
): SeriesState {
  const history = [
    ...series.history,
    { gameNumber: series.gameNumber, firstSeat: series.firstSeat, result, reason },
  ];
  if (result === 'draw') {
    // A draw is simply played again (the other seat opens). Only an endless run of them ends it.
    const drawStreak = series.drawStreak + 1;
    const base = { ...series, game, draws: series.draws + 1, drawStreak, history };
    return drawStreak >= DRAW_REPLAY_LIMIT
      ? { ...base, phase: 'completed', winner: 'draw', endReason: 'draw_limit' }
      : { ...base, phase: 'between_games' };
  }
  const wins = bump(series.wins, result);
  const base = { ...series, game, wins, drawStreak: 0, history };
  return wins[result] >= winsNeeded(series.bestOf)
    ? { ...base, phase: 'completed', winner: result, endReason: 'score' }
    : { ...base, phase: 'between_games' };
}

/** A seat places its mark. The first mover alternates every game. */
export function playMove(series: SeriesState, seat: Seat, cell: unknown): SeriesResult {
  if (series.phase !== 'playing') return { ok: false, error: 'SERIES_NOT_PLAYING' };
  if (seat !== seatToMove(series)) return { ok: false, error: 'NOT_YOUR_TURN' };

  const moved = applyMove(series.game, markOf(series, seat), cell);
  if (!moved.ok) return { ok: false, error: moved.error };

  const game = moved.state;
  if (game.status === 'won' && game.winner !== null) {
    return {
      ok: true,
      series: finishGame(series, game, seatOf(series, game.winner), 'line'),
    };
  }
  if (game.status === 'draw') {
    return {
      ok: true,
      series: finishGame(series, game, 'draw', 'full_board'),
    };
  }
  return { ok: true, series: { ...series, game } };
}

/**
 * The turn timer ran out for `seat`. That seat loses the game (not the series). Only the seat that
 * is actually on turn can time out.
 */
export function timeoutTurn(series: SeriesState, seat: Seat): SeriesResult {
  if (series.phase !== 'playing') return { ok: false, error: 'SERIES_NOT_PLAYING' };
  if (seat !== seatToMove(series)) return { ok: false, error: 'NOT_YOUR_TURN' };
  return {
    ok: true,
    series: finishGame(series, series.game, otherSeat(seat), 'timeout'),
  };
}

/** Seat leaves or its disconnect grace expired: the other seat wins the whole series. */
export function forfeitSeries(series: SeriesState, seat: Seat): SeriesResult {
  if (series.phase === 'completed') return { ok: false, error: 'SERIES_NOT_PLAYING' };
  const winner = otherSeat(seat);
  const history = [
    ...series.history,
    {
      gameNumber: series.gameNumber,
      firstSeat: series.firstSeat,
      result: winner,
      reason: 'forfeit' as const,
    },
  ];
  return {
    ok: true,
    series: {
      ...series,
      phase: 'completed',
      wins: bump(series.wins, winner),
      history,
      winner,
      endReason: 'forfeit',
    },
  };
}

/** Moves from the just-finished game to the next one, with the other seat opening. */
export function startNextGame(series: SeriesState): SeriesResult {
  if (series.phase !== 'between_games') return { ok: false, error: 'SERIES_NOT_PLAYING' };
  return {
    ok: true,
    series: {
      ...series,
      phase: 'playing',
      firstSeat: otherSeat(series.firstSeat),
      gameNumber: series.gameNumber + 1,
      game: createGame(),
    },
  };
}

/** A fresh series; the opening seat keeps alternating from where the last series stopped. */
export function createRematch(previous: SeriesState): SeriesState {
  return createSeries(otherSeat(previous.firstSeat), previous.bestOf);
}

/** Ranking score for a seat: win 1, draw 0.5, loss 0. Only defined once the series is over. */
export function seriesScore(series: SeriesState, seat: Seat): 0 | 0.5 | 1 | null {
  if (series.phase !== 'completed' || series.winner === null) return null;
  if (series.winner === 'draw') return 0.5;
  return series.winner === seat ? 1 : 0;
}
