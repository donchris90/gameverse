import { HttpStatus } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { ErrorCode, type AyoView, type BotLevelName } from '@gameverse/shared-types';
import {
  AYO_TURN_TIMER_MS,
  acceptAyoEnd,
  applyAyoMove,
  chooseAyoMove,
  createAyo,
  declineAyoEnd,
  forfeitAyo,
  legalAyoMoves,
  livePits,
  offerAyoEnd,
  seedsOf,
  timeoutAyo,
  type AyoEvent,
  type AyoResult,
  type AyoSeat,
  type AyoState,
} from '@gameverse/game-rules';
import { AppException } from '../common/app.exception.js';
import type { GameMatch, Prisma } from '../generated/prisma/client.js';
import { botActionId } from './bot-action-id.js';
import type { DriverAction, GameDriver, StartResult } from './game-driver.js';
import type { AnySeat, Change, EventDraft } from './match-changes.js';
import { invalidState } from './match-errors.js';
import type { MatchRecord } from './match.view.js';

export function ayoOf(match: Pick<GameMatch, 'gameId' | 'state'>): AyoState | null {
  if (match.gameId !== 'ayo' || match.state === null) return null;
  return match.state as unknown as AyoState;
}

function toJson(state: AyoState): Prisma.InputJsonValue {
  return state as unknown as Prisma.InputJsonValue;
}

export function toAyoView(state: AyoState): AyoView {
  return {
    phase: state.phase,
    pits: [...state.pits],
    alive: [...state.alive],
    stores: [state.stores[0], state.stores[1]],
    toMove: state.phase === 'finished' ? null : state.toMove,
    round: state.round,
    starter: state.starter,
    moves: legalAyoMoves(state),
    winner: state.winner,
    endReason: state.endReason,
    endOffer: state.endOffer,
    canOfferEnd:
      state.phase === 'playing' && (livePits(state, 0) === 2 || livePits(state, 1) === 2),
    totals: [seedsOf(state, 0), seedsOf(state, 1)],
    plies: state.plies,
    last:
      state.last === null
        ? null
        : {
            seat: state.last.seat,
            pit: state.last.pit,
            steps: state.last.steps.map((step) => ({ ...step })),
          },
    lastRound: state.lastRound === null ? null : { ...state.lastRound },
  };
}

/** Maps rule events to event-log entries. `actionId` marks the human action behind the event. */
function eventDrafts(
  events: readonly AyoEvent[],
  actor?: { seat: AyoSeat; clientActionId: string },
): EventDraft[] {
  // One action id marks one event: the move itself when there is one, otherwise the offer, the
  // answer or the end. (The log is unique per match, seat and action id.)
  const carriesId = !events.some((event) => event.type === 'MOVED');
  return events.map((event): EventDraft => {
    switch (event.type) {
      case 'MOVED': {
        const draft: EventDraft = {
          type: 'MOVE',
          seat: event.seat,
          data: {
            pit: event.pit,
            reaped: event.reaped,
            steps: event.steps,
          } as unknown as Prisma.InputJsonValue,
        };
        if (actor) draft.clientActionId = actor.clientActionId;
        return draft;
      }
      case 'ROUND_ENDED':
        return {
          type: 'ROUND_ENDED',
          data: { round: event.round, winner: event.winner, took: event.took },
        };
      case 'ROUND_STARTED':
        return {
          type: 'ROUND_STARTED',
          data: { round: event.round, starter: event.starter, pits: event.pits },
        };
      case 'END_OFFERED':
      case 'END_DECLINED': {
        const draft: EventDraft = { type: event.type, seat: event.seat };
        if (actor && carriesId && actor.seat === event.seat) {
          draft.clientActionId = actor.clientActionId;
        }
        return draft;
      }
      case 'GAME_ENDED': {
        const draft: EventDraft = {
          type: 'GAME_ENDED',
          data: { winner: event.winner, reason: event.reason },
        };
        if (actor && carriesId) {
          draft.seat = actor.seat;
          draft.clientActionId = actor.clientActionId;
        }
        return draft;
      }
    }
  });
}

