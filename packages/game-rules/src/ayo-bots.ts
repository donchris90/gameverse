import { applyAyoMove, legalAyoMoves, sowAyo, type AyoSeat, type AyoState } from './ayo.js';

export type AyoBotLevel = 'easy' | 'medium' | 'hard';

const other = (seat: AyoSeat): AyoSeat => (seat === 0 ? 1 : 0);

/** What a pit would pack for the mover, minus what its sowing hands to the opponent (RRYDA's bot). */
function netGain(state: AyoState, pit: number): number {
  const seat = state.toMove;
  const sow = sowAyo(state.pits, state.owners, seat, pit);
  return sow.packedBy[seat] - sow.packedBy[other(seat)];
}

/**
 * How well `seat` stands: seeds packed this round, plus a share of the seeds on its own side.
 * Pits owned count too, because pits are what the next round is built from.
 */
function evaluate(state: AyoState, seat: AyoSeat): number {
  const them = other(seat);
  let mine = 0;
  let theirs = 0;
  for (let pit = 0; pit < state.pits.length; pit += 1) {
    if (state.owners[pit] === seat) mine += state.pits[pit] ?? 0;
    else theirs += state.pits[pit] ?? 0;
  }
  return (state.packed[seat] - state.packed[them]) * 3 + (mine - theirs);
}

function search(
  state: AyoState,
  depth: number,
  alpha: number,
  beta: number,
  seat: AyoSeat,
  budget: { nodes: number },
): number {
  budget.nodes -= 1;
  if (state.phase === 'finished') {
    if (state.winner === 'draw') return 0;
    return state.winner === seat ? 100_000 + depth : -100_000 - depth;
  }
  if (depth === 0 || budget.nodes <= 0 || state.decision !== null) return evaluate(state, seat);
  const maximizing = state.toMove === seat;
  let best = maximizing ? -Infinity : Infinity;
  for (const pit of legalAyoMoves(state)) {
    const result = applyAyoMove(state, state.toMove, pit);
    if (!result.ok) continue;
    const score = search(result.state, depth - 1, alpha, beta, seat, budget);
    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break;
  }
  return best === Infinity || best === -Infinity ? evaluate(state, seat) : best;
}

/**
 * Picks a pit for the side to move. Every candidate comes from `legalAyoMoves`, so a bot can
 * never play a move a human could not. `random` returns [0, 1) and is injected.
 *  - easy: any pit.
 *  - medium: RRYDA's bot. Three times in four it plays a pit with the best net pack, else any pit.
 *  - hard: looks a few turns ahead and keeps the best.
 */
export function chooseAyoMove(
  state: AyoState,
  level: AyoBotLevel,
  random: () => number,
): number | null {
  const moves = legalAyoMoves(state);
  if (moves.length === 0) return null;
  const pick = (list: readonly number[]): number =>
    list[Math.min(list.length - 1, Math.floor(random() * list.length))] as number;
  if (level === 'easy') return pick(moves);

  if (level === 'medium') {
    const scored = moves.map((pit) => ({ pit, gain: netGain(state, pit) }));
    const best = Math.max(...scored.map((entry) => entry.gain));
    const pool = random() < 0.75 ? scored.filter((entry) => entry.gain === best) : scored;
    return pick(pool.map((entry) => entry.pit));
  }

  const seat = state.toMove;
  const budget = { nodes: 4_000 };
  let bestScore = -Infinity;
  let best: number[] = [];
  for (const pit of moves) {
    const result = applyAyoMove(state, seat, pit);
    if (!result.ok) continue;
    const score = search(result.state, 3, -Infinity, Infinity, seat, budget);
    if (score > bestScore) {
      bestScore = score;
      best = [pit];
    } else if (score === bestScore) {
      best.push(pit);
    }
  }
  return best.length === 0 ? pick(moves) : pick(best);
}
