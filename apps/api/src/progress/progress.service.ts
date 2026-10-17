import { Injectable } from '@nestjs/common';
import { DEFAULT_RATING } from '@gameverse/game-rules';
import {
  GAME_IDS,
  LEADERBOARD_MIN_RATED_GAMES,
  levelForXp,
  xpForLevel,
  type GameId,
  type GameProgress,
  type LeaderboardQuery,
  type LeaderboardView,
  type MyProgress,
} from '@gameverse/shared-types';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ProgressService {
  constructor(private readonly prisma: PrismaService) {}

  async mine(userId: string): Promise<MyProgress> {
    const [experience, ratings, statistics] = await Promise.all([
      this.prisma.playerExperience.findUnique({ where: { userId } }),
      this.prisma.playerRating.findMany({ where: { userId } }),
      this.prisma.playerStatistics.findMany({ where: { userId } }),
    ]);
    const xp = experience?.xp ?? 0;
    const level = levelForXp(xp);
    const games: GameProgress[] = GAME_IDS.map((gameId) => {
      const rating = ratings.find((row) => row.gameId === gameId);
      const stats = statistics.find((row) => row.gameId === gameId);
      return {
        gameId,
        rating: rating?.rating ?? DEFAULT_RATING,
        ratedGames: rating?.ratedGames ?? 0,
        played: stats?.played ?? 0,
        wins: stats?.wins ?? 0,
        losses: stats?.losses ?? 0,
        draws: stats?.draws ?? 0,
        winStreak: stats?.winStreak ?? 0,
        bestWinStreak: stats?.bestWinStreak ?? 0,
      };
    });
    return {
      xp,
      level,
      levelStartXp: xpForLevel(level),
      nextLevelXp: xpForLevel(level + 1),
      games,
    };
  }

  /**
   * Top players by rating. Only active players with enough rated games appear, people the viewer
   * has blocked (or who blocked the viewer) are left out, and ranks count the list the viewer sees.
   */
  async leaderboard(
    viewerId: string,
    gameId: GameId,
    query: LeaderboardQuery,
  ): Promise<LeaderboardView> {
    const blocks = await this.prisma.blockedUser.findMany({
      where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true },
    });
    const hidden = blocks.map((block) =>
      block.blockerId === viewerId ? block.blockedId : block.blockerId,
    );
    const eligible: Prisma.PlayerRatingWhereInput = {
      gameId,
      ratedGames: { gte: LEADERBOARD_MIN_RATED_GAMES },
      userId: { notIn: hidden },
      user: { status: 'ACTIVE', profile: { isNot: null } },
    };

    const page = await this.prisma.playerRating.findMany({
      where: eligible,
      orderBy: [{ rating: 'desc' }, { ratedGames: 'desc' }, { userId: 'asc' }],
      skip: query.offset,
      take: query.limit + 1,
      include: { user: { select: { profile: { select: { username: true, avatarId: true } } } } },
    });
    const shown = page.slice(0, query.limit);
    const stats = await this.prisma.playerStatistics.findMany({
      where: { gameId, userId: { in: shown.map((row) => row.userId) } },
      select: { userId: true, wins: true },
    });
    const wins = new Map(stats.map((row) => [row.userId, row.wins]));

    const own = await this.prisma.playerRating.findUnique({
      where: { userId_gameId: { userId: viewerId, gameId } },
    });
    const rating = own?.rating ?? DEFAULT_RATING;
    const ratedGames = own?.ratedGames ?? 0;
    let rank: number | null = null;
    if (own && ratedGames >= LEADERBOARD_MIN_RATED_GAMES) {
      const ahead = await this.prisma.playerRating.count({
        where: {
          AND: [
            eligible,
            {
              OR: [
                { rating: { gt: rating } },
                { rating, ratedGames: { gt: ratedGames } },
                { rating, ratedGames, userId: { lt: viewerId } },
              ],
            },
          ],
        },
      });
      rank = ahead + 1;
    }

    return {
      gameId,
      minRatedGames: LEADERBOARD_MIN_RATED_GAMES,
      entries: shown.map((row, index) => ({
        rank: query.offset + index + 1,
        userId: row.userId,
        username: row.user.profile?.username ?? 'Player',
        avatarId: row.user.profile?.avatarId ?? '',
        rating: row.rating,
        ratedGames: row.ratedGames,
        wins: wins.get(row.userId) ?? 0,
      })),
      me: { rank, rating, ratedGames },
      hasMore: page.length > query.limit,
    };
  }
}
