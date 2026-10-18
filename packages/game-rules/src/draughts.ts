/**
 * English draughts (American checkers) on 8x8, exactly as approved in docs/draughts-rules.md.
 * Pure and deterministic: nothing here reads a clock or a random source, and every function
 * returns a new state instead of changing the old one.
 *
 * Squares are indexes 0..63, `row * 8 + col`, row 0 at the top. Only dark squares are used
 * (`(row + col)` odd). Seat 0 starts on the bottom three rows and moves up (row decreasing); seat 1
 * starts on the top three rows and moves down.
 */

export type DraughtsSeat = 0 | 1;

/** 0 empty, 1 seat 0 man, 2 seat 0 king, 3 seat 1 man, 4 seat 1 king. */
export type DraughtsPiece = 0 | 1 | 2 | 3 | 4;

export const DRAUGHTS_BOARD_SIZE = 8;
export const DRAUGHTS_TURN_TIMER_MS = 20_000;
/** Plies (single moves) without a capture or a man move after which the game is drawn. */
export const FORTY_MOVE_PLIES = 80;
export const REPETITION_LIMIT = 3;

export type DraughtsEndReason =
  'no_pieces' | 'no_moves' | 'repetition' | 'forty_moves' | 'timeout' | 'forfeit';

export interface DraughtsMove {
  readonly from: number;
  /** Landing squares in order: one square for a plain move, one per jump for a capture. */
  readonly path: readonly number[];
  /** Squares of the jumped pieces, in order. Empty for a plain move. */
  readonly captures: readonly number[];
}

export interface DraughtsState {
  readonly board: readonly DraughtsPiece[];
  readonly toMove: DraughtsSeat;
  readonly phase: 'playing' | 'finished';
  readonly winner: DraughtsSeat | 'draw' | null;
  readonly endReason: DraughtsEndReason | null;
  /** Plies since the last capture or man move. */
  readonly sinceProgress: number;
  /** How often each position (board + side to move) has occurred since the last irreversible move. */
  readonly positions: Readonly<Record<string, number>>;
  /** Plies played so far. */
  readonly plies: number;
  readonly last: DraughtsMove | null;
}

export type DraughtsError = 'NOT_YOUR_TURN' | 'GAME_FINISHED' | 'INVALID_SQUARE' | 'ILLEGAL_MOVE';

export type DraughtsEvent =
  | {
      type: 'MOVED';
      seat: DraughtsSeat;
      from: number;
      path: number[];
      captures: number[];
      crowned: boolean;
    }
  | { type: 'GAME_ENDED'; winner: DraughtsSeat | 'draw'; reason: DraughtsEndReason };

export type DraughtsResult =
  { ok: true; state: DraughtsState; events: DraughtsEvent[] } | { ok: false; error: DraughtsError };

export const isDarkSquare = (square: number): boolean =>
  Number.isInteger(square) &&
  square >= 0 &&
  square < 64 &&
  (Math.floor(square / 8) + (square % 8)) % 2 === 1;

export const pieceOwner = (piece: DraughtsPiece): DraughtsSeat | null =>
  piece === 0 ? null : piece <= 2 ? 0 : 1;
export const isKing = (piece: DraughtsPiece): boolean => piece === 2 || piece === 4;
const man = (seat: DraughtsSeat): DraughtsPiece => (seat === 0 ? 1 : 3);
const king = (seat: DraughtsSeat): DraughtsPiece => (seat === 0 ? 2 : 4);
const crownRow = (seat: DraughtsSeat): number => (seat === 0 ? 0 : 7);

function positionKey(board: readonly DraughtsPiece[], toMove: DraughtsSeat): string {
  return `${board.join('')}${toMove}`;
}

export function initialBoard(): DraughtsPiece[] {
  const board: DraughtsPiece[] = Array.from({ length: 64 }, () => 0 as DraughtsPiece);
  for (let square = 0; square < 64; square += 1) {
    if (!isDarkSquare(square)) continue;
    const row = Math.floor(square / 8);
    if (row <= 2) board[square] = man(1);
    else if (row >= 5) board[square] = man(0);
  }
  return board;
}

/** A new game. `opening` moves first. */
export function createDraughts(opening: DraughtsSeat): DraughtsState {
  const board = initialBoard();
  return {
    board,
    toMove: opening,
    phase: 'playing',
    winner: null,
    endReason: null,
    sinceProgress: 0,
    positions: { [positionKey(board, opening)]: 1 },
    plies: 0,
    last: null,
  };
}

