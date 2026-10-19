import { HttpStatus, Injectable } from '@nestjs/common';
import { ENTRY_FEE_TIERS, ErrorCode } from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';
import type { Prisma } from '../generated/prisma/client.js';
import { WalletService } from '../wallet/wallet.service.js';
import { ENDED_STATUSES, settlementOf, type SettlementMatch } from './settlement.js';

type Tx = Prisma.TransactionClient;

export { ENDED_STATUSES } from './settlement.js';
export type EntryMatch = SettlementMatch;

/**
 * Entry fees and pots in bonus coins (decision #110). Fees are taken in the same transaction that
 * creates the match, and the pot is paid or the fees returned in the same transaction that ends
 * it, so a match can never exist without its fees or end without settling them. Every payment has
 * a key made from the match (and player), so replaying a settlement changes nothing.
 */
@Injectable()
export class EntryService {
  constructor(private readonly wallet: WalletService) {}

  /** A paid match needs a listed fee, only humans at the table, and the master switch on. */
  async assertAllowed(
    tx: Tx,
    input: { fee: number; kind: string; allHuman: boolean },
  ): Promise<void> {
    if (!(ENTRY_FEE_TIERS as readonly number[]).includes(input.fee)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'That is not an available entry fee',
      );
    }
    if (input.fee === 0) return;
    if (input.kind === 'BOT' || !input.allHuman) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Matches with bots are always free',
      );
    }
    const { paidEntry } = await this.wallet.settings(tx);
    if (paidEntry !== 1) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.PAID_ENTRY_UNAVAILABLE,
        'Matches with an entry fee are switched off right now',
      );
    }
  }

  /** Takes the fee from every human, lowest id first so two tables never wait on each other. */
  async charge(tx: Tx, matchId: string, userIds: readonly string[], fee: number): Promise<void> {
    if (fee <= 0) return;
    for (const userId of [...userIds].sort()) {
      await this.wallet.ensureStarter(tx, userId);
      await this.wallet.move(tx, {
        userId,
        delta: -fee,
        reason: 'ENTRY',
        reference: matchId,
        idempotencyKey: `entry:${matchId}:${userId}`,
      });
    }
  }

  /**
   * Called when a match reaches an ended status. The pot is paid by `settlementOf` (the winner, a
   * Ludo finishing order, or every fee back on a draw, cancel or expiry), always out of what was
   * really collected, and each payment has a key made from the match and the player, so settling
   * twice pays nothing twice.
   */
  async settle(tx: Tx, match: EntryMatch): Promise<void> {
    if (match.entryFee <= 0 || !ENDED_STATUSES.has(match.status)) return;
    const paid = await tx.coinLedger.findMany({
      where: { reference: match.id, reason: 'ENTRY' },
      select: { userId: true, delta: true },
    });
    if (paid.length === 0) return;
    const pot = paid.reduce((sum, row) => sum - row.delta, 0);
    const payers = new Set(paid.map((row) => row.userId));

    let shares = settlementOf(match, pot);
    // Never pay a pot to someone who did not put an entry in: give every fee back instead.
    if (shares.some((share) => share.kind === 'POT' && !payers.has(share.userId))) {
      shares = settlementOf({ ...match, status: 'CANCELLED' }, pot);
    }
    for (const share of [...shares].sort((a, b) => a.userId.localeCompare(b.userId))) {
      const refund = share.kind === 'REFUND';
      await this.wallet.move(tx, {
        userId: share.userId,
        delta: refund ? paidBy(paid, share.userId) : share.amount,
        reason: refund ? 'REFUND' : 'POT',
        reference: match.id,
        idempotencyKey: refund
          ? `refund:${match.id}:${share.userId}`
          : `pot:${match.id}:${share.userId}`,
      });
    }
  }
}

/** What this player actually paid in (a refund returns the real fee, not a recomputed one). */
function paidBy(paid: readonly { userId: string; delta: number }[], userId: string): number {
  return paid.filter((row) => row.userId === userId).reduce((sum, row) => sum - row.delta, 0);
}
