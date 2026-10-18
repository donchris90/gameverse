import { Injectable } from '@nestjs/common';
import { levelForXp } from '@gameverse/shared-types';
import { ayoOf } from '../matches/ayo.driver.js';
import { draughtsOf } from '../matches/draughts.driver.js';
import { ludoOf } from '../matches/ludo-driver.js';
import {
  DEFAULT_RATING,
  RATING_FLOOR,
  ratingAfter,
  seriesScore,
  type Seat,
  type SeriesState,
} from '@gameverse/game-rules';
import type { GameMatch, GameMatchPlayer } from '../generated/prisma/client.js';
import type { Tx } from '../social/serializable.js';
import { orderedPair } from '../social/pair.js';
import { WalletService } from '../wallet/wallet.service.js';
import {
  BOT_XP_MATCHES_PER_DAY,
  DAY_MS,
  RATED_PAIR_LIMIT,
  ludoXpFor,
  startOfUtcDay,
  xpFor,
} from './xp.policy.js';

type Completed = GameMatch & { players: GameMatchPlayer[] };

/**
 * Turns a finished match into a result: ratings, statistics and XP. It runs inside the same
 * transaction that completes the match, and the unique `matchId` on the result makes a second
 * attempt a no-op, so nothing is ever applied twice or half-applied.
 */
/**
 * Each two-seat game says how a finished match scored: 1 win, 0.5 draw, 0 loss. Null while the
 * game is not finished, so nothing is recorded early.
 */
function finalScores(match: Completed): ((seat: Seat) => 0 | 0.5 | 1) | null {
  if (match.gameId === 'draughts') {
    const game = draughtsOf(match);
    if (game === null || game.phase !== 'finished' || game.winner === null) return null;
    const winner = game.winner;
    return (seat) => (winner === 'draw' ? 0.5 : winner === seat ? 1 : 0);
  }
  if (match.gameId === 'ayo') {
    const game = ayoOf(match);
    if (game === null || game.phase !== 'finished' || game.winner === null) return null;
    const winner = game.winner;
    return (seat) => (winner === 'draw' ? 0.5 : winner === seat ? 1 : 0);
  }
  const series = match.state as SeriesState | null;
  if (series === null || series.phase !== 'completed') return null;
  return (seat) => seriesScore(series, seat) ?? 0.5;
}

@Injectable()
export class ResultsService {
  constructor(private readonly wallet: WalletService) {}

