import { describe, expect, it } from 'vitest';
import {
  AYO_MAX_AUTO_PLAYS,
  AYO_MAX_ROUNDS,
  AYO_TOTAL_SEEDS,
  applyAyoMove,
  checkAyoInvariants,
  createAyo,
  decideAyo,
  defaultOwners,
  forfeitAyo,
  idleAyo,
  legalAyoMoves,
  ownersForPits,
  pitCount,
  sowAyo,
  type AyoSeat,
  type AyoState,
  type AyoStep,
} from './ayo.js';
import { chooseAyoMove, type AyoBotLevel } from './ayo-bots.js';

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
  state.pits.reduce((a, b) => a + b, 0) + state.packed[0] + state.packed[1];

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

describe('the start', () => {
  it('has 48 seeds, four in each of 12 pits, six pits each, and six moves for the opener', () => {
    const start = createAyo(1);
    expect(start.pits).toEqual(Array(12).fill(4));
    expect(total(start)).toBe(AYO_TOTAL_SEEDS);
    expect(start.owners).toEqual(defaultOwners());
    expect(start.toMove).toBe(1);
    expect(legalAyoMoves(start)).toEqual([6, 7, 8, 9, 10, 11]);
    expect(legalAyoMoves(createAyo(0))).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('never packs on an opening move and always keeps 48 seeds', () => {
    for (const pit of [0, 1, 2, 3, 4, 5]) {
      const done = play(createAyo(0), pit);
      expect(done.state.packed).toEqual([0, 0]);
      expect(total(done.state)).toBe(48);
    }
  });
});

describe('sowing', () => {
  it('relays from an occupied pit and stops on an empty one', () => {
    // pit 0 has 2: pit 1 (empty -> 1), pit 2 (had 1 -> 2, occupied -> lift 2), pit 3, pit 4 (empty) -> stop
    const r = sowAyo([2, 0, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1], defaultOwners(), 0, 0);
    expect(r.pits).toEqual([0, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1]);
    expect(r.steps.filter((s) => s.k === 'lift')).toHaveLength(2);
  });

  it('packs a pit that reaches four for the sower, and a packed last seed ends the turn', () => {
    const r = sowAyo([1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], defaultOwners(), 0, 0);
    expect(r.packedBy).toEqual([4, 0]);
    expect(r.pits[1]).toBe(0);
    expect(r.steps).toContainEqual({ k: 'pack', pit: 1, by: 0, amount: 4 });
  });

  it('a four made in the middle of a sow on the other side goes to that side', () => {
    const r = sowAyo([0, 0, 0, 0, 0, 2, 3, 0, 1, 1, 1, 1], defaultOwners(), 0, 5);
    expect(r.packedBy).toEqual([0, 4]);
    expect(r.lastReceiver).toBe(1);
    expect(r.steps).toContainEqual({ k: 'pack', pit: 6, by: 1, amount: 4 });
  });

  it('a four made by the last seed on the other side goes to the sower', () => {
    const r = sowAyo([0, 0, 0, 0, 0, 1, 3, 0, 1, 1, 1, 1], defaultOwners(), 0, 5);
    expect(r.packedBy).toEqual([4, 0]);
    expect(r.lastReceiver).toBe(0);
  });

  it('a four made in the middle of a sow on my own side is mine', () => {
    const r = sowAyo([2, 3, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1], defaultOwners(), 0, 0);
    expect(r.packedBy).toEqual([4, 0]);
  });

  it('does not skip the pit it lifted from on a long lap', () => {
    const r = sowAyo([13, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], defaultOwners(), 0, 0);
    const drops = r.steps.filter((s) => s.k === 'drop');
    expect(drops.filter((s) => s.pit === 0).length).toBeGreaterThan(0);
  });

  it('every opening move ends, and the replay steps rebuild the final board', () => {
    for (let pit = 0; pit < 6; pit += 1) {
      const start = createAyo(0);
      const done = play(start, pit);
      const board = [...start.pits];
      for (const step of done.state.last?.steps ?? []) {
        if (step.k === 'lift') board[step.pit] = 0;
        if (step.k === 'drop') board[step.pit] = (board[step.pit] ?? 0) + 1;
        if (step.k === 'pack') board[step.pit] = 0;
      }
      expect(board).toEqual([...done.state.pits]);
      expect(done.state.last?.before.pits).toEqual(start.pits);
    }
  });
});

describe('who moves', () => {
  it('refuses the wrong seat, a pit that is not yours and an empty pit', () => {
    const state = createAyo(0);
    expect(applyAyoMove(state, 1, 6)).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
    expect(applyAyoMove(state, 0, 6)).toEqual({ ok: false, error: 'ILLEGAL_MOVE' });
    expect(applyAyoMove(state, 0, 12)).toEqual({ ok: false, error: 'INVALID_PIT' });
    const gap = position({ 1: 1, 7: 1, 8: 2, 9: 2, 10: 2, 11: 2 }, { packed: [20, 16] });
    expect(applyAyoMove(gap, 0, 0)).toEqual({ ok: false, error: 'ILLEGAL_MOVE' });
  });

  it('a player with no seeds on their side skips their turn', () => {
    const state = position({ 0: 1, 9: 2, 10: 3, 11: 2 }, { packed: [20, 20] });
    // seat 0 plays pit 0 into empty pit 1 and stops; seat 1 has seeds, so seat 1 moves
    expect(play(state, 0).state.toMove).toBe(1);
    const lonely = position({ 3: 2, 5: 3, 11: 1 }, { packed: [20, 22], toMove: 1 });
    // seat 1 plays pit 11 into empty pit 0 and stops; seat 0 has seeds, so seat 0 moves
    expect(play(lonely, 11).state.toMove).toBe(0);
    // seat 0 plays its only seed away and seat 1 has nothing: seat 0 moves again
    const again = position({ 0: 1, 5: 5, 6: 0 }, { packed: [20, 22], toMove: 0 });
    expect(play(again, 0).state.toMove).toBe(0);
  });
});

describe('the end of a round', () => {
  it('gives the last four seeds to the previous packer and sets up the next round', () => {
    const state = position({ 2: 1, 7: 1, 8: 1, 9: 1 }, { packed: [24, 20], lastPacker: 1 });
    const done = play(state, 2).state;
    expect(done.round).toBe(2);
    expect(done.lastRound).toEqual({ round: 1, packed: [24, 24], pits: [6, 6], finalTo: 1 });
    expect(done.pits).toEqual(Array(12).fill(4));
    expect(pitCount(done, 0)).toBe(6);
    expect(done.starter).toBe(1); // rounds alternate
    expect(done.toMove).toBe(1);
    expect(done.packed).toEqual([0, 0]);
    expect(done.last?.steps.map((s) => s.k)).toEqual(['lift', 'drop', 'final', 'round']);
  });

  it('a four packed for the other side counts as their last pack', () => {
    const state = position({ 5: 2, 6: 3, 8: 1, 9: 1, 10: 1 }, { packed: [20, 20], lastPacker: 0 });
    const done = play(state, 5).state;
    expect(done.lastRound?.packed).toEqual([20, 28]);
    expect(done.lastRound?.finalTo).toBe(1);
  });

  it('28 seeds make 7 pits and 20 make 5, the bigger row first in the ring', () => {
    const state = position({ 2: 1, 7: 1, 8: 1, 9: 1 }, { packed: [24, 20], lastPacker: 0 });
    const done = play(state, 2).state;
    expect(done.lastRound?.pits).toEqual([7, 5]);
    expect(done.owners).toEqual(ownersForPits(7));
    expect(pitCount(done, 1)).toBe(5);
  });

  it('the player with no pit loses', () => {
    const state = position({ 2: 1, 7: 1, 8: 1, 9: 1 }, { packed: [0, 44], lastPacker: 1 });
    const done = play(state, 2).state;
    expect(done.phase).toBe('finished');
    expect(done.winner).toBe(1);
    expect(done.endReason).toBe('no_pits');
  });

  it('a player who starts a round with one pit must choose, and nobody can move until they do', () => {
    const state = position({ 2: 1, 7: 1, 8: 1, 9: 1 }, { packed: [4, 40], lastPacker: 1 });
    const done = play(state, 2);
    expect(done.state.decision).toBe(0);
    expect(done.events.some((e) => e.type === 'DECISION_REQUIRED')).toBe(true);
    expect(legalAyoMoves(done.state)).toEqual([]);
    const pit = done.state.owners.indexOf(done.state.toMove);
    expect(applyAyoMove(done.state, done.state.toMove, pit)).toEqual({
      ok: false,
      error: 'DECISION_PENDING',
    });
    // only the seat with the choice may answer
    expect(decideAyo(done.state, 1, false)).toEqual({ ok: false, error: 'NO_DECISION' });
    const quit = decideAyo(done.state, 0, true);
    expect(quit.ok && quit.state.winner).toBe(1);
    expect(quit.ok && quit.state.endReason).toBe('quit');
    const stay = decideAyo(done.state, 0, false);
    expect(stay.ok && stay.state.decision).toBeNull();
    expect(stay.ok && legalAyoMoves(stay.state).length).toBeGreaterThan(0);
  });

  it('ends after the last allowed round with the bigger row winning (equal = draw)', () => {
    const last = (packed: [number, number], lastPacker: AyoSeat) =>
      play(position({ 2: 1, 7: 1, 8: 1, 9: 1 }, { packed, lastPacker, round: AYO_MAX_ROUNDS }), 2)
        .state;
    const bigger = last([24, 20], 0); // 28 v 20: 7 pits v 5
    expect(bigger.phase).toBe('finished');
    expect(bigger.endReason).toBe('max_rounds');
    expect(bigger.winner).toBe(0);
    expect(last([24, 20], 1).winner).toBe('draw'); // 24 v 24
  });
});

describe('leaving and the clock', () => {
  it('a forfeit gives the match to the other seat', () => {
    const result = forfeitAyo(createAyo(0), 0);
    expect(result.ok && result.state.winner).toBe(1);
    expect(result.ok && result.state.endReason).toBe('forfeit');
    const finished = result.ok ? result.state : createAyo(0);
    expect(forfeitAyo(finished, 1)).toEqual({ ok: false, error: 'GAME_FINISHED' });
  });

  it('plays a pit for a player whose clock ran out, and forfeits them after three in a row', () => {
    let state = createAyo(0);
    const pick = (s: AyoState) => legalAyoMoves(s)[0] ?? null;
    const first = idleAyo(state, pick);
    expect(first.ok && first.state.autoPlays).toEqual([1, 0]);
    expect(first.ok && first.state.plies).toBe(1);
    // the other seat plays for real; seat 0 times out again
    if (!first.ok) throw new Error('x');
    state = first.state;
    state = play(state, legalAyoMoves(state)[0] as number).state;
    const second = idleAyo(state, pick);
    expect(second.ok && second.state.autoPlays).toEqual([2, 0]);
    if (!second.ok) throw new Error('x');
    state = play(second.state, legalAyoMoves(second.state)[0] as number).state;
    const third = idleAyo(state, pick);
    expect(AYO_MAX_AUTO_PLAYS).toBe(3);
    expect(third.ok && third.state.phase).toBe('finished');
    expect(third.ok && third.state.winner).toBe(1);
    expect(third.ok && third.state.endReason).toBe('timeout');
  });

  it('a real move clears the streak of auto plays', () => {
    const state = { ...createAyo(0), autoPlays: [2, 0] as [number, number] };
    expect(play(state, 0).state.autoPlays).toEqual([0, 0]);
  });

  it('continues for a player who ran out of time on a quit-or-continue choice', () => {
    const state = position({ 2: 1, 7: 1, 8: 1, 9: 1 }, { packed: [4, 40], lastPacker: 1 });
    const waiting = play(state, 2).state;
    const result = idleAyo(waiting, () => null);
    expect(result.ok && result.state.decision).toBeNull();
    expect(result.ok && result.state.phase).toBe('playing');
  });
});

describe('whole games', () => {
  it.each<AyoBotLevel>(['easy', 'medium', 'hard'])(
    '%s bots always finish a game, keep 48 seeds and never break a rule',
    (level) => {
      for (let seed = 1; seed <= (level === 'hard' ? 2 : 20); seed += 1) {
        const random = mulberry32(seed * 7919);
        let state = createAyo((seed % 2) as AyoSeat);
        let steps = 0;
        while (state.phase !== 'finished' && steps < 30_000) {
          steps += 1;
          if (state.decision !== null) {
            const answered = decideAyo(state, state.decision, false);
            if (!answered.ok) throw new Error(answered.error);
            state = answered.state;
            continue;
          }
          const pit = chooseAyoMove(state, level, random);
          expect(pit).not.toBeNull();
          expect(legalAyoMoves(state)).toContain(pit);
          const result = applyAyoMove(state, state.toMove, pit ?? 0);
          if (!result.ok) throw new Error(result.error);
          state = result.state;
          expect(checkAyoInvariants(state)).toEqual([]);
          expect(state.round).toBeLessThanOrEqual(AYO_MAX_ROUNDS);
        }
        expect(state.phase).toBe('finished');
      }
    },
    120_000,
  );

  it('medium beats easy over fixed seeds', () => {
    let wins = 0;
    let games = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      const random = mulberry32(seed * 104729);
      const strong = (seed % 2) as AyoSeat;
      let state = createAyo(0);
      for (let steps = 0; state.phase !== 'finished' && steps < 30_000; steps += 1) {
        if (state.decision !== null) {
          const answered = decideAyo(state, state.decision, false);
          if (!answered.ok) throw new Error(answered.error);
          state = answered.state;
          continue;
        }
        const level: AyoBotLevel = state.toMove === strong ? 'medium' : 'easy';
        const result = applyAyoMove(state, state.toMove, chooseAyoMove(state, level, random) ?? 0);
        if (!result.ok) throw new Error(result.error);
        state = result.state;
      }
      if (state.winner === 'draw') continue;
      games += 1;
      if (state.winner === strong) wins += 1;
    }
    expect(wins / games).toBeGreaterThan(0.55);
  }, 120_000);

  it('the step list of any move only uses known step kinds in a legal order', () => {
    const state = createAyo(0);
    const done = play(state, 3).state;
    const kinds = new Set<AyoStep['k']>(done.last?.steps.map((s) => s.k));
    for (const kind of kinds) expect(['lift', 'drop', 'pack', 'final', 'round']).toContain(kind);
    expect(done.last?.steps[0]?.k).toBe('lift');
  });
});
