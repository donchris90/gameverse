import { describe, expect, it } from 'vitest';
import {
  AYO_LAST_SEEDS,
  AYO_MAX_LIFTS,
  AYO_TOTAL_SEEDS,
  acceptAyoEnd,
  applyAyoMove,
  createAyo,
  declineAyoEnd,
  forfeitAyo,
  legalAyoMoves,
  livePits,
  offerAyoEnd,
  pitsFor,
  seedsOf,
  timeoutAyo,
  type AyoSeat,
  type AyoState,
} from './ayo.js';
import { chooseAyoMove } from './ayo-bots.js';

/** A position with the given seeds per pit (missing pits are empty). */
function position(pits: Record<number, number>, over: Partial<AyoState> = {}): AyoState {
  const base = createAyo(0);
  return {
    ...base,
    pits: Array.from({ length: 12 }, (_unused, pit) => pits[pit] ?? 0),
    ...over,
  };
}

function play(state: AyoState, pit: number) {
  const result = applyAyoMove(state, state.toMove, pit);
  if (!result.ok) throw new Error(`illegal: ${result.error}`);
  return result;
}

const total = (state: AyoState): number =>
  state.pits.reduce((a, b) => a + b, 0) + state.stores[0] + state.stores[1];

describe('the start', () => {
  it('has 48 seeds, four in each of 12 pits, and six moves for the opener', () => {
    const start = createAyo(1);
    expect(start.pits).toEqual(Array(12).fill(4));
    expect(total(start)).toBe(AYO_TOTAL_SEEDS);
    expect(start.toMove).toBe(1);
    expect(legalAyoMoves(start)).toEqual([6, 7, 8, 9, 10, 11]);
  });

  it('never reaps on an opening move, and matches the worked example in the rules', () => {
    for (const pit of [0, 1, 2, 3, 4, 5]) {
      const done = play(createAyo(0), pit);
      expect(done.state.stores).toEqual([0, 0]);
      expect(total(done.state)).toBe(48);
    }
    const example = play(createAyo(0), 0);
    expect(example.state.pits).toEqual([2, 7, 1, 6, 1, 6, 6, 6, 0, 1, 6, 6]);
    expect(example.state.toMove).toBe(1);
  });
});

describe('reaping at four', () => {
  it('lets the mover reap a pit of their own that reaches four', () => {
    const state = position({ 0: 2, 1: 3, 6: 9 });
    const done = play(state, 0);
    // seed 1 makes pit 1 hold 4 (reaped), seed 2 lands in empty pit 2 and ends the turn
    expect(done.state.stores).toEqual([4, 0]);
    expect(done.state.pits[1]).toBe(0);
    expect(done.state.pits[2]).toBe(1);
    expect(done.state.toMove).toBe(1);
  });

  it('gives a four made on the opponent side mid-sowing to the opponent', () => {
    const state = position({ 5: 2, 6: 3, 9: 9 });
    const done = play(state, 5);
    expect(done.state.stores).toEqual([0, 4]);
    expect(done.state.pits[6]).toBe(0);
    expect(done.state.pits[7]).toBe(1);
  });

  it('gives it to the mover when it is the very last seed', () => {
    const state = position({ 5: 1, 6: 3, 9: 9 });
    const done = play(state, 5);
    expect(done.state.stores).toEqual([4, 0]);
    expect(done.state.pits[6]).toBe(0);
    expect(done.state.toMove).toBe(1);
  });

  it('reaps a four made by the last seed in the mover own pit and ends the turn', () => {
    const state = position({ 0: 1, 1: 3, 8: 9 });
    const done = play(state, 0);
    expect(done.state.stores).toEqual([4, 0]);
    expect(done.state.pits[1]).toBe(0);
    expect(done.state.pits[8]).toBe(9); // no relay afterwards
  });

  it('only reaps exactly four: a pit going from four to five stays', () => {
    const state = position({ 0: 1, 1: 4, 8: 9 });
    const done = play(state, 0);
    expect(done.state.stores).toEqual([0, 0]);
  });

  it('counts the seed that reaches four even in a pit emptied earlier in the same turn', () => {
    const state = position({ 0: 5, 1: 3, 2: 3, 9: 9 });
    const done = play(state, 0);
    // drops: pit1 3->4 (reaped), pit2 3->4 (reaped), pit3 0->1, pit4 0->1, pit5 0->1 (last, empty)
    expect(done.state.stores).toEqual([8, 0]);
    expect(done.state.pits.slice(1, 6)).toEqual([0, 0, 1, 1, 1]);
  });
});

