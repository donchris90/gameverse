import { applyAyoMove, legalAyoMoves, seedsOf, type AyoSeat, type AyoState } from './ayo.js';

export type AyoBotLevel = 'easy' | 'medium' | 'hard';

/** Seeds that are mine (store plus my side) against the opponent's, from `seat`'s point of view. */
function evaluate(state: AyoState, seat: AyoSeat): number {
  const mine = seedsOf(state, seat);
  const theirs = seedsOf(state, seat === 0 ? 1 : 0);
  return (state.stores[seat] - state.stores[seat === 0 ? 1 : 0]) * 3 + (mine - theirs);
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
  if (depth === 0 || budget.nodes <= 0) return evaluate(state, seat);
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

  const seat = state.toMove;
  const depth = level === 'medium' ? 2 : 6;
  const budget = { nodes: level === 'medium' ? 600 : 6_000 };
  let bestScore = -Infinity;
  let best: number[] = [];
  for (const pit of moves) {
    const result = applyAyoMove(state, seat, pit);
    if (!result.ok) continue;
    const score = search(result.state, depth - 1, -Infinity, Infinity, seat, budget);
    if (score > bestScore) {
      bestScore = score;
      best = [pit];
    } else if (score === bestScore) {
      best.push(pit);
    }
  }
  return best.length === 0 ? pick(moves) : pick(best);
}
