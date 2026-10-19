import { describe, expect, it } from 'vitest';
import {
  DRAW_REPLAY_LIMIT,
  TURN_TIMER_MS,
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

  it('a drawn game does not count: it is played again with the other seat opening', () => {
    let series = playCells(createSeries(0), DRAW);
    expect(series.draws).toBe(1);
    expect(series.drawStreak).toBe(1);
    expect(series.wins).toEqual([0, 0]);
    expect(series.phase).toBe('between_games');
    series = must(startNextGame(series));
    expect(series.gameNumber).toBe(2);
    expect(series.firstSeat).toBe(1);
    expect(series.phase).toBe('playing');
  });

  it('three draws in a row end the match as a draw', () => {
    expect(DRAW_REPLAY_LIMIT).toBe(3);
    let series = playCells(createSeries(0), DRAW);
    series = must(startNextGame(series));
    series = playCells(series, DRAW);
    expect(series.phase).toBe('between_games');
    series = must(startNextGame(series));
    series = playCells(series, DRAW);
    expect(series.phase).toBe('completed');
    expect(series.winner).toBe('draw');
    expect(series.endReason).toBe('draw_limit');
    expect(series.draws).toBe(3);
    expect(seriesScore(series, 0)).toBe(0.5);
    expect(seriesScore(series, 1)).toBe(0.5);
  });

  it('three draws in a row end it as a draw even when one player leads', () => {
    let series = playCells(createSeries(0), FIRST_WINS); // 1-0
    for (let i = 0; i < DRAW_REPLAY_LIMIT; i += 1) {
      series = must(startNextGame(series));
      series = playCells(series, DRAW);
    }
    expect(series.phase).toBe('completed');
    expect(series.winner).toBe('draw');
    expect(series.wins).toEqual([1, 0]);
  });

  it('a decided game clears the run of draws', () => {
    let series = playCells(createSeries(0), DRAW);
    series = must(startNextGame(series));
    series = playCells(series, DRAW);
    expect(series.drawStreak).toBe(2);
    series = must(startNextGame(series));
    series = playCells(series, FIRST_WINS); // seat 0 opens game 3 and wins
    expect(series.drawStreak).toBe(0);
    expect(series.phase).toBe('between_games');
    expect(series.wins).toEqual([1, 0]);
    expect(series.draws).toBe(2);
  });

  it('draws do not stop a series being won: it goes on until a player has two wins', () => {
    let series = playCells(createSeries(0), FIRST_WINS); // 1-0, game 1
    series = must(startNextGame(series));
    series = playCells(series, DRAW); // game 2 drawn
    series = must(startNextGame(series));
    expect(series.gameNumber).toBe(3);
    expect(series.firstSeat).toBe(0);
    series = playCells(series, FIRST_WINS);
    expect(series.phase).toBe('completed');
    expect(series.wins).toEqual([2, 0]);
    expect(series.winner).toBe(0);
    expect(series.endReason).toBe('score');
    expect(series.history).toHaveLength(3);
  });

  it('a timeout loses that game for the seat that timed out, and the series goes on', () => {
    const series = createSeries(0);
    const after = must(timeoutTurn(series, 0));
    expect(after.wins).toEqual([0, 1]);
    expect(after.history[0]).toMatchObject({ result: 1, reason: 'timeout' });
    expect(after.phase).toBe('between_games');
    expect(after.endReason).toBeNull();
  });

  it('only the seat on turn can time out', () => {
    expect(timeoutTurn(createSeries(0), 1)).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
  });

  it('a timeout never forfeits the series: the other player needs two game wins', () => {
    let series = must(timeoutTurn(createSeries(0), 0)); // seat 0 times out: 0-1
    series = must(startNextGame(series)); // seat 1 opens
    series = must(playMove(series, 1, 4));
    series = must(timeoutTurn(series, 0)); // seat 0 times out again: 0-2
    expect(series.phase).toBe('completed');
    expect(series.winner).toBe(1);
    expect(series.endReason).toBe('score'); // by wins, not by forfeit
    expect(series.wins).toEqual([0, 2]);
  });

  it('the turn clock is 15 seconds, as in RRYDA', () => {
    expect(TURN_TIMER_MS).toBe(15_000);
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

  it('always finishes under random play, with never more than two wins and a bounded run of draws', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      let state = seed;
      const rand = (): number => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x1_0000_0000;
      };
      let series = createSeries(rand() < 0.5 ? 0 : 1);
      let steps = 0;
      while (series.phase !== 'completed' && steps < 2000) {
        steps += 1;
        if (series.phase === 'between_games') {
          series = must(startNextGame(series));
          continue;
        }
        const seat = seatToMove(series) as Seat;
        if (rand() < 0.03) series = must(timeoutTurn(series, seat));
        else {
          const free = series.game.board
            .map((cell, index) => (cell === null ? index : -1))
            .filter((index) => index >= 0);
          series = must(playMove(series, seat, free[Math.floor(rand() * free.length)]));
        }
        expect(series.drawStreak).toBeLessThanOrEqual(DRAW_REPLAY_LIMIT);
        expect(Math.max(...series.wins)).toBeLessThanOrEqual(2);
      }
      expect(series.phase).toBe('completed');
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

  it('replays a drawn game with the other seat opening, and a third draw in a row ends it', () => {
    let series = playCells(createSeries(0, 1), DRAW);
    expect(series.phase).toBe('between_games');
    expect(series.draws).toBe(1);
    series = must(startNextGame(series));
    expect(series.firstSeat).toBe(1);
    series = playCells(series, SECOND_WINS); // seat 1 opened and loses: seat 0 wins the single game
    expect(series.phase).toBe('completed');
    expect(series.winner).toBe(0);

    let stuck = playCells(createSeries(0, 1), DRAW);
    stuck = must(startNextGame(stuck));
    stuck = playCells(stuck, DRAW);
    stuck = must(startNextGame(stuck));
    stuck = playCells(stuck, DRAW);
    expect(stuck.phase).toBe('completed');
    expect(stuck.winner).toBe('draw');
    expect(stuck.endReason).toBe('draw_limit');
    expect(startNextGame(stuck)).toEqual({ ok: false, error: 'SERIES_NOT_PLAYING' });
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
