import { randomInt } from 'node:crypto';
import type { BotLevelName } from '@gameverse/shared-types';
import {
  TURN_TIMER_MS,
  chooseBotMove,
  createRematch,
  createSeries,
  forfeitSeries,
  playMove,
  seatToMove,
  startNextGame,
  timeoutTurn,
  type Seat,
  type SeriesState,
} from '@gameverse/game-rules';
import type { GameMatch, Prisma } from '../generated/prisma/client.js';
import { botActionId } from './bot-action-id.js';
import type { DriverAction, GameDriver, StartResult } from './game-driver.js';
import { invalidState, seriesError } from './match-errors.js';
import type { AnySeat, Change, EventDraft } from './match-changes.js';
import { NEXT_GAME_DELAY_MS } from './matches.constants.js';
import type { MatchRecord } from './match.view.js';

/** The tic-tac-toe series of a match; null for other games and before the match starts. */
export function seriesOf(match: Pick<GameMatch, 'gameId' | 'state'>): SeriesState | null {
  if (match.gameId !== 'tictactoe' || match.state === null) return null;
  return match.state as unknown as SeriesState;
}

function toJson(series: SeriesState): Prisma.InputJsonValue {
  return series as unknown as Prisma.InputJsonValue;
}

/** Row changes after a series change: next turn clock, the pause between games, or completion. */
function afterSeriesChange(series: SeriesState, events: EventDraft[], now: Date): Change['patch'] {
  const patch: Prisma.GameMatchUncheckedUpdateManyInput = { state: toJson(series) };
  if (series.phase === 'playing') {
    patch.deadlineKind = 'TURN';
    patch.deadlineAt = new Date(now.getTime() + TURN_TIMER_MS);
  } else if (series.phase === 'between_games') {
    patch.deadlineKind = 'NEXT_GAME';
    patch.deadlineAt = new Date(now.getTime() + NEXT_GAME_DELAY_MS);
  } else {
    patch.status = 'COMPLETED';
    patch.deadlineKind = null;
    patch.deadlineAt = null;
    patch.endedAt = now;
    patch.endReason = series.endReason === 'forfeit' ? 'forfeit' : 'score';
    patch.winnerSeat = series.winner === 'draw' || series.winner === null ? null : series.winner;
    events.push({
      type: 'SERIES_ENDED',
      data: { winner: series.winner, reason: series.endReason, wins: [...series.wins] },
    });
  }
  return patch;
}

/** Events for a game that just ended, derived from the new history entries. */
function gameEndedEvents(before: SeriesState, after: SeriesState): EventDraft[] {
  return after.history.slice(before.history.length).map((record) => ({
    type: 'GAME_ENDED',
    data: { gameNumber: record.gameNumber, result: record.result, reason: record.reason },
  }));
}

export const ticTacToeDriver: GameDriver = {
  gameId: 'tictactoe',
  turnTimerMs: TURN_TIMER_MS,
  fixedPlayerCount: 2,

  start(match: MatchRecord, now: Date): StartResult {
    const series = createSeries(match.openingSeat as Seat);
    return {
      state: toJson(series),
      deadlineAt: new Date(now.getTime() + TURN_TIMER_MS),
      events: [{ type: 'GAME_STARTED', data: { gameNumber: 1, firstSeat: series.firstSeat } }],
    };
  },

  act(match, seat, action: DriverAction, clientActionId, now): Change {
    if (action.kind === 'draughts') throw invalidState('This match is played with cells');
    if (action.kind !== 'place') throw invalidState('This match has no dice');
    const before = seriesOf(match);
    if (before === null) throw invalidState('The match is not in progress');
    const moved = playMove(before, seat as Seat, action.cell);
    if (!moved.ok) throw seriesError(moved.error);
    const events: EventDraft[] = [
      { type: 'MOVE', seat, clientActionId, data: { cell: action.cell } },
      ...gameEndedEvents(before, moved.series),
    ];
    return { patch: afterSeriesChange(moved.series, events, now), events };
  },

  leave(match, seat, now, reason): Change | null {
    const before = seriesOf(match);
    if (before === null) return null;
    const forfeited = forfeitSeries(before, seat as Seat);
    if (!forfeited.ok) return null;
    const events: EventDraft[] = [
      { type: reason === 'left' ? 'PLAYER_LEFT' : 'PLAYER_DISCONNECTED', seat },
    ];
    const patch = afterSeriesChange(forfeited.series, events, now);
    patch.endReason = reason;
    return { patch, events };
  },

  deadline(match, now): Change | null {
    const before = seriesOf(match);
    if (match.status !== 'ACTIVE' || before === null) return null;

    if (match.deadlineKind === 'TURN') {
      const seat = seatToMove(before);
      if (seat === null) return null;
      const result = timeoutTurn(before, seat);
      if (!result.ok) return null;
      const events: EventDraft[] = [
        { type: 'TIMEOUT', seat },
        ...gameEndedEvents(before, result.series),
      ];
      return { patch: afterSeriesChange(result.series, events, now), events };
    }

    if (match.deadlineKind === 'NEXT_GAME') {
      const next = startNextGame(before);
      if (!next.ok) return null;
      const events: EventDraft[] = [
        {
          type: 'GAME_STARTED',
          data: { gameNumber: next.series.gameNumber, firstSeat: next.series.firstSeat },
        },
      ];
      return { patch: afterSeriesChange(next.series, events, now), events };
    }
    return null;
  },

  botMove(match, now): Change | null {
    const before = seriesOf(match);
    if (before === null) return null;
    const seat = seatToMove(before);
    if (seat === null) return null;
    const player = match.players.find((candidate) => candidate.seat === seat);
    if (!player || player.userId !== null || player.botLevel === null) return null;

    const level = player.botLevel.toLowerCase() as BotLevelName;
    const cell = chooseBotMove(before.game, level, () => randomInt(0, 2 ** 30) / 2 ** 30);
    const result = playMove(before, seat, cell);
    if (!result.ok) return null; // a bot may never force an illegal move through

    const events: EventDraft[] = [
      { type: 'MOVE', seat, clientActionId: botActionId(match.id, match.version), data: { cell } },
      ...gameEndedEvents(before, result.series),
    ];
    return { patch: afterSeriesChange(result.series, events, now), events };
  },

  rematchOpening(match): AnySeat {
    const series = seriesOf(match);
    return series === null ? 0 : createRematch(series).firstSeat;
  },
};
