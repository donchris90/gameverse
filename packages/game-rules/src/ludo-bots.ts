import type { BotLevel, Rng } from './bots.js';
import {
  TRACK_LENGTH,
  isSafeSquare,
  legalLudoMoves,
  seatsOf,
  trackSquare,
  type LudoMove,
  type LudoSeat,
  type LudoState,
} from './ludo.js';

/**
 * Ludo bots. They only choose among the legal moves of the current state, so they can never make
 * a move a human could not. The die is never theirs to choose: the server rolls it.
 */

function pick<T>(items: readonly T[], rng: Rng): T {
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
  const item = items[index];
  if (item === undefined) throw new Error('pick() called with an empty list');
  return item;
}

/** How many opponent tokens could land on `square` with a single die roll (1..6). */
function threatsTo(state: LudoState, seat: LudoSeat, square: number): number {
  if (isSafeSquare(square)) return 0;
  let threats = 0;
  for (const other of seatsOf(state)) {
    if (other === seat || state.removed.includes(other) || state.finished.includes(other)) continue;
    const colour = state.colours[other] ?? 0;
    for (const p of state.tokens[other] ?? []) {
      const at = trackSquare(colour, p);
      if (at === null) continue;
      const distance = (square - at + TRACK_LENGTH) % TRACK_LENGTH;
      if (distance >= 1 && distance <= 6) threats += 1;
    }
  }
  return threats;
}

function baseScore(move: LudoMove, colour: number): number {
  let score = move.to; // progress
  if (move.captures !== null) score += 100;
  if (move.reachesHome) score += 90;
  if (move.entersFromBase) score += 70;
  if (move.to >= 52 && !move.reachesHome) score += 40; // safe in the home column
  const square = trackSquare(colour, move.to);
  if (square !== null && isSafeSquare(square)) score += 25;
  return score;
}

export function scoreLudoMove(state: LudoState, move: LudoMove, level: BotLevel): number {
  const seat = state.toMove;
  const colour = state.colours[seat] ?? 0;
  let score = baseScore(move, colour);
  if (level !== 'hard') return score;

  const destination = trackSquare(colour, move.to);
  if (destination !== null) score -= 60 * threatsTo(state, seat, destination);
  // Moving a token that is currently in danger is worth something.
  const origin = trackSquare(colour, move.from);
  if (origin !== null) score += 35 * threatsTo(state, seat, origin);
  return score;
}

/** The token a bot moves. Returns null when there is no legal move. */
export function chooseLudoMove(state: LudoState, level: BotLevel, rng: Rng): number | null {
  const moves = legalLudoMoves(state);
  if (moves.length === 0) return null;
  if (level === 'easy') return pick(moves, rng).token;
  let best = Number.NEGATIVE_INFINITY;
  let chosen: LudoMove[] = [];
  for (const move of moves) {
    const score = scoreLudoMove(state, move, level);
    if (score > best) {
      best = score;
      chosen = [move];
    } else if (score === best) {
      chosen.push(move);
    }
  }
  return pick(chosen, rng).token;
}
