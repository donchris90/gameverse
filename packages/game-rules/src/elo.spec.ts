import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RATING,
  K_ESTABLISHED,
  K_PROVISIONAL,
  PROVISIONAL_GAMES,
  RATING_FLOOR,
  expectedScore,
  kFactor,
  ratingAfter,
} from './elo.js';

describe('expectedScore', () => {
  it('is 0.5 between equals and symmetric around it', () => {
    expect(expectedScore(1000, 1000)).toBe(0.5);
    expect(expectedScore(1200, 1000) + expectedScore(1000, 1200)).toBeCloseTo(1, 12);
  });

  it('is about 0.76 for a 200 point favourite and 0.91 for 400', () => {
    expect(expectedScore(1200, 1000)).toBeCloseTo(0.7597, 3);
    expect(expectedScore(1400, 1000)).toBeCloseTo(0.9091, 3);
  });
});

describe('kFactor', () => {
  it('is larger for new players and drops at the threshold', () => {
    expect(kFactor(0)).toBe(K_PROVISIONAL);
    expect(kFactor(PROVISIONAL_GAMES - 1)).toBe(K_PROVISIONAL);
    expect(kFactor(PROVISIONAL_GAMES)).toBe(K_ESTABLISHED);
  });
});

describe('ratingAfter', () => {
  it('moves equals by half of K', () => {
    expect(ratingAfter(DEFAULT_RATING, DEFAULT_RATING, 1, 0)).toBe(1016);
    expect(ratingAfter(DEFAULT_RATING, DEFAULT_RATING, 0, 0)).toBe(984);
    expect(ratingAfter(DEFAULT_RATING, DEFAULT_RATING, 0.5, 0)).toBe(1000);
  });

  it('rewards an upset more than an expected win', () => {
    const upset = ratingAfter(1000, 1400, 1, 10) - 1000;
    const expected = ratingAfter(1400, 1000, 1, 10) - 1400;
    expect(upset).toBeGreaterThan(expected);
    expect(upset).toBe(29);
    expect(expected).toBe(3);
  });

  it('a draw between unequal players favours the lower rated one', () => {
    expect(ratingAfter(1000, 1200, 0.5, 0)).toBeGreaterThan(1000);
    expect(ratingAfter(1200, 1000, 0.5, 0)).toBeLessThan(1200);
  });

  it('moves established players less', () => {
    const fresh = ratingAfter(1000, 1000, 1, 0) - 1000;
    const veteran = ratingAfter(1000, 1000, 1, 100) - 1000;
    expect(veteran).toBe(fresh / 2);
  });

  it('never falls below the floor', () => {
    expect(ratingAfter(RATING_FLOOR, 1500, 0, 0)).toBe(RATING_FLOOR);
    expect(ratingAfter(RATING_FLOOR + 5, RATING_FLOOR + 5, 0, 0)).toBe(RATING_FLOOR); // would be 89
  });

  it('is roughly zero-sum between two equally experienced players', () => {
    for (const [a, b] of [
      [1000, 1000],
      [1300, 900],
      [750, 1100],
    ] as const) {
      for (const score of [0, 0.5, 1] as const) {
        const da = ratingAfter(a, b, score, 5) - a;
        const db = ratingAfter(b, a, (1 - score) as 0 | 0.5 | 1, 5) - b;
        expect(Math.abs(da + db)).toBeLessThanOrEqual(1);
      }
    }
  });
});
