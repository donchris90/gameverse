import type { BotLevel, Rng } from './bots.js';
import {
  HOME_POSITION,
  IN_BASE,
  LAST_TRACK_STEP,
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
      // An opponent token that would leave the ring for its home lane first cannot land here.
      if (distance >= 1 && distance <= 6 && p + distance <= LAST_TRACK_STEP) threats += 1;
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

/** Progress of the furthest opponent token this move would capture (0 when it captures nothing). */
function capturedProgress(state: LudoState, seat: LudoSeat, move: LudoMove): number {
  if (move.captures === null) return 0;
  const colour = state.colours[seat] ?? 0;
  const square = trackSquare(colour, move.to);
  if (square === null) return 0;
  const victimColour = state.colours[move.captures] ?? 0;
  let best = 0;
  for (const p of state.tokens[move.captures] ?? []) {
    if (trackSquare(victimColour, p) === square) best = Math.max(best, p + 1);
  }
  return best;
}

/**
 * HARD scoring, ported from the RRYDA Ludo AI: finish a token, capture (the further along the
 * victim the better), bring tokens out, step into the home lane or onto a safe square, run from
 * danger, and avoid ending where opponents can hit. Weights are RRYDA's.
 */
function hardScore(state: LudoState, move: LudoMove): number {
  const seat = state.toMove;
  const colour = state.colours[seat] ?? 0;
  const row = state.tokens[seat] ?? [];
  const outCount = row.filter((p) => p !== IN_BASE && p !== HOME_POSITION).length;
  const { from, to } = move;
  let score = to * 1.5;
  if (move.reachesHome) score += 1000;
  const victim = capturedProgress(state, seat, move);
  if (victim > 0) score += 600 + victim * 4;
  if (move.entersFromBase) score += outCount === 0 ? 400 : outCount === 1 ? 260 : 150;
  if (to >= LAST_TRACK_STEP + 1 && from <= LAST_TRACK_STEP && !move.reachesHome) score += 180;
  const landing = trackSquare(colour, to);
  if (landing !== null && isSafeSquare(landing)) score += 90;

  const value = 60 + to * 3;
  const dangerAfter = move.reachesHome || landing === null ? 0 : threatsTo(state, seat, landing);
  const origin = trackSquare(colour, from);
  const dangerBefore = origin === null ? 0 : threatsTo(state, seat, origin);
  score -= dangerAfter * value;
  score += dangerBefore * value * 0.9;

  // Do not walk a token off a safe square for nothing.
  if (
    origin !== null &&
    isSafeSquare(origin) &&
    !(landing !== null && isSafeSquare(landing)) &&
    landing !== null
  ) {
    score -= 30;
  }
  return score;
}

export function scoreLudoMove(state: LudoState, move: LudoMove, level: BotLevel): number {
  if (level === 'hard') return hardScore(state, move);
  return baseScore(move, state.colours[state.toMove] ?? 0);
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
