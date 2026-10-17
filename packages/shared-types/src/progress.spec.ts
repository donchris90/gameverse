import { describe, expect, it } from 'vitest';
import { leaderboardQuerySchema, levelForXp, xpForLevel } from './progress.js';

describe('levels', () => {
  it('starts at 1 and follows 50 x (level - 1)^2', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(49)).toBe(1);
    expect(levelForXp(50)).toBe(2);
    expect(levelForXp(199)).toBe(2);
    expect(levelForXp(200)).toBe(3);
    expect(levelForXp(450)).toBe(4);
  });

  it('level boundaries agree with xpForLevel', () => {
    for (let level = 1; level < 30; level += 1) {
      expect(levelForXp(xpForLevel(level))).toBe(level);
      expect(levelForXp(xpForLevel(level + 1) - 1)).toBe(level);
    }
  });

  it('treats negative XP as zero', () => {
    expect(levelForXp(-10)).toBe(1);
  });
});

describe('leaderboardQuerySchema', () => {
  it('applies defaults and coerces query strings', () => {
    expect(leaderboardQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
    expect(leaderboardQuerySchema.parse({ limit: '5', offset: '10' })).toEqual({
      limit: 5,
      offset: 10,
    });
  });

  it('rejects out-of-range values and unknown keys', () => {
    expect(leaderboardQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(leaderboardQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(leaderboardQuerySchema.safeParse({ offset: '-1' }).success).toBe(false);
    expect(leaderboardQuerySchema.safeParse({ sort: 'wins' }).success).toBe(false);
  });
});
