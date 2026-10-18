import { describe, expect, it } from 'vitest';
import { RETRY_MAX_ATTEMPTS, reconnectDelayMs, retryDelayMs, shouldRetry } from './retry.js';

describe('retry policy', () => {
  it('retries only 503, and only up to the attempt limit', () => {
    expect(shouldRetry(503, 1)).toBe(true);
    expect(shouldRetry(503, RETRY_MAX_ATTEMPTS - 1)).toBe(true);
    expect(shouldRetry(503, RETRY_MAX_ATTEMPTS)).toBe(false);
    for (const status of [400, 401, 404, 409, 429, 500, 502]) {
      expect(shouldRetry(status, 1), String(status)).toBe(false);
    }
  });

  it('backs off with full jitter and a cap', () => {
    expect(retryDelayMs(1, () => 0)).toBe(0);
    expect(retryDelayMs(1, () => 0.999)).toBe(149);
    expect(retryDelayMs(2, () => 0.999)).toBe(299);
    expect(retryDelayMs(3, () => 0.999)).toBe(599);
    expect(retryDelayMs(10, () => 0.999)).toBe(1198);
  });

  it('spreads reconnects between half and the full backoff, and caps them', () => {
    expect(reconnectDelayMs(1, () => 0)).toBe(1000);
    expect(reconnectDelayMs(1, () => 0.999)).toBe(1999);
    expect(reconnectDelayMs(3, () => 0)).toBe(4000);
    expect(reconnectDelayMs(5, () => 0.999)).toBe(29_985);
    for (const attempt of [1, 2, 3, 4, 5, 9, 50]) {
      const low = reconnectDelayMs(attempt, () => 0);
      const high = reconnectDelayMs(attempt, () => 0.9999);
      expect(high).toBeGreaterThan(low);
      expect(high).toBeLessThanOrEqual(30_000);
    }
  });
});
