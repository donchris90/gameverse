import { randomInt } from 'node:crypto';
import type { BotLevelName, DraughtsMoveView, DraughtsView } from '@gameverse/shared-types';
import {
  DRAUGHTS_TURN_TIMER_MS,
  applyDraughtsMove,
  chooseDraughtsMove,
  createDraughts,
  forfeitDraughts,
  legalDraughtsMoves,
  timeoutDraughts,
  type DraughtsEvent,
  type DraughtsMove,
  type DraughtsSeat,
  type DraughtsState,
} from '@gameverse/game-rules';
import type { GameMatch, Prisma } from '../generated/prisma/client.js';
import { botActionId } from './bot-action-id.js';
import type { DriverAction, GameDriver, StartResult } from './game-driver.js';
import type { AnySeat, Change, EventDraft } from './match-changes.js';
import { AppException } from '../common/app.exception.js';
import { invalidState } from './match-errors.js';
import type { MatchRecord } from './match.view.js';
import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@gameverse/shared-types';

export function draughtsOf(match: Pick<GameMatch, 'gameId' | 'state'>): DraughtsState | null {
  if (match.gameId !== 'draughts' || match.state === null) return null;
  return match.state as unknown as DraughtsState;
}

function toJson(state: DraughtsState): Prisma.InputJsonValue {
  return state as unknown as Prisma.InputJsonValue;
}

function moveView(move: DraughtsMove): DraughtsMoveView {
  return { from: move.from, path: [...move.path], captures: [...move.captures] };
}

export function toDraughtsView(state: DraughtsState): DraughtsView {
  return {
    phase: state.phase,
    board: [...state.board],
    toMove: state.phase === 'finished' ? null : state.toMove,
    moves: legalDraughtsMoves(state).map(moveView),
    winner: state.winner,
    endReason: state.endReason,
    plies: state.plies,
    sinceProgress: state.sinceProgress,
    last: state.last === null ? null : moveView(state.last),
  };
}

function eventDrafts(events: readonly DraughtsEvent[], clientActionId?: string): EventDraft[] {
  return events.map((event) => {
    if (event.type === 'MOVED') {
      const { seat, ...rest } = event;
      const draft: EventDraft = {
        type: 'MOVE',
        seat,
        data: { from: rest.from, path: rest.path, captures: rest.captures, crowned: rest.crowned },
      };
      if (clientActionId !== undefined) draft.clientActionId = clientActionId;
      return draft;
    }
    return { type: 'GAME_ENDED', data: { winner: event.winner, reason: event.reason } };
  });
}

/** The row changes that follow a state change: the next turn clock, or completion. */
function afterChange(state: DraughtsState, now: Date, endReasonOverride?: string): Change['patch'] {
  const patch: Prisma.GameMatchUncheckedUpdateManyInput = { state: toJson(state) };
  if (state.phase === 'playing') {
    patch.deadlineKind = 'TURN';
    patch.deadlineAt = new Date(now.getTime() + DRAUGHTS_TURN_TIMER_MS);
    return patch;
  }
  patch.status = 'COMPLETED';
  patch.deadlineKind = null;
  patch.deadlineAt = null;
  patch.endedAt = now;
  patch.endReason =
    endReasonOverride ??
    (state.endReason === 'forfeit'
      ? 'forfeit'
      : state.endReason === 'timeout'
        ? 'timeout'
        : 'score');
  patch.winnerSeat = state.winner === 'draw' || state.winner === null ? null : state.winner;
  return patch;
}

function moveError(error: string): AppException {
  switch (error) {
    case 'NOT_YOUR_TURN':
      return new AppException(HttpStatus.CONFLICT, ErrorCode.NOT_YOUR_TURN, 'It is not your turn');
    case 'GAME_FINISHED':
      return invalidState('The match is not accepting moves right now');
    default:
      return new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_MOVE,
        'That move is not allowed',
        { reason: error },
      );
  }
}

export const draughtsDriver: GameDriver = {
  gameId: 'draughts',
  turnTimerMs: DRAUGHTS_TURN_TIMER_MS,
  fixedPlayerCount: 2,

  start(match: MatchRecord, now: Date): StartResult {
    const state = createDraughts(match.openingSeat as DraughtsSeat);
    return {
      state: toJson(state),
      deadlineAt: new Date(now.getTime() + DRAUGHTS_TURN_TIMER_MS),
      events: [{ type: 'GAME_STARTED', data: { firstSeat: state.toMove } }],
    };
  },

  act(match, seat, action: DriverAction, clientActionId, now): Change {
    if (action.kind !== 'draughts') throw invalidState('This match is played on a board');
    const state = draughtsOf(match);
    if (state === null) throw invalidState('The match is not in progress');
    const result = applyDraughtsMove(state, seat as DraughtsSeat, {
      from: action.from,
      path: action.path,
    });
    if (!result.ok) throw moveError(result.error);
    return {
      patch: afterChange(result.state, now),
      events: eventDrafts(result.events, clientActionId),
    };
  },

  leave(match, seat, now, reason): Change | null {
    const state = draughtsOf(match);
    if (state === null) return null;
    const result = forfeitDraughts(state, seat as DraughtsSeat);
    if (!result.ok) return null;
    return {
      patch: afterChange(result.state, now, reason),
      events: [
        { type: reason === 'left' ? 'PLAYER_LEFT' : 'PLAYER_DISCONNECTED', seat },
        ...eventDrafts(result.events),
      ],
    };
  },

  deadline(match, now): Change | null {
    const state = draughtsOf(match);
    if (state === null || match.status !== 'ACTIVE' || match.deadlineKind !== 'TURN') return null;
    const result = timeoutDraughts(state);
    if (!result.ok) return null;
    return {
      patch: afterChange(result.state, now),
      events: [{ type: 'TIMEOUT', seat: state.toMove }, ...eventDrafts(result.events)],
    };
  },

  botMove(match, now): Change | null {
    const state = draughtsOf(match);
    if (state === null || state.phase !== 'playing') return null;
    const seat = state.toMove;
    const player = match.players.find((candidate) => candidate.seat === seat);
    if (!player || player.userId !== null || player.botLevel === null) return null;
    const level = player.botLevel.toLowerCase() as BotLevelName;
    const move = chooseDraughtsMove(state, level, () => randomInt(0, 2 ** 30) / 2 ** 30);
    if (move === null) return null;
    const result = applyDraughtsMove(state, seat, { from: move.from, path: move.path }); // same validator as a human
    if (!result.ok) return null;
    return {
      patch: afterChange(result.state, now),
      events: eventDrafts(result.events, botActionId(match.id, match.version)),
    };
  },

  rematchOpening(match): AnySeat {
    // The other seat opens the rematch, as in tic-tac-toe.
    return (match.openingSeat === 0 ? 1 : 0) as AnySeat;
  },
};
