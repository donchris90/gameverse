import type { MatchKind } from '@gameverse/shared-types';

/** XP for finishing a match, by kind and result. Ranked quick matches are worth the most. */
export const XP_TABLE: Record<MatchKind, { win: number; draw: number; loss: number }> = {
  QUICK: { win: 30, draw: 20, loss: 15 },
  PRIVATE: { win: 15, draw: 10, loss: 8 },
  FRIEND: { win: 15, draw: 10, loss: 8 },
  BOT: { win: 5, draw: 5, loss: 5 },
};

/** Bot matches that can earn XP per player per UTC day: practice cannot be farmed for levels. */
export const BOT_XP_MATCHES_PER_DAY = 10;
/** Rated matches one pair of players may have counted for rating in 24 hours. */
export const RATED_PAIR_LIMIT = 3;
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * XP for one seat. A player who walked away (left, or stayed disconnected) and lost earns nothing:
 * quitting must never be the cheapest way to collect XP.
 */
export function xpFor(kind: MatchKind, score: 0 | 0.5 | 1, abandoned: boolean): number {
  if (abandoned) return 0;
  const row = XP_TABLE[kind];
  return score === 1 ? row.win : score === 0.5 ? row.draw : row.loss;
}

/** Ludo XP by finishing place (0 = first) in a quick or friendly game. */
export const LUDO_XP_BY_PLACE: Record<'QUICK' | 'FRIENDLY', readonly number[]> = {
  QUICK: [40, 25, 15, 10],
  FRIENDLY: [20, 12, 8, 5],
};

/** XP for one Ludo seat. Walking away earns nothing; bot games pay a flat practice amount. */
export function ludoXpFor(kind: MatchKind, place: number, abandoned: boolean): number {
  if (abandoned) return 0;
  if (kind === 'BOT') return XP_TABLE.BOT.win;
  const table = kind === 'QUICK' ? LUDO_XP_BY_PLACE.QUICK : LUDO_XP_BY_PLACE.FRIENDLY;
  return table[Math.min(place, table.length - 1)] ?? 0;
}

export function startOfUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}
