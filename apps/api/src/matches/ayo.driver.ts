import { HttpStatus } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import {
  ErrorCode,
  ayoAnimationMs,
  type AyoStepView,
  type AyoView,
  type BotLevelName,
} from '@gameverse/shared-types';
import {
  AYO_DECISION_MS,
  AYO_TURN_TIMER_MS,
  applyAyoMove,
  chooseAyoMove,
  createAyo,
  decideAyo,
  forfeitAyo,
  idleAyo,
  legalAyoMoves,
  seatOnClock,
  type AyoEvent,
  type AyoResult,
  type AyoSeat,
  type AyoState,
  type AyoStep,
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

function stepView(step: AyoStep): AyoStepView {
  return step.k === 'round' ? { ...step, owners: [...step.owners] } : { ...step };
}

export function toAyoView(state: AyoState): AyoView {
  return {
    phase: state.phase,
    pits: [...state.pits],
    owners: [...state.owners],
    packed: [state.packed[0], state.packed[1]],
    toMove: state.phase === 'finished' ? null : state.toMove,
    round: state.round,
    starter: state.starter,
    moves: legalAyoMoves(state),
    decision: state.phase === 'finished' ? null : state.decision,
    winner: state.winner,
    endReason: state.endReason,
    plies: state.plies,
    last:
      state.last === null
        ? null
        : {
            seat: state.last.seat,
            pit: state.last.pit,
            steps: state.last.steps.map(stepView),
            before: {
              pits: [...state.last.before.pits],
              owners: [...state.last.before.owners],
              packed: [state.last.before.packed[0], state.last.before.packed[1]],
            },
            animMs: ayoAnimationMs(state.last.steps.map(stepView)),
          },
    lastRound:
      state.lastRound === null
        ? null
        : {
            round: state.lastRound.round,
            packed: [state.lastRound.packed[0], state.lastRound.packed[1]],
            pits: [state.lastRound.pits[0], state.lastRound.pits[1]],
            finalTo: state.lastRound.finalTo,
          },
  };
}

/** Maps rule events to event-log entries. `actor` marks the human action behind the event. */
function eventDrafts(
  events: readonly AyoEvent[],
  actor?: { seat: AyoSeat; clientActionId: string },
): EventDraft[] {
  // One action id marks one event: the move itself when there is one, otherwise the choice or the
  // end. (The log is unique per match, seat and action id.)
  const carriesId = !events.some((event) => event.type === 'MOVED' || event.type === 'DECIDED');
  return events.map((event): EventDraft => {
    switch (event.type) {
      case 'MOVED': {
        const draft: EventDraft = {
          type: 'MOVE',
          seat: event.seat,
          data: {
            pit: event.pit,
            packed: event.packed,
            steps: event.steps,
          } as unknown as Prisma.InputJsonValue,
        };
        if (actor) draft.clientActionId = actor.clientActionId;
        return draft;
      }
      case 'ROUND_ENDED':
        return {
          type: 'ROUND_ENDED',
          data: { round: event.round, packed: event.packed, finalTo: event.finalTo },
        };
      case 'ROUND_STARTED':
        return {
          type: 'ROUND_STARTED',
          data: { round: event.round, starter: event.starter, pits: event.pits },
        };
      case 'DECISION_REQUIRED':
        return { type: 'DECISION_REQUIRED', seat: event.seat };
      case 'DECIDED': {
        const draft: EventDraft = {
          type: event.quit ? 'QUIT' : 'CONTINUED',
          seat: event.seat,
        };
        if (actor && actor.seat === event.seat) draft.clientActionId = actor.clientActionId;
        return draft;
      }
      case 'AUTO_PLAYED':
        return { type: 'AUTO_PLAYED', seat: event.seat };
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

/**
 * The row changes that follow a state change. The next turn clock starts only after everyone has
 * watched the move (`animMs`), so watching never costs a player time. A choice between quitting
 * and continuing gets longer, unless the player who must choose is a bot.
 */
function afterChange(
  state: AyoState,
  now: Date,
  options: { endReason?: string; botSeats?: readonly number[] } = {},
): Change['patch'] {
  const patch: Prisma.GameMatchUncheckedUpdateManyInput = { state: toJson(state) };
  if (state.phase === 'playing') {
    const animMs = state.last === null ? 0 : ayoAnimationMs(state.last.steps.map(stepView));
    const onClock = seatOnClock(state);
    const clock =
      state.decision !== null && !(options.botSeats ?? []).includes(onClock)
        ? AYO_DECISION_MS
        : AYO_TURN_TIMER_MS;
    patch.deadlineKind = 'TURN';
    patch.deadlineAt = new Date(now.getTime() + animMs + clock);
    return patch;
  }
  patch.status = 'COMPLETED';
  patch.deadlineKind = null;
  patch.deadlineAt = null;
  patch.endedAt = now;
  patch.endReason =
    options.endReason ??
    (state.endReason === 'forfeit'
      ? 'forfeit'
      : state.endReason === 'timeout'
        ? 'timeout'
        : 'score');
  patch.winnerSeat = state.winner === 'draw' || state.winner === null ? null : state.winner;
  return patch;
}

const botSeatsOf = (match: MatchRecord): number[] =>
  match.players.filter((player) => player.userId === null).map((player) => player.seat);

function ayoError(error: string): AppException {
  switch (error) {
    case 'NOT_YOUR_TURN':
      return new AppException(HttpStatus.CONFLICT, ErrorCode.NOT_YOUR_TURN, 'It is not your turn');
    case 'GAME_FINISHED':
      return invalidState('The match is not accepting moves right now');
    case 'DECISION_PENDING':
      return invalidState('A player has to choose to quit or continue first');
    case 'NO_DECISION':
      return invalidState('There is nothing for you to choose');
    default:
      return new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_MOVE,
        'That move is not allowed',
        { reason: error },
      );
  }
}

const randomUnit = (): number => randomInt(0, 2 ** 30) / 2 ** 30;

export const ayoDriver: GameDriver = {
  gameId: 'ayo',
  turnTimerMs: AYO_TURN_TIMER_MS,
  fixedPlayerCount: 2,
  /** RRYDA gives an Ayo player a minute to come back. */
  disconnectGraceMs: 60_000,

  start(match: MatchRecord, now: Date): StartResult {
    const state = createAyo(match.openingSeat as AyoSeat);
    return {
      state: toJson(state),
      deadlineAt: new Date(now.getTime() + AYO_TURN_TIMER_MS),
      events: [{ type: 'GAME_STARTED', data: { firstSeat: state.toMove, round: 1 } }],
    };
  },

  act(match, seat, action: DriverAction, clientActionId, now): Change {
    if (action.kind !== 'ayo' && action.kind !== 'ayo-decision') {
      throw invalidState('This match is played with pits');
    }
    const state = ayoOf(match);
    if (state === null) throw invalidState('The match is not in progress');
    const actor = { seat: seat as AyoSeat, clientActionId };

    const result: AyoResult =
      action.kind === 'ayo'
        ? applyAyoMove(state, seat as AyoSeat, action.pit)
        : decideAyo(state, seat as AyoSeat, action.quit);
    if (!result.ok) throw ayoError(result.error);
    return {
      patch: afterChange(result.state, now, { botSeats: botSeatsOf(match) }),
      events: eventDrafts(result.events, actor),
    };
  },

  leave(match, seat, now, reason): Change | null {
    const state = ayoOf(match);
    if (state === null) return null;
    const result = forfeitAyo(state, seat as AyoSeat);
    if (!result.ok) return null;
    return {
      patch: afterChange(result.state, now, { endReason: reason }),
      events: [
        { type: reason === 'left' ? 'PLAYER_LEFT' : 'PLAYER_DISCONNECTED', seat },
        ...eventDrafts(result.events),
      ],
    };
  },

  /**
   * The clock of the player on turn ran out. The server plays for them (a pit, or "continue" when a
   * choice was waiting). After three turns in a row they forfeit, so the server never plays a whole
   * match for someone who is not there.
   */
  deadline(match, now): Change | null {
    const state = ayoOf(match);
    if (state === null || match.status !== 'ACTIVE' || match.deadlineKind !== 'TURN') return null;
    const result = idleAyo(state, (current) => chooseAyoMove(current, 'medium', randomUnit));
    if (!result.ok) return null;
    const onClock = seatOnClock(state);
    return {
      patch: afterChange(result.state, now, { botSeats: botSeatsOf(match) }),
      events: [{ type: 'TIMEOUT', seat: onClock }, ...eventDrafts(result.events)],
    };
  },

  botMove(match, now): Change | null {
    const state = ayoOf(match);
    if (state === null || state.phase !== 'playing') return null;
    const seat = seatOnClock(state);
    const player = match.players.find((candidate) => candidate.seat === seat);
    if (!player || player.userId !== null || player.botLevel === null) return null;
    const actor = { seat, clientActionId: botActionId(match.id, match.version) };
    let result: AyoResult;
    if (state.decision !== null) {
      result = decideAyo(state, seat, false); // a bot never quits
    } else {
      const level = player.botLevel.toLowerCase() as BotLevelName;
      const pit = chooseAyoMove(state, level, randomUnit);
      if (pit === null) return null;
      result = applyAyoMove(state, seat, pit); // the same validator a human move goes through
    }
    if (!result.ok) return null;
    return {
      patch: afterChange(result.state, now, { botSeats: botSeatsOf(match) }),
      events: eventDrafts(result.events, actor),
    };
  },

  rematchOpening(match): AnySeat {
    // The other seat opens the rematch, as in tic-tac-toe.
    return (match.openingSeat === 0 ? 1 : 0) as AnySeat;
  },
};
