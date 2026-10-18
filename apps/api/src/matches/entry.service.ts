import { HttpStatus, Injectable } from '@nestjs/common';
import { ENTRY_FEE_TIERS, ErrorCode } from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';
import type { Prisma } from '../generated/prisma/client.js';
import { WalletService } from '../wallet/wallet.service.js';

type Tx = Prisma.TransactionClient;

/** The parts of a match the money needs. */
export interface EntryMatch {
  id: string;
  entryFee: number;
  status: string;
  winnerSeat: number | null;
  players: readonly { seat: number; userId: string | null }[];
}

/** Statuses a match never leaves. Reaching one settles the entry fees, exactly once. */
export const ENDED_STATUSES: ReadonlySet<string> = new Set([
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'ABANDONED',
]);

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
   * Called when a match reaches an ended status. A finished match with a winner pays that player
   * everything that was paid in; a draw, a cancellation or an expiry returns each fee.
   */
  async settle(tx: Tx, match: EntryMatch): Promise<void> {
    if (match.entryFee <= 0 || !ENDED_STATUSES.has(match.status)) return;
    const paid = await tx.coinLedger.findMany({
      where: { reference: match.id, reason: 'ENTRY' },
      select: { userId: true, delta: true },
    });
    if (paid.length === 0) return;

    const winnerId =
      match.status === 'COMPLETED' && match.winnerSeat !== null
        ? (match.players.find((player) => player.seat === match.winnerSeat)?.userId ?? null)
        : null;
    if (winnerId !== null && paid.some((row) => row.userId === winnerId)) {
      const pot = paid.reduce((sum, row) => sum - row.delta, 0);
      await this.wallet.move(tx, {
        userId: winnerId,
        delta: pot,
        reason: 'POT',
        reference: match.id,
        idempotencyKey: `pot:${match.id}`,
      });
      return;
    }
    for (const row of [...paid].sort((a, b) => a.userId.localeCompare(b.userId))) {
      await this.wallet.move(tx, {
        userId: row.userId,
        delta: -row.delta,
        reason: 'REFUND',
        reference: match.id,
        idempotencyKey: `refund:${match.id}:${row.userId}`,
      });
    }
  }
}
