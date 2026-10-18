/**
 * Ayo (Ayo Olopon), exactly as approved in docs/ayo-rules.md. Pure and deterministic: nothing here
 * reads a clock or a random source, and every function returns a new state.
 *
 * Twelve pits in a ring, numbered 0-11 counter-clockwise. Seat 0 owns pits 0-5, seat 1 owns pits
 * 6-11. A pit that has been lost between rounds is out of the ring (`alive` is false). Seeds are
 * conserved: board + both stores + the seeds in the hand always add up to 48.
 */

export type AyoSeat = 0 | 1;

export const AYO_PITS = 12;
export const AYO_PITS_PER_SIDE = 6;
export const AYO_START_SEEDS = 4;
export const AYO_TOTAL_SEEDS = 48;
export const AYO_TURN_TIMER_MS = 20_000;
/** A round ends when this many seeds are left and somebody reaps. */
export const AYO_LAST_SEEDS = 8;
/** A lift of at least this many seeds skips the pit it was lifted from on each lap. */
export const AYO_LAP_SKIP_FROM = 12;
/**
 * Safety valve: a turn that relays more often than this stops where it is. A relay that returns to
 * a position it was already in ends the turn earlier (see `sow`), so this is only a second guard.
 */
export const AYO_MAX_LIFTS = 400;

export type AyoEndReason = 'one_pit' | 'agreement' | 'timeout' | 'forfeit';

/** One step of a turn, in order, so the app can animate it. */
export type AyoStep =
  | { k: 'lift'; pit: number; count: number }
  | { k: 'drop'; pit: number }
  /** `by` reaped the seeds in `pit`; `all` is true when it took the whole table (round over). */
  | { k: 'reap'; pit: number; by: AyoSeat; amount: number; all: boolean };

export interface AyoMoveRecord {
  readonly seat: AyoSeat;
  readonly pit: number;
  readonly steps: readonly AyoStep[];
}

export interface AyoState {
  /** Seeds in each pit. */
  readonly pits: readonly number[];
  /** Whether each pit is in the ring this round. */
  readonly alive: readonly boolean[];
  /** Seeds each seat has reaped and not yet put back on the board. */
  readonly stores: readonly [number, number];
  readonly toMove: AyoSeat;
  readonly phase: 'playing' | 'finished';
  /** 1 for the first round. */
  readonly round: number;
  /** Who started the current round. */
  readonly starter: AyoSeat;
  readonly winner: AyoSeat | 'draw' | null;
  readonly endReason: AyoEndReason | null;
  /** Seat that has offered to end the game by agreement, if any. */
  readonly endOffer: AyoSeat | null;
  readonly plies: number;
  readonly last: AyoMoveRecord | null;
  /** How the previous round ended, for the app to announce. */
  readonly lastRound: {
    readonly round: number;
    readonly winner: AyoSeat;
    readonly took: number;
  } | null;
}

export type AyoError =
  | 'NOT_YOUR_TURN'
  | 'GAME_FINISHED'
  | 'INVALID_PIT'
  | 'ILLEGAL_MOVE'
  | 'END_NOT_ALLOWED'
  | 'NO_OFFER'
  | 'OWN_OFFER';

export type AyoEvent =
  | { type: 'MOVED'; seat: AyoSeat; pit: number; steps: AyoStep[]; reaped: [number, number] }
  | { type: 'ROUND_ENDED'; round: number; winner: AyoSeat; took: number }
  | { type: 'ROUND_STARTED'; round: number; starter: AyoSeat; pits: [number, number] }
  | { type: 'END_OFFERED'; seat: AyoSeat }
  | { type: 'END_DECLINED'; seat: AyoSeat }
  | { type: 'GAME_ENDED'; winner: AyoSeat | 'draw'; reason: AyoEndReason };

export type AyoResult =
  { ok: true; state: AyoState; events: AyoEvent[] } | { ok: false; error: AyoError };

export const ownerOfPit = (pit: number): AyoSeat => (pit < AYO_PITS_PER_SIDE ? 0 : 1);
const other = (seat: AyoSeat): AyoSeat => (seat === 0 ? 1 : 0);
const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

