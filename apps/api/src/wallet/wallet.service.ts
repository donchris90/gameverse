import { HttpStatus, Injectable } from '@nestjs/common';
import {
  COIN_SETTING_DEFAULTS,
  COIN_SETTING_KEYS,
  ErrorCode,
  WALLET_HISTORY_LIMIT,
  nextUtcDayStart,
  utcDay,
  type AdminCoinSettings,
  type CoinReason,
  type DailyClaimView,
  type WalletView,
} from '@gameverse/shared-types';
import type { AuthUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import type { Prisma } from '../generated/prisma/client.js';
import { recordAudit } from '../moderation/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Tx = Prisma.TransactionClient;

export interface CoinMovement {
  userId: string;
  /** Positive for coins in, negative for coins out. */
  delta: number;
  reason: CoinReason;
  reference?: string | undefined;
  /** One real-world event, one key. Replaying the key changes nothing. */
  idempotencyKey: string;
}

export interface CoinMoveResult {
  /** False when this key was already applied: nothing changed. */
  applied: boolean;
  balance: number;
}

/**
 * Bonus coins (decision #110). Every change goes through `move`, inside the caller's transaction,
 * so a balance can never change without its ledger row and a match cannot finish without paying.
 * Nothing here can send coins to another player, pay them out or sell them: there is no such path.
 */
@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Adds or removes coins. Locks the player's wallet row for the rest of the transaction, so two
   * debits at once cannot both pass the balance check. A debit larger than the balance is refused.
   */
  async move(tx: Tx, movement: CoinMovement): Promise<CoinMoveResult> {
    const { userId, delta } = movement;
    if (!Number.isInteger(delta) || delta === 0) {
      throw new Error('A coin movement must be a non-zero whole number');
    }
    await tx.$executeRaw`INSERT INTO coin_wallets ("userId") VALUES (${userId}::uuid) ON CONFLICT ("userId") DO NOTHING`;
    const locked = await tx.$queryRaw<{ balance: number }[]>`
      SELECT balance FROM coin_wallets WHERE "userId" = ${userId}::uuid FOR UPDATE`;
    const balance = locked[0]?.balance ?? 0;

    const done = await tx.coinLedger.findUnique({
      where: { idempotencyKey: movement.idempotencyKey },
      select: { userId: true },
    });
    if (done) return { applied: false, balance };

    const next = balance + delta;
    if (next < 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INSUFFICIENT_COINS,
        'Not enough bonus coins',
        { balance, needed: -delta },
      );
    }
    await tx.coinWallet.update({ where: { userId }, data: { balance: next } });
    await tx.coinLedger.create({
      data: {
        userId,
        delta,
        balanceAfter: next,
        reason: movement.reason,
        reference: movement.reference ?? null,
        idempotencyKey: movement.idempotencyKey,
      },
    });
    return { applied: true, balance: next };
  }

  /** Current balance (0 when the player has no wallet yet). */
  async balanceOf(db: Tx | PrismaService, userId: string): Promise<number> {
    const row = await db.coinWallet.findUnique({ where: { userId }, select: { balance: true } });
    return row?.balance ?? 0;
  }

  /**
   * Refuses unless the player can pay `fee` right now. Gives a brand-new player their starter
   * grant first, so someone who has never opened the wallet is not wrongly turned away.
   */
  async assertCanPay(tx: Tx, userId: string, fee: number): Promise<void> {
    await this.ensureStarter(tx, userId);
    const balance = await this.balanceOf(tx, userId);
    if (balance < fee) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INSUFFICIENT_COINS,
        'Not enough bonus coins for this entry fee',
        { balance, needed: fee },
      );
    }
  }

  /** Current earning amounts: the database values, with the shipped defaults for any missing key. */
  async settings(db: Tx | PrismaService = this.prisma): Promise<AdminCoinSettings> {
    const rows = await db.coinSetting.findMany();
    const out: AdminCoinSettings = { ...COIN_SETTING_DEFAULTS };
    for (const row of rows) {
      if ((COIN_SETTING_KEYS as readonly string[]).includes(row.key)) {
        out[row.key as keyof AdminCoinSettings] = row.value;
      }
    }
    return out;
  }

  /** The one-time starter grant. Safe to call any number of times. */
  async ensureStarter(tx: Tx, userId: string): Promise<void> {
    const { starter } = await this.settings(tx);
    if (starter > 0) {
      await this.move(tx, {
        userId,
        delta: starter,
        reason: 'STARTER',
        idempotencyKey: `starter:${userId}`,
      });
    } else {
      await tx.$executeRaw`INSERT INTO coin_wallets ("userId") VALUES (${userId}::uuid) ON CONFLICT ("userId") DO NOTHING`;
    }
  }

  /** Pays the level-up reward for every level between `fromLevel` (exclusive) and `toLevel`. */
  async rewardLevels(tx: Tx, userId: string, fromLevel: number, toLevel: number): Promise<void> {
    if (toLevel <= fromLevel) return;
    const { levelUp } = await this.settings(tx);
    if (levelUp <= 0) return;
    for (let level = fromLevel + 1; level <= toLevel; level += 1) {
      await this.move(tx, {
        userId,
        delta: levelUp,
        reason: 'LEVEL_UP',
        reference: `level:${String(level)}`,
        idempotencyKey: `levelup:${userId}:${String(level)}`,
      });
    }
  }

  async view(userId: string, now: Date = new Date()): Promise<WalletView> {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureStarter(tx, userId);
      return this.buildView(tx, userId, now);
    });
  }

  async claimDaily(userId: string, now: Date = new Date()): Promise<DailyClaimView> {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureStarter(tx, userId);
      const { daily } = await this.settings(tx);
      let claimed = false;
      if (daily > 0) {
        const result = await this.move(tx, {
          userId,
          delta: daily,
          reason: 'DAILY',
          reference: utcDay(now),
          idempotencyKey: `daily:${userId}:${utcDay(now)}`,
        });
        claimed = result.applied;
      }
      return {
        claimed,
        amount: claimed ? daily : 0,
        wallet: await this.buildView(tx, userId, now),
      };
    });
  }

  private async buildView(tx: Tx, userId: string, now: Date): Promise<WalletView> {
    const [wallet, history, settings, today] = await Promise.all([
      tx.coinWallet.findUnique({ where: { userId } }),
      tx.coinLedger.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: WALLET_HISTORY_LIMIT,
      }),
      this.settings(tx),
      tx.coinLedger.findUnique({
        where: { idempotencyKey: `daily:${userId}:${utcDay(now)}` },
        select: { id: true },
      }),
    ]);
    const open = today === null && settings.daily > 0;
    return {
      balance: wallet?.balance ?? 0,
      dailyAmount: settings.daily,
      canClaimDaily: open,
      nextDailyAt: open || settings.daily === 0 ? null : nextUtcDayStart(now).toISOString(),
      history: history.map((row) => ({
        id: row.id,
        delta: row.delta,
        balanceAfter: row.balanceAfter,
        reason: row.reason as CoinReason,
        reference: row.reference,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /** Staff grant or take-back for support. Audited with who, why and the amount, in one transaction. */
  async adminAdjust(
    actor: AuthUser,
    userId: string,
    input: { amount: number; reason: string; idempotencyKey: string },
  ): Promise<WalletView> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
      if (!user || user.status === 'DELETED') {
        throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'User not found');
      }
      await this.ensureStarter(tx, userId);
      const result = await this.move(tx, {
        userId,
        delta: input.amount,
        reason: input.amount > 0 ? 'ADMIN_GRANT' : 'ADMIN_REVOKE',
        reference: `admin:${actor.id}`,
        idempotencyKey: `admin:${userId}:${input.idempotencyKey}`,
      });
      if (result.applied) {
        await recordAudit(tx, {
          actorId: actor.id,
          action: input.amount > 0 ? 'COINS_GRANTED' : 'COINS_REVOKED',
          targetType: 'user',
          targetId: userId,
          metadata: { amount: input.amount, reason: input.reason, balanceAfter: result.balance },
        });
      }
      return this.buildView(tx, userId, new Date());
    });
  }

  async updateSettings(
    actor: AuthUser,
    input: Partial<AdminCoinSettings> & { reason: string },
  ): Promise<AdminCoinSettings> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.settings(tx);
      const changes: Partial<AdminCoinSettings> = {};
      for (const key of COIN_SETTING_KEYS) {
        const value = input[key];
        if (value !== undefined && value !== before[key]) {
          await tx.coinSetting.upsert({
            where: { key },
            create: { key, value },
            update: { value },
          });
          changes[key] = value;
        }
      }
      if (Object.keys(changes).length > 0) {
        await recordAudit(tx, {
          actorId: actor.id,
          action: 'COIN_SETTINGS_CHANGED',
          targetType: 'coin_settings',
          metadata: { before, changes, reason: input.reason },
        });
      }
      return this.settings(tx);
    });
  }
}
