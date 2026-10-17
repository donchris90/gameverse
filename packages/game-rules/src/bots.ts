import {
  BOARD_SIZE,
  WIN_LINES,
  applyMove,
  legalMoves,
  otherMark,
  type Mark,
  type TicTacToeState,
} from './tictactoe.js';

export type BotLevel = 'easy' | 'medium' | 'hard';

/** Injected randomness: returns a number in [0, 1). The server supplies a seeded generator. */
export type Rng = () => number;

function pick<T>(items: readonly T[], rng: Rng): T {
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
  const item = items[index];
  if (item === undefined) throw new Error('pick() called with an empty list');
  return item;
}

/** A cell that would complete a line for `mark`, if any. */
function completingCell(state: TicTacToeState, mark: Mark): number | null {
  for (const [a, b, c] of WIN_LINES) {
    const cells = [a, b, c] as const;
    const owned = cells.filter((cell) => state.board[cell] === mark);
    const empty = cells.filter((cell) => state.board[cell] === null);
    if (owned.length === 2 && empty.length === 1) return empty[0] ?? null;
  }
  return null;
}

function easyMove(state: TicTacToeState, rng: Rng): number {
  return pick(legalMoves(state), rng);
}

/** Wins if it can, blocks if it must, then prefers centre, corners, edges. Beatable by a fork. */
function mediumMove(state: TicTacToeState, rng: Rng): number {
  const mark = state.next;
  const win = completingCell(state, mark);
  if (win !== null) return win;
  const block = completingCell(state, otherMark(mark));
  if (block !== null) return block;
  if (state.board[4] === null) return 4;
  const corners = [0, 2, 6, 8].filter((cell) => state.board[cell] === null);
  if (corners.length > 0) return pick(corners, rng);
  return pick(legalMoves(state), rng);
}

/** Score from `mark`'s point of view with best play from both sides; sooner wins score higher. */
function minimax(state: TicTacToeState, mark: Mark): number {
  if (state.status === 'won')
    return state.winner === mark ? 10 - state.moveCount : state.moveCount - 10;
  if (state.status === 'draw') return 0;
  const maximising = state.next === mark;
  let best = maximising ? -Infinity : Infinity;
  for (const cell of legalMoves(state)) {
    const moved = applyMove(state, state.next, cell);
    if (!moved.ok) continue;
    const score = minimax(moved.state, mark);
    best = maximising ? Math.max(best, score) : Math.min(best, score);
  }
  return best;
}

/** Perfect play. Ties between equally good moves are broken with the injected RNG for variety. */
function hardMove(state: TicTacToeState, rng: Rng): number {
  const mark = state.next;
  let bestScore = -Infinity;
  let bestCells: number[] = [];
  for (const cell of legalMoves(state)) {
    const moved = applyMove(state, mark, cell);
    if (!moved.ok) continue;
    const score = minimax(moved.state, mark);
    if (score > bestScore) {
      bestScore = score;
      bestCells = [cell];
    } else if (score === bestScore) {
      bestCells.push(cell);
    }
  }
  return pick(bestCells, rng);
}

/**
 * Chooses a cell for the player on turn. The result is only a suggestion: the caller must still
 * pass it through `applyMove`, exactly like a human's move, so a bot can never do anything a
 * human could not.
 */
export function chooseBotMove(state: TicTacToeState, level: BotLevel, rng: Rng): number {
  if (state.status !== 'in_progress')
    throw new Error('The game is over; there is no move to choose');
  if (state.moveCount >= BOARD_SIZE) throw new Error('The board is full');
  switch (level) {
    case 'easy':
      return easyMove(state, rng);
    case 'medium':
      return mediumMove(state, rng);
    case 'hard':
      return hardMove(state, rng);
  }
}