/** Pits a seat gets when it fills its row from `store` seeds (four each, at most six). */
export const pitsFor = (store: number): number =>
  Math.min(AYO_PITS_PER_SIDE, Math.floor(store / AYO_START_SEEDS));

/** Number of pits in the ring on a seat's side. */
export function livePits(state: AyoState, seat: AyoSeat): number {
  let count = 0;
  for (let pit = 0; pit < AYO_PITS; pit += 1) {
    if (ownerOfPit(pit) === seat && state.alive[pit]) count += 1;
  }
  return count;
}

/** Seeds a seat could still use: its store plus what sits on its side of the board. */
export function seedsOf(state: AyoState, seat: AyoSeat): number {
  let onBoard = 0;
  for (let pit = 0; pit < AYO_PITS; pit += 1) {
    if (ownerOfPit(pit) === seat) onBoard += state.pits[pit] ?? 0;
  }
  return (state.stores[seat] ?? 0) + onBoard;
}

function setupRound(stores: readonly [number, number]): {
  pits: number[];
  alive: boolean[];
  stores: [number, number];
  counts: [number, number];
} {
  const counts: [number, number] = [pitsFor(stores[0]), pitsFor(stores[1])];
  const pits = Array.from({ length: AYO_PITS }, () => 0);
  const alive = Array.from({ length: AYO_PITS }, () => false);
  for (const seat of [0, 1] as const) {
    for (let index = 0; index < counts[seat]; index += 1) {
      const pit = seat * AYO_PITS_PER_SIDE + index;
      alive[pit] = true;
      pits[pit] = AYO_START_SEEDS;
    }
  }
  return {
    pits,
    alive,
    stores: [stores[0] - counts[0] * AYO_START_SEEDS, stores[1] - counts[1] * AYO_START_SEEDS],
    counts,
  };
}

/** A new match. `opening` moves first. */
export function createAyo(opening: AyoSeat): AyoState {
  return {
    pits: Array.from({ length: AYO_PITS }, () => AYO_START_SEEDS),
    alive: Array.from({ length: AYO_PITS }, () => true),
    stores: [0, 0],
    toMove: opening,
    phase: 'playing',
    round: 1,
    starter: opening,
    winner: null,
    endReason: null,
    endOffer: null,
    plies: 0,
    last: null,
    lastRound: null,
  };
}

/** Pits the side to move may lift now. */
export function legalAyoMoves(state: AyoState): number[] {
  if (state.phase === 'finished') return [];
  const moves: number[] = [];
  for (let pit = 0; pit < AYO_PITS; pit += 1) {
    if (ownerOfPit(pit) === state.toMove && state.alive[pit] && (state.pits[pit] ?? 0) > 0) {
      moves.push(pit);
    }
  }
  return moves;
}

interface TurnOutcome {
  pits: number[];
  stores: [number, number];
  steps: AyoStep[];
  /** Set when the whole table was taken: the round is over and this seat won it. */
  roundWinner: AyoSeat | null;
  took: number;
}

