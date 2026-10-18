import { describe, expect, it } from 'vitest';
import {
  adminCoinGrantSchema,
  adminCoinSettingsSchema,
  COIN_AMOUNT_MAX,
  nextUtcDayStart,
  utcDay,
} from './wallet.js';

describe('daily check-in day', () => {
  it('uses the UTC calendar day', () => {
    expect(utcDay(new Date('2026-10-18T23:59:59.999Z'))).toBe('2026-10-18');
    expect(utcDay(new Date('2026-10-19T00:00:00.000Z'))).toBe('2026-10-19');
  });

  it('opens the next check-in at the next UTC midnight', () => {
    expect(nextUtcDayStart(new Date('2026-10-18T13:00:00Z')).toISOString()).toBe(
      '2026-10-19T00:00:00.000Z',
    );
    expect(nextUtcDayStart(new Date('2026-12-31T23:59:59Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
});

describe('admin coin grant', () => {
  const base = { reason: 'Support goodwill', idempotencyKey: 'ticket-1234' };
  it('accepts a grant and a take-back', () => {
    expect(adminCoinGrantSchema.safeParse({ ...base, amount: 100 }).success).toBe(true);
    expect(adminCoinGrantSchema.safeParse({ ...base, amount: -100 }).success).toBe(true);
  });
  it('refuses zero, fractions, absurd amounts and a missing reason', () => {
    expect(adminCoinGrantSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(adminCoinGrantSchema.safeParse({ ...base, amount: 1.5 }).success).toBe(false);
    expect(adminCoinGrantSchema.safeParse({ ...base, amount: COIN_AMOUNT_MAX + 1 }).success).toBe(
      false,
    );
    expect(adminCoinGrantSchema.safeParse({ ...base, amount: 5, reason: '' }).success).toBe(false);
  });
});

describe('admin coin settings', () => {
  it('needs at least one amount and a reason', () => {
    expect(adminCoinSettingsSchema.safeParse({ reason: 'Tuning' }).success).toBe(false);
    expect(adminCoinSettingsSchema.safeParse({ daily: 75, reason: 'Tuning' }).success).toBe(true);
    expect(adminCoinSettingsSchema.safeParse({ daily: -5, reason: 'Tuning' }).success).toBe(false);
  });
});
