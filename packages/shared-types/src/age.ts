import { MAX_AGE_YEARS, MIN_AGE_YEARS } from './constants.js';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface ParsedDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

/**
 * Parses a strict YYYY-MM-DD calendar date. Returns null for malformed or impossible dates
 * (e.g. 2001-02-30). No timezone is involved: a date of birth is a calendar date.
 */
export function parseIsoDate(value: string): ParsedDate | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/**
 * Whole years elapsed between a date of birth and `now`, using the UTC calendar date of `now`.
 * Returns null when the date of birth is malformed or lies in the future.
 */
export function calculateAge(dateOfBirth: string, now: Date = new Date()): number | null {
  const dob = parseIsoDate(dateOfBirth);
  if (!dob) return null;
  const nowYear = now.getUTCFullYear();
  const nowMonth = now.getUTCMonth() + 1;
  const nowDay = now.getUTCDate();

  let age = nowYear - dob.year;
  if (nowMonth < dob.month || (nowMonth === dob.month && nowDay < dob.day)) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

export type AgeCheck =
  { ok: true; age: number } | { ok: false; reason: 'invalid_date' | 'too_young' | 'implausible' };

/** Server and client share this check; the server's result is the only one that counts. */
export function checkAgeEligibility(dateOfBirth: string, now: Date = new Date()): AgeCheck {
  const age = calculateAge(dateOfBirth, now);
  if (age === null) return { ok: false, reason: 'invalid_date' };
  if (age > MAX_AGE_YEARS) return { ok: false, reason: 'implausible' };
  if (age < MIN_AGE_YEARS) return { ok: false, reason: 'too_young' };
  return { ok: true, age };
}