function directions(piece: DraughtsPiece): readonly (readonly [number, number])[] {
  if (isKing(piece)) {
    return [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ];
  }
  const dr = pieceOwner(piece) === 0 ? -1 : 1;
  return [
    [dr, -1],
    [dr, 1],
  ];
}

const inside = (row: number, col: number): boolean =>
  row >= 0 && row < DRAUGHTS_BOARD_SIZE && col >= 0 && col < DRAUGHTS_BOARD_SIZE;

/** Every complete capture sequence for the piece on `from`, longest or not. */
function capturesFrom(
  board: readonly DraughtsPiece[],
  from: number,
  seat: DraughtsSeat,
): DraughtsMove[] {
  const piece = board[from] as DraughtsPiece;
  const results: DraughtsMove[] = [];
  // The mover's origin square is empty while it travels, so a path may cross it again.
  const work = board.slice();
  work[from] = 0;

  const walk = (square: number, isKingNow: boolean, path: number[], captured: number[]): void => {
    const row = Math.floor(square / 8);
    const col = square % 8;
    let jumped = false;
    for (const [dr, dc] of directions(isKingNow ? king(seat) : piece)) {
      const midRow = row + dr;
      const midCol = col + dc;
      const toRow = row + 2 * dr;
      const toCol = col + 2 * dc;
      if (!inside(toRow, toCol)) continue;
      const mid = midRow * 8 + midCol;
      const to = toRow * 8 + toCol;
      const target = work[mid] as DraughtsPiece;
      if (target === 0 || pieceOwner(target) === seat || captured.includes(mid)) continue;
      if (work[to] !== 0) continue; // captured pieces stay on the board until the turn ends
      jumped = true;
      const becomesKing = isKingNow || toRow === crownRow(seat);
      const nextPath = [...path, to];
      const nextCaptured = [...captured, mid];
      if (!isKingNow && becomesKing) {
        // Crowning ends the turn, even if the new king could keep capturing.
        results.push({ from, path: nextPath, captures: nextCaptured });
      } else {
        walk(to, isKingNow, nextPath, nextCaptured);
      }
    }
    if (!jumped && path.length > 0) results.push({ from, path, captures: captured });
  };

  walk(from, isKing(piece), [], []);
  return results;
}

function plainMovesFrom(board: readonly DraughtsPiece[], from: number): DraughtsMove[] {
  const piece = board[from] as DraughtsPiece;
  const row = Math.floor(from / 8);
  const col = from % 8;
  const moves: DraughtsMove[] = [];
  for (const [dr, dc] of directions(piece)) {
    const toRow = row + dr;
    const toCol = col + dc;
    if (!inside(toRow, toCol)) continue;
    const to = toRow * 8 + toCol;
    if (board[to] === 0) moves.push({ from, path: [to], captures: [] });
  }
  return moves;
}

/** All legal moves for the side to move. If any capture exists, only captures are legal. */
export function legalDraughtsMoves(state: DraughtsState): DraughtsMove[] {
  if (state.phase === 'finished') return [];
  return legalFor(state.board, state.toMove);
}

function legalFor(board: readonly DraughtsPiece[], seat: DraughtsSeat): DraughtsMove[] {
  const captures: DraughtsMove[] = [];
  const plain: DraughtsMove[] = [];
  for (let square = 0; square < 64; square += 1) {
    const piece = board[square] as DraughtsPiece;
    if (pieceOwner(piece) !== seat) continue;
    captures.push(...capturesFrom(board, square, seat));
    plain.push(...plainMovesFrom(board, square));
  }
  return captures.length > 0 ? captures : plain;
}

/** The board after a move (jumped pieces removed, man crowned). Does not check legality. */
export function boardAfter(
  board: readonly DraughtsPiece[],
  move: DraughtsMove,
): { board: DraughtsPiece[]; crowned: boolean } {
  const next = board.slice();
  const piece = next[move.from] as DraughtsPiece;
  const seat = pieceOwner(piece) as DraughtsSeat;
  next[move.from] = 0;
  for (const square of move.captures) next[square] = 0;
  const last = move.path[move.path.length - 1] as number;
  const crowned = !isKing(piece) && Math.floor(last / 8) === crownRow(seat);
  next[last] = crowned ? king(seat) : piece;
  return { board: next, crowned };
}

