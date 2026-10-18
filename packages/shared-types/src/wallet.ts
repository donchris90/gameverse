import { z } from 'zod';
import { userIdSchema } from './social.js';

/**
 * Bonus coins (decision #110): free play credit for match entry fees and pots. They cannot be
 * bought, withdrawn, sent to another player or exchanged for anything, so there is deliberately
 * no type, route or schema in this file for any of that.
 */

/** Why a ledger row exists. ENTRY, REFUND and POT are written by the match flow (slice 8B). */
export const COIN_REASONS = [
  'STARTER',
  'DAILY',
  'LEVEL_UP',
  'ADMIN_GRANT',
  'ADMIN_REVOKE',
  'ENTRY',
  'REFUND',
  'POT',
] as const;
export type CoinReason = (typeof COIN_REASONS)[number];

/** Amounts the owner can change from the admin. */
export const COIN_SETTING_KEYS = ['starter', 'daily', 'levelUp'] as const;
export type CoinSettingKey = (typeof COIN_SETTING_KEYS)[number];

/** Defaults used until the owner changes them (decision #112). The database holds the live values. */
export const COIN_SETTING_DEFAULTS: Record<CoinSettingKey, number> = {
  starter: 500,
  daily: 50,
  levelUp: 100,
};

/** No setting or single grant may exceed this, so a typo cannot hand out a fortune. */
export const COIN_AMOUNT_MAX = 1_000_000;

export interface CoinLedgerView {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: CoinReason;
  reference: string | null;
  createdAt: string;
}

export interface WalletView {
  balance: number;
  /** Coins the daily check-in pays right now. */
  dailyAmount: number;
  /** True when today's check-in has not been claimed yet. */
  canClaimDaily: boolean;
  /** When the next check-in opens (the start of the next UTC day), or null when it is open now. */
  nextDailyAt: string | null;
  /** Newest first, at most WALLET_HISTORY_LIMIT rows. */
  history: CoinLedgerView[];
}

export const WALLET_HISTORY_LIMIT = 20;

export interface DailyClaimView {
  /** False when today's check-in was already claimed (the balance is unchanged). */
  claimed: boolean;
  amount: number;
  wallet: WalletView;
}

/** Calendar day (UTC) used for the daily check-in, e.g. 2026-10-18. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The start of the next UTC day: when the next daily check-in opens. */
export function nextUtcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

const coinAmount = z.number().int().min(1).max(COIN_AMOUNT_MAX);
const adminReason = z.string().trim().min(3).max(300);

export const adminCoinGrantSchema = z.object({
  /** Positive to grant, negative to take back. Never zero. */
  amount: z
    .number()
    .int()
    .min(-COIN_AMOUNT_MAX)
    .max(COIN_AMOUNT_MAX)
    .refine((n) => n !== 0, 'Amount cannot be zero'),
  reason: adminReason,
  /** Makes the grant safe to retry: the same key never applies twice. */
  idempotencyKey: z.string().trim().min(8).max(100),
});

export const adminCoinSettingsSchema = z
  .object({
    starter: coinAmount.or(z.literal(0)),
    daily: coinAmount.or(z.literal(0)),
    levelUp: coinAmount.or(z.literal(0)),
    reason: adminReason,
  })
  .partial({ starter: true, daily: true, levelUp: true })
  .refine(
    (v) => v.starter !== undefined || v.daily !== undefined || v.levelUp !== undefined,
    'Change at least one amount',
  );

export const coinUserParamSchema = userIdSchema;

export type AdminCoinSettings = Record<CoinSettingKey, number>;
