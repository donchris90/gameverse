import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  HOME_POSITION,
  IN_BASE,
  applyLudoMove,
  applyLudoRoll,
  applyLudoTimeout,
  checkLudoInvariants,
  coloursFor,
  createLudo,
  defaultLudoMove,
  isSafeSquare,
  legalLudoMoves,
  removeLudoSeat,
  trackSquare,
  type LudoPlayerCount,
  type LudoSeat,
  type LudoState,
} from './ludo.js';

type Tokens = readonly (readonly number[])[];

/** A state with the given tokens, built from a fresh game so every other field is valid. */
function stateWith(
  players: LudoPlayerCount,
  tokens: Tokens,
  over: Partial<LudoState> = {},
): LudoState {
  return { ...createLudo(players), tokens, ...over };
}

const base4 = [IN_BASE, IN_BASE, IN_BASE, IN_BASE];
const allBase = (players: LudoPlayerCount): Tokens =>
  Array.from({ length: players }, () => [...base4]);
const withSeat = (tokens: Tokens, seat: number, row: number[]): Tokens =>
  tokens.map((r, i) => (i === seat ? row : r));

function ok(result: ReturnType<typeof applyLudoRoll>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result;
}

const rolling = (state: LudoState, seat: LudoSeat, value: number) =>
  ok(applyLudoRoll(state, seat, value));

/** Deep freeze so any accidental mutation throws. */
function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe('board geometry', () => {
  it('has exactly 8 safe squares: the starts and the stars 8 after each', () => {
    const safe = Array.from({ length: 52 }, (_, square) => square).filter(isSafeSquare);
    expect(safe).toEqual([0, 8, 13, 21, 26, 34, 39, 47]);
  });

  it('maps a token to the shared track from its own start square', () => {
    expect(trackSquare(0, 0)).toBe(0);
    expect(trackSquare(1, 0)).toBe(13);
    expect(trackSquare(2, 5)).toBe(31);
    expect(trackSquare(3, 20)).toBe((39 + 20) % 52);
    expect(trackSquare(1, 51)).toBe(12); // the square just before its own start
  });

  it('keeps base, the home column and home off the shared track', () => {
    expect(trackSquare(0, IN_BASE)).toBeNull();
    expect(trackSquare(0, 52)).toBeNull();
    expect(trackSquare(0, HOME_POSITION)).toBeNull();
  });

  it('seats opposite colours with two players', () => {
    expect(coloursFor(2)).toEqual([0, 2]);
    expect(coloursFor(3)).toEqual([0, 1, 2]);
    expect(coloursFor(4)).toEqual([0, 1, 2, 3]);
  });
});

describe('creating a game', () => {
  it('starts with every token in the base and the opener to roll', () => {
    const game = createLudo(4, 2);
    expect(game.toMove).toBe(2);
    expect(game.phase).toBe('roll');
    expect(game.tokens.flat().every((p) => p === IN_BASE)).toBe(true);
    expect(checkLudoInvariants(game)).toEqual([]);
  });

  it('refuses an opener who is not seated', () => {
    expect(() => createLudo(2, 3)).toThrow();
  });
});

describe('rolling', () => {
  it('rejects the wrong seat, a bad die, the wrong phase and a finished game', () => {
    const game = createLudo(3);
    expect(applyLudoRoll(game, 1, 6)).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
    for (const bad of [0, 7, -1, 1.5, Number.NaN, Infinity]) {
      expect(applyLudoRoll(game, 0, bad)).toEqual({ ok: false, error: 'INVALID_DIE' });
    }
    const moving = rolling(game, 0, 6).state;
    expect(applyLudoRoll(moving, 0, 3)).toEqual({ ok: false, error: 'WRONG_PHASE' });
    const over = removeLudoSeat(createLudo(2), 1, 'forfeit');
    expect(over.ok && applyLudoRoll(over.state, 0, 6)).toEqual({
      ok: false,
      error: 'GAME_FINISHED',
    });
  });

  it('with every token in the base, anything but a six passes the turn with no extra roll', () => {
    for (const value of [1, 2, 3, 4, 5]) {
      const { state, events } = rolling(createLudo(4), 0, value);
      expect(state.toMove).toBe(1);
      expect(state.phase).toBe('roll');
      expect(events.map((e) => e.type)).toEqual(['ROLLED', 'NO_MOVE', 'TURN']);
    }
  });

  it('a six lets any base token out, and nothing else is possible', () => {
    const { state } = rolling(createLudo(2), 0, 6);
    expect(state.phase).toBe('move');
    expect(legalLudoMoves(state).map((m) => [m.token, m.to, m.entersFromBase])).toEqual([
      [0, 0, true],
      [1, 0, true],
      [2, 0, true],
      [3, 0, true],
    ]);
  });

  it('counts every roll', () => {
    expect(rolling(createLudo(2), 0, 2).state.rolls).toBe(1);
  });
});

