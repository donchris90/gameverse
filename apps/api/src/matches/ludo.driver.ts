import { randomInt } from 'node:crypto';
import type { BotLevelName } from '@gameverse/shared-types';
import {
  LUDO_TURN_TIMER_MS,
  applyLudoCoverStep,
  applyLudoMove,
  applyLudoRoll,
  applyLudoTimeout,
  chooseLudoMove,
  createLudo,
  isAiCovered,
  removeLudoSeat,
  startLudoAiCover,
  takeBackLudoSeat,
  type LudoPlayerCount,
  type LudoSeat,
  type LudoState,
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

/** The AI plays an absent human's seat at the strongest level, with the server's own randomness. */
const coverChooser = (state: LudoState): number | null =>
  chooseLudoMove(state, 'hard', () => randomInt(0, 2 ** 30) / 2 ** 30);

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
    if (action.kind !== 'roll' && action.kind !== 'token' && action.kind !== 'resume')
      throw invalidState('The match is not in progress');
    const stored = ludoOf(match);
    if (stored === null) throw invalidState('This match has no dice');
    const state = ludoState(stored);

    if (action.kind === 'resume') {
      // The player asks for the seat back: the AI stops, their clock restarts.
      if (!isAiCovered(state, seat as LudoSeat)) throw ludoError('NOT_COVERED');
      const back = takeBackLudoSeat(state, seat as LudoSeat);
      // The first event carries the action id, so a retried request is acknowledged, not repeated.
      const events = ludoEventDrafts(back.events);
      if (events[0] !== undefined) events[0].clientActionId = clientActionId;
      return { patch: afterLudoChange(back.state, back.events, now), events };
    }

    // The server rolls the die; the phone sends no number.
    const result =
      action.kind === 'roll'
        ? applyLudoRoll(state, seat as LudoSeat, rollDie())
        : applyLudoMove(state, seat as LudoSeat, action.token);
    if (!result.ok) throw ludoError(result.error);
    // Acting yourself ends any AI cover of your seat.
    const back = takeBackLudoSeat(result.state, seat as LudoSeat);
    const events = ludoEventDrafts([...result.events, ...back.events], {
      type: action.kind === 'roll' ? 'ROLLED' : 'MOVED',
      seat: seat as LudoSeat,
      clientActionId,
    });
    return {
      patch: afterLudoChange(back.state, [...result.events, ...back.events], now),
      events,
      outSeats: departedSeats(result.events),
    };
  },

  leave(match, seat, now, reason): Change | null {
    const stored = ludoOf(match);
    if (stored === null) return null;
    if (reason === 'disconnected') {
      // A dropped connection is not a forfeit: the AI plays the seat (and the player can take it
      // back by acting) until too many covered turns pass in a row.
      const covered = startLudoAiCover(ludoState(stored), seat as LudoSeat);
      if (!covered.ok) return null; // already covered, or already out of the game
      return {
        patch: afterLudoChange(covered.state, covered.events, now),
        events: [{ type: 'PLAYER_DISCONNECTED', seat }, ...ludoEventDrafts(covered.events)],
      };
    }
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
    const result = applyLudoTimeout(ludoState(stored), rollDie(), coverChooser);
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
    if (!bot) return null;
    const state = ludoState(stored);
    if (bot.userId !== null) {
      // A human whose seat the AI is covering. Same validators as the human's own step.
      if (!isAiCovered(state, seat)) return null;
      const step = applyLudoCoverStep(state, rollDie(), coverChooser);
      if (!step.ok) return null;
      const phaseType = state.phase === 'roll' ? 'ROLLED' : 'MOVED';
      return {
        patch: afterLudoChange(step.state, step.events, now),
        events: ludoEventDrafts(step.events, {
          type: phaseType,
          seat,
          clientActionId: botActionId(match.id, match.version),
        }),
        outSeats: departedSeats(step.events),
      };
    }
    if (bot.botLevel === null) return null;
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
