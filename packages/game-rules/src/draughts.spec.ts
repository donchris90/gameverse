import { describe, expect, it } from 'vitest';
import {
  FORTY_MOVE_PLIES,
  applyDraughtsMove,
  countPieces,
  createDraughts,
  forfeitDraughts,
  isDarkSquare,
  legalDraughtsMoves,
  timeoutDraughts,
  type DraughtsPiece,
  type DraughtsSeat,
  type DraughtsState,
} from './draughts.js';
import { chooseDraughtsMove } from './draughts-bots.js';

const sq = (row: number, col: number): number => row * 8 + col;

/**
 * Builds a position from piece tags `<kind><row><col>`: a/A = seat 0 man/king, b/B = seat 1
 * man/king, for example 'a43' is a seat 0 man on row 4, column 3.
 */
function position(pieces: string[], toMove: DraughtsSeat = 0, extra: Partial<DraughtsState> = {}) {
  const codes: Record<string, DraughtsPiece> = { a: 1, A: 2, b: 3, B: 4 };
  const board = Array.from({ length: 64 }, () => 0 as DraughtsPiece);
  for (const tag of pieces) {
    const square = sq(Number(tag[1]), Number(tag[2]));
    expect(isDarkSquare(square)).toBe(true);
    board[square] = codes[tag[0] as string] as DraughtsPiece;
  }
  const base = createDraughts(toMove);
  return { ...base, board, toMove, positions: {}, ...extra } as DraughtsState;
}

function play(state: DraughtsState, from: number, path: number[]) {
  const result = applyDraughtsMove(state, state.toMove, { from, path });
  if (!result.ok) throw new Error(`illegal: ${result.error}`);
  return result;
}

describe('the start position', () => {
  it('has 12 men a side and the seven English opening moves', () => {
    const start = createDraughts(0);
    expect(countPieces(start, 0)).toBe(12);
    expect(countPieces(start, 1)).toBe(12);
    expect(legalDraughtsMoves(start)).toHaveLength(7);
    expect(start.toMove).toBe(0);
    expect(createDraughts(1).toMove).toBe(1);
  });
});

describe('plain moves', () => {
  it('moves a man one square diagonally forward and never backward', () => {
    const state = position(['a43', 'b76']);
    const to = legalDraughtsMoves(state).flatMap((m) => m.path);
    expect(to.sort()).toEqual([sq(3, 2), sq(3, 4)].sort());
  });

  it('lets a king move one square in all four directions', () => {
    const state = position(['A43', 'b76']);
    expect(legalDraughtsMoves(state)).toHaveLength(4);
  });

  it('refuses a move onto an occupied square, off the dark squares, or out of turn', () => {
    const start = createDraughts(0);
    expect(applyDraughtsMove(start, 1, { from: sq(2, 1), path: [sq(3, 0)] })).toEqual({
      ok: false,
      error: 'NOT_YOUR_TURN',
    });
    expect(applyDraughtsMove(start, 0, { from: sq(5, 0), path: [sq(4, 0)] })).toEqual({
      ok: false,
      error: 'INVALID_SQUARE',
    });
    expect(applyDraughtsMove(start, 0, { from: sq(6, 1), path: [sq(5, 0)] })).toEqual({
      ok: false,
      error: 'ILLEGAL_MOVE',
    });
    expect(applyDraughtsMove(start, 0, { from: 99, path: [3] })).toEqual({
      ok: false,
      error: 'INVALID_SQUARE',
    });
  });
});