describe('moving', () => {
  it('rejects bad tokens, illegal moves and moves out of turn or phase', () => {
    const game = rolling(createLudo(2), 0, 6).state;
    for (const bad of [-1, 4, 1.5, Number.NaN]) {
      expect(applyLudoMove(game, 0, bad)).toEqual({ ok: false, error: 'INVALID_TOKEN' });
    }
    expect(applyLudoMove(game, 1, 0)).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
    expect(applyLudoMove(createLudo(2), 0, 0)).toEqual({ ok: false, error: 'WRONG_PHASE' });
    const onBoard = stateWith(2, withSeat(allBase(2), 0, [5, IN_BASE, IN_BASE, IN_BASE]));
    const rolled = rolling(onBoard, 0, 3).state;
    expect(applyLudoMove(rolled, 0, 1)).toEqual({ ok: false, error: 'ILLEGAL_MOVE' });
  });

  it('a six brings a token out and earns another roll for the same player', () => {
    const rolled = rolling(createLudo(2), 0, 6).state;
    const moved = ok(applyLudoMove(rolled, 0, 2));
    expect(moved.state.tokens[0]).toEqual([IN_BASE, IN_BASE, 0, IN_BASE]);
    expect(moved.state.toMove).toBe(0);
    expect(moved.state.phase).toBe('roll');
    expect(moved.events.map((e) => e.type)).toEqual(['MOVED', 'EXTRA_ROLL']);
  });

  it('an ordinary move passes the turn clockwise', () => {
    const start = stateWith(3, withSeat(allBase(3), 0, [10, IN_BASE, IN_BASE, IN_BASE]));
    const moved = ok(applyLudoMove(rolling(start, 0, 4).state, 0, 0));
    expect(moved.state.tokens[0]?.[0]).toBe(14);
    expect(moved.state.toMove).toBe(1);
    expect(moved.state.phase).toBe('roll');
  });

  it('moves into the home column and stops at home only on the exact number', () => {
    const near = stateWith(2, withSeat(allBase(2), 0, [50, 55, IN_BASE, IN_BASE]));
    // 3 from 50 enters the column; 3 from 55 would overshoot home (57)
    const rolled = rolling(near, 0, 3).state;
    expect(legalLudoMoves(rolled).map((m) => m.token)).toEqual([0]);
    const exact = rolling(near, 0, 2).state;
    const home = ok(applyLudoMove(exact, 0, 1));
    expect(home.state.tokens[0]?.[1]).toBe(HOME_POSITION);
    expect(home.events.map((e) => e.type)).toContain('TOKEN_HOME');
    expect(home.state.toMove).toBe(0); // reaching home earns another roll
  });

  it('a token that cannot use the roll without overshooting stays; if none can move the turn passes', () => {
    const stuck = stateWith(2, withSeat(allBase(2), 0, [56, IN_BASE, IN_BASE, IN_BASE]));
    const { state, events } = rolling(stuck, 0, 5);
    expect(events.map((e) => e.type)).toEqual(['ROLLED', 'NO_MOVE', 'TURN']);
    expect(state.toMove).toBe(1);
  });

  it('a home token never moves again', () => {
    const tokens = withSeat(allBase(2), 0, [HOME_POSITION, 20, IN_BASE, IN_BASE]);
    const rolled = rolling(stateWith(2, tokens), 0, 2).state;
    expect(legalLudoMoves(rolled).map((m) => m.token)).toEqual([1]);
  });
});

