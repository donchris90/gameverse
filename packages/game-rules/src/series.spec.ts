import { describe, expect, it } from 'vitest';
import {
  MAX_CONSECUTIVE_TIMEOUTS,
  createRematch,
  createSeries,
  forfeitSeries,
  markOf,
  playMove,
  seatOf,
  seatToMove,
  seriesScore,
  startNextGame,
  timeoutTurn,
  type Seat,
  type SeriesState,
} from './series.js';

function must(
  result: { ok: true; series: SeriesState } | { ok: false; error: string },
): SeriesState {
  if (!result.ok) throw new Error(`unexpected rejection: ${result.error}`);
  return result.series;
}

/** Plays cells in order; whoever is on turn moves. */
function playCells(series: SeriesState, cells: number[]): SeriesState {
  let current = series;
  for (const cell of cells) {
    const seat = seatToMove(current);
    if (seat === null) throw new Error('nobody to move');
    current = must(playMove(current, seat, cell));
  }
  return current;
}

// Cell orders (first mover plays X): first mover wins / second mover wins / draw.
const FIRST_WINS = [0, 3, 1, 4, 2];
const SECOND_WINS = [0, 3, 1, 4, 8, 5];
const DRAW = [0, 1, 2, 4, 3, 5, 7, 6, 8];

