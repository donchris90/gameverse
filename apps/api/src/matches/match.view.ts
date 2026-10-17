import type {
  BotLevelName,
  MatchPlayerView,
  MatchSeriesView,
  MatchView,
} from '@gameverse/shared-types';
import { seatToMove, type SeriesState } from '@gameverse/game-rules';
import type { GameMatch, GameMatchPlayer } from '../generated/prisma/client.js';
import { BOT_AVATAR_ID, BOT_NAME } from './matches.constants.js';

export type MatchRecord = GameMatch & { players: GameMatchPlayer[] };
export type ProfileLookup = ReadonlyMap<string, { username: string; avatarId: string }>;

const BOT_LEVELS: Record<'EASY' | 'MEDIUM' | 'HARD', BotLevelName> = {
  EASY: 'easy',
  MEDIUM: 'medium',
  HARD: 'hard',
};

export function seriesOf(match: GameMatch): SeriesState | null {
  return match.state === null ? null : (match.state as unknown as SeriesState);
}

function toSeriesView(series: SeriesState): MatchSeriesView {
  return {
    phase: series.phase,
    gameNumber: series.gameNumber,
    firstSeat: series.firstSeat,
    board: [...series.game.board],
    seatToMove: seatToMove(series),
    winLine: series.game.winLine === null ? null : [...series.game.winLine],
    wins: [series.wins[0], series.wins[1]],
    draws: series.draws,
    history: series.history.map((record) => ({
      gameNumber: record.gameNumber,
      firstSeat: record.firstSeat,
      result: record.result,
      reason: record.reason,
    })),
    winner: series.winner,
    endReason: series.endReason,
  };
}

function toPlayerView(player: GameMatchPlayer, profiles: ProfileLookup): MatchPlayerView {
  const seat = player.seat as 0 | 1;
  if (player.userId === null) {
    return {
      seat,
      userId: null,
      bot: player.botLevel === null ? 'easy' : BOT_LEVELS[player.botLevel],
      username: BOT_NAME,
      avatarId: BOT_AVATAR_ID,
      ready: player.ready,
    };
  }
  const profile = profiles.get(player.userId);
  return {
    seat,
    userId: player.userId,
    bot: null,
    username: profile?.username ?? 'Player',
    avatarId: profile?.avatarId ?? 'avatar-01',
    ready: player.ready,
  };
}

/** What `viewerSeat` is allowed to see of a match. Nothing here is secret between the two seats. */
export function toMatchView(
  match: MatchRecord,
  viewerSeat: 0 | 1,
  profiles: ProfileLookup,
  now: Date,
): MatchView {
  const series = seriesOf(match);
  const mask = match.rematchRequestedMask;
  const requested: (0 | 1)[] = [];
  if ((mask & 1) !== 0) requested.push(0);
  if ((mask & 2) !== 0) requested.push(1);
  return {
    id: match.id,
    gameId: match.gameId as MatchView['gameId'],
    kind: match.kind,
    status: match.status,
    version: match.version,
    mySeat: viewerSeat,
    players: [...match.players]
      .sort((a, b) => a.seat - b.seat)
      .map((player) => toPlayerView(player, profiles)),
    series: series === null ? null : toSeriesView(series),
    deadline:
      match.deadlineKind === null || match.deadlineAt === null
        ? null
        : { kind: match.deadlineKind, at: match.deadlineAt.toISOString() },
    serverTime: now.toISOString(),
    endReason: match.endReason,
    winnerSeat: match.winnerSeat === null ? null : (match.winnerSeat as 0 | 1),
    rematchRequestedBy: requested,
    rematchMatchId: match.rematchMatchId,
    createdAt: match.createdAt.toISOString(),
    endedAt: match.endedAt === null ? null : match.endedAt.toISOString(),
  };
}
