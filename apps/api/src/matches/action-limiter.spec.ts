import { describe, expect, it } from 'vitest';
import { ActionLimiter } from './action-limiter.js';

describe('ActionLimiter', () => {
  it('allows up to the limit inside the window and refuses the next one', () => {
    const limiter = new ActionLimiter(3, 1000);
    expect([0, 1, 2, 3].map((i) => limiter.tryConsume('u', 100 + i))).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it('forgets actions once they leave the window', () => {
    const limiter = new ActionLimiter(2, 1000);
    limiter.tryConsume('u', 0);
    limiter.tryConsume('u', 10);
    expect(limiter.tryConsume('u', 500)).toBe(false);
    expect(limiter.tryConsume('u', 1001)).toBe(true); // the first hit expired, the second has not
    expect(limiter.tryConsume('u', 1002)).toBe(false);
    expect(limiter.tryConsume('u', 1011)).toBe(true);
  });

  it('does not count refused attempts against the user', () => {
    const limiter = new ActionLimiter(1, 1000);
    limiter.tryConsume('u', 0);
    for (let i = 1; i < 50; i += 1) limiter.tryConsume('u', i);
    expect(limiter.tryConsume('u', 1000)).toBe(true);
  });

  it('keeps users independent', () => {
    const limiter = new ActionLimiter(1, 1000);
    expect(limiter.tryConsume('a', 0)).toBe(true);
    expect(limiter.tryConsume('b', 0)).toBe(true);
    expect(limiter.tryConsume('a', 1)).toBe(false);
  });

  it('prune removes idle users only', () => {
    const limiter = new ActionLimiter(5, 1000);
    limiter.tryConsume('idle', 0);
    limiter.tryConsume('busy', 1500);
    limiter.prune(2000);
    expect(limiter.size).toBe(1);
    expect(limiter.tryConsume('busy', 2001)).toBe(true);
  });
});
