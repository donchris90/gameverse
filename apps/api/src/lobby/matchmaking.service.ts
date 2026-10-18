import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode, type GameId, type MatchmakingStatus } from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';
import type { MatchQueueEntry } from '../generated/prisma/client.js';
import { OPEN_STATUSES } from '../matches/matches.constants.js';
import { MatchesService } from '../matches/matches.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { runSerializable, type Tx } from '../social/serializable.js';
import {
  DEFAULT_RATING,
  QUEUE_BOT_OFFER_AFTER_MS,
  QUEUE_TTL_MS,
  pickPartner,
  ratingBand,
  type Waiting,
} from './matchmaking.policy.js';

function waiting(entry: MatchQueueEntry): Waiting {
  return { userId: entry.userId, rating: entry.rating, joinedAt: entry.joinedAt };
}

@Injectable()
export class MatchmakingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matches: MatchesService,
  ) {}

  /** Skill rating at the moment the search starts (1000 for a player with no rated games). */
  private async ratingOf(tx: Tx, userId: string, gameId: GameId): Promise<number> {
    const row = await tx.playerRating.findUnique({ where: { userId_gameId: { userId, gameId } } });
    return row?.rating ?? DEFAULT_RATING;
  }

  // ------------------------------------------------------------------ status

  async status(userId: string, now: Date = new Date()): Promise<MatchmakingStatus> {
    const entry = await this.prisma.matchQueueEntry.findUnique({ where: { userId } });
    if (entry !== null && now.getTime() - entry.joinedAt.getTime() < QUEUE_TTL_MS) {
      const waitedMs = Math.max(0, now.getTime() - entry.joinedAt.getTime());
      return {
        state: 'searching',
        searching: {
          gameId: entry.gameId as GameId,
          joinedAt: entry.joinedAt.toISOString(),
          waitedMs,
          ratingBand: ratingBand(waitedMs),
          botOffer: waitedMs >= QUEUE_BOT_OFFER_AFTER_MS,
          expiresAt: new Date(entry.joinedAt.getTime() + QUEUE_TTL_MS).toISOString(),
        },
        match: null,
      };
    }
    const { match } = await this.matches.current(userId);
    // Only a match the queue produced counts as "matched"; a private room match is not a search result.
    if (match !== null && match.kind === 'QUICK')
      return { state: 'matched', searching: null, match };
    return { state: 'idle', searching: null, match: null };
  }

  // -------------------------------------------------------------------- join

  /** Joining twice is harmless: the second call just reports the search already running. */
  async join(userId: string, gameId: GameId, now: Date = new Date()): Promise<MatchmakingStatus> {
    const matchId = await runSerializable(this.prisma, async (tx) => {
      const game = await tx.game.findUnique({ where: { id: gameId } });
      if (!game || !game.enabled) {
        throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Game not found');
      }
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { status: true, profile: { select: { userId: true } } },
      });
      if (!user || user.status !== 'ACTIVE' || !user.profile) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.PROFILE_REQUIRED,
          'Choose a username first',
        );
      }
      const existing = await tx.matchQueueEntry.findUnique({ where: { userId } });
      if (existing !== null) {
        if (existing.gameId !== gameId) {
          throw new AppException(
            HttpStatus.CONFLICT,
            ErrorCode.ALREADY_QUEUED,
            'Cancel your current search first',
          );
        }
        if (now.getTime() - existing.joinedAt.getTime() < QUEUE_TTL_MS) return null;
        // The old search timed out unnoticed; start a fresh one below.
        await tx.matchQueueEntry.delete({ where: { id: existing.id } });
      }
      const open = await tx.gameMatchPlayer.count({
        where: { userId, outAt: null, match: { status: { in: [...OPEN_STATUSES] } } },
      });
      if (open > 0) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.ALREADY_IN_MATCH,
          'Finish or leave your current match first',
        );
      }
      const hosting = await tx.gameRoom.count({
        where: { hostId: userId, status: 'OPEN', expiresAt: { gt: now } },
      });
      if (hosting > 0) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATE,
          'Close your open room before searching for a match',
        );
      }
      const entry = await tx.matchQueueEntry.create({
        data: { userId, gameId, rating: await this.ratingOf(tx, userId, gameId), joinedAt: now },
      });
      return this.tryPair(tx, entry, now);
    });
    if (matchId !== null) await this.matches.publish(matchId);
    return this.status(userId, now);
  }

  async cancel(userId: string, now: Date = new Date()): Promise<MatchmakingStatus> {
    await this.prisma.matchQueueEntry.deleteMany({ where: { userId } });
    return this.status(userId, now);
  }

  // ----------------------------------------------------------------- pairing

  /**
   * Tries to pair `entry` with the best waiting partner. Runs inside the caller's SERIALIZABLE
   * transaction: both entries are removed and the match created in one step, so two simultaneous
   * searches can never both claim the same partner, and nobody ends up in two matches.
   */
  private async tryPair(tx: Tx, entry: MatchQueueEntry, now: Date): Promise<string | null> {
    const others = await tx.matchQueueEntry.findMany({
      where: {
        gameId: entry.gameId,
        userId: { not: entry.userId },
        joinedAt: { gt: new Date(now.getTime() - QUEUE_TTL_MS) },
      },
      orderBy: { joinedAt: 'asc' },
      take: 200,
    });
    if (others.length === 0) return null;

    const otherIds = others.map((other) => other.userId);
    const blocks = await tx.blockedUser.findMany({
      where: {
        OR: [
          { blockerId: entry.userId, blockedId: { in: otherIds } },
          { blockedId: entry.userId, blockerId: { in: otherIds } },
        ],
      },
      select: { blockerId: true, blockedId: true },
    });
    const blocked = new Set(
      blocks.map((block) => (block.blockerId === entry.userId ? block.blockedId : block.blockerId)),
    );
    const busy = await tx.gameMatchPlayer.findMany({
      where: {
        userId: { in: otherIds },
        outAt: null,
        match: { status: { in: [...OPEN_STATUSES] } },
      },
      select: { userId: true },
    });
    const inMatch = new Set(busy.map((row) => row.userId));
    const eligible = others.filter(
      (other) => !blocked.has(other.userId) && !inMatch.has(other.userId),
    );

    const partner = pickPartner(waiting(entry), eligible.map(waiting), now);
    if (partner === null) return null;
    const partnerEntry = eligible.find((other) => other.userId === partner.userId);
    if (!partnerEntry) return null;

    await tx.matchQueueEntry.deleteMany({
      where: { id: { in: [entry.id, partnerEntry.id] } },
    });
    // The player who waited longest sits in seat 0; who opens is a coin flip.
    const [first, second] =
      partnerEntry.joinedAt.getTime() <= entry.joinedAt.getTime()
        ? [partnerEntry, entry]
        : [entry, partnerEntry];
    return this.matches.createMatch(
      {
        gameId: entry.gameId as GameId,
        kind: 'QUICK',
        seats: [{ userId: first.userId }, { userId: second.userId }],
        openingSeat: randomInt(0, 2) === 0 ? 0 : 1,
      },
      tx,
    );
  }

  /**
   * Sweeper step: drops searches that outlived the queue TTL and pairs players whose acceptable
   * rating band has widened enough since they last looked. Returns how many matches were made.
   */
  async runMatchmaking(now: Date = new Date()): Promise<number> {
    await this.prisma.matchQueueEntry.deleteMany({
      where: { joinedAt: { lte: new Date(now.getTime() - QUEUE_TTL_MS) } },
    });
    const entries = await this.prisma.matchQueueEntry.findMany({
      orderBy: { joinedAt: 'asc' },
      take: 200,
    });
    let made = 0;
    for (const candidate of entries) {
      const matchId = await runSerializable(this.prisma, async (tx) => {
        // Re-read inside the transaction: an earlier iteration may already have paired this player.
        const fresh = await tx.matchQueueEntry.findUnique({ where: { id: candidate.id } });
        return fresh === null ? null : this.tryPair(tx, fresh, now);
      });
      if (matchId !== null) {
        made += 1;
        await this.matches.publish(matchId);
      }
    }
    return made;
  }
}
