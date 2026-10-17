import { describe, expect, it } from 'vitest';
import { calculateAge, checkAgeEligibility, parseIsoDate } from './age.js';

const NOW = new Date('2026-10-17T12:00:00Z');

describe('parseIsoDate', () => {
  it('accepts valid calendar dates', () => {
    expect(parseIsoDate('2000-02-29')).toEqual({ year: 2000, month: 2, day: 29 });
  });

  it.each(['2001-02-29', '2001-13-01', '2001-00-10', '2001-04-31', '01-01-2001', '2001/01/01', ''])(
    'rejects %s',
    (value) => {
      expect(parseIsoDate(value)).toBeNull();
    },
  );
});

describe('calculateAge', () => {
  it('counts whole years and handles the day before and on the birthday', () => {
    expect(calculateAge('2010-10-18', NOW)).toBe(15); // birthday tomorrow
    expect(calculateAge('2010-10-17', NOW)).toBe(16); // birthday today
    expect(calculateAge('2010-10-16', NOW)).toBe(16);
  });

  it('handles leap-day births', () => {
    expect(calculateAge('2008-02-29', new Date('2026-02-28T00:00:00Z'))).toBe(17);
    expect(calculateAge('2008-02-29', new Date('2026-03-01T00:00:00Z'))).toBe(18);
  });

  it('returns null for future or malformed dates', () => {
    expect(calculateAge('2027-01-01', NOW)).toBeNull();
    expect(calculateAge('nope', NOW)).toBeNull();
  });
});

describe('checkAgeEligibility (minimum age 16)', () => {
  it('rejects someone who turns 16 tomorrow', () => {
    expect(checkAgeEligibility('2010-10-18', NOW)).toEqual({ ok: false, reason: 'too_young' });
  });

  it('accepts someone who turns 16 today', () => {
    expect(checkAgeEligibility('2010-10-17', NOW)).toEqual({ ok: true, age: 16 });
  });

  it('rejects implausible ages and invalid dates', () => {
    expect(checkAgeEligibility('1800-01-01', NOW)).toEqual({ ok: false, reason: 'implausible' });
    expect(checkAgeEligibility('2001-02-30', NOW)).toEqual({ ok: false, reason: 'invalid_date' });
    expect(checkAgeEligibility('2099-01-01', NOW)).toEqual({ ok: false, reason: 'invalid_date' });
  });
});
