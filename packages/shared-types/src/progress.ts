import { z } from 'zod';
import { GAME_IDS, type GameId } from './matches.js';

/** Level for a total XP: 1 at 0 XP, 2 at 50, 3 at 200, 4 at 450 (50 x (level - 1)^2). */
export function levelForXp(xp: number): number {
  return 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 50));
}

/** Total XP at which `level` begins. */
export function xpForLevel(level: number): number {
  return 50 * Math.max(0, level - 1) ** 2;
}

/** A player appears on a leaderboard after this many rated games. */
export const LEADERBOARD_MIN_RATED_GAMES = 3;
export const LEADERBOARD_PAGE_MAX = 50;
export const LEADERBOARD_PAGE_DEFAULT = 20;

export interface GameProgress {
  gameId: GameId;
  rating: number;
  ratedGames: number;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  winStreak: number;
  bestWinStreak: number;
}

export interface MyProgress {
  xp: number;
  level: number;
  /** XP at which the current level began and the next one begins. */
  levelStartXp: number;
  nextLevelXp: number;
  games: GameProgress[];
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatarId: string;
  rating: number;
  ratedGames: number;
  wins: number;
}

export interface LeaderboardView {
  gameId: GameId;
  minRatedGames: number;
  entries: LeaderboardEntry[];
  /** The viewer's own place; `rank` is null until they have enough rated games. */
  me: { rank: number | null; rating: number; ratedGames: number } | null;
  hasMore: boolean;
}

export const leaderboardParamSchema = z.enum(GAME_IDS);
export const leaderboardQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(LEADERBOARD_PAGE_MAX)
      .default(LEADERBOARD_PAGE_DEFAULT),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .strict();
export type LeaderboardQuery = z.output<typeof leaderboardQuerySchema>;

/** What a finished match did to each seat. Null rating fields mean the match was not rated. */
export interface MatchResultView {
  ranked: boolean;
  players: {
    seat: 0 | 1 | 2 | 3;
    userId: string | null;
    ratingBefore: number | null;
    ratingAfter: number | null;
    xp: number;
  }[];
}