const sameMove = (a: { from: number; path: readonly number[] }, b: DraughtsMove): boolean =>
  a.from === b.from && a.path.length === b.path.length && a.path.every((s, i) => s === b.path[i]);

function finish(
  state: DraughtsState,
  winner: DraughtsSeat | 'draw',
  reason: DraughtsEndReason,
): { state: DraughtsState; events: DraughtsEvent[] } {
  return {
    state: { ...state, phase: 'finished', winner, endReason: reason },
    events: [{ type: 'GAME_ENDED', winner, reason }],
  };
}

/**
 * Plays a move for `seat`. The move is only a starting square and the landing squares; the server
 * works out what is captured and refuses anything that is not exactly one of the legal moves
 * (so a plain move when a capture exists, or a jump that stops early, is refused).
 */
export function applyDraughtsMove(
  state: DraughtsState,
  seat: DraughtsSeat,
  request: { from: number; path: readonly number[] },
): DraughtsResult {
  if (state.phase === 'finished') return { ok: false, error: 'GAME_FINISHED' };
  if (seat !== state.toMove) return { ok: false, error: 'NOT_YOUR_TURN' };
  if (
    !isDarkSquare(request.from) ||
    request.path.length === 0 ||
    request.path.length > 16 ||
    !request.path.every(isDarkSquare)
  ) {
    return { ok: false, error: 'INVALID_SQUARE' };
  }
  const move = legalDraughtsMoves(state).find((candidate) => sameMove(request, candidate));
  if (move === undefined) return { ok: false, error: 'ILLEGAL_MOVE' };

  const piece = state.board[move.from] as DraughtsPiece;
  const { board, crowned } = boardAfter(state.board, move);
  const other: DraughtsSeat = seat === 0 ? 1 : 0;
  const irreversible = move.captures.length > 0 || !isKing(piece);
  const sinceProgress = irreversible ? 0 : state.sinceProgress + 1;
  const key = positionKey(board, other);
  const positions = irreversible
    ? { [key]: 1 }
    : { ...state.positions, [key]: (state.positions[key] ?? 0) + 1 };

  const moved: DraughtsState = {
    ...state,
    board,
    toMove: other,
    sinceProgress,
    positions,
    plies: state.plies + 1,
    last: move,
  };
  const events: DraughtsEvent[] = [
    {
      type: 'MOVED',
      seat,
      from: move.from,
      path: [...move.path],
      captures: [...move.captures],
      crowned,
    },
  ];

  const hasPieces = board.some((cell) => pieceOwner(cell) === other);
  if (!hasPieces) {
    const done = finish(moved, seat, 'no_pieces');
    return { ok: true, state: done.state, events: [...events, ...done.events] };
  }
  if (legalFor(board, other).length === 0) {
    const done = finish(moved, seat, 'no_moves');
    return { ok: true, state: done.state, events: [...events, ...done.events] };
  }
  if ((positions[key] ?? 0) >= REPETITION_LIMIT) {
    const done = finish(moved, 'draw', 'repetition');
    return { ok: true, state: done.state, events: [...events, ...done.events] };
  }
  if (sinceProgress >= FORTY_MOVE_PLIES) {
    const done = finish(moved, 'draw', 'forty_moves');
    return { ok: true, state: done.state, events: [...events, ...done.events] };
  }
  return { ok: true, state: moved, events };
}

/** The player on turn ran out of time and loses the game. */
export function timeoutDraughts(state: DraughtsState): DraughtsResult {
  if (state.phase === 'finished') return { ok: false, error: 'GAME_FINISHED' };
  const winner: DraughtsSeat = state.toMove === 0 ? 1 : 0;
  const done = finish(state, winner, 'timeout');
  return { ok: true, state: done.state, events: done.events };
}

/** `seat` leaves or is dropped; the other seat wins. */
export function forfeitDraughts(state: DraughtsState, seat: DraughtsSeat): DraughtsResult {
  if (state.phase === 'finished') return { ok: false, error: 'GAME_FINISHED' };
  const winner: DraughtsSeat = seat === 0 ? 1 : 0;
  const done = finish(state, winner, 'forfeit');
  return { ok: true, state: done.state, events: done.events };
}

export function countPieces(state: DraughtsState, seat: DraughtsSeat): number {
  return state.board.filter((cell) => pieceOwner(cell) === seat).length;
}
