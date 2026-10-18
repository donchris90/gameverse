/**
 * Where things sit on the Ludo board. Presentation geometry only: it decides nothing about the
 * game. Everything is expressed on a 15 x 15 grid of cells, and points are in cell units (the
 * centre of cell column 3, row 6 is x 3.5, y 6.5), so a screen just multiplies by its cell size.
 *
 * The track is the usual cross-shaped ring of 52 squares, clockwise. Colour 0 starts at the top of
 * the left arm and its home column runs along the middle row; the other colours are the same
 * picture turned a quarter turn each (top, right, bottom). That matches the rules exactly: a token
 * at relative position p stands on track square (13 * colour + p) % 52, and the last track square
 * (p 51) is the one beside the entrance to its own home column.
 */
import {
  HOME_POSITION,
  IN_BASE,
  LAST_TRACK_STEP,
  START_SPACING,
  TRACK_LENGTH,
  TOKENS_PER_PLAYER,
  isSafeSquare,
} from './ludo.js';

export const LUDO_BOARD_SIZE = 15;
export const COLOUR_COUNT = 4;

export interface LudoCell {
  readonly col: number;
  readonly row: number;
}
export interface LudoPoint {
  readonly x: number;
  readonly y: number;
}

const cell = (col: number, row: number): LudoCell => ({ col, row });
const range = (from: number, to: number): number[] => {
  const out: number[] = [];
  const step = from <= to ? 1 : -1;
  for (let v = from; v !== to + step; v += step) out.push(v);
  return out;
};

function buildTrack(): readonly LudoCell[] {
  return [
    cell(0, 6), // 0: colour 0 starts here
    ...range(1, 5).map((c) => cell(c, 6)),
    ...range(5, 0).map((r) => cell(6, r)),
    cell(7, 0),
    cell(8, 0), // 13: colour 1 starts here
    ...range(1, 5).map((r) => cell(8, r)),
    ...range(9, 14).map((c) => cell(c, 6)),
    cell(14, 7),
    cell(14, 8), // 26: colour 2 starts here
    ...range(13, 9).map((c) => cell(c, 8)),
    ...range(9, 14).map((r) => cell(8, r)),
    cell(7, 14),
    cell(6, 14), // 39: colour 3 starts here
    ...range(13, 9).map((r) => cell(6, r)),
    ...range(5, 0).map((c) => cell(c, 8)),
    cell(0, 7), // 51: the square before colour 0's start, beside its home column
  ];
}

/** The 52 track squares in playing order (clockwise), starting at colour 0's start square. */
export const TRACK_CELLS: readonly LudoCell[] = buildTrack();

/** The five coloured squares of each colour's home column, entrance first. */
export const HOME_COLUMN_CELLS: readonly (readonly LudoCell[])[] = [
  range(1, 5).map((c) => cell(c, 7)),
  range(1, 5).map((r) => cell(7, r)),
  range(13, 9).map((c) => cell(c, 7)),
  range(13, 9).map((r) => cell(7, r)),
];

/** The square at the end of each home column, next to the centre. */
export const HOME_CELLS: readonly LudoCell[] = [cell(6, 7), cell(7, 6), cell(8, 7), cell(7, 8)];

/** Top-left corner (in cells) of each colour's 6 x 6 base. */
export const BASE_ORIGINS: readonly LudoCell[] = [cell(0, 0), cell(9, 0), cell(9, 9), cell(0, 9)];

/** Where token 0..3 of a colour waits in its base, as cell-unit points. */
export function basePoint(colour: number, token: number): LudoPoint {
  const origin = BASE_ORIGINS[colour];
  if (!origin || token < 0 || token >= TOKENS_PER_PLAYER) {
    throw new RangeError('No such base slot');
  }
  return { x: origin.col + (token % 2 === 0 ? 2 : 4), y: origin.row + (token < 2 ? 2 : 4) };
}

const centre = (c: LudoCell): LudoPoint => ({ x: c.col + 0.5, y: c.row + 0.5 });

/** The grid cell of a token that is on the board (not in the base); null for a base token. */
export function cellOf(colour: number, position: number): LudoCell | null {
  if (position === IN_BASE) return null;
  if (position >= 0 && position <= LAST_TRACK_STEP) {
    return TRACK_CELLS[(colour * START_SPACING + position) % TRACK_LENGTH] ?? null;
  }
  if (position > LAST_TRACK_STEP && position < HOME_POSITION) {
    return HOME_COLUMN_CELLS[colour]?.[position - LAST_TRACK_STEP - 1] ?? null;
  }
  if (position === HOME_POSITION) return HOME_CELLS[colour] ?? null;
  return null;
}