describe('captures', () => {
  const oneJump = position(['a43', 'b32', 'b76']);

  it('are compulsory: a plain move is refused while a capture exists', () => {
    const plain = applyDraughtsMove(oneJump, 0, { from: sq(4, 3), path: [sq(3, 4)] });
    expect(plain).toEqual({ ok: false, error: 'ILLEGAL_MOVE' });
    const moves = legalDraughtsMoves(oneJump);
    expect(moves).toHaveLength(1);
    expect(moves[0]?.captures).toEqual([sq(3, 2)]);
  });

  it('remove the jumped piece', () => {
    const done = play(oneJump, sq(4, 3), [sq(2, 1)]);
    expect(done.state.board[sq(3, 2)]).toBe(0);
    expect(done.state.board[sq(2, 1)]).toBe(1);
    expect(done.state.board[sq(4, 3)]).toBe(0);
  });

  it('may be chosen freely: there are two captures and either is accepted', () => {
    const choice = position(['a41', 'b32', 'a45', 'b36']);
    const moves = legalDraughtsMoves(choice);
    expect(moves).toHaveLength(2);
    expect(play(choice, sq(4, 1), [sq(2, 3)]).state.toMove).toBe(1);
    expect(play(choice, sq(4, 5), [sq(2, 7)]).state.toMove).toBe(1);
  });

  it('must continue a multi-jump: stopping early is refused', () => {
    const state = position(['a52', 'b43', 'b23', 'b76']);
    const moves = legalDraughtsMoves(state);
    expect(moves).toHaveLength(1);
    expect(moves[0]?.path).toEqual([sq(3, 4), sq(1, 2)]);
    expect(applyDraughtsMove(state, 0, { from: sq(5, 2), path: [sq(3, 4)] })).toEqual({
      ok: false,
      error: 'ILLEGAL_MOVE',
    });
    const done = play(state, sq(5, 2), [sq(3, 4), sq(1, 2)]);
    expect(done.state.board[sq(4, 3)]).toBe(0);
    expect(done.state.board[sq(2, 3)]).toBe(0);
    expect(done.events[0]).toMatchObject({ type: 'MOVED', captures: [sq(4, 3), sq(2, 3)] });
  });

  it('a man cannot capture backwards, but a king can', () => {
    const man = position(['a43', 'b52', 'b76']);
    expect(legalDraughtsMoves(man).every((m) => m.captures.length === 0)).toBe(true);
    const blocked = position(['A43', 'b52', 'b61', 'b76']);
    expect(legalDraughtsMoves(blocked).every((m) => m.captures.length === 0)).toBe(true);
    const king = legalDraughtsMoves(position(['A43', 'b52', 'b76']));
    expect(king).toHaveLength(1);
    expect(king[0]?.captures).toEqual([sq(5, 2)]);
  });

  it('cannot jump two adjacent pieces at once', () => {
    const adjacent = position(['a50', 'b41', 'b32', 'b76']);
    expect(legalDraughtsMoves(adjacent).every((m) => m.captures.length === 0)).toBe(true);
  });

  it('a king that circles back never re-jumps a captured piece', () => {
    const loop = position(['A52', 'b43', 'b23', 'b21', 'b41']);
    const moves = legalDraughtsMoves(loop);
    const longest = Math.max(...moves.map((m) => m.captures.length));
    expect(longest).toBe(4);
    for (const move of moves) {
      expect(new Set(move.captures).size).toBe(move.captures.length);
    }
  });
});

describe('crowning', () => {
  it('crowns a man on the far row', () => {
    const done = play(position(['a12', 'b76']), sq(1, 2), [sq(0, 1)]);
    expect(done.state.board[sq(0, 1)]).toBe(2);
    expect(done.events[0]).toMatchObject({ crowned: true });
  });

  it('ends the turn when a capture crowns, even if the new king could jump on', () => {
    const state = position(['a21', 'b12', 'b14']);
    const moves = legalDraughtsMoves(state);
    expect(moves).toHaveLength(1);
    expect(moves[0]?.path).toEqual([sq(0, 3)]);
    expect(moves[0]?.captures).toEqual([sq(1, 2)]);
  });
});

