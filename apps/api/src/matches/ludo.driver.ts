import { randomInt } from 'node:crypto';
import type { BotLevelName } from '@gameverse/shared-types';
import {
  LUDO_TURN_TIMER_MS,
  applyLudoMove,
  applyLudoRoll,
  applyLudoTimeout,
  chooseLudoMove,
  createLudo,
  removeLudoSeat,
  type LudoPlayerCount,
  type LudoSeat,
} from '@gameverse/game-rules';
import { botActionId } from './bot-action-id.js';
import type { DriverAction, GameDriver, StartResult } from './game-driver.js';
import {
  afterLudoChange,
  ludoEventDrafts,
  ludoOf,
  ludoState,
  ludoToJson,
  rollDie,
} from './ludo-driver.js';
import type { AnySeat, Change, EventDraft } from './match-changes.js';
import { departedSeats, invalidState, ludoError } from './match-errors.js';
import type { MatchRecord } from './match.view.js';

export const ludoDriver: GameDriver = {
  gameId: 'ludo',
  turnTimerMs: LUDO_TURN_TIMER_MS,

  start(match: MatchRecord, now: Date): StartResult {
    const players = match.players.length as LudoPlayerCount;
    const game = createLudo(players, match.openingSeat as LudoSeat);
    return {
      state: ludoToJson(game, []),
      deadlineAt: new Date(now.getTime() + LUDO_TURN_TIMER_MS),
      events: [{ type: 'GAME_STARTED', data: { players, openingSeat: game.toMove } }],
    };
  },

  act(match, seat, action: DriverAction, clientActionId, now): Change {
    if (action.kind === 'place' || action.kind === 'draughts')
      throw invalidState('The match is not in progress');
    const stored = ludoOf(match);
    if (stored === null) throw invalidState('This match has no dice');
    const state = ludoState(stored);
    // The server rolls the die; the phone sends no number.
    const result =
      action.kind === 'roll'
        ? applyLudoRoll(state, seat as LudoSeat, rollDie())
        : applyLudoMove(state, seat as LudoSeat, action.token);
    if (!result.ok) throw ludoError(result.error);
    const events = ludoEventDrafts(result.events, {
      type: action.kind === 'roll' ? 'ROLLED' : 'MOVED',
      seat: seat as LudoSeat,
      clientActionId,
    });
    return {
      patch: afterLudoChange(result.state, result.events, now),
      events,
      outSeats: departedSeats(result.events),
    };
  },

  leave(match, seat, now, reason): Change | null {
    const stored = ludoOf(match);
    if (stored === null) return null;
    const removed = removeLudoSeat(ludoState(stored), seat as LudoSeat, 'forfeit');
    if (!removed.ok) return null; // already out of the game: nothing to leave
    const events: EventDraft[] = [
      { type: reason === 'left' ? 'PLAYER_LEFT' : 'PLAYER_DISCONNECTED', seat },
      ...ludoEventDrafts(removed.events),
    ];
    const patch = afterLudoChange(
      removed.state,
      removed.events,
      now,
      removed.state.phase === 'finished' ? reason : undefined,
    );
    return { patch, events, outSeats: departedSeats(removed.events) };
  },

  deadline(match, now): Change | null {
    const stored = ludoOf(match);
    if (stored === null) return null;
    if (match.status !== 'ACTIVE' || match.deadlineKind !== 'TURN') return null;
    const result = applyLudoTimeout(ludoState(stored), rollDie());
    if (!result.ok) return null;
    const events: EventDraft[] = [
      { type: 'TIMEOUT', seat: stored.toMove },
      ...ludoEventDrafts(result.events),
    ];
    return {
      patch: afterLudoChange(result.state, result.events, now),
      events,
      outSeats: departedSeats(result.events),
    };
  },

  botMove(match, now): Change | null {
    const stored = ludoOf(match);
    if (stored === null) return null;
    const seat = stored.toMove;
    const bot = match.players.find((candidate) => candidate.seat === seat);
    if (!bot || bot.userId !== null || bot.botLevel === null) return null;
    const state = ludoState(stored);
    const level = bot.botLevel.toLowerCase() as BotLevelName;
    let result;
    if (state.phase === 'roll') {
      result = applyLudoRoll(state, seat, rollDie());
    } else {
      const token = chooseLudoMove(state, level, () => randomInt(0, 2 ** 30) / 2 ** 30);
      if (token === null) return null;
      result = applyLudoMove(state, seat, token); // the same validator a human move goes through
    }
    if (!result.ok) return null;
    const events = ludoEventDrafts(result.events, {
      type: state.phase === 'roll' ? 'ROLLED' : 'MOVED',
      seat,
      clientActionId: botActionId(match.id, match.version),
    });
    return {
      patch: afterLudoChange(result.state, result.events, now),
      events,
      outSeats: departedSeats(result.events),
    };
  },

  rematchOpening(match, seatCount): AnySeat {
    // Ludo passes the opening turn clockwise.
    return ((match.openingSeat + 1) % seatCount) as AnySeat;
  },
};