/** Plays one full turn (lifts, relays, reaps) for `seat` from `pit`. */
function sow(state: AyoState, seat: AyoSeat, pit: number): TurnOutcome {
  const pits = state.pits.slice();
  const stores: [number, number] = [state.stores[0], state.stores[1]];
  const steps: AyoStep[] = [];
  const next = (from: number, skip: number): number => {
    let cursor = from;
    for (let guard = 0; guard < AYO_PITS * 2; guard += 1) {
      cursor = (cursor + 1) % AYO_PITS;
      if (state.alive[cursor] && cursor !== skip) return cursor;
    }
    return from;
  };

  let lifted = pit;
  // A relay can come back to a position it has already been in; it would then go round forever.
  // The turn ends at that point.
  const seen = new Set<string>();
  for (let lifts = 0; lifts < AYO_MAX_LIFTS; lifts += 1) {
    const key = `${String(lifted)}:${pits.join(',')}:${String(stores[0])}`;
    if (seen.has(key)) break;
    seen.add(key);
    const count = pits[lifted] ?? 0;
    pits[lifted] = 0;
    steps.push({ k: 'lift', pit: lifted, count });
    const skip = count >= AYO_LAP_SKIP_FROM ? lifted : -1;
    let cursor = lifted;
    let landedOn = lifted;
    let reapedLast = false;
    for (let index = 0; index < count; index += 1) {
      cursor = next(cursor, skip);
      pits[cursor] = (pits[cursor] ?? 0) + 1;
      steps.push({ k: 'drop', pit: cursor });
      const isLast = index === count - 1;
      landedOn = cursor;
      if (pits[cursor] === 4) {
        const hand = count - index - 1;
        const reaper: AyoSeat = ownerOfPit(cursor) === seat ? seat : isLast ? seat : other(seat);
        const onTable = sum(pits) + hand;
        if (onTable === AYO_LAST_SEEDS) {
          // The last eight: whoever reaps takes the lot and the round is over.
          const took = onTable;
          stores[reaper] += took;
          steps.push({ k: 'reap', pit: cursor, by: reaper, amount: took, all: true });
          for (let p = 0; p < AYO_PITS; p += 1) pits[p] = 0;
          return { pits, stores, steps, roundWinner: reaper, took };
        }
        stores[reaper] += 4;
        pits[cursor] = 0;
        steps.push({ k: 'reap', pit: cursor, by: reaper, amount: 4, all: false });
        if (isLast) reapedLast = true;
      }
    }
    // A last seed in a pit that already held seeds (and was not reaped) is a relay.
    if (!reapedLast && (pits[landedOn] ?? 0) >= 2) {
      lifted = landedOn;
      continue;
    }
    break;
  }
  return { pits, stores, steps, roundWinner: null, took: 0 };
}

function finishMatch(
  state: AyoState,
  winner: AyoSeat | 'draw',
  reason: AyoEndReason,
): { state: AyoState; events: AyoEvent[] } {
  return {
    state: { ...state, phase: 'finished', winner, endReason: reason, endOffer: null },
    events: [{ type: 'GAME_ENDED', winner, reason }],
  };
}

/** Closes a round won by `winner`, then starts the next one or ends the match. */
function closeRound(
  state: AyoState,
  winner: AyoSeat,
  took: number,
  stores: readonly [number, number],
): { state: AyoState; events: AyoEvent[] } {
  const events: AyoEvent[] = [{ type: 'ROUND_ENDED', round: state.round, winner, took }];
  const setup = setupRound(stores);
  const lastRound = { round: state.round, winner, took };
  if (setup.counts[0] <= 1 || setup.counts[1] <= 1) {
    // A player cannot fill more than one pit: the match is over.
    const loser: AyoSeat = setup.counts[0] <= 1 ? 0 : 1;
    const done = finishMatch(
      {
        ...state,
        pits: Array.from({ length: AYO_PITS }, () => 0),
        stores: [stores[0], stores[1]],
        lastRound,
      },
      other(loser),
      'one_pit',
    );
    return { state: done.state, events: [...events, ...done.events] };
  }
  const starter: AyoSeat = other(winner); // the loser of the round starts the next one
  events.push({
    type: 'ROUND_STARTED',
    round: state.round + 1,
    starter,
    pits: setup.counts,
  });
  return {
    state: {
      ...state,
      pits: setup.pits,
      alive: setup.alive,
      stores: setup.stores,
      toMove: starter,
      starter,
      round: state.round + 1,
      endOffer: null,
      lastRound,
    },
    events,
  };
}