describe('three sixes', () => {
  const sixesState = () => stateWith(2, withSeat(allBase(2), 0, [10, 20, IN_BASE, IN_BASE]));

  it('the third six in a row is cancelled and the turn ends', () => {
    let state = sixesState();
    state = ok(applyLudoMove(rolling(state, 0, 6).state, 0, 0)).state;
    state = ok(applyLudoMove(rolling(state, 0, 6).state, 0, 0)).state;
    expect(state.sixes).toBe(2);
    const third = rolling(state, 0, 6);
    expect(third.events.map((e) => e.type)).toEqual(['ROLLED', 'THIRD_SIX', 'TURN']);
    expect(third.state.toMove).toBe(1);
    expect(third.state.tokens[0]).toEqual(state.tokens[0]); // nothing moved
    expect(third.state.sixes).toBe(0);
  });

  it('a non-six in between resets the count', () => {
    let state = sixesState();
    state = ok(applyLudoMove(rolling(state, 0, 6).state, 0, 0)).state; // six, extra roll
    state = ok(applyLudoMove(rolling(state, 0, 1).state, 0, 0)).state; // one, turn passes
    expect(state.toMove).toBe(1);
    expect(state.sixes).toBe(0);
  });

  it('6, then a capture roll, then 6 is not three in a row', () => {
    let state = sixesState();
    state = ok(applyLudoMove(rolling(state, 0, 6).state, 0, 0)).state;
    expect(state.sixes).toBe(1);
    const roll3 = rolling(state, 0, 3).state;
    expect(roll3.sixes).toBe(0);
  });
});