describe('series', () => {
  it('starts with seat 0 as X', () => {
    const series = createSeries();
    expect(series.phase).toBe('playing');
    expect(markOf(series, 0)).toBe('X');
    expect(markOf(series, 1)).toBe('O');
    expect(seatToMove(series)).toBe(0);
    expect(seatOf(series, 'O')).toBe(1);
  });

  it('only the seat on turn can move, and bad cells change nothing', () => {
    const series = createSeries();
    expect(playMove(series, 1, 0)).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
    expect(playMove(series, 0, 99)).toEqual({ ok: false, error: 'INVALID_CELL' });
    const after = must(playMove(series, 0, 4));
    expect(playMove(after, 1, 4)).toEqual({ ok: false, error: 'CELL_TAKEN' });
  });

  it('a 2-0 sweep ends the series after two games', () => {
    let series = playCells(createSeries(0), FIRST_WINS);
    expect(series.phase).toBe('between_games');
    expect(series.wins).toEqual([1, 0]);
    expect(playMove(series, 0, 0)).toEqual({ ok: false, error: 'SERIES_NOT_PLAYING' });

    series = must(startNextGame(series));
    expect(series.gameNumber).toBe(2);
    expect(series.firstSeat).toBe(1); // alternates
    expect(markOf(series, 1)).toBe('X');
    // Seat 1 opens game 2; make seat 0 (O) win it: seat 1 plays X.
    series = playCells(series, SECOND_WINS);
    expect(series.wins).toEqual([2, 0]);
    expect(series.phase).toBe('completed');
    expect(series.winner).toBe(0);
    expect(series.endReason).toBe('score');
    expect(series.history).toHaveLength(2);
    expect(seriesScore(series, 0)).toBe(1);
    expect(seriesScore(series, 1)).toBe(0);
  });

  it('goes to a third game at 1-1 and the third decides it', () => {
    let series = playCells(createSeries(0), FIRST_WINS); // seat 0 wins g1
    series = must(startNextGame(series));
    series = playCells(series, FIRST_WINS); // seat 1 opens g2 and wins
    expect(series.wins).toEqual([1, 1]);
    expect(series.phase).toBe('between_games');
    series = must(startNextGame(series));
    expect(series.gameNumber).toBe(3);
    expect(series.firstSeat).toBe(0);
    series = playCells(series, FIRST_WINS);
    expect(series.phase).toBe('completed');
    expect(series.winner).toBe(0);
    expect(series.wins).toEqual([2, 1]);
  });

  it('a drawn game still counts as a game played', () => {
    let series = playCells(createSeries(0), DRAW);
    expect(series.draws).toBe(1);
    expect(series.wins).toEqual([0, 0]);
    series = must(startNextGame(series));
    series = playCells(series, DRAW);
    series = must(startNextGame(series));
    series = playCells(series, DRAW);
    expect(series.phase).toBe('completed');
    expect(series.winner).toBe('draw');
    expect(seriesScore(series, 0)).toBe(0.5);
    expect(seriesScore(series, 1)).toBe(0.5);
  });

  it('after three games the player with more wins takes a drawn-out series', () => {
    let series = playCells(createSeries(0), FIRST_WINS); // 1-0
    series = must(startNextGame(series));
    series = playCells(series, DRAW); // 1-0, one draw
    series = must(startNextGame(series));
    series = playCells(series, DRAW);
    expect(series.phase).toBe('completed');
    expect(series.wins).toEqual([1, 0]);
    expect(series.winner).toBe(0);
  });

  it('a timeout loses that game for the seat that timed out', () => {
    const series = createSeries(0);
    const after = must(timeoutTurn(series, 0));
    expect(after.wins).toEqual([0, 1]);
    expect(after.history[0]).toMatchObject({ result: 1, reason: 'timeout' });
    expect(after.phase).toBe('between_games');
    expect(after.consecutiveTimeouts).toEqual([1, 0]);
  });

  it('only the seat on turn can time out', () => {
    expect(timeoutTurn(createSeries(0), 1)).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
  });

  it('a real move clears the run of timeouts', () => {
    let series = must(timeoutTurn(createSeries(0), 0)); // seat 0 times out in game 1
    series = must(startNextGame(series)); // seat 1 opens game 2
    series = must(playMove(series, 1, 4));
    series = must(playMove(series, 0, 0)); // seat 0 moves: run is cleared
    expect(series.consecutiveTimeouts).toEqual([0, 0]);
  });

  it('forfeits when the same seat times out in consecutive games without moving', () => {
    let series = must(timeoutTurn(createSeries(0), 0)); // g1: seat 0 on turn, times out
    series = must(startNextGame(series)); // g2: seat 1 opens
    series = must(timeoutTurn(series, 1)); // seat 1 times out instead
    expect(series.consecutiveTimeouts).toEqual([1, 1]);
    expect(series.wins).toEqual([1, 1]);
    series = must(startNextGame(series)); // g3: seat 0 opens
    series = must(timeoutTurn(series, 0)); // seat 0's second timeout in a row
    expect(MAX_CONSECUTIVE_TIMEOUTS).toBe(2);
    expect(series.phase).toBe('completed');
    expect(series.winner).toBe(1);
    expect(series.endReason).toBe('forfeit');
  });

  it('two consecutive timeouts by one seat end the series before the third game', () => {
    // Seat 0 times out in game 1, seat 1 opens game 2 and moves, then seat 0 times out again
    // without having moved in between: its second timeout in a row.
    let series = must(timeoutTurn(createSeries(0), 0)); // seat 0: 1 timeout
    series = must(startNextGame(series)); // seat 1 opens g2
    series = must(playMove(series, 1, 4)); // seat 1 moves
    series = must(timeoutTurn(series, 0)); // seat 0 on turn, times out again
    expect(series.phase).toBe('completed');
    expect(series.winner).toBe(1);
    expect(series.endReason).toBe('forfeit');
  });

  it('forfeit gives the other seat the series and cannot be repeated', () => {
    const series = must(forfeitSeries(playCells(createSeries(0), [4]), 1));
    expect(series.phase).toBe('completed');
    expect(series.winner).toBe(0);
    expect(series.endReason).toBe('forfeit');
    expect(forfeitSeries(series, 0)).toEqual({ ok: false, error: 'SERIES_NOT_PLAYING' });
    expect(playMove(series, 0, 0)).toEqual({ ok: false, error: 'SERIES_NOT_PLAYING' });
    expect(timeoutTurn(series, 0)).toEqual({ ok: false, error: 'SERIES_NOT_PLAYING' });
  });

  it('rematch keeps the first-mover alternation going', () => {
    let series = playCells(createSeries(0), FIRST_WINS);
    series = must(startNextGame(series));
    series = playCells(series, SECOND_WINS);
    expect(series.phase).toBe('completed');
    expect(series.firstSeat).toBe(1); // seat 1 opened the last game
    const rematch = createRematch(series);
    expect(rematch.firstSeat).toBe(0);
    expect(rematch.gameNumber).toBe(1);
    expect(rematch.wins).toEqual([0, 0]);
    expect(rematch.history).toEqual([]);
  });

  it('cannot start the next game before the current one is over, or after the series', () => {
    expect(startNextGame(createSeries())).toEqual({ ok: false, error: 'SERIES_NOT_PLAYING' });
    const done = must(forfeitSeries(createSeries(), 0));
    expect(startNextGame(done)).toEqual({ ok: false, error: 'SERIES_NOT_PLAYING' });
  });

  it('the score is undefined until the series ends', () => {
    expect(seriesScore(createSeries(), 0)).toBeNull();
  });

  it('never lets a series exceed three games (seeded random play)', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      let state = seed;
      const rand = (): number => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x1_0000_0000;
      };
      let series = createSeries(rand() < 0.5 ? 0 : 1);
      let steps = 0;
      while (series.phase !== 'completed' && steps < 200) {
        steps += 1;
        if (series.phase === 'between_games') {
          series = must(startNextGame(series));
          continue;
        }
        const seat = seatToMove(series) as Seat;
        const roll = rand();
        if (roll < 0.03) series = must(timeoutTurn(series, seat));
        else {
          const free = series.game.board
            .map((cell, index) => (cell === null ? index : -1))
            .filter((index) => index >= 0);
          series = must(playMove(series, seat, free[Math.floor(rand() * free.length)]));
        }
        expect(series.gameNumber).toBeLessThanOrEqual(3);
      }
      expect(series.phase).toBe('completed');
      expect(series.history.length).toBeLessThanOrEqual(3);
      expect(series.winner).not.toBeNull();
    }
  });
});

