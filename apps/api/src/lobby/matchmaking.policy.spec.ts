import { describe, expect, it } from 'vitest';
import {
  BAND_GROWTH,
  BAND_START,
  BAND_STEP_MS,
  canPair,
  pickPartner,
  ratingBand,
  type Waiting,
} from './matchmaking.policy.js';

const T0 = new Date('2026-10-18T12:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const player = (userId: string, rating: number, joinedAtMs = 0): Waiting => ({
  userId,
  rating,
  joinedAt: at(joinedAtMs),
});

describe('ratingBand', () => {
  it('starts narrow and widens one step at a time', () => {
    expect(ratingBand(0)).toBe(BAND_START);
    expect(ratingBand(BAND_STEP_MS - 1)).toBe(BAND_START);
    expect(ratingBand(BAND_STEP_MS)).toBe(BAND_START + BAND_GROWTH);
    expect(ratingBand(4 * BAND_STEP_MS + 10)).toBe(BAND_START + 4 * BAND_GROWTH);
  });

  it('treats a negative wait (clock skew) as no wait', () => {
    expect(ratingBand(-5_000)).toBe(BAND_START);
  });
});

describe('canPair', () => {
  it('accepts a gap exactly equal to the band and refuses one point more', () => {
    expect(canPair(player('a', 1000), player('b', 1100), at(0))).toBe(true);
    expect(canPair(player('a', 1000), player('b', 1101), at(0))).toBe(false);
  });

  it('is symmetric', () => {
    const a = player('a', 1000);
    const b = player('b', 1090, 3_000);
    expect(canPair(a, b, at(3_000))).toBe(canPair(b, a, at(3_000)));
  });

  it('uses the wider band, so a long waiter is not held back by a newcomer', () => {
    const veteran = player('old', 1000, 0);
    const newcomer = player('new', 1400, 30_000);
    expect(canPair(veteran, newcomer, at(30_000))).toBe(true); // veteran band is 400
    expect(canPair(veteran, newcomer, at(29_999))).toBe(false); // 350
  });

  it('never pairs a player with themselves', () => {
    expect(canPair(player('a', 1000), player('a', 1000), at(0))).toBe(false);
  });
});

describe('pickPartner', () => {
  it('chooses the closest rating', () => {
    const seeker = player('s', 1000);
    const best = pickPartner(
      seeker,
      [player('x', 1090), player('y', 1020), player('z', 950)],
      at(0),
    );
    expect(best?.userId).toBe('y');
  });

  it('breaks ties in favour of whoever waited longest', () => {
    const seeker = player('s', 1000);
    const best = pickPartner(
      seeker,
      [player('late', 1040, 2_000), player('early', 960, 0)],
      at(2_000),
    );
    expect(best?.userId).toBe('early');
  });

  it('returns null when nobody fits', () => {
    expect(pickPartner(player('s', 1000), [player('far', 1500)], at(0))).toBeNull();
    expect(pickPartner(player('s', 1000), [], at(0))).toBeNull();
  });
});