/** The centre point of a token; base tokens sit in their colour's base. */
export function tokenPoint(colour: number, token: number, position: number): LudoPoint {
  if (position === IN_BASE) return basePoint(colour, token);
  const where = cellOf(colour, position);
  if (!where) throw new RangeError(`No such position ${String(position)}`);
  return centre(where);
}

export type SquareKind = 'track' | 'column' | 'home';
export interface BoardSquare {
  readonly col: number;
  readonly row: number;
  readonly kind: SquareKind;
  /** The colour a start, column or home square belongs to; null for a plain track square. */
  readonly colour: number | null;
  /** A square where a token cannot be captured (start squares and stars). */
  readonly safe: boolean;
  /** True on a colour's start square. */
  readonly start: boolean;
}

/** Every square a screen has to draw (track, home columns, home squares). */
export function boardSquares(): BoardSquare[] {
  const squares: BoardSquare[] = TRACK_CELLS.map((where, index) => {
    const startOf = index % START_SPACING === 0 ? index / START_SPACING : null;
    return {
      col: where.col,
      row: where.row,
      kind: 'track',
      colour: startOf,
      safe: isSafeSquare(index),
      start: startOf !== null,
    };
  });
  HOME_COLUMN_CELLS.forEach((column, colour) => {
    for (const where of column) {
      squares.push({
        col: where.col,
        row: where.row,
        kind: 'column',
        colour,
        safe: true,
        start: false,
      });
    }
  });
  HOME_CELLS.forEach((where, colour) => {
    squares.push({
      col: where.col,
      row: where.row,
      kind: 'home',
      colour,
      safe: true,
      start: false,
    });
  });
  return squares;
}

export interface TokenSpot {
  readonly seat: number;
  readonly token: number;
  readonly colour: number;
  readonly position: number;
  readonly x: number;
  readonly y: number;
  /** Shrink factor so several tokens on one square all stay visible (1 for a lone token). */
  readonly scale: number;
}

const STACK_OFFSETS: readonly (readonly (readonly [number, number])[])[] = [
  [],
  [[0, 0]],
  [
    [-0.2, 0],
    [0.2, 0],
  ],
  [
    [-0.2, -0.15],
    [0.2, -0.15],
    [0, 0.22],
  ],
  [
    [-0.2, -0.2],
    [0.2, -0.2],
    [-0.2, 0.2],
    [0.2, 0.2],
  ],
];

/**
 * Where every token is drawn. Tokens that share a square (own pairs, or different colours on the
 * same track square) are nudged apart and shrunk so none is hidden. Base tokens never overlap.
 */
export function layoutTokens(
  tokens: readonly (readonly number[])[],
  colours: readonly number[],
): TokenSpot[] {
  const spots: Omit<TokenSpot, 'x' | 'y' | 'scale'>[] = [];
  tokens.forEach((row, seat) => {
    const colour = colours[seat] ?? seat;
    row.forEach((position, token) => spots.push({ seat, token, colour, position }));
  });
  const groups = new Map<string, number[]>();
  spots.forEach((spot, index) => {
    const where = cellOf(spot.colour, spot.position);
    if (!where) return;
    const key = `${String(where.col)}:${String(where.row)}`;
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  return spots.map((spot, index) => {
    const base = tokenPoint(spot.colour, spot.token, spot.position);
    const where = cellOf(spot.colour, spot.position);
    if (!where) return { ...spot, ...base, scale: 1 };
    const group = groups.get(`${String(where.col)}:${String(where.row)}`) ?? [index];
    if (group.length <= 1) return { ...spot, ...base, scale: 1 };
    const offsets = STACK_OFFSETS[Math.min(group.length, 4)] ?? [];
    const slot = offsets[group.indexOf(index) % offsets.length] ?? [0, 0];
    return { ...spot, x: base.x + slot[0], y: base.y + slot[1], scale: 0.62 };
  });
}

/** The positions a token hops through for a move, one square at a time (for animation). */
export function movePath(from: number, to: number): number[] {
  if (from === to) return [to];
  if (from === IN_BASE) return [to];
  if (to < from) return [to]; // a captured token goes straight back to its base
  const path: number[] = [];
  for (let p = from + 1; p <= to; p += 1) path.push(p);
  return path;
}
