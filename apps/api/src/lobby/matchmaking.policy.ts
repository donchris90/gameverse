import { DEFAULT_RATING } from '@gameverse/game-rules';
import { QUEUE_BOT_OFFER_AFTER_MS, QUEUE_TTL_MS } from '@gameverse/shared-types';

/** Rating difference accepted at the start of a search. */
export const BAND_START = 100;
/** The band grows by this much every BAND_STEP_MS of waiting. */
export const BAND_GROWTH = 50;
export const BAND_STEP_MS = 5_000;

export { DEFAULT_RATING, QUEUE_BOT_OFFER_AFTER_MS, QUEUE_TTL_MS };

/** How far apart two ratings may be for a player who has waited `waitedMs`. */
export function ratingBand(waitedMs: number): number {
  const steps = Math.floor(Math.max(0, waitedMs) / BAND_STEP_MS);
  return BAND_START + steps * BAND_GROWTH;
}

export interface Waiting {
  userId: string;
  rating: number;
  joinedAt: Date;
}

/**
 * Two waiting players may be paired when their rating gap fits inside the wider of their two bands:
 * a player who has waited a long time is not held back by a newcomer's narrow band.
 */
export function canPair(a: Waiting, b: Waiting, now: Date): boolean {
  if (a.userId === b.userId) return false;
  const band = Math.max(
    ratingBand(now.getTime() - a.joinedAt.getTime()),
    ratingBand(now.getTime() - b.joinedAt.getTime()),
  );
  return Math.abs(a.rating - b.rating) <= band;
}

/** Among candidates, the best partner is the closest in rating; ties go to whoever waited longest. */
export function pickPartner(
  seeker: Waiting,
  candidates: readonly Waiting[],
  now: Date,
): Waiting | null {
  let best: Waiting | null = null;
  for (const candidate of candidates) {
    if (!canPair(seeker, candidate, now)) continue;
    if (best === null) {
      best = candidate;
      continue;
    }
    const gap = Math.abs(candidate.rating - seeker.rating);
    const bestGap = Math.abs(best.rating - seeker.rating);
    if (
      gap < bestGap ||
      (gap === bestGap && candidate.joinedAt.getTime() < best.joinedAt.getTime())
    ) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Picks `size - 1` partners for `seeker` to make a group of `size`. Candidates are tried closest
 * in rating first (ties: longest wait). Each one must fit the seeker's band and every player
 * already chosen, and must not be blocked with any of them (`conflicts`). Returns null when no
 * such group exists yet. For size 2 this is exactly `pickPartner`.
 */
export function pickGroup(
  seeker: Waiting,
  candidates: readonly Waiting[],
  size: number,
  now: Date,
  conflicts: (a: string, b: string) => boolean = () => false,
): Waiting[] | null {
  const ordered = [...candidates]
    .filter((candidate) => candidate.userId !== seeker.userId)
    .sort((a, b) => {
      const gapA = Math.abs(a.rating - seeker.rating);
      const gapB = Math.abs(b.rating - seeker.rating);
      return gapA - gapB || a.joinedAt.getTime() - b.joinedAt.getTime();
    });
  const chosen: Waiting[] = [];
  for (const candidate of ordered) {
    const group = [seeker, ...chosen];
    const fits = group.every(
      (member) => canPair(member, candidate, now) && !conflicts(member.userId, candidate.userId),
    );
    if (!fits) continue;
    chosen.push(candidate);
    if (chosen.length === size - 1) return chosen;
  }
  return null;
}