describe('capturing, safe squares and blocks', () => {
  // Seat 0 is red (start 0). Seat 1 in a 2-player game is colour 2 (start 26): its p maps to
  // absolute square (26 + p) % 52.
  const abs = (p: number) => (26 + p) % 52;

  it('captures a single opponent token on a normal square, sends it home and earns another roll', () => {
    // seat 0 token at p=10, rolls 3 -> square 13? use square 14: seat1 token at p such that abs = 13
    // pick target square 14 (not safe): seat 1 p = (14 - 26 + 52) % 52 = 40
    const tokens = withSeat(withSeat(allBase(2), 0, [11, IN_BASE, IN_BASE, IN_BASE]), 1, [
      40,
      IN_BASE,
      IN_BASE,
      IN_BASE,
    ]);
    expect(abs(40)).toBe(14);
    const moved = ok(applyLudoMove(rolling(stateWith(2, tokens), 0, 3).state, 0, 0));
    expect(moved.state.tokens[1]).toEqual(base4);
    expect(moved.state.tokens[0]?.[0]).toBe(14);
    expect(moved.events.map((e) => e.type)).toEqual(['MOVED', 'CAPTURED', 'EXTRA_ROLL']);
    expect(moved.state.toMove).toBe(0);
  });

  it('never captures on a safe square: both tokens stay', () => {
    // square 8 is a star; seat 1 p = (8 - 26 + 52) % 52 = 34
    const tokens = withSeat(withSeat(allBase(2), 0, [5, IN_BASE, IN_BASE, IN_BASE]), 1, [
      34,
      IN_BASE,
      IN_BASE,
      IN_BASE,
    ]);
    const rolled = rolling(stateWith(2, tokens), 0, 3).state;
    const [move] = legalLudoMoves(rolled);
    expect(move?.captures).toBeNull();
    const moved = ok(applyLudoMove(rolled, 0, 0));
    expect(moved.state.tokens[1]?.[0]).toBe(34);
    expect(moved.state.tokens[0]?.[0]).toBe(8);
    expect(checkLudoInvariants(moved.state)).toEqual([]);
  });

  it('a token leaving the base onto an occupied start square captures nothing', () => {
    // seat 1 token sits on square 0 (seat 0's start): p = (0 - 26 + 52) % 52 = 26
    const tokens = withSeat(allBase(2), 1, [26, IN_BASE, IN_BASE, IN_BASE]);
    const moved = ok(applyLudoMove(rolling(stateWith(2, tokens), 0, 6).state, 0, 0));
    expect(moved.state.tokens[1]?.[0]).toBe(26);
    expect(moved.state.tokens[0]?.[0]).toBe(0);
  });

  it('cannot land on an opponent block, but can pass over it', () => {
    // block of two seat-1 tokens on square 14 (p 40); seat 0 token at p=11
    const tokens = withSeat(withSeat(allBase(2), 0, [11, 10, IN_BASE, IN_BASE]), 1, [
      40,
      40,
      IN_BASE,
      IN_BASE,
    ]);
    const landing = rolling(stateWith(2, tokens), 0, 3).state; // 11 -> 14 is blocked; 10 -> 13 ok
    expect(legalLudoMoves(landing).map((m) => m.token)).toEqual([1]);
    const passing = rolling(stateWith(2, tokens), 0, 4).state; // 11 -> 15 passes over the block
    // token 0 passes over the block to 15; token 1 (10 + 4) would land on it, so it is refused
    expect(legalLudoMoves(passing).map((m) => m.token)).toEqual([0]);
  });

  it('a block cannot be captured by any roll, and two different tokens are not a block', () => {
    const block = withSeat(withSeat(allBase(2), 0, [11, IN_BASE, IN_BASE, IN_BASE]), 1, [
      40,
      40,
      IN_BASE,
      IN_BASE,
    ]);
    const blocked = rolling(stateWith(2, block), 0, 3);
    expect(blocked.events.map((e) => e.type)).toEqual(['ROLLED', 'NO_MOVE', 'TURN']);
  });

  it('own tokens may share a square (forming a block) and never capture each other', () => {
    const tokens = withSeat(allBase(2), 0, [10, 14, IN_BASE, IN_BASE]);
    const rolled = rolling(stateWith(2, tokens), 0, 4).state;
    const move = legalLudoMoves(rolled).find((m) => m.token === 0);
    expect(move?.captures).toBeNull();
    expect(ok(applyLudoMove(rolled, 0, 0)).state.tokens[0]).toEqual([14, 14, IN_BASE, IN_BASE]);
  });

  it('the home column is private: opponents never meet there', () => {
    const tokens = withSeat(withSeat(allBase(2), 0, [50, IN_BASE, IN_BASE, IN_BASE]), 1, [
      52,
      IN_BASE,
      IN_BASE,
      IN_BASE,
    ]);
    const moved = ok(applyLudoMove(rolling(stateWith(2, tokens), 0, 2).state, 0, 0));
    expect(moved.state.tokens[1]?.[0]).toBe(52);
  });
});

describe('finishing and placings', () => {
  const almost = (players: LudoPlayerCount, seat: number): Tokens =>
    withSeat(allBase(players), seat, [HOME_POSITION, HOME_POSITION, HOME_POSITION, 56]);

  it('a seat with all four tokens home is placed, and play goes on for the rest', () => {
    const start = stateWith(3, almost(3, 0), { toMove: 0 });
    const moved = ok(applyLudoMove(rolling(start, 0, 1).state, 0, 3));
    expect(moved.state.finished).toEqual([0]);
    expect(moved.state.phase).toBe('roll');
    expect(moved.state.toMove).toBe(1); // no extra roll once finished
    expect(moved.events.map((e) => e.type)).toContain('SEAT_FINISHED');
    expect(checkLudoInvariants(moved.state)).toEqual([]);
  });

  it('finished seats are skipped, and the game ends when only one seat is left', () => {
    let state = stateWith(
      3,
      withSeat(almost(3, 0), 1, [HOME_POSITION, HOME_POSITION, HOME_POSITION, 56]),
      {
        toMove: 0,
      },
    );
    state = ok(applyLudoMove(rolling(state, 0, 1).state, 0, 3)).state;
    expect(state.toMove).toBe(1);
    const end = ok(applyLudoMove(rolling(state, 1, 1).state, 1, 3));
    expect(end.state.phase).toBe('finished');
    expect(end.state.placings).toEqual([0, 1, 2]);
    expect(end.state.endReason).toBe('completed');
    expect(end.events.map((e) => e.type)).toContain('GAME_OVER');
  });

  it('two players: finishing wins at once', () => {
    const state = stateWith(2, almost(2, 1), { toMove: 1 });
    const end = ok(applyLudoMove(rolling(state, 1, 1).state, 1, 3));
    expect(end.state.placings).toEqual([1, 0]);
  });
});