describe('a single game (best of 1)', () => {
  it('is over as soon as one game is won', () => {
    const done = playCells(createSeries(0, 1), FIRST_WINS);
    expect(done.phase).toBe('completed');
    expect(done.winner).toBe(0);
    expect(done.endReason).toBe('score');
    expect(done.wins).toEqual([1, 0]);
    expect(seriesScore(done, 0)).toBe(1);
    expect(seriesScore(done, 1)).toBe(0);
  });

  it('is over when the second mover wins too', () => {
    const done = playCells(createSeries(0, 1), SECOND_WINS);
    expect(done.phase).toBe('completed');
    expect(done.winner).toBe(1);
  });

  it('ends a drawn game as a drawn match, with no replay', () => {
    const done = playCells(createSeries(0, 1), DRAW);
    expect(done.phase).toBe('completed');
    expect(done.winner).toBe('draw');
    expect(done.draws).toBe(1);
    expect(startNextGame(done)).toEqual({ ok: false, error: 'SERIES_NOT_PLAYING' });
  });

  it('is lost by one timeout', () => {
    const done = must(timeoutTurn(createSeries(0, 1), 0));
    expect(done.phase).toBe('completed');
    expect(done.winner).toBe(1);
  });

  it('keeps its length for a rematch, and best of three stays the default', () => {
    expect(createRematch(createSeries(0, 1)).bestOf).toBe(1);
    expect(createSeries().bestOf).toBe(3);
    expect(createRematch(createSeries(0)).bestOf).toBe(3);
  });

  it('best of three still needs two wins', () => {
    const mid = playCells(createSeries(0, 3), FIRST_WINS);
    expect(mid.phase).toBe('between_games');
  });
});
