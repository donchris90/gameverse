import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  WIN_LINES,
  applyMove,
  createGame,
  legalMoves,
  otherMark,
  type Cell,
  type Mark,
  type TicTacToeState,
} from './tictactoe.js';

/** Independent winner check written differently from the production code (rows/cols/diagonals). */
function referenceWinner(board: readonly Cell[]): Mark | null {
  const at = (row: number, col: number): Cell => board[row * 3 + col] ?? null;
  const candidates: Cell[][] = [];
  for (let i = 0; i < 3; i += 1) {
    candidates.push([at(i, 0), at(i, 1), at(i, 2)]);
    candidates.push([at(0, i), at(1, i), at(2, i)]);
  }
  candidates.push([at(0, 0), at(1, 1), at(2, 2)]);
  candidates.push([at(0, 2), at(1, 1), at(2, 0)]);
  for (const line of candidates) {
    const [a, b, c] = line;
    if (a !== null && a === b && b === c) return a ?? null;
  }
  return null;
}

function play(cells: number[]): TicTacToeState {
  let state = createGame();
  for (const cell of cells) {
    const moved = applyMove(state, state.next, cell);
    if (!moved.ok) throw new Error(`move ${String(cell)} rejected: ${moved.error}`);
    state = moved.state;
  }
  return state;
}

describe('tic-tac-toe rules', () => {
  it('starts empty with X to move', () => {
    const game = createGame();
    expect(game.board).toHaveLength(BOARD_SIZE);
    expect(game.board.every((cell) => cell === null)).toBe(true);
    expect(game.next).toBe('X');
    expect(game.status).toBe('in_progress');
    expect(legalMoves(game)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('has exactly eight distinct winning lines', () => {
    expect(WIN_LINES).toHaveLength(8);
    expect(new Set(WIN_LINES.map((line) => [...line].sort().join())).size).toBe(8);
  });

  it('rejects every kind of bad move without changing the state', () => {
    const game = play([4]);
    expect(applyMove(game, 'X', 0)).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
    expect(applyMove(game, 'O', 4)).toEqual({ ok: false, error: 'CELL_TAKEN' });
    for (const bad of [-1, 9, 1.5, Number.NaN, Infinity, '3', null, undefined, {}, [3], true]) {
      expect(applyMove(game, 'O', bad)).toEqual({ ok: false, error: 'INVALID_CELL' });
    }
    expect(game.moveCount).toBe(1);
  });

  it('never mutates the state it is given', () => {
    const game = createGame();
    const snapshot = JSON.stringify(game);
    applyMove(game, 'X', 0);
    expect(JSON.stringify(game)).toBe(snapshot);
  });

  it('detects a win and reports the line', () => {
    const won = play([0, 3, 1, 4, 2]);
    expect(won.status).toBe('won');
    expect(won.winner).toBe('X');
    expect(won.winLine).toEqual([0, 1, 2]);
    expect(legalMoves(won)).toEqual([]);
    expect(applyMove(won, 'O', 5)).toEqual({ ok: false, error: 'GAME_OVER' });
  });

  it('detects a draw only when the board is full with no line', () => {
    const drawn = play([0, 1, 2, 4, 3, 5, 7, 6, 8]);
    expect(drawn.status).toBe('draw');
    expect(drawn.winner).toBeNull();
    expect(drawn.moveCount).toBe(9);
  });

  it('plays every possible game and matches the known tic-tac-toe totals', () => {
    let games = 0;
    let xWins = 0;
    let oWins = 0;
    let draws = 0;
    let winsOnNinthMove = 0;
    const positions = new Set<string>();
    const problems: string[] = [];

    const walk = (state: TicTacToeState): void => {
      positions.add(state.board.map((cell) => cell ?? '.').join(''));
      // Invariants that must hold in every reachable position.
      const marks = state.board.filter((cell) => cell !== null).length;
      const reference = referenceWinner(state.board);
      if (marks !== state.moveCount) problems.push(`move count wrong: ${JSON.stringify(state)}`);
      if (state.winner !== reference) problems.push(`winner wrong: ${JSON.stringify(state)}`);
      if ((state.status === 'won') !== (reference !== null)) {
        problems.push(`status wrong: ${JSON.stringify(state)}`);
      }

      if (state.status !== 'in_progress') {
        games += 1;
        if (state.status === 'draw') draws += 1;
        else {
          if (state.winner === 'X') xWins += 1;
          else oWins += 1;
          if (state.moveCount === BOARD_SIZE) winsOnNinthMove += 1;
        }
        return;
      }
      for (const cell of legalMoves(state)) {
        const moved = applyMove(state, state.next, cell);
        if (!moved.ok) {
          problems.push('a legal move was rejected');
          continue;
        }
        if (moved.state.next !== otherMark(state.next)) problems.push('turn did not alternate');
        walk(moved.state);
      }
    };
    walk(createGame());

    expect(problems).toEqual([]);
    // Well-known figures: 255,168 distinct games, 5,478 reachable positions.
    expect(games).toBe(255_168);
    expect(xWins).toBe(131_184);
    expect(oWins).toBe(77_904);
    expect(draws).toBe(46_080);
    expect(positions.size).toBe(5_478);
    // Games that end on the ninth move split into 81,792 wins and 46,080 draws.
    expect(winsOnNinthMove).toBe(81_792);
  }, 60_000);
});
