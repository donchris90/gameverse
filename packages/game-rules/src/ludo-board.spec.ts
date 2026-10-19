import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  HOME_POSITION,
  IN_BASE,
  TRACK_LENGTH,
  isSafeSquare,
  startSquare,
  trackSquare,
} from './ludo.js';
import {
  BASE_ORIGINS,
  LUDO_BOARD_SIZE,
  HOME_CELLS,
  HOME_COLUMN_CELLS,
  TRACK_CELLS,
  basePoint,
  boardSquares,
  cellOf,
  layoutTokens,
  movePath,
  tokenPoint,
  type LudoCell,
} from './ludo-board.js';

const key = (c: LudoCell) => `${String(c.col)},${String(c.row)}`;
const adjacent = (a: LudoCell, b: LudoCell) =>
  Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;

describe('the track', () => {
  it('is 52 distinct squares inside the 15 x 15 grid', () => {
    expect(TRACK_CELLS).toHaveLength(TRACK_LENGTH);
    expect(new Set(TRACK_CELLS.map(key)).size).toBe(TRACK_LENGTH);
    for (const c of TRACK_CELLS) {
      expect(c.col).toBeGreaterThanOrEqual(0);
      expect(c.col).toBeLessThan(LUDO_BOARD_SIZE);
      expect(c.row).toBeGreaterThanOrEqual(0);
      expect(c.row).toBeLessThan(LUDO_BOARD_SIZE);
    }
  });

  it('is one unbroken loop: every square touches the next, including the wrap-around', () => {
    let diagonals = 0;
    TRACK_CELLS.forEach((c, i) => {
      const next = TRACK_CELLS[(i + 1) % TRACK_LENGTH] as LudoCell;
      const across = Math.abs(c.col - next.col);
      const down = Math.abs(c.row - next.row);
      expect(Math.max(across, down), `square ${String(i)}`).toBe(1);
      if (across === 1 && down === 1) diagonals += 1;
    });
    // The ring turns each inner corner of the cross with one diagonal step, as on a real board.
    expect(diagonals).toBe(4);
  });

  it('puts each start square at the edge of its own arm, in the colour order of the rules', () => {
    expect([0, 1, 2, 3].map((c) => key(TRACK_CELLS[startSquare(c)] as LudoCell))).toEqual([
      '1,6',
      '8,1',
      '13,8',
      '6,13',
    ]);
  });

  it('never enters the base quadrants', () => {
    for (const c of TRACK_CELLS) {
      const inCorner = (c.col < 6 || c.col > 8) && (c.row < 6 || c.row > 8); // a 6 x 6 corner
      expect(inCorner, key(c)).toBe(false);
    }
  });
});

describe('home columns', () => {
  it.each([0, 1, 2, 3])(
    'colour %i: last track square, five column squares, home, in a chain',
    (colour) => {
      const chain = [
        cellOf(colour, 50) as LudoCell,
        ...[51, 52, 53, 54, 55].map((p) => cellOf(colour, p) as LudoCell),
        cellOf(colour, HOME_POSITION) as LudoCell,
      ];
      chain.forEach((c, i) => {
        if (i > 0) expect(adjacent(chain[i - 1] as LudoCell, c), `step ${String(i)}`).toBe(true);
      });
      expect(HOME_COLUMN_CELLS[colour]).toHaveLength(5);
      expect(HOME_CELLS[colour]).toEqual(cellOf(colour, HOME_POSITION));
    },
  );

  it('shares no square with the track, another colour, or another home', () => {
    const all = [...TRACK_CELLS, ...HOME_COLUMN_CELLS.flat(), ...HOME_CELLS].map(key);
    expect(new Set(all).size).toBe(TRACK_LENGTH + 20 + 4);
  });

  it('enters from its last track square (p 50), and never uses the box behind its start', () => {
    for (const colour of [0, 1, 2, 3]) {
      const last = cellOf(colour, 50) as LudoCell;
      const entrance = HOME_COLUMN_CELLS[colour]?.[0] as LudoCell;
      expect(adjacent(last, entrance)).toBe(true);
      expect(trackSquare(colour, 50)).toBe((startSquare(colour) + 50) % TRACK_LENGTH);
      const unused = (startSquare(colour) + 51) % TRACK_LENGTH;
      for (let p = 0; p <= 50; p += 1) expect(trackSquare(colour, p)).not.toBe(unused);
    }
  });
});