  async record(tx: Tx, match: Completed): Promise<void> {
    if (match.status !== 'COMPLETED') return;
    if (match.gameId === 'ludo') return this.recordLudo(tx, match);
    const scoreOf = finalScores(match);
    if (scoreOf === null) return;
    if (await tx.gameResult.findUnique({ where: { matchId: match.id }, select: { id: true } })) {
      return;
    }

    const endedAt = match.endedAt ?? new Date();
    const seats = [...match.players].sort((a, b) => a.seat - b.seat);
    const humans = seats.filter((player) => player.userId !== null);
    const ranked = match.kind === 'QUICK' && humans.length === 2;
    const pairKey =
      humans.length === 2
        ? (() => {
            const pair = orderedPair(humans[0]?.userId ?? '', humans[1]?.userId ?? '');
            return `${pair.low}:${pair.high}`;
          })()
        : null;

    let ratingApplied = false;
    if (ranked && pairKey !== null) {
      const recent = await tx.gameResult.count({
        where: {
          pairKey,
          ratingApplied: true,
          endedAt: { gt: new Date(endedAt.getTime() - DAY_MS) },
        },
      });
      ratingApplied = recent < RATED_PAIR_LIMIT;
    }

    // Who walked away? The loser of a series that ended by leaving or by staying disconnected.
    const walkedAway =
      (match.endReason === 'left' || match.endReason === 'disconnected') &&
      match.winnerSeat !== null
        ? ((1 - match.winnerSeat) as Seat)
        : null;

    const before = new Map<string, { rating: number; ratedGames: number }>();
    if (ratingApplied) {
      for (const player of humans) {
        const row = await tx.playerRating.findUnique({
          where: { userId_gameId: { userId: player.userId ?? '', gameId: match.gameId } },
        });
        before.set(player.userId ?? '', {
          rating: row?.rating ?? DEFAULT_RATING,
          ratedGames: row?.ratedGames ?? 0,
        });
      }
    }

    const dayStart = startOfUtcDay(endedAt);
    const rows: {
      seat: Seat;
      userId: string | null;
      score: 0 | 0.5 | 1;
      ratingBefore: number | null;
      ratingAfter: number | null;
      xp: number;
    }[] = [];
    for (const player of seats) {
      const seat = player.seat as Seat;
      const score = scoreOf(seat);
      const userId = player.userId;
      let ratingBefore: number | null = null;
      let ratingNow: number | null = null;
      if (ratingApplied && userId !== null) {
        const own = before.get(userId);
        const other = seats.find((candidate) => candidate.seat !== player.seat);
        const opponent = other?.userId ? before.get(other.userId) : undefined;
        if (own && opponent) {
          ratingBefore = own.rating;
          ratingNow = ratingAfter(own.rating, opponent.rating, score, own.ratedGames);
        }
      }
      let xp = 0;
      if (userId !== null) {
        xp = xpFor(match.kind, score, walkedAway === seat);
        if (xp > 0 && match.kind === 'BOT') {
          const earlier = await tx.gameResultPlayer.count({
            where: {
              userId,
              xp: { gt: 0 },
              result: { kind: 'BOT', endedAt: { gte: dayStart } },
            },
          });
          if (earlier >= BOT_XP_MATCHES_PER_DAY) xp = 0;
        }
      }
      rows.push({ seat, userId, score, ratingBefore, ratingAfter: ratingNow, xp });
    }

    await tx.gameResult.create({
      data: {
        matchId: match.id,
        gameId: match.gameId,
        kind: match.kind,
        ranked,
        ratingApplied,
        pairKey,
        endReason: match.endReason,
        winnerSeat: match.winnerSeat,
        endedAt,
        players: { create: rows },
      },
    });

    for (const row of rows) {
      if (row.userId === null) continue;
      if (row.ratingAfter !== null) {
        const ratedGames = (before.get(row.userId)?.ratedGames ?? 0) + 1;
        await tx.playerRating.upsert({
          where: { userId_gameId: { userId: row.userId, gameId: match.gameId } },
          create: { userId: row.userId, gameId: match.gameId, rating: row.ratingAfter, ratedGames },
          update: { rating: row.ratingAfter, ratedGames },
        });
      }
      if (match.kind !== 'BOT') await this.addStatistics(tx, row.userId, match.gameId, row.score);
      if (row.xp > 0) await this.addExperience(tx, row.userId, row.xp);
    }
  }