describe('leaving the game', () => {
  it('two players: the other player wins by forfeit', () => {
    const result = ok(removeLudoSeat(createLudo(2), 0, 'forfeit'));
    expect(result.state.placings).toEqual([1, 0]);
    expect(result.state.endReason).toBe('forfeit');
  });

  it('three or four players: their tokens leave the board and the game continues', () => {
    const tokens = withSeat(allBase(4), 2, [5, 6, 7, 8]);
    const state = stateWith(4, tokens, { toMove: 0 });
    const result = ok(removeLudoSeat(state, 2, 'forfeit'));
    expect(result.state.tokens[2]).toEqual(base4);
    expect(result.state.phase).toBe('roll');
    expect(result.state.removed).toEqual([2]);
    expect(result.state.toMove).toBe(0);
    expect(checkLudoInvariants(result.state)).toEqual([]);
  });

  it('when the seat to move leaves, the turn passes on', () => {
    const rolled = rolling(createLudo(3), 0, 6).state;
    const result = ok(removeLudoSeat(rolled, 0, 'forfeit'));
    expect(result.state.toMove).toBe(1);
    expect(result.state.phase).toBe('roll');
    expect(result.state.roll).toBeNull();
  });

  it('later leavers are placed ahead of earlier ones, all behind everyone still playing', () => {
    let state = createLudo(4);
    state = ok(removeLudoSeat(state, 1, 'forfeit')).state;
    state = ok(removeLudoSeat(state, 3, 'forfeit')).state;
    const end = ok(removeLudoSeat(state, 0, 'forfeit'));
    expect(end.state.placings).toEqual([2, 0, 3, 1]);
  });

  it('rejects removing a seat twice, an unknown seat, or after the end', () => {
    const state = ok(removeLudoSeat(createLudo(3), 1, 'forfeit')).state;
    expect(removeLudoSeat(state, 1, 'forfeit')).toEqual({ ok: false, error: 'INVALID_SEAT' });
    expect(removeLudoSeat(state, 3 as LudoSeat, 'forfeit')).toEqual({
      ok: false,
      error: 'INVALID_SEAT',
    });
    const over = ok(removeLudoSeat(createLudo(2), 0, 'forfeit')).state;
    expect(removeLudoSeat(over, 1, 'forfeit')).toEqual({ ok: false, error: 'GAME_FINISHED' });
  });
});

describe('timeouts', () => {
  it('rolls for a player who did not, and plays the token closest to home', () => {
    const tokens = withSeat(allBase(2), 0, [10, 30, IN_BASE, IN_BASE]);
    const result = ok(applyLudoTimeout(stateWith(2, tokens), 4));
    expect(result.state.tokens[0]).toEqual([10, 34, IN_BASE, IN_BASE]);
    expect(result.state.consecutiveTimeouts[0]).toBe(1);
    expect(result.state.toMove).toBe(1);
  });

  it('plays the fallback for a player who rolled but did not choose', () => {
    const tokens = withSeat(allBase(2), 0, [10, 30, IN_BASE, IN_BASE]);
    const rolled = rolling(stateWith(2, tokens), 0, 2).state;
    const result = ok(applyLudoTimeout(rolled, 6));
    expect(result.state.tokens[0]).toEqual([10, 32, IN_BASE, IN_BASE]);
  });

  it('a timeout with no possible move just passes, and still counts as a strike', () => {
    const result = ok(applyLudoTimeout(createLudo(2), 3));
    expect(result.state.toMove).toBe(1);
    expect(result.state.consecutiveTimeouts[0]).toBe(1);
  });

  it('three timeouts in a row remove the seat; a deliberate move clears the count', () => {
    let state = stateWith(3, withSeat(allBase(3), 0, [10, IN_BASE, IN_BASE, IN_BASE]));
    state = { ...state, consecutiveTimeouts: [2, 0, 0] };
    const removed = ok(applyLudoTimeout(state, 3));
    expect(removed.state.removed).toEqual([0]);
    expect(removed.state.toMove).toBe(1);

    const reset = ok(applyLudoMove(rolling(state, 0, 3).state, 0, 0));
    expect(reset.state.consecutiveTimeouts[0]).toBe(0);
  });

  it('default move prefers the token closest to home, then the lowest index', () => {
    const tokens = withSeat(allBase(2), 0, [20, 20, 15, IN_BASE]);
    const rolled = rolling(stateWith(2, tokens), 0, 3).state;
    expect(defaultLudoMove(rolled)).toBe(0);
    expect(defaultLudoMove(createLudo(2))).toBeNull();
  });
});

