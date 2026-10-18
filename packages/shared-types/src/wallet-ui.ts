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

/** The parts of a match view the entry line needs. */
export interface EntryMatch {
  entryFee: number;
  pot: number;
  status: string;
  winnerSeat: number | null;
  mySeat: number;
}

/**
 * One line about the money in a match, or null for a free match. Says plainly what the entry was,
 * what is at stake, and how it ended for this player. All amounts are bonus coins.
 */
export function entrySummary(match: EntryMatch): string | null {
  if (match.entryFee <= 0) return null;
  const fee = formatCoins(match.entryFee);
  const pot = formatCoins(match.pot);
  switch (match.status) {
    case 'WAITING':
    case 'READY':
    case 'ACTIVE':
      return `Entry ${fee} bonus coins. Winner takes ${pot}.`;
    case 'COMPLETED':
      if (match.winnerSeat === null) return `Draw. Your ${fee} entry coins were returned.`;
      return match.winnerSeat === match.mySeat
        ? `You won ${pot} bonus coins.`
        : `You lost your ${fee} entry coins.`;
    default:
      return `Match did not start. Your ${fee} entry coins were returned.`;
  }
}
