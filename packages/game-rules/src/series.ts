import {
  applyMove,
  createGame,
  type MoveError,
  type Mark,
  type TicTacToeState,
} from './tictactoe.js';

/** Best of three games; first to two wins. A turn that runs out of time loses that game. */
export const SERIES_MAX_GAMES = 3;
export const WINS_NEEDED = 2;
export const TURN_TIMER_MS = 20_000;
export const MAX_CONSECUTIVE_TIMEOUTS = 2;

/** A seat is a player's fixed place in the match. Marks move between seats; seats never do. */
export type Seat = 0 | 1;

export type GameEndReason = 'line' | 'full_board' | 'timeout' | 'forfeit';
export type SeriesEndReason = 'score' | 'forfeit';
export type SeriesPhase = 'playing' | 'between_games' | 'completed';

export interface GameRecord {
  readonly gameNumber: number;
  readonly firstSeat: Seat;
  readonly result: Seat | 'draw';
  readonly reason: GameEndReason;
}

export interface SeriesState {
  readonly phase: SeriesPhase;
  /** The seat that moves first (plays X) in the current or just-finished game. */
  readonly firstSeat: Seat;
  readonly gameNumber: number;
  readonly game: TicTacToeState;
  readonly wins: readonly [number, number];
  readonly draws: number;
  readonly consecutiveTimeouts: readonly [number, number];
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

export function createSeries(firstSeat: Seat = 0): SeriesState {
  return {
    phase: 'playing',
    firstSeat,
    gameNumber: 1,
    game: createGame(),
    wins: [0, 0],
    draws: 0,
    consecutiveTimeouts: [0, 0],
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

function withCount(pair: readonly [number, number], seat: Seat, value: number): [number, number] {
  return seat === 0 ? [value, pair[1]] : [pair[0], value];
}

/** Closes the current game with `result`, then decides whether the series is over. */
function finishGame(
  series: SeriesState,
  game: TicTacToeState,
  result: Seat | 'draw',
  reason: GameEndReason,
  consecutiveTimeouts: readonly [number, number],
): SeriesState {
  const wins = result === 'draw' ? series.wins : bump(series.wins, result);
  const draws = result === 'draw' ? series.draws + 1 : series.draws;
  const history = [
    ...series.history,
    { gameNumber: series.gameNumber, firstSeat: series.firstSeat, result, reason },
  ];
  const base = { ...series, game, wins, draws, history, consecutiveTimeouts };

  const forfeited =
    reason === 'timeout' &&
    result !== 'draw' &&
    consecutiveTimeouts[otherSeat(result)] >= MAX_CONSECUTIVE_TIMEOUTS;
  if (forfeited) {
    return { ...base, phase: 'completed', winner: result, endReason: 'forfeit' };
  }

  const reachedTarget = wins[0] >= WINS_NEEDED || wins[1] >= WINS_NEEDED;
  if (reachedTarget || series.gameNumber >= SERIES_MAX_GAMES) {
    const winner: Seat | 'draw' = wins[0] === wins[1] ? 'draw' : wins[0] > wins[1] ? 0 : 1;
    return { ...base, phase: 'completed', winner, endReason: 'score' };
  }
  return { ...base, phase: 'between_games' };
}

/** A seat places its mark. The first mover alternates every game. */
export function playMove(series: SeriesState, seat: Seat, cell: unknown): SeriesResult {
  if (series.phase !== 'playing') return { ok: false, error: 'SERIES_NOT_PLAYING' };
  if (seat !== seatToMove(series)) return { ok: false, error: 'NOT_YOUR_TURN' };

  const moved = applyMove(series.game, markOf(series, seat), cell);
  if (!moved.ok) return { ok: false, error: moved.error };

  // Any real move clears that seat's run of timeouts.
  const consecutiveTimeouts = withCount(series.consecutiveTimeouts, seat, 0);
  const game = moved.state;
  if (game.status === 'won' && game.winner !== null) {
    return {
      ok: true,
      series: finishGame(series, game, seatOf(series, game.winner), 'line', consecutiveTimeouts),
    };
  }
  if (game.status === 'draw') {
    return {
      ok: true,
      series: finishGame(series, game, 'draw', 'full_board', consecutiveTimeouts),
    };
  }
  return { ok: true, series: { ...series, game, consecutiveTimeouts } };
}

/**
 * The turn timer ran out for `seat`. That seat loses the game; two timeouts in a row forfeit the
 * whole series. Only the seat that is actually on turn can time out.
 */
export function timeoutTurn(series: SeriesState, seat: Seat): SeriesResult {
  if (series.phase !== 'playing') return { ok: false, error: 'SERIES_NOT_PLAYING' };
  if (seat !== seatToMove(series)) return { ok: false, error: 'NOT_YOUR_TURN' };
  const consecutiveTimeouts = withCount(
    series.consecutiveTimeouts,
    seat,
    series.consecutiveTimeouts[seat] + 1,
  );
  return {
    ok: true,
    series: finishGame(series, series.game, otherSeat(seat), 'timeout', consecutiveTimeouts),
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
  return createSeries(otherSeat(previous.firstSeat));
}

/** Ranking score for a seat: win 1, draw 0.5, loss 0. Only defined once the series is over. */
export function seriesScore(series: SeriesState, seat: Seat): 0 | 0.5 | 1 | null {
  if (series.phase !== 'completed' || series.winner === null) return null;
  if (series.winner === 'draw') return 0.5;
  return series.winner === seat ? 1 : 0;
}