  /** Ludo: placings decide everything. Ratings are Elo against each other human, averaged. */
  private async recordLudo(tx: Tx, match: Completed): Promise<void> {
    const game = ludoOf(match);
    if (game === null || game.phase !== 'finished' || game.placings === null) return;
    if (await tx.gameResult.findUnique({ where: { matchId: match.id }, select: { id: true } })) {
      return;
    }
    const placings = game.placings;
    const endedAt = match.endedAt ?? new Date();
    const seats = [...match.players].sort((a, b) => a.seat - b.seat);
    const humans = seats.filter((player) => player.userId !== null);
    const everyoneHuman = humans.length === seats.length;
    const ranked = match.kind === 'QUICK' && everyoneHuman && humans.length >= 2;
    const groupKey = everyoneHuman
      ? humans
          .map((player) => player.userId ?? '')
          .sort()
          .join(':')
      : null;

    let ratingApplied = false;
    if (ranked && groupKey !== null) {
      const recent = await tx.gameResult.count({
        where: {
          pairKey: groupKey,
          ratingApplied: true,
          endedAt: { gt: new Date(endedAt.getTime() - DAY_MS) },
        },
      });
      ratingApplied = recent < RATED_PAIR_LIMIT;
    }

    const before = new Map<string, { rating: number; ratedGames: number }>();
    if (ratingApplied) {
      for (const player of humans) {
        const row = await tx.playerRating.findUnique({
          where: { userId_gameId: { userId: player.userId ?? '', gameId: match.gameId } },
        });
        before.set(player.userId ?? '', {
          rating: row?.rating ?? DEFAULT_RATING,
          ratedGames: row?.ratedGames ?? 0,
        });
      }
    }

    const dayStart = startOfUtcDay(endedAt);
    const count = seats.length;
    const rows: {
      seat: number;
      userId: string | null;
      score: number;
      ratingBefore: number | null;
      ratingAfter: number | null;
      xp: number;
    }[] = [];
    for (const player of seats) {
      const place = placings.indexOf(player.seat as 0 | 1 | 2 | 3);
      const score = count > 1 ? (count - 1 - place) / (count - 1) : 1;
      const userId = player.userId;
      let ratingBefore: number | null = null;
      let ratingNow: number | null = null;
      const own = userId === null ? undefined : before.get(userId);
      if (ratingApplied && userId !== null && own) {
        let total = 0;
        for (const other of humans) {
          if (other.seat === player.seat) continue;
          const opponent = before.get(other.userId ?? '');
          if (!opponent) continue;
          const otherPlace = placings.indexOf(other.seat as 0 | 1 | 2 | 3);
          const result = place < otherPlace ? 1 : 0;
          total += ratingAfter(own.rating, opponent.rating, result, own.ratedGames) - own.rating;
        }
        ratingBefore = own.rating;
        ratingNow = Math.max(RATING_FLOOR, Math.round(own.rating + total / (humans.length - 1)));
      }
      let xp = 0;
      if (userId !== null) {
        const walkedAway = game.removed.includes(player.seat as 0 | 1 | 2 | 3);
        xp = ludoXpFor(match.kind, place, walkedAway);
        if (xp > 0 && match.kind === 'BOT') {
          const earlier = await tx.gameResultPlayer.count({
            where: { userId, xp: { gt: 0 }, result: { kind: 'BOT', endedAt: { gte: dayStart } } },
          });
          if (earlier >= BOT_XP_MATCHES_PER_DAY) xp = 0;
        }
      }
      rows.push({ seat: player.seat, userId, score, ratingBefore, ratingAfter: ratingNow, xp });
    }

    await tx.gameResult.create({
      data: {
        matchId: match.id,
        gameId: match.gameId,
        kind: match.kind,
        ranked,
        ratingApplied,
        pairKey: groupKey,
        endReason: match.endReason,
        winnerSeat: match.winnerSeat,
        endedAt,
        players: { create: rows },
      },
    });

    for (const row of rows) {
      if (row.userId === null) continue;
      if (row.ratingAfter !== null) {
        const ratedGames = (before.get(row.userId)?.ratedGames ?? 0) + 1;
        await tx.playerRating.upsert({
          where: { userId_gameId: { userId: row.userId, gameId: match.gameId } },
          create: { userId: row.userId, gameId: match.gameId, rating: row.ratingAfter, ratedGames },
          update: { rating: row.ratingAfter, ratedGames },
        });
      }
      if (match.kind !== 'BOT') {
        await this.addStatistics(tx, row.userId, match.gameId, row.score === 1 ? 1 : 0);
      }
      if (row.xp > 0) await this.addExperience(tx, row.userId, row.xp);
    }
  }

  /** Adds XP and pays the bonus-coin reward for every level it reaches, in the same transaction. */
  private async addExperience(tx: Tx, userId: string, xp: number): Promise<void> {
    const row = await tx.playerExperience.upsert({
      where: { userId },
      create: { userId, xp },
      update: { xp: { increment: xp } },
    });
    await this.wallet.rewardLevels(tx, userId, levelForXp(row.xp - xp), levelForXp(row.xp));
  }

  private async addStatistics(
    tx: Tx,
    userId: string,
    gameId: string,
    score: 0 | 0.5 | 1,
  ): Promise<void> {
    const current = await tx.playerStatistics.findUnique({
      where: { userId_gameId: { userId, gameId } },
    });
    const winStreak = score === 1 ? (current?.winStreak ?? 0) + 1 : 0;
    const data = {
      played: (current?.played ?? 0) + 1,
      wins: (current?.wins ?? 0) + (score === 1 ? 1 : 0),
      losses: (current?.losses ?? 0) + (score === 0 ? 1 : 0),
      draws: (current?.draws ?? 0) + (score === 0.5 ? 1 : 0),
      winStreak,
      bestWinStreak: Math.max(current?.bestWinStreak ?? 0, winStreak),
    };
    await tx.playerStatistics.upsert({
      where: { userId_gameId: { userId, gameId } },
      create: { userId, gameId, ...data },
      update: data,
    });
  }
}
