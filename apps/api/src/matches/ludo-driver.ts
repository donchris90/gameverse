import { randomInt } from 'node:crypto';
import type { LudoEventView, LudoMoveView, LudoView } from '@gameverse/shared-types';
import {
  LUDO_TURN_TIMER_MS,
  legalLudoMoves,
  type LudoEvent,
  type LudoSeat,
  type LudoState,
} from '@gameverse/game-rules';
import type { GameMatch, Prisma } from '../generated/prisma/client.js';
import type { Change, EventDraft } from './match-changes.js';

/** The Ludo state as stored in `game_matches.state`: the game plus what the last change did. */
export type LudoStored = LudoState & { lastEvents: readonly LudoEvent[] };

/** One securely random die. The only source of dice in the system. */
export const rollDie = (): number => randomInt(1, 7);

export function ludoOf(match: Pick<GameMatch, 'gameId' | 'state'>): LudoStored | null {
  if (match.gameId !== 'ludo' || match.state === null) return null;
  return match.state as unknown as LudoStored;
}

export function ludoToJson(
  state: LudoState,
  lastEvents: readonly LudoEvent[],
): Prisma.InputJsonValue {
  return { ...state, lastEvents } as unknown as Prisma.InputJsonValue;
}

/** Stored game state without the animation extras, ready to hand to the rules. */
export function ludoState(stored: LudoStored): LudoState {
  const { lastEvents: _ignored, ...state } = stored;
  return state;
}

/** Maps rule events to event-log entries. `actionId` marks the human action that caused the roll or move. */
export function ludoEventDrafts(
  events: readonly LudoEvent[],
  actionId?: { type: 'ROLLED' | 'MOVED'; seat: LudoSeat; clientActionId: string },
): EventDraft[] {
  return events.map((event) => {
    const { type, seat, ...rest } = event as LudoEvent & { seat?: LudoSeat };
    const draft: EventDraft = { type, data: rest as unknown as Prisma.InputJsonValue };
    if (seat !== undefined) draft.seat = seat;
    if (actionId && type === actionId.type && seat === actionId.seat) {
      draft.clientActionId = actionId.clientActionId;
    }
    return draft;
  });
}

function eventView(event: LudoEvent): LudoEventView {
  const view: LudoEventView = { type: event.type };
  const loose = event as Record<string, unknown>;
  if (typeof loose['seat'] === 'number') view.seat = loose['seat'] as LudoEventView['seat'];
  if (typeof loose['value'] === 'number') view.value = loose['value'];
  if (typeof loose['token'] === 'number') view.token = loose['token'];
  if (typeof loose['from'] === 'number') view.from = loose['from'];
  if (typeof loose['to'] === 'number') view.to = loose['to'];
  if (typeof loose['victim'] === 'number') view.victim = loose['victim'] as LudoEventView['victim'];
  if (typeof loose['place'] === 'number') view.place = loose['place'];
  return view;
}

export function toLudoView(stored: LudoStored): LudoView {
  const state = ludoState(stored);
  const moves: LudoMoveView[] = legalLudoMoves(state).map((move) => ({
    token: move.token,
    from: move.from,
    to: move.to,
    capturesSeat: move.captures,
    entersFromBase: move.entersFromBase,
    reachesHome: move.reachesHome,
  }));
  return {
    phase: state.phase,
    players: state.players,
    colours: [...state.colours],
    tokens: state.tokens.map((row) => [...row]),
    toMove: state.phase === 'finished' ? null : state.toMove,
    roll: state.roll,
    sixes: state.sixes,
    moves,
    finished: [...state.finished],
    removed: [...state.removed],
    placings: state.placings === null ? null : [...state.placings],
    endReason: state.endReason,
    rolls: state.rolls,
    lastEvents: stored.lastEvents.map(eventView),
  };
}

/**
 * The row changes that follow a Ludo state change: new state, the next 20-second turn clock, or
 * completion with the final order. `drafts` is extended with the match-level events.
 */
export function afterLudoChange(
  state: LudoState,
  events: readonly LudoEvent[],
  now: Date,
  endReasonOverride?: string,
): Change['patch'] {
  const patch: Prisma.GameMatchUncheckedUpdateManyInput = { state: ludoToJson(state, events) };
  if (state.phase !== 'finished') {
    patch.deadlineKind = 'TURN';
    patch.deadlineAt = new Date(now.getTime() + LUDO_TURN_TIMER_MS);
    return patch;
  }
  patch.status = 'COMPLETED';
  patch.deadlineKind = null;
  patch.deadlineAt = null;
  patch.endedAt = now;
  patch.endReason = endReasonOverride ?? (state.endReason === 'completed' ? 'score' : 'forfeit');
  patch.winnerSeat = state.placings?.[0] ?? null;
  return patch;
}

/** Seats the given rule events took out of the game. */
export function removedSeats(events: readonly LudoEvent[]): LudoSeat[] {
  return events.flatMap((event) => (event.type === 'SEAT_REMOVED' ? [event.seat] : []));
}