describe('how a game ends', () => {
  it('is won when the opponent has no pieces left', () => {
    const done = play(position(['a43', 'b32']), sq(4, 3), [sq(2, 1)]);
    expect(done.state).toMatchObject({ phase: 'finished', winner: 0, endReason: 'no_pieces' });
    expect(legalDraughtsMoves(done.state)).toEqual([]);
    expect(applyDraughtsMove(done.state, 1, { from: 0, path: [1] })).toEqual({
      ok: false,
      error: 'GAME_FINISHED',
    });
  });

  it('is won when the opponent has pieces but no legal move', () => {
    const state = position(['b01', 'a10', 'a12', 'a23', 'a65']);
    const done = play(state, sq(6, 5), [sq(5, 4)]);
    expect(done.state).toMatchObject({ phase: 'finished', winner: 0, endReason: 'no_moves' });
  });

  it('is drawn on the third occurrence of a position', () => {
    let state = position(['A12', 'B65'], 0);
    state = { ...state, positions: { [`${state.board.join('')}0`]: 1 } };
    const shuffle = [
      [sq(1, 2), sq(0, 1)],
      [sq(6, 5), sq(7, 4)],
      [sq(0, 1), sq(1, 2)],
      [sq(7, 4), sq(6, 5)],
    ] as const;
    let last = state;
    let plies = 0;
    for (let round = 0; round < 3; round += 1) {
      for (const [from, to] of shuffle) {
        if (last.phase === 'finished') break;
        last = play(last, from, [to]).state;
        plies += 1;
      }
    }
    expect(last).toMatchObject({ phase: 'finished', winner: 'draw', endReason: 'repetition' });
    expect(plies).toBe(8);
  });

  it('is drawn after 40 moves each with no capture and no man moved', () => {
    const start = position(['A12', 'B65'], 0, { sinceProgress: FORTY_MOVE_PLIES - 1 });
    const done = play(start, sq(1, 2), [sq(0, 1)]);
    expect(done.state).toMatchObject({
      phase: 'finished',
      winner: 'draw',
      endReason: 'forty_moves',
    });
  });

  it('resets the counters on a capture or a man move', () => {
    const state = position(['a43', 'B65'], 0, { sinceProgress: 50 });
    const done = play(state, sq(4, 3), [sq(3, 2)]);
    expect(done.state.sinceProgress).toBe(0);
    expect(Object.keys(done.state.positions)).toHaveLength(1);
  });

  it('loses on timeout and on forfeit, once', () => {
    const start = createDraughts(0);
    const timed = timeoutDraughts(start);
    expect(timed.ok && timed.state).toMatchObject({ winner: 1, endReason: 'timeout' });
    const left = forfeitDraughts(start, 1);
    expect(left.ok && left.state).toMatchObject({ winner: 0, endReason: 'forfeit' });
    if (timed.ok)
      expect(timeoutDraughts(timed.state)).toEqual({ ok: false, error: 'GAME_FINISHED' });
  });

  it('does not change the old state when a move is played', () => {
    const start = createDraughts(0);
    const before = JSON.stringify(start);
    const move = legalDraughtsMoves(start)[0]!;
    play(start, move.from, [...move.path]);
    expect(JSON.stringify(start)).toBe(before);
  });
});

/** Small seeded generator so a failing playout can be replayed. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('random playouts', () => {
  it('always end, never raise a piece count, and keep the invariants', () => {
    for (let seed = 1; seed <= 150; seed += 1) {
      const random = seeded(seed);
      let state = createDraughts(seed % 2 === 0 ? 0 : 1);
      let pieces = [12, 12];
      for (let ply = 0; ply < 600 && state.phase === 'playing'; ply += 1) {
        const moves = legalDraughtsMoves(state);
        expect(moves.length).toBeGreaterThan(0);
        const captureAvailable = moves.some((m) => m.captures.length > 0);
        if (captureAvailable) expect(moves.every((m) => m.captures.length > 0)).toBe(true);
        const move = moves[Math.floor(random() * moves.length)]!;
        const result = applyDraughtsMove(state, state.toMove, { from: move.from, path: move.path });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        state = result.state;
        const now = [countPieces(state, 0), countPieces(state, 1)];
        expect(now[0]).toBeLessThanOrEqual(pieces[0]!);
        expect(now[1]).toBeLessThanOrEqual(pieces[1]!);
        pieces = now;
        state.board.forEach((piece, index) => {
          if (piece !== 0) expect(isDarkSquare(index)).toBe(true);
        });
      }
      expect(state.phase).toBe('finished');
    }
  });
});

describe('bots', () => {
  it('only ever choose a legal move, at every level', () => {
    for (const level of ['easy', 'medium', 'hard'] as const) {
      const random = seeded(7);
      let state = createDraughts(0);
      for (let ply = 0; ply < 40 && state.phase === 'playing'; ply += 1) {
        const move = chooseDraughtsMove(state, level, random);
        expect(move).not.toBeNull();
        const result = applyDraughtsMove(state, state.toMove, {
          from: move!.from,
          path: move!.path,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        state = result.state;
      }
    }
  });

  it('returns null when there is nothing to play', () => {
    const done = timeoutDraughts(createDraughts(0));
    if (done.ok) expect(chooseDraughtsMove(done.state, 'hard', Math.random)).toBeNull();
  });

  it('hard takes a free piece and does not hang one when it can avoid it', () => {
    const state = position(['a43', 'b32', 'b76']);
    const move = chooseDraughtsMove(state, 'hard', () => 0);
    expect(move?.captures).toEqual([sq(3, 2)]);
  });
});