describe('purity', () => {
  it('never changes the state it is given', () => {
    const start = freeze(createLudo(4));
    const rolled = freeze(ok(applyLudoRoll(start, 0, 6)).state);
    const moved = freeze(ok(applyLudoMove(rolled, 0, 0)).state);
    freeze(ok(applyLudoTimeout(moved, 2)).state);
    freeze(ok(removeLudoSeat(moved, 1, 'forfeit')).state);
    expect(start.tokens.flat().every((p) => p === IN_BASE)).toBe(true);
  });
});

describe('invariant checker', () => {
  it('notices impossible states', () => {
    const mixed = stateWith(2, [
      [14, IN_BASE, IN_BASE, IN_BASE],
      [40, IN_BASE, IN_BASE, IN_BASE],
    ]);
    expect(checkLudoInvariants(mixed).join()).toContain('shared by different colours');
    const out = stateWith(2, [[99, IN_BASE, IN_BASE, IN_BASE], [...base4]]);
    expect(checkLudoInvariants(out).join()).toContain('out of range');
  });
});

// ---------------------------------------------------------------------------------------------
// Property and fuzz tests: whatever happens, the game stays legal and always ends.
// ---------------------------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface LogEntry {
  kind: 'roll' | 'move' | 'timeout' | 'remove';
  seat: LudoSeat;
  value: number;
}

function playRandomGame(
  players: LudoPlayerCount,
  seed: number,
  options: { chaos: boolean },
  onStep?: (state: LudoState) => void,
): { state: LudoState; log: LogEntry[]; steps: number } {
  const random = mulberry32(seed);
  const die = () => 1 + Math.floor(random() * 6);
  let state = createLudo(players, Math.floor(random() * players) as LudoSeat);
  const log: LogEntry[] = [];
  let steps = 0;
  while (state.phase !== 'finished' && steps < 20_000) {
    steps += 1;
    const seat = state.toMove;
    let result;
    if (options.chaos && random() < 0.02) {
      result = applyLudoTimeout(state, die());
      log.push({ kind: 'timeout', seat, value: 0 });
      // a timeout rolls internally; record the die it used by replaying with the same value
      log[log.length - 1] = { kind: 'timeout', seat, value: 0 };
    } else if (options.chaos && random() < 0.003) {
      result = removeLudoSeat(state, seat, 'forfeit');
      log.push({ kind: 'remove', seat, value: 0 });
    } else if (state.phase === 'roll') {
      const value = die();
      result = applyLudoRoll(state, seat, value);
      log.push({ kind: 'roll', seat, value });
    } else {
      const moves = legalLudoMoves(state);
      const chosen = moves[Math.floor(random() * moves.length)];
      result = applyLudoMove(state, seat, chosen?.token ?? 0);
      log.push({ kind: 'move', seat, value: chosen?.token ?? 0 });
    }
    if (!result.ok)
      throw new Error(`unexpected rejection ${result.error} at step ${String(steps)}`);
    state = result.state;
    onStep?.(state);
  }
  return { state, log, steps };
}

