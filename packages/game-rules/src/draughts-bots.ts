import {
  applyDraughtsMove,
  isKing,
  legalDraughtsMoves,
  pieceOwner,
  type DraughtsMove,
  type DraughtsSeat,
  type DraughtsState,
} from './draughts.js';

export type DraughtsBotLevel = 'easy' | 'medium' | 'hard';

/** Material plus a little for advancing men, from `seat`'s point of view. */
function evaluate(state: DraughtsState, seat: DraughtsSeat): number {
  let score = 0;
  for (let square = 0; square < 64; square += 1) {
    const piece = state.board[square] as 0 | 1 | 2 | 3 | 4;
    const owner = pieceOwner(piece);
    if (owner === null) continue;
    const row = Math.floor(square / 8);
    const advance = owner === 0 ? 7 - row : row;
    const value = isKing(piece) ? 160 : 100 + advance * 3;
    score += owner === seat ? value : -value;
  }
  return score;
}

function play(state: DraughtsState, move: DraughtsMove): DraughtsState | null {
  const result = applyDraughtsMove(state, state.toMove, { from: move.from, path: move.path });
  return result.ok ? result.state : null;
}

/** Alpha-beta with a node budget so a turn never takes long. */
function search(
  state: DraughtsState,
  depth: number,
  alpha: number,
  beta: number,
  seat: DraughtsSeat,
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
  for (const move of legalDraughtsMoves(state)) {
    const next = play(state, move);
    if (next === null) continue;
    const score = search(next, depth - 1, alpha, beta, seat, budget);
    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break;
  }
  return best;
}

/**
 * Picks a move for the side to move. Every candidate comes from `legalDraughtsMoves`, so a bot
 * can never play a move a human could not. `random` returns [0, 1) and is injected.
 */
export function chooseDraughtsMove(
  state: DraughtsState,
  level: DraughtsBotLevel,
  random: () => number,
): DraughtsMove | null {
  const moves = legalDraughtsMoves(state);
  if (moves.length === 0) return null;
  const pickRandom = (list: readonly DraughtsMove[]): DraughtsMove =>
    list[Math.min(list.length - 1, Math.floor(random() * list.length))] as DraughtsMove;
  if (level === 'easy') return pickRandom(moves);

  const seat = state.toMove;
  const depth = level === 'medium' ? 2 : 6;
  const budget = { nodes: level === 'medium' ? 2_000 : 30_000 };
  let bestScore = -Infinity;
  let best: DraughtsMove[] = [];
  for (const move of moves) {
    const next = play(state, move);
    if (next === null) continue;
    const score = search(next, depth - 1, -Infinity, Infinity, seat, budget);
    if (score > bestScore) {
      bestScore = score;
      best = [move];
    } else if (score === bestScore) {
      best.push(move);
    }
  }
  return best.length === 0 ? pickRandom(moves) : pickRandom(best);
}
