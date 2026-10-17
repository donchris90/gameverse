/**
 * Tic-tac-toe rules. Pure and deterministic: every function returns a new value and never
 * touches I/O, time or randomness. X always moves first within a game.
 */
export type Mark = 'X' | 'O';
export type Cell = Mark | null;

export const BOARD_SIZE = 9;

export const WIN_LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export type GameStatus = 'in_progress' | 'won' | 'draw';

export interface TicTacToeState {
  readonly board: readonly Cell[];
  /** Whose turn it is. Meaningless once the game is over. */
  readonly next: Mark;
  readonly status: GameStatus;
  readonly winner: Mark | null;
  readonly winLine: readonly number[] | null;
  readonly moveCount: number;
}

export type MoveError = 'GAME_OVER' | 'NOT_YOUR_TURN' | 'INVALID_CELL' | 'CELL_TAKEN';

export type MoveResult =
  | { readonly ok: true; readonly state: TicTacToeState }
  | { readonly ok: false; readonly error: MoveError };

export function otherMark(mark: Mark): Mark {
  return mark === 'X' ? 'O' : 'X';
}

export function createGame(): TicTacToeState {
  return {
    board: Array.from({ length: BOARD_SIZE }, () => null),
    next: 'X',
    status: 'in_progress',
    winner: null,
    winLine: null,
    moveCount: 0,
  };
}

export function findWinLine(board: readonly Cell[]): readonly number[] | null {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    const mark = board[a];
    if (mark !== null && mark !== undefined && mark === board[b] && mark === board[c]) {
      return line;
    }
  }
  return null;
}

export function legalMoves(state: TicTacToeState): number[] {
  if (state.status !== 'in_progress') return [];
  const moves: number[] = [];
  for (let cell = 0; cell < BOARD_SIZE; cell += 1) {
    if (state.board[cell] === null) moves.push(cell);
  }
  return moves;
}

/**
 * Applies one move by `mark`. Every rejection is a value, never an exception, so callers can map
 * it to an error response without try/catch. `cell` is `unknown` on purpose: it is the one value
 * that arrives straight from a client.
 */
export function applyMove(state: TicTacToeState, mark: Mark, cell: unknown): MoveResult {
  if (state.status !== 'in_progress') return { ok: false, error: 'GAME_OVER' };
  if (mark !== state.next) return { ok: false, error: 'NOT_YOUR_TURN' };
  if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell >= BOARD_SIZE) {
    return { ok: false, error: 'INVALID_CELL' };
  }
  if (state.board[cell] !== null) return { ok: false, error: 'CELL_TAKEN' };

  const board = state.board.map((existing, index) => (index === cell ? mark : existing));
  const moveCount = state.moveCount + 1;
  const winLine = findWinLine(board);
  if (winLine !== null) {
    return {
      ok: true,
      state: { board, next: otherMark(mark), status: 'won', winner: mark, winLine, moveCount },
    };
  }
  if (moveCount === BOARD_SIZE) {
    return {
      ok: true,
      state: {
        board,
        next: otherMark(mark),
        status: 'draw',
        winner: null,
        winLine: null,
        moveCount,
      },
    };
  }
  return {
    ok: true,
    state: {
      board,
      next: otherMark(mark),
      status: 'in_progress',
      winner: null,
      winLine: null,
      moveCount,
    },
  };
}