describe('property tests', () => {
  const playersArb = fc.constantFrom<LudoPlayerCount>(2, 3, 4);
  const seedArb = fc.integer({ min: 0, max: 2 ** 31 - 1 });

  it('every state reached by legal play satisfies the invariants', () => {
    fc.assert(
      fc.property(playersArb, seedArb, (players, seed) => {
        playRandomGame(players, seed, { chaos: false }, (state) => {
          const problems = checkLudoInvariants(state);
          if (problems.length > 0) throw new Error(problems.join('; '));
        });
      }),
      { numRuns: 150 },
    );
  });

  it('with timeouts and players leaving, states stay legal and the game still ends', () => {
    fc.assert(
      fc.property(playersArb, seedArb, (players, seed) => {
        const { state, steps } = playRandomGame(players, seed, { chaos: true }, (s) => {
          const problems = checkLudoInvariants(s);
          if (problems.length > 0) throw new Error(problems.join('; '));
        });
        expect(state.phase).toBe('finished');
        expect(steps).toBeLessThan(20_000);
      }),
      { numRuns: 150 },
    );
  });

  it('a finished game has every seat placed exactly once, finishers ahead of the rest', () => {
    fc.assert(
      fc.property(playersArb, seedArb, (players, seed) => {
        const { state } = playRandomGame(players, seed, { chaos: false });
        const placings = state.placings ?? [];
        expect([...placings].sort()).toEqual(Array.from({ length: players }, (_, i) => i));
        expect(placings.slice(0, state.finished.length)).toEqual(state.finished);
        // Without leavers, the winner has all four tokens home.
        const winner = placings[0] ?? 0;
        expect(state.tokens[winner]?.every((p) => p === HOME_POSITION)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('is deterministic: replaying the logged rolls and moves gives the same game', () => {
    fc.assert(
      fc.property(playersArb, seedArb, (players, seed) => {
        const first = playRandomGame(players, seed, { chaos: false });
        const random = mulberry32(seed);
        const opener = Math.floor(random() * players) as LudoSeat;
        let replay = createLudo(players, opener);
        for (const entry of first.log) {
          const result =
            entry.kind === 'roll'
              ? applyLudoRoll(replay, entry.seat, entry.value)
              : applyLudoMove(replay, entry.seat, entry.value);
          if (!result.ok) throw new Error(result.error);
          replay = result.state;
        }
        expect(replay).toEqual(first.state);
      }),
      { numRuns: 100 },
    );
  });

  it('a move is accepted exactly when it is in the legal-move list', () => {
    fc.assert(
      fc.property(
        playersArb,
        seedArb,
        fc.integer({ min: 0, max: 400 }),
        (players, seed, stopAt) => {
          let reached = createLudo(players);
          let count = 0;
          playRandomGame(players, seed, { chaos: false }, (s) => {
            if (count++ === stopAt) reached = s;
          });
          if (reached.phase !== 'move') return;
          const legal = new Set(legalLudoMoves(reached).map((m) => m.token));
          for (let token = 0; token < 4; token += 1) {
            expect(applyLudoMove(reached, reached.toMove, token).ok).toBe(legal.has(token));
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it('rejected actions never change the state', () => {
    fc.assert(
      fc.property(
        playersArb,
        seedArb,
        fc.integer({ min: 0, max: 400 }),
        (players, seed, stopAt) => {
          let reached = createLudo(players);
          let count = 0;
          playRandomGame(players, seed, { chaos: false }, (s) => {
            if (count++ === stopAt) reached = s;
          });
          const snapshot = structuredClone(reached);
          const frozen = freeze(reached);
          const other = ((frozen.toMove + 1) % players) as LudoSeat;
          applyLudoRoll(frozen, other, 3);
          applyLudoMove(frozen, other, 0);
          applyLudoRoll(frozen, frozen.toMove, 9);
          applyLudoMove(frozen, frozen.toMove, 9);
          expect(frozen).toEqual(snapshot);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('a die roll never produces more than three sixes in a row for one seat in one turn', () => {
    fc.assert(
      fc.property(playersArb, seedArb, (players, seed) => {
        playRandomGame(players, seed, { chaos: false }, (s) => {
          expect(s.sixes).toBeLessThanOrEqual(2);
        });
      }),
      { numRuns: 100 },
    );
  });
});