/** The row changes that follow a state change: the next turn clock, or completion. */
function afterChange(state: AyoState, now: Date, endReasonOverride?: string): Change['patch'] {
  const patch: Prisma.GameMatchUncheckedUpdateManyInput = { state: toJson(state) };
  if (state.phase === 'playing') {
    patch.deadlineKind = 'TURN';
    patch.deadlineAt = new Date(now.getTime() + AYO_TURN_TIMER_MS);
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
        : state.endReason === 'agreement'
          ? 'agreement'
          : 'score');
  patch.winnerSeat = state.winner === 'draw' || state.winner === null ? null : state.winner;
  return patch;
}

function ayoError(error: string): AppException {
  switch (error) {
    case 'NOT_YOUR_TURN':
      return new AppException(HttpStatus.CONFLICT, ErrorCode.NOT_YOUR_TURN, 'It is not your turn');
    case 'GAME_FINISHED':
      return invalidState('The match is not accepting moves right now');
    case 'END_NOT_ALLOWED':
      return invalidState('The game can only be ended by agreement when a player has two pits');
    case 'NO_OFFER':
      return invalidState('There is no offer to answer');
    case 'OWN_OFFER':
      return invalidState('You cannot answer your own offer');
    default:
      return new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_MOVE,
        'That move is not allowed',
        { reason: error },
      );
  }
}

export const ayoDriver: GameDriver = {
  gameId: 'ayo',
  turnTimerMs: AYO_TURN_TIMER_MS,
  fixedPlayerCount: 2,

  start(match: MatchRecord, now: Date): StartResult {
    const state = createAyo(match.openingSeat as AyoSeat);
    return {
      state: toJson(state),
      deadlineAt: new Date(now.getTime() + AYO_TURN_TIMER_MS),
      events: [{ type: 'GAME_STARTED', data: { firstSeat: state.toMove, round: 1 } }],
    };
  },

  act(match, seat, action: DriverAction, clientActionId, now): Change {
    if (action.kind !== 'ayo' && action.kind !== 'ayo-end') {
      throw invalidState('This match is played with pits');
    }
    const state = ayoOf(match);
    if (state === null) throw invalidState('The match is not in progress');
    const actor = { seat: seat as AyoSeat, clientActionId };

    let result: AyoResult;
    if (action.kind === 'ayo') {
      result = applyAyoMove(state, seat as AyoSeat, action.pit);
    } else {
      const opponent = match.players.find((player) => player.seat !== seat);
      if (action.action === 'offer' && opponent?.userId === null) {
        throw invalidState('A bot does not agree to end a game. Leave the match instead');
      }
      result =
        action.action === 'offer'
          ? offerAyoEnd(state, seat as AyoSeat)
          : action.action === 'accept'
            ? acceptAyoEnd(state, seat as AyoSeat)
            : declineAyoEnd(state, seat as AyoSeat);
    }
    if (!result.ok) throw ayoError(result.error);
    return { patch: afterChange(result.state, now), events: eventDrafts(result.events, actor) };
  },

  leave(match, seat, now, reason): Change | null {
    const state = ayoOf(match);
    if (state === null) return null;
    const result = forfeitAyo(state, seat as AyoSeat);
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
    const state = ayoOf(match);
    if (state === null || match.status !== 'ACTIVE' || match.deadlineKind !== 'TURN') return null;
    const result = timeoutAyo(state);
    if (!result.ok) return null;
    return {
      patch: afterChange(result.state, now),
      events: [{ type: 'TIMEOUT', seat: state.toMove }, ...eventDrafts(result.events)],
    };
  },

  botMove(match, now): Change | null {
    const state = ayoOf(match);
    if (state === null || state.phase !== 'playing') return null;
    const seat = state.toMove;
    const player = match.players.find((candidate) => candidate.seat === seat);
    if (!player || player.userId !== null || player.botLevel === null) return null;
    const level = player.botLevel.toLowerCase() as BotLevelName;
    const pit = chooseAyoMove(state, level, () => randomInt(0, 2 ** 30) / 2 ** 30);
    if (pit === null) return null;
    const result = applyAyoMove(state, seat, pit); // the same validator a human move goes through
    if (!result.ok) return null;
    return {
      patch: afterChange(result.state, now),
      events: eventDrafts(result.events, {
        seat,
        clientActionId: botActionId(match.id, match.version),
      }),
    };
  },

  rematchOpening(match): AnySeat {
    // The other seat opens the rematch, as in tic-tac-toe.
    return (match.openingSeat === 0 ? 1 : 0) as AnySeat;
  },
};
