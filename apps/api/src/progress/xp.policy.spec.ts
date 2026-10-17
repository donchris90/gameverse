import { describe, expect, it } from 'vitest';
import { XP_TABLE, startOfUtcDay, xpFor } from './xp.policy.js';

describe('xpFor', () => {
  it('pays more for ranked quick matches and for winning', () => {
    expect(xpFor('QUICK', 1, false)).toBe(30);
    expect(xpFor('QUICK', 0.5, false)).toBe(20);
    expect(xpFor('QUICK', 0, false)).toBe(15);
    expect(xpFor('PRIVATE', 1, false)).toBeLessThan(xpFor('QUICK', 1, false));
    expect(xpFor('BOT', 1, false)).toBeLessThan(xpFor('FRIEND', 0, false) + 1);
  });

  it('pays a player who abandoned nothing', () => {
    for (const kind of Object.keys(XP_TABLE) as (keyof typeof XP_TABLE)[]) {
      expect(xpFor(kind, 0, true)).toBe(0);
    }
  });

  it('never pays a loss more than a draw or a draw more than a win', () => {
    for (const row of Object.values(XP_TABLE)) {
      expect(row.loss).toBeLessThanOrEqual(row.draw);
      expect(row.draw).toBeLessThanOrEqual(row.win);
    }
  });
});

describe('startOfUtcDay', () => {
  it('truncates to midnight UTC', () => {
    expect(startOfUtcDay(new Date('2026-10-18T23:59:59.999Z')).toISOString()).toBe(
      '2026-10-18T00:00:00.000Z',
    );
  });
});
