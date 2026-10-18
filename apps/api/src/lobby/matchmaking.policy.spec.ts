import { describe, expect, it } from 'vitest';
import {
  BAND_GROWTH,
  BAND_START,
  BAND_STEP_MS,
  canPair,
  pickGroup,
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

describe('pickGroup', () => {
  const ids = (group: Waiting[] | null) => group?.map((w) => w.userId) ?? null;

  it('for a pair, chooses exactly the partner pickPartner would', () => {
    const seeker = player('s', 1000);
    const others = [player('a', 1090, 100), player('b', 1040, 200), player('c', 1040, 50)];
    expect(ids(pickGroup(seeker, others, 2, T0))).toEqual([
      pickPartner(seeker, others, T0)?.userId,
    ]);
  });

  it('fills a table of four with the three closest ratings, ties to the longest wait', () => {
    const seeker = player('s', 1000);
    const others = [
      player('far', 1090, 0),
      player('late', 1020, 300),
      player('early', 1020, 100),
      player('near', 1005, 400),
    ];
    expect(ids(pickGroup(seeker, others, 4, T0))).toEqual(['near', 'early', 'late']);
  });

  it('returns null until enough compatible players are waiting', () => {
    const seeker = player('s', 1000);
    expect(pickGroup(seeker, [player('a', 1010), player('b', 1020)], 4, T0)).toBeNull();
    expect(pickGroup(seeker, [], 3, T0)).toBeNull();
  });

  it('never takes someone outside the band, and widens with the wait', () => {
    const seeker = player('s', 1000);
    const far = player('far', 1000 + BAND_START + 1);
    expect(pickGroup(seeker, [far], 2, T0)).toBeNull();
    expect(ids(pickGroup(seeker, [far], 2, at(BAND_STEP_MS)))).toEqual(['far']);
  });

  it('requires every pair at the table to fit, not just each against the seeker', () => {
    const seeker = player('s', 1000);
    // low and high are each within 100 of the seeker but 200 apart from each other.
    const low = player('low', 900);
    const high = player('high', 1100);
    expect(pickGroup(seeker, [low, high], 3, T0)).toBeNull();
    expect(ids(pickGroup(seeker, [low, high], 3, at(BAND_STEP_MS * 2)))).toEqual(['low', 'high']);
  });

  it('skips players who are blocked with the seeker or with someone already chosen', () => {
    const seeker = player('s', 1000);
    const a = player('a', 1001);
    const b = player('b', 1002);
    const c = player('c', 1003);
    const d = player('d', 1004);
    const blocked = (x: string, y: string) =>
      (x === 's' && y === 'a') || (x === 'b' && y === 'c') || (x === 'c' && y === 'b');
    // a is blocked by the seeker; b is taken first so c (blocked with b) is skipped; d fills in.
    expect(ids(pickGroup(seeker, [a, b, c, d], 3, T0, blocked))).toEqual(['b', 'd']);
  });

  it('ignores the seeker if they appear among the candidates', () => {
    const seeker = player('s', 1000);
    expect(ids(pickGroup(seeker, [seeker, player('a', 1000)], 2, T0))).toEqual(['a']);
  });
});