/** Plays a pit for `seat`: the whole turn, then rounds and the end of the match. */
export function applyAyoMove(state: AyoState, seat: AyoSeat, pit: number): AyoResult {
  if (state.phase === 'finished') return { ok: false, error: 'GAME_FINISHED' };
  if (seat !== state.toMove) return { ok: false, error: 'NOT_YOUR_TURN' };
  if (!Number.isInteger(pit) || pit < 0 || pit >= AYO_PITS)
    return { ok: false, error: 'INVALID_PIT' };
  if (!legalAyoMoves(state).includes(pit)) return { ok: false, error: 'ILLEGAL_MOVE' };

  const turn = sow(state, seat, pit);
  const reaped: [number, number] = [
    turn.stores[0] - state.stores[0],
    turn.stores[1] - state.stores[1],
  ];
  const record: AyoMoveRecord = { seat, pit, steps: turn.steps };
  const moved: AyoState = {
    ...state,
    pits: turn.pits,
    stores: turn.stores,
    toMove: other(seat),
    plies: state.plies + 1,
    last: record,
    endOffer: null, // playing on answers an offer with "no"
  };
  const events: AyoEvent[] = [{ type: 'MOVED', seat, pit, steps: turn.steps, reaped }];
  if (state.endOffer !== null && state.endOffer !== seat) {
    events.unshift({ type: 'END_DECLINED', seat });
  }

  if (turn.roundWinner !== null) {
    const closed = closeRound(moved, turn.roundWinner, turn.took, turn.stores);
    return { ok: true, state: closed.state, events: [...events, ...closed.events] };
  }
  // The next player has nothing to lift: the round ends and the mover takes what is left.
  if (legalAyoMoves(moved).length === 0) {
    const left = sum(turn.pits);
    const stores: [number, number] = [turn.stores[0], turn.stores[1]];
    stores[seat] += left;
    const cleared: AyoState = { ...moved, pits: Array.from({ length: AYO_PITS }, () => 0), stores };
    const closed = closeRound(cleared, seat, left, stores);
    return { ok: true, state: closed.state, events: [...events, ...closed.events] };
  }
  return { ok: true, state: moved, events };
}

/** Either player may offer to end the game by agreement once they have exactly two pits. */
export function offerAyoEnd(state: AyoState, seat: AyoSeat): AyoResult {
  if (state.phase === 'finished') return { ok: false, error: 'GAME_FINISHED' };
  if (livePits(state, 0) !== 2 && livePits(state, 1) !== 2) {
    return { ok: false, error: 'END_NOT_ALLOWED' };
  }
  if (state.endOffer === seat) return { ok: true, state, events: [] }; // asking twice is one ask
  if (state.endOffer !== null) return acceptAyoEnd(state, seat);
  return {
    ok: true,
    state: { ...state, endOffer: seat },
    events: [{ type: 'END_OFFERED', seat }],
  };
}

/** The other player accepts: the match ends and the bigger total (store plus own side) wins. */
export function acceptAyoEnd(state: AyoState, seat: AyoSeat): AyoResult {
  if (state.phase === 'finished') return { ok: false, error: 'GAME_FINISHED' };
  if (state.endOffer === null) return { ok: false, error: 'NO_OFFER' };
  if (state.endOffer === seat) return { ok: false, error: 'OWN_OFFER' };
  const mine = seedsOf(state, 0);
  const theirs = seedsOf(state, 1);
  const winner: AyoSeat | 'draw' = mine === theirs ? 'draw' : mine > theirs ? 0 : 1;
  const done = finishMatch(state, winner, 'agreement');
  return { ok: true, state: done.state, events: done.events };
}

export function declineAyoEnd(state: AyoState, seat: AyoSeat): AyoResult {
  if (state.phase === 'finished') return { ok: false, error: 'GAME_FINISHED' };
  if (state.endOffer === null) return { ok: false, error: 'NO_OFFER' };
  if (state.endOffer === seat) return { ok: false, error: 'OWN_OFFER' };
  return {
    ok: true,
    state: { ...state, endOffer: null },
    events: [{ type: 'END_DECLINED', seat }],
  };
}

/** The player on turn ran out of time and loses the match. */
export function timeoutAyo(state: AyoState): AyoResult {
  if (state.phase === 'finished') return { ok: false, error: 'GAME_FINISHED' };
  const done = finishMatch(state, other(state.toMove), 'timeout');
  return { ok: true, state: done.state, events: done.events };
}

/** `seat` leaves or is dropped; the other seat wins. */
export function forfeitAyo(state: AyoState, seat: AyoSeat): AyoResult {
  if (state.phase === 'finished') return { ok: false, error: 'GAME_FINISHED' };
  const done = finishMatch(state, other(seat), 'forfeit');
  return { ok: true, state: done.state, events: done.events };
}
