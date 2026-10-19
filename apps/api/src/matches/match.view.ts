import {
  type BotLevelName,
  type PlayerSeat,
  type MatchPlayerView,
  type MatchSeriesView,
  type MatchView,
} from '@gameverse/shared-types';
import { DRAW_REPLAY_LIMIT, seatToMove, type SeriesState } from '@gameverse/game-rules';
import type {
  GameMatch,
  GameMatchPlayer,
  GameResult,
  GameResultPlayer,
} from '../generated/prisma/client.js';
import { BOT_AVATAR_ID, BOT_NAME } from './matches.constants.js';
import { ludoOf, toLudoView } from './ludo-driver.js';
import { settlementOf } from './settlement.js';
import { seriesOf } from './tictactoe.driver.js';
import { draughtsOf, toDraughtsView } from './draughts.driver.js';
import { ayoOf, toAyoView } from './ayo.driver.js';
import { disconnectGraceFor } from './game-driver.js';

export type MatchRecord = GameMatch & {
  players: GameMatchPlayer[];
  /** Present once the match is over and its result was recorded. */
  result?: (GameResult & { players: GameResultPlayer[] }) | null;
};
export type ProfileLookup = ReadonlyMap<string, { username: string; avatarId: string }>;

const BOT_LEVELS: Record<'EASY' | 'MEDIUM' | 'HARD', BotLevelName> = {
  EASY: 'easy',
  MEDIUM: 'medium',
  HARD: 'hard',
};

function toSeriesView(series: SeriesState): MatchSeriesView {
  return {
    bestOf: series.bestOf,
    phase: series.phase,
    gameNumber: series.gameNumber,
    firstSeat: series.firstSeat,
    board: [...series.game.board],
    seatToMove: seatToMove(series),
    winLine: series.game.winLine === null ? null : [...series.game.winLine],
    wins: [series.wins[0], series.wins[1]],
    draws: series.draws,
    drawStreak: series.drawStreak,
    drawLimit: DRAW_REPLAY_LIMIT,
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

function toPlayerView(
  player: GameMatchPlayer,
  profiles: ProfileLookup,
  graceMs: number,
): MatchPlayerView {
  const seat = player.seat as PlayerSeat;
  if (player.userId === null) {
    return {
      seat,
      userId: null,
      bot: player.botLevel === null ? 'easy' : BOT_LEVELS[player.botLevel],
      username: BOT_NAME,
      avatarId: BOT_AVATAR_ID,
      ready: player.ready,
      connected: true,
      reconnectBy: null,
      out: player.outAt !== null,
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
    out: player.outAt !== null,
    connected: player.disconnectedAt === null,
    reconnectBy:
      player.disconnectedAt === null
        ? null
        : new Date(player.disconnectedAt.getTime() + graceMs).toISOString(),
  };
}

/** Bonus coins credited to the viewer when the match ended: their pot share or their refund. */
function payoutFor(match: MatchRecord, viewerSeat: PlayerSeat): number {
  const viewer = match.players.find((player) => player.seat === viewerSeat);
  if (viewer === undefined || viewer.userId === null) return 0;
  return settlementOf(match)
    .filter((share) => share.userId === viewer.userId)
    .reduce((sum, share) => sum + share.amount, 0);
}

/** What `viewerSeat` is allowed to see of a match. Nothing here is secret between the two seats. */
export function toMatchView(
  match: MatchRecord,
  viewerSeat: PlayerSeat,
  profiles: ProfileLookup,
  now: Date,
): MatchView {
  const series = seriesOf(match);
  const mask = match.rematchRequestedMask;
  const requested: PlayerSeat[] = [];
  for (const seat of [0, 1, 2, 3] as const) {
    if ((mask & (1 << seat)) !== 0) requested.push(seat);
  }
  const ludo = ludoOf(match);
  const draughts = draughtsOf(match);
  const ayo = ayoOf(match);
  return {
    id: match.id,
    gameId: match.gameId as MatchView['gameId'],
    kind: match.kind,
    status: match.status,
    version: match.version,
    mySeat: viewerSeat,
    players: [...match.players]
      .sort((a, b) => a.seat - b.seat)
      .map((player) => toPlayerView(player, profiles, disconnectGraceFor(match.gameId))),
    series: series === null ? null : toSeriesView(series),
    ludo: ludo === null ? null : toLudoView(ludo),
    draughts: draughts === null ? null : toDraughtsView(draughts),
    ayo: ayo === null ? null : toAyoView(ayo),
    entryFee: match.entryFee,
    pot: match.entryFee * match.players.filter((player) => player.userId !== null).length,
    payout: payoutFor(match, viewerSeat),
    deadline:
      match.deadlineKind === null || match.deadlineAt === null
        ? null
        : { kind: match.deadlineKind, at: match.deadlineAt.toISOString() },
    serverTime: now.toISOString(),
    endReason: match.endReason,
    winnerSeat: match.winnerSeat === null ? null : (match.winnerSeat as PlayerSeat),
    result:
      match.result === undefined || match.result === null
        ? null
        : {
            ranked: match.result.ratingApplied,
            players: [...match.result.players]
              .sort((a, b) => a.seat - b.seat)
              .map((row) => ({
                seat: row.seat as PlayerSeat,
                userId: row.userId,
                ratingBefore: row.ratingBefore,
                ratingAfter: row.ratingAfter,
                xp: row.xp,
              })),
          },
    rematchRequestedBy: requested,
    rematchMatchId: match.rematchMatchId,
    createdAt: match.createdAt.toISOString(),
    endedAt: match.endedAt === null ? null : match.endedAt.toISOString(),
  };
}