describe('bases and token points', () => {
  it('gives each colour four distinct slots inside its own 6 x 6 corner', () => {
    for (const colour of [0, 1, 2, 3]) {
      const origin = BASE_ORIGINS[colour] as LudoCell;
      const slots = [0, 1, 2, 3].map((t) => basePoint(colour, t));
      expect(new Set(slots.map((p) => `${String(p.x)},${String(p.y)}`)).size).toBe(4);
      for (const p of slots) {
        expect(p.x).toBeGreaterThan(origin.col);
        expect(p.x).toBeLessThan(origin.col + 6);
        expect(p.y).toBeGreaterThan(origin.row);
        expect(p.y).toBeLessThan(origin.row + 6);
      }
    }
    expect(() => basePoint(0, 4)).toThrow(RangeError);
  });

  it('draws a shared track square at the same point for every colour', () => {
    // colour 0 at p 13 and colour 1 at p 0 are the same absolute square.
    expect(tokenPoint(0, 0, 13)).toEqual(tokenPoint(1, 0, 0));
    expect(tokenPoint(2, 3, 5)).toEqual(tokenPoint(3, 1, 44)); // both are track square 31
  });

  it('uses the base for a token in the base and a cell centre otherwise', () => {
    expect(tokenPoint(1, 2, IN_BASE)).toEqual(basePoint(1, 2));
    expect(tokenPoint(0, 0, 0)).toEqual({ x: 1.5, y: 6.5 });
    expect(() => tokenPoint(0, 0, 57)).toThrow(RangeError);
  });

  it('every legal position lands inside the board', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: -1, max: HOME_POSITION }),
        (colour, token, position) => {
          const p = tokenPoint(colour, token, position);
          return p.x > 0 && p.x < LUDO_BOARD_SIZE && p.y > 0 && p.y < LUDO_BOARD_SIZE;
        },
      ),
    );
  });
});

describe('boardSquares', () => {
  const squares = boardSquares();

  it('lists the track, the home columns and the home squares once each', () => {
    expect(squares).toHaveLength(TRACK_LENGTH + 20 + 4);
    expect(squares.filter((s) => s.kind === 'track')).toHaveLength(52);
    expect(squares.filter((s) => s.kind === 'column')).toHaveLength(20);
    expect(squares.filter((s) => s.kind === 'home')).toHaveLength(4);
  });

  it('marks exactly the safe squares of the rules, and the four starts', () => {
    const track = squares.filter((s) => s.kind === 'track');
    track.forEach((s, i) => expect(s.safe).toBe(isSafeSquare(i)));
    expect(track.filter((s) => s.safe)).toHaveLength(8);
    const starts = track.filter((s) => s.start);
    expect(starts.map((s) => s.colour)).toEqual([0, 1, 2, 3]);
  });
});

describe('layoutTokens', () => {
  it('draws a fresh game with every token in its own base slot, none stacked', () => {
    const tokens = [
      [-1, -1, -1, -1],
      [-1, -1, -1, -1],
    ];
    const spots = layoutTokens(tokens, [0, 2]);
    expect(spots).toHaveLength(8);
    expect(new Set(spots.map((s) => `${String(s.x)},${String(s.y)}`)).size).toBe(8);
    expect(spots.every((s) => s.scale === 1)).toBe(true);
  });

  it('nudges apart tokens that share a square, including different colours', () => {
    // seat 0 (colour 0) at p 13 and seat 1 (colour 1) at p 0 share track square 13.
    const spots = layoutTokens(
      [
        [13, -1, -1, -1],
        [0, -1, -1, -1],
      ],
      [0, 1],
    );
    const a = spots.find((s) => s.seat === 0 && s.token === 0);
    const b = spots.find((s) => s.seat === 1 && s.token === 0);
    expect(a && b && (a.x !== b.x || a.y !== b.y)).toBe(true);
    expect(a?.scale).toBeLessThan(1);
    expect(b?.scale).toBeLessThan(1);
    // Both are still within the square they share.
    for (const s of [a, b]) {
      expect(Math.abs((s?.x ?? 0) - 8.5)).toBeLessThan(0.5);
      expect(Math.abs((s?.y ?? 0) - 1.5)).toBeLessThan(0.5);
    }
  });

  it('keeps four tokens on one square all distinct', () => {
    const spots = layoutTokens([[HOME_POSITION, HOME_POSITION, HOME_POSITION, HOME_POSITION]], [0]);
    expect(new Set(spots.map((s) => `${String(s.x)},${String(s.y)}`)).size).toBe(4);
  });

  it('leaves a lone token exactly at the centre of its square', () => {
    const [spot] = layoutTokens([[5, -1, -1, -1]], [0]);
    expect(spot).toMatchObject({ x: 6.5, y: 5.5, scale: 1 });
  });
});

describe('movePath', () => {
  it('hops one square at a time for a forward move', () => {
    expect(movePath(3, 6)).toEqual([4, 5, 6]);
    expect(movePath(49, 52)).toEqual([50, 51, 52]);
  });
  it('enters the board in one step and sends a captured token straight back', () => {
    expect(movePath(IN_BASE, 0)).toEqual([0]);
    expect(movePath(20, IN_BASE)).toEqual([IN_BASE]);
  });
  it('is a single no-op step when nothing moved', () => {
    expect(movePath(4, 4)).toEqual([4]);
  });
});
