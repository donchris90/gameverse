import { COIN_REASONS, type CoinReason, type WalletView } from './wallet.js';

/** Plain words for each ledger reason, for the history list and screen readers. */
export const COIN_REASON_LABELS: Record<CoinReason, string> = {
  STARTER: 'Welcome bonus',
  DAILY: 'Daily check-in',
  LEVEL_UP: 'Level-up reward',
  ADMIN_GRANT: 'Added by support',
  ADMIN_REVOKE: 'Removed by support',
  ENTRY: 'Match entry',
  REFUND: 'Entry refunded',
  POT: 'Match winnings',
};

export function coinReasonLabel(reason: string): string {
  return (COIN_REASONS as readonly string[]).includes(reason)
    ? COIN_REASON_LABELS[reason as CoinReason]
    : 'Bonus coins';
}

export function formatCoins(amount: number): string {
  return Math.trunc(amount).toLocaleString('en-US');
}

export interface CoinBanner {
  /** "550" */
  balanceText: string;
  /** Spoken label, always saying these are free play coins. */
  accessibilityLabel: string;
  /** The check-in button, or null when there is nothing to claim today. */
  claimLabel: string | null;
  /** Small line under the balance. */
  note: string;
}

/** What the Play tab shows for the player's bonus coins. */
export function coinBanner(wallet: WalletView, now: Date = new Date()): CoinBanner {
  const balanceText = formatCoins(wallet.balance);
  const accessibilityLabel = `${balanceText} bonus coins. Free play coins for match entry. They cannot be bought or cashed out.`;
  if (wallet.canClaimDaily) {
    return {
      balanceText,
      accessibilityLabel,
      claimLabel: `Claim ${formatCoins(wallet.dailyAmount)} daily coins`,
      note: 'Free play coins, for match entry only',
    };
  }
  let note = 'Free play coins, for match entry only';
  if (wallet.nextDailyAt !== null) {
    const hours = Math.max(
      1,
      Math.ceil((Date.parse(wallet.nextDailyAt) - now.getTime()) / 3_600_000),
    );
    note = `Next daily coins in about ${String(hours)} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  return { balanceText, accessibilityLabel, claimLabel: null, note };
}