describe('relay and the end of a turn', () => {
  it('ends when the last seed lands in an empty pit', () => {
    const done = play(position({ 0: 1, 7: 9 }), 0);
    expect(done.state.pits[1]).toBe(1);
    expect(done.state.toMove).toBe(1);
  });

  it('relays from a non-empty pit on the mover side', () => {
    const done = play(position({ 0: 1, 1: 1, 8: 9 }), 0);
    // pit 1 had 1 and now holds 2: lift it, drop in 2 and 3; the last lands in an empty pit
    expect(done.state.pits.slice(0, 4)).toEqual([0, 0, 1, 1]);
    expect(done.events[0]).toMatchObject({ type: 'MOVED' });
  });

  it('relays through a pit on the opponent side, lifting their seeds', () => {
    const done = play(position({ 5: 1, 6: 1, 9: 9 }), 5);
    // pit 6 had 1, now 2: lift and sow 7 and 8; last lands in empty pit 8
    expect(done.state.pits.slice(5, 9)).toEqual([0, 0, 1, 1]);
  });

  it('skips the pit a big lift came from on each lap', () => {
    const state = position({ 0: 12 });
    const done = play(state, 0);
    const steps = done.state.last?.steps ?? [];
    const firstLift = steps.findIndex((step, index) => index > 0 && step.k === 'lift');
    const drops = steps
      .slice(1, firstLift === -1 ? undefined : firstLift)
      .flatMap((step) => (step.k === 'drop' ? [step.pit] : []));
    expect(drops).toHaveLength(12);
    expect(drops.slice(0, 11)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(drops[11]).toBe(1); // pit 0 is skipped
  });
});

describe('the last eight seeds', () => {
  it('give the whole table to whoever reaps, and end the round', () => {
    // 8 on the board: pit 0 (1), pit 1 (3), pit 6 (4). 18 + 22 in the stores.
    const state = position({ 0: 1, 1: 3, 6: 4 }, { stores: [18, 22] });
    const done = play(state, 0);
    expect(done.events.map((e) => e.type)).toEqual(['MOVED', 'ROUND_ENDED', 'ROUND_STARTED']);
    expect(done.state.lastRound).toEqual({ round: 1, winner: 0, took: AYO_LAST_SEEDS });
    // stores 18 + 8 = 26 and 22: six pits (24) and five pits (20)
    expect(livePits(done.state, 0)).toBe(6);
    expect(livePits(done.state, 1)).toBe(5);
    expect(done.state.stores).toEqual([2, 2]);
    expect(done.state.round).toBe(2);
    expect(total(done.state)).toBe(48);
  });

  it('give them to the opponent when the opponent reaps a four made mid-sowing', () => {
    // 5 holds 2; 6 holds 3; 7 holds 1; 11 holds 2. One seed in hand after pit 6 reaches 4: 8 in all.
    const state = position({ 5: 2, 6: 3, 7: 1, 11: 2 }, { stores: [20, 20] });
    const done = play(state, 5);
    expect(done.state.lastRound).toEqual({ round: 1, winner: 1, took: 8 });
    expect(total(done.state)).toBe(48);
  });

  it('start the next round with the loser of the last one', () => {
    const state = position({ 0: 1, 1: 3, 6: 4 }, { stores: [18, 22] });
    const done = play(state, 0);
    expect(done.state.toMove).toBe(1);
    expect(done.state.starter).toBe(1);
  });

  it('end the whole match when a player can fill only one pit', () => {
    const state = position({ 0: 1, 1: 3, 6: 4 }, { stores: [38, 2] });
    const done = play(state, 0);
    expect(done.state).toMatchObject({ phase: 'finished', winner: 0, endReason: 'one_pit' });
    expect(done.events.map((e) => e.type)).toEqual(['MOVED', 'ROUND_ENDED', 'GAME_ENDED']);
    expect(legalAyoMoves(done.state)).toEqual([]);
  });

  it('keep a player with two pits in the match', () => {
    const state = position({ 0: 1, 1: 3, 6: 4 }, { stores: [32, 8] });
    const done = play(state, 0);
    expect(done.state.phase).toBe('playing');
    expect(pitsFor(8)).toBe(2);
    expect(livePits(done.state, 1)).toBe(2);
  });

  it('plays a round with fewer pits: the lost pits are skipped by sowing', () => {
    const state = position({ 0: 1, 1: 3, 6: 4 }, { stores: [32, 8] });
    const next = play(state, 0).state; // seat 1 has pits 6 and 7 only
    expect(next.alive.slice(6, 12)).toEqual([true, true, false, false, false, false]);
    expect(legalAyoMoves(next)).toEqual([6, 7]);
    const done = play(next, 6);
    const drops = (done.state.last?.steps ?? []).flatMap((step) =>
      step.k === 'drop' ? [step.pit] : [],
    );
    // four seeds from pit 6 go to 7, then past the lost pits to 0, 1, 2
    expect(drops.slice(0, 4)).toEqual([7, 0, 1, 2]);
    expect(drops.every((pit) => next.alive[pit])).toBe(true);
    expect(done.state.pits.slice(8, 12)).toEqual([0, 0, 0, 0]);
    expect(total(done.state)).toBe(48);
  });

  it('ends the round when the next player has nothing to lift', () => {
    const state = position({ 0: 1, 3: 7 }, { stores: [20, 20] });
    const done = play(state, 0);
    expect(done.state.lastRound).toEqual({ round: 1, winner: 0, took: 8 });
    expect(total(done.state)).toBe(48);
  });
});

describe('ending by agreement', () => {
  const twoPits = (): AyoState => {
    const base = createAyo(0);
    const alive = base.alive.map((_a, pit) => pit < 6 || pit < 8);
    const pits = base.pits.map((n, pit) => (alive[pit] ? n : 0));
    return { ...base, alive, pits, stores: [0, 0] as [number, number] };
  };

  it('is refused unless a player has exactly two pits', () => {
    expect(offerAyoEnd(createAyo(0), 0)).toEqual({ ok: false, error: 'END_NOT_ALLOWED' });
  });

  it('needs the other player to accept, and the bigger total wins', () => {
    const state = { ...twoPits(), stores: [30, 6] as [number, number] };
    const offered = offerAyoEnd(state, 1);
    expect(offered.ok && offered.state.endOffer).toBe(1);
    if (!offered.ok) return;
    expect(acceptAyoEnd(offered.state, 1)).toEqual({ ok: false, error: 'OWN_OFFER' });
    const accepted = acceptAyoEnd(offered.state, 0);
    expect(accepted.ok && accepted.state).toMatchObject({
      phase: 'finished',
      endReason: 'agreement',
    });
    expect(seedsOf(state, 0)).toBeGreaterThan(seedsOf(state, 1));
  });

  it('can be declined, and playing on counts as declining', () => {
    const state = twoPits();
    const offered = offerAyoEnd(state, 0);
    if (!offered.ok) throw new Error('offer failed');
    const declined = declineAyoEnd(offered.state, 1);
    expect(declined.ok && declined.state.endOffer).toBeNull();
    const again = offerAyoEnd(state, 1);
    if (!again.ok) throw new Error('offer failed');
    const moved = applyAyoMove({ ...again.state, toMove: 0 }, 0, 0);
    expect(moved.ok && moved.state.endOffer).toBeNull();
    expect(declineAyoEnd(state, 1)).toEqual({ ok: false, error: 'NO_OFFER' });
  });

  it('is a draw when both totals are equal', () => {
    const state = { ...twoPits(), stores: [10, 10] as [number, number] };
    const base = seedsOf(state, 0) === seedsOf(state, 1);
    const offered = offerAyoEnd(state, 0);
    if (!offered.ok) throw new Error('offer failed');
    const accepted = acceptAyoEnd(offered.state, 1);
    expect(accepted.ok && accepted.state.winner).toBe(
      base ? 'draw' : accepted.ok ? accepted.state.winner : null,
    );
  });
});

describe('a relay that goes round in a circle', () => {
  it('ends the turn when a position repeats inside it', () => {
    // Search random positions for a turn that is cut short by the repeat rule.
    let found = 0;
    for (let seed = 1; seed <= 60 && found === 0; seed += 1) {
      const random = seeded(seed);
      let state = createAyo(0);
      for (let ply = 0; ply < 400 && state.phase === 'playing'; ply += 1) {
        const moves = legalAyoMoves(state);
        const result = applyAyoMove(
          state,
          state.toMove,
          moves[Math.floor(random() * moves.length)] as number,
        );
        if (!result.ok) break;
        const lifts = (result.state.last?.steps ?? []).filter((s) => s.k === 'lift').length;
        if (lifts > 40) found = lifts;
        state = result.state;
      }
    }
    // Whatever was found, no turn ever reaches the hard limit.
    expect(found).toBeLessThan(AYO_MAX_LIFTS);
  });
});

describe('refusals and the clock', () => {
  it('refuses out-of-turn, empty, foreign and malformed pits', () => {
    const start = createAyo(0);
    expect(applyAyoMove(start, 1, 6)).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
    expect(applyAyoMove(start, 0, 7)).toEqual({ ok: false, error: 'ILLEGAL_MOVE' });
    expect(applyAyoMove(start, 0, 12)).toEqual({ ok: false, error: 'INVALID_PIT' });
    expect(applyAyoMove(start, 0, 1.5)).toEqual({ ok: false, error: 'INVALID_PIT' });
    const empty = position({ 3: 4, 8: 4 });
    expect(applyAyoMove(empty, 0, 0)).toEqual({ ok: false, error: 'ILLEGAL_MOVE' });
  });

  it('loses on timeout and on forfeit, once, and refuses moves after the end', () => {
    const start = createAyo(0);
    const timed = timeoutAyo(start);
    expect(timed.ok && timed.state).toMatchObject({ winner: 1, endReason: 'timeout' });
    const left = forfeitAyo(start, 1);
    expect(left.ok && left.state).toMatchObject({ winner: 0, endReason: 'forfeit' });
    if (timed.ok) {
      expect(timeoutAyo(timed.state)).toEqual({ ok: false, error: 'GAME_FINISHED' });
      expect(applyAyoMove(timed.state, 0, 0)).toEqual({ ok: false, error: 'GAME_FINISHED' });
    }
  });

  it('does not change the old state when a move is played', () => {
    const start = createAyo(0);
    const before = JSON.stringify(start);
    play(start, 2);
    expect(JSON.stringify(start)).toBe(before);
  });
});

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
  it('conserve 48 seeds, always offer a move, usually end, and never hit the relay safety limit', () => {
    let longestTurn = 0;
    let finished = 0;
    const violations: string[] = [];
    for (let seed = 1; seed <= 80; seed += 1) {
      const random = seeded(seed);
      let state = createAyo((seed % 2) as AyoSeat);
      for (let ply = 0; ply < 1500 && state.phase === 'playing'; ply += 1) {
        const moves = legalAyoMoves(state);
        if (moves.length === 0) {
          violations.push(`seed ${String(seed)} ply ${String(ply)}: no move`);
          break;
        }
        const pit = moves[Math.floor(random() * moves.length)] as number;
        const result = applyAyoMove(state, state.toMove, pit);
        if (!result.ok) {
          violations.push(`seed ${String(seed)} ply ${String(ply)}: ${result.error}`);
          break;
        }
        state = result.state;
        if (total(state) !== AYO_TOTAL_SEEDS)
          violations.push(`seed ${String(seed)}: seeds not conserved`);
        const lifts = (state.last?.steps ?? []).filter((step) => step.k === 'lift').length;
        longestTurn = Math.max(longestTurn, lifts);
        if (lifts >= AYO_MAX_LIFTS) violations.push(`seed ${String(seed)}: relay limit hit`);
        state.pits.forEach((n, index) => {
          if (n < 0 || (!state.alive[index] && n !== 0))
            violations.push(`seed ${String(seed)}: bad pit`);
        });
      }
      // Two random players can trade rounds for a long time; most matches still end inside the cap.
      if (state.phase === 'finished') finished += 1;
    }
    expect(violations).toEqual([]);
    expect(finished).toBeGreaterThan(40);
    expect(longestTurn).toBeGreaterThan(1);
  }, 120_000);
});

describe('bots', () => {
  it('only ever choose a legal pit, at every level', () => {
    for (const level of ['easy', 'medium', 'hard'] as const) {
      const random = seeded(5);
      let state = createAyo(0);
      for (let ply = 0; ply < 60 && state.phase === 'playing'; ply += 1) {
        const pit = chooseAyoMove(state, level, random);
        expect(pit).not.toBeNull();
        const result = applyAyoMove(state, state.toMove, pit as number);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        state = result.state;
      }
    }
  });

  it('returns null when the game is over, and hard takes an available reap', () => {
    const done = timeoutAyo(createAyo(0));
    if (done.ok) expect(chooseAyoMove(done.state, 'hard', Math.random)).toBeNull();
    const state = position({ 0: 2, 1: 3, 4: 1, 8: 9 });
    expect(chooseAyoMove(state, 'hard', () => 0)).toBe(0);
  });
});
