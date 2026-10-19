/**
 * Ayo, with the RRYDA house rules (owner decision 2026-10-19, decision #118). Pure and
 * deterministic: nothing here reads a clock or a random source, and every function returns a new
 * state. The full rules are in docs/ayo-rules.md.
 *
 *  - 12 pits in a ring, numbered 0-11 counter-clockwise, 48 seeds. Round 1: seat 0 owns pits 0-5,
 *    seat 1 owns pits 6-11, four seeds in every pit.
 *  - A move: lift all the seeds of one of YOUR pits that has seeds and sow them one by one into the
 *    next pits, counter-clockwise, round the whole ring (the pit you lifted from is not skipped).
 *  - Relay: if the last seed lands in a pit that already held seeds, lift them all and keep sowing.
 *    The turn ends when the last seed lands in an empty pit.
 *  - Packing: a pit that reaches exactly four is packed. In the middle of a sow the four go to the
 *    pit's OWNER; if it is the last seed of a sow the SOWER takes them (on either side) and the turn
 *    ends.
 *  - A player with no seeds on their side skips their turn.
 *  - When four seeds or fewer are left on the board, they go to whoever packed last and the round
 *    ends. Rounds also end when the board is empty.
 *  - Next round: each player makes as many pits of four as they packed allows (28 seeds = 7 pits);
 *    the pits of seat 0 come first in the ring. The starter alternates every round.
 *  - A player who starts a round with exactly ONE pit may quit (and lose) or continue. A player with
 *    no pit loses. After MAX_ROUNDS rounds the player with more pits wins (equal = draw).
 *
 * Seeds are conserved: board + both packed counts always add up to 48 inside a round.
 */

export type AyoSeat = 0 | 1;

export const AYO_PITS = 12;
export const AYO_START_SEEDS = 4;
export const AYO_TOTAL_SEEDS = 48;
/** One turn clock. */
export const AYO_TURN_TIMER_MS = 20_000;
/** A player who has to choose quit or continue has this long. */
export const AYO_DECISION_MS = 30_000;
/** Sowing steps per move before the hand is put down (a guard; real turns are far shorter). */
export const AYO_MAX_SOW_STEPS = 2000;
/** Turns in one round before the rest of the board goes to the last packer. */
export const AYO_MAX_ROUND_TURNS = 400;
/** Rounds in one game before the player with more pits wins. */
export const AYO_MAX_ROUNDS = 30;
/** Turns in a row the server may play for a player whose clock ran out before they forfeit. */
export const AYO_MAX_AUTO_PLAYS = 3;

export type AyoEndReason = 'no_pits' | 'quit' | 'max_rounds' | 'timeout' | 'forfeit';

/** One step of a turn, in order, so the app can replay it seed by seed. */
export type AyoStep =
  /** Seeds lifted from a pit (the start of a move, or a relay). */
  | { k: 'lift'; pit: number; count: number }
  /** One seed dropped into a pit. */
  | { k: 'drop'; pit: number }
  /** A pit reached four and `by` packed it. */
  | { k: 'pack'; pit: number; by: AyoSeat; amount: number }
  /** The last seeds of the round went to `by`, the last packer. */
  | { k: 'final'; by: AyoSeat; amount: number }
  /** A new round was set up; `owners` says who owns which pit in it. */
  | { k: 'round'; round: number; owners: readonly AyoSeat[] };

/** The table as it stood before a move, so the app can replay the move from the start. */
export interface AyoBefore {
  readonly pits: readonly number[];
  readonly owners: readonly AyoSeat[];
  readonly packed: readonly [number, number];
}

export interface AyoMoveRecord {
  readonly seat: AyoSeat;
  readonly pit: number;
  readonly steps: readonly AyoStep[];
  readonly before: AyoBefore;
}

export interface AyoRoundSummary {
  readonly round: number;
  /** What each seat packed in the round (the last seeds included). */
  readonly packed: readonly [number, number];
  /** How many pits of four each seat gets next round. */
  readonly pits: readonly [number, number];
  /** The seat that received the last seeds of the round, if there were any. */
  readonly finalTo: AyoSeat | null;
}

export interface AyoState {
  /** Seeds in each pit. */
  readonly pits: readonly number[];
  /** Which seat owns each pit this round. */
  readonly owners: readonly AyoSeat[];
  /** Seeds each seat has packed this round. */
  readonly packed: readonly [number, number];
  readonly toMove: AyoSeat;
  readonly phase: 'playing' | 'finished';
  /** 1 for the first round. */
  readonly round: number;
  /** Who made (or makes) the first move of the current round. */
  readonly starter: AyoSeat;
  /** The seat that packed last this round; it gets the last seeds. */
  readonly lastPacker: AyoSeat | null;
  readonly roundTurns: number;
  /** A seat that started the round with one pit and must choose to quit or continue. */
  readonly decision: AyoSeat | null;
  /** Turns in a row, per seat, that the server played because the clock ran out. */
  readonly autoPlays: readonly [number, number];
  readonly winner: AyoSeat | 'draw' | null;
  readonly endReason: AyoEndReason | null;
  readonly plies: number;
  readonly last: AyoMoveRecord | null;
  /** How the previous round ended, for the app to announce. */
  readonly lastRound: AyoRoundSummary | null;
}

export type AyoError =
  | 'NOT_YOUR_TURN'
  | 'GAME_FINISHED'
  | 'INVALID_PIT'
  | 'ILLEGAL_MOVE'
  | 'DECISION_PENDING'
  | 'NO_DECISION';

export type AyoEvent =
  | { type: 'MOVED'; seat: AyoSeat; pit: number; steps: AyoStep[]; packed: [number, number] }
  | { type: 'ROUND_ENDED'; round: number; packed: [number, number]; finalTo: AyoSeat | null }
  | { type: 'ROUND_STARTED'; round: number; starter: AyoSeat; pits: [number, number] }
  | { type: 'DECISION_REQUIRED'; seat: AyoSeat }
  | { type: 'DECIDED'; seat: AyoSeat; quit: boolean }
  | { type: 'AUTO_PLAYED'; seat: AyoSeat }
  | { type: 'GAME_ENDED'; winner: AyoSeat | 'draw'; reason: AyoEndReason };

export type AyoResult =
  { ok: true; state: AyoState; events: AyoEvent[] } | { ok: false; error: AyoError };

const other = (seat: AyoSeat): AyoSeat => (seat === 0 ? 1 : 0);
const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

/** Round 1: seat 0 owns pits 0-5, seat 1 owns pits 6-11. */
export const defaultOwners = (): AyoSeat[] =>
  Array.from({ length: AYO_PITS }, (_, pit): AyoSeat => (pit < AYO_PITS / 2 ? 0 : 1));

/** Seat 0 owns pits [0, k); seat 1 owns the rest. An extra pit sits next to your row. */
export function ownersForPits(seat0Pits: number): AyoSeat[] {
  const k = Math.max(0, Math.min(AYO_PITS, seat0Pits));
  return Array.from({ length: AYO_PITS }, (_, pit): AyoSeat => (pit < k ? 0 : 1));
}

export const ownerOfPit = (state: Pick<AyoState, 'owners'>, pit: number): AyoSeat =>
  state.owners[pit] ?? (pit < AYO_PITS / 2 ? 0 : 1);

/** Number of pits a seat owns this round. */
export const pitCount = (state: Pick<AyoState, 'owners'>, seat: AyoSeat): number =>
  state.owners.filter((owner) => owner === seat).length;

/** Seeds on a seat's side of the board. */
export function seedsOnSide(state: AyoState, seat: AyoSeat): number {
  let total = 0;
  for (let pit = 0; pit < AYO_PITS; pit += 1) {
    if (state.owners[pit] === seat) total += state.pits[pit] ?? 0;
  }
  return total;
}

/** A new match. `opening` moves first. */
export function createAyo(opening: AyoSeat): AyoState {
  return {
    pits: Array.from({ length: AYO_PITS }, () => AYO_START_SEEDS),
    owners: defaultOwners(),
    packed: [0, 0],
    toMove: opening,
    phase: 'playing',
    round: 1,
    starter: opening,
    lastPacker: null,
    roundTurns: 0,
    decision: null,
    autoPlays: [0, 0],
    winner: null,
    endReason: null,
    plies: 0,
    last: null,
    lastRound: null,
  };
}

/** Pits of `seat` that have seeds. */
function pitsWithSeeds(state: AyoState, seat: AyoSeat): number[] {
  const out: number[] = [];
  for (let pit = 0; pit < AYO_PITS; pit += 1) {
    if (state.owners[pit] === seat && (state.pits[pit] ?? 0) > 0) out.push(pit);
  }
  return out;
}

/** Pits the side to move may lift now (none while a quit-or-continue choice is waiting). */
export function legalAyoMoves(state: AyoState): number[] {
  if (state.phase === 'finished' || state.decision !== null) return [];
  return pitsWithSeeds(state, state.toMove);
}

export interface SowOutcome {
  pits: number[];
  /** Seeds each seat received while sowing. */
  packedBy: [number, number];
  /** Seeds the sower received. */
  packedBySower: number;
  /** Who received the last pack of the move. */
  lastReceiver: AyoSeat | null;
  steps: AyoStep[];
}

/** Pure sowing of one move for `seat` from `pit`. It always ends (AYO_MAX_SOW_STEPS). */
export function sowAyo(
  input: readonly number[],
  owners: readonly AyoSeat[],
  seat: AyoSeat,
  pit: number,
): SowOutcome {
  const pits = input.slice();
  let hand = pits[pit] ?? 0;
  pits[pit] = 0;
  const steps: AyoStep[] = [{ k: 'lift', pit, count: hand }];
  const packedBy: [number, number] = [0, 0];
  let lastReceiver: AyoSeat | null = null;
  let cursor = pit;
  let sown = 0;
  while (hand > 0) {
    cursor = (cursor + 1) % AYO_PITS;
    pits[cursor] = (pits[cursor] ?? 0) + 1;
    hand -= 1;
    sown += 1;
    steps.push({ k: 'drop', pit: cursor });
    if (pits[cursor] === 4) {
      // The last seed of the move: the sower takes it, even on the other side. Mid-sow: the owner.
      const to: AyoSeat = hand === 0 ? seat : (owners[cursor] ?? seat);
      pits[cursor] = 0;
      packedBy[to] += 4;
      lastReceiver = to;
      steps.push({ k: 'pack', pit: cursor, by: to, amount: 4 });
      continue; // a packed last seed leaves an empty pit: the turn ends
    }
    if (hand === 0 && (pits[cursor] ?? 0) > 1) {
      // The last seed landed in a pit that already held seeds: lift them and carry on.
      hand = pits[cursor] ?? 0;
      pits[cursor] = 0;
      steps.push({ k: 'lift', pit: cursor, count: hand });
    }
    if (sown >= AYO_MAX_SOW_STEPS && hand > 0) {
      pits[cursor] = (pits[cursor] ?? 0) + hand; // guard: put the hand down; seeds are conserved
      hand = 0;
    }
  }
  return { pits, packedBy, packedBySower: packedBy[seat], lastReceiver, steps };
}

function finish(
  state: AyoState,
  winner: AyoSeat | 'draw',
  reason: AyoEndReason,
): { state: AyoState; events: AyoEvent[] } {
  return {
    state: { ...state, phase: 'finished', winner, endReason: reason, decision: null },
    events: [{ type: 'GAME_ENDED', winner, reason }],
  };
}

/**
 * Ends the current round: the last seeds go to the last packer, then the next round is set up (or
 * the game ends). `steps` gets the closing steps so the app can replay them.
 */
function endRound(input: AyoState, steps: AyoStep[]): { state: AyoState; events: AyoEvent[] } {
  let state = input;
  const left = sum(state.pits);
  const packed: [number, number] = [state.packed[0], state.packed[1]];
  let finalTo: AyoSeat | null = null;
  if (left > 0) {
    // The last seeds go to whoever packed before them (the opponent of the mover if nobody has).
    finalTo = state.lastPacker ?? other(state.toMove);
    packed[finalTo] += left;
    steps.push({ k: 'final', by: finalTo, amount: left });
    state = { ...state, pits: Array.from({ length: AYO_PITS }, () => 0) };
  }
  const pits: [number, number] = [
    Math.floor(packed[0] / AYO_START_SEEDS),
    Math.floor(packed[1] / AYO_START_SEEDS),
  ];
  const lastRound: AyoRoundSummary = { round: state.round, packed, pits, finalTo };
  const events: AyoEvent[] = [{ type: 'ROUND_ENDED', round: state.round, packed, finalTo }];
  state = { ...state, packed, lastRound };

  if (pits[0] === 0 || pits[1] === 0) {
    const done = finish(state, pits[0] === 0 ? 1 : 0, 'no_pits');
    return { state: done.state, events: [...events, ...done.events] };
  }
  if (state.round >= AYO_MAX_ROUNDS) {
    const done = finish(
      state,
      pits[0] === pits[1] ? 'draw' : pits[0] > pits[1] ? 0 : 1,
      'max_rounds',
    );
    return { state: done.state, events: [...events, ...done.events] };
  }

  const starter = other(state.starter); // rounds alternate who starts
  const onePit: AyoSeat | null = pits[0] === 1 ? 0 : pits[1] === 1 ? 1 : null;
  steps.push({ k: 'round', round: state.round + 1, owners: ownersForPits(pits[0]) });
  events.push({ type: 'ROUND_STARTED', round: state.round + 1, starter, pits });
  if (onePit !== null) events.push({ type: 'DECISION_REQUIRED', seat: onePit });
  return {
    state: {
      ...state,
      pits: Array.from({ length: AYO_PITS }, () => AYO_START_SEEDS),
      owners: ownersForPits(pits[0]),
      packed: [0, 0],
      round: state.round + 1,
      roundTurns: 0,
      lastPacker: null,
      starter,
      toMove: starter,
      decision: onePit,
    },
    events,
  };
}

/**
 * Plays a pit for `seat`: the whole turn (sowing, relays, packs), then the end of the round and the
 * match when they come. `auto` marks a move the server played because the clock ran out.
 */
export function applyAyoMove(state: AyoState, seat: AyoSeat, pit: number, auto = false): AyoResult {
  if (state.phase === 'finished') return { ok: false, error: 'GAME_FINISHED' };
  if (state.decision !== null) return { ok: false, error: 'DECISION_PENDING' };
  if (seat !== state.toMove) return { ok: false, error: 'NOT_YOUR_TURN' };
  if (!Number.isInteger(pit) || pit < 0 || pit >= AYO_PITS)
    return { ok: false, error: 'INVALID_PIT' };
  if (!legalAyoMoves(state).includes(pit)) return { ok: false, error: 'ILLEGAL_MOVE' };

  const before: AyoBefore = {
    pits: [...state.pits],
    owners: [...state.owners],
    packed: [state.packed[0], state.packed[1]],
  };
  const sow = sowAyo(state.pits, state.owners, seat, pit);
  const steps = sow.steps;
  const packed: [number, number] = [
    state.packed[0] + sow.packedBy[0],
    state.packed[1] + sow.packedBy[1],
  ];
  const autoPlays: [number, number] = [state.autoPlays[0], state.autoPlays[1]];
  if (!auto) autoPlays[seat] = 0; // a real move proves the player is here
  let moved: AyoState = {
    ...state,
    pits: sow.pits,
    packed,
    lastPacker: sow.lastReceiver ?? state.lastPacker,
    roundTurns: state.roundTurns + 1,
    plies: state.plies + 1,
    autoPlays,
    last: { seat, pit, steps, before },
  };
  const events: AyoEvent[] = [
    { type: 'MOVED', seat, pit, steps, packed: [sow.packedBy[0], sow.packedBy[1]] },
  ];

  const left = sum(moved.pits);
  let closing: { state: AyoState; events: AyoEvent[] } | null = null;
  if (left <= 4 || moved.roundTurns >= AYO_MAX_ROUND_TURNS) {
    closing = endRound(moved, steps);
  } else {
    const next = other(seat);
    // A player with no seeds on their side skips their turn.
    if (pitsWithSeeds(moved, next).length > 0) moved = { ...moved, toMove: next };
    else if (pitsWithSeeds(moved, seat).length > 0) moved = { ...moved, toMove: seat };
    else closing = endRound(moved, steps);
  }
  if (closing !== null) {
    moved = { ...closing.state, last: { seat, pit, steps, before } };
    events.push(...closing.events);
  }
  return { ok: true, state: moved, events };
}

/** The player who has to choose quits (and loses) or continues. */
export function decideAyo(state: AyoState, seat: AyoSeat, quit: boolean): AyoResult {
  if (state.phase === 'finished') return { ok: false, error: 'GAME_FINISHED' };
  if (state.decision === null || state.decision !== seat)
    return { ok: false, error: 'NO_DECISION' };
  const events: AyoEvent[] = [{ type: 'DECIDED', seat, quit }];
  if (quit) {
    const done = finish({ ...state, decision: null }, other(seat), 'quit');
    return { ok: true, state: done.state, events: [...events, ...done.events] };
  }
  return { ok: true, state: { ...state, decision: null }, events };
}

/** `seat` leaves or is dropped; the other seat wins. */
export function forfeitAyo(state: AyoState, seat: AyoSeat): AyoResult {
  if (state.phase === 'finished') return { ok: false, error: 'GAME_FINISHED' };
  const done = finish(state, other(seat), 'forfeit');
  return { ok: true, state: done.state, events: done.events };
}

/** The seat the clock is waiting for: the one that must choose, else the one to move. */
export const seatOnClock = (state: AyoState): AyoSeat => state.decision ?? state.toMove;

/**
 * The clock of the seat on turn ran out. The server plays for them: it continues if a choice was
 * waiting, otherwise it plays the pit `pick` gives. After AYO_MAX_AUTO_PLAYS turns in a row the
 * player forfeits, so the server never plays a whole match for someone who is not there.
 */
export function idleAyo(state: AyoState, pick: (state: AyoState) => number | null): AyoResult {
  if (state.phase === 'finished') return { ok: false, error: 'GAME_FINISHED' };
  const seat = seatOnClock(state);
  const autoPlays: [number, number] = [state.autoPlays[0], state.autoPlays[1]];
  autoPlays[seat] += 1;
  const counted: AyoState = { ...state, autoPlays };
  if (autoPlays[seat] >= AYO_MAX_AUTO_PLAYS) {
    const done = finish(counted, other(seat), 'timeout');
    return { ok: true, state: done.state, events: [{ type: 'AUTO_PLAYED', seat }, ...done.events] };
  }
  if (counted.decision !== null) {
    const result = decideAyo(counted, seat, false);
    return result.ok
      ? { ok: true, state: result.state, events: [{ type: 'AUTO_PLAYED', seat }, ...result.events] }
      : result;
  }
  const chosen = pick(counted);
  if (chosen === null) return { ok: false, error: 'ILLEGAL_MOVE' };
  const result = applyAyoMove(counted, seat, chosen, true);
  return result.ok
    ? { ok: true, state: result.state, events: [{ type: 'AUTO_PLAYED', seat }, ...result.events] }
    : result;
}

/** Checks the conservation laws; returns the problems found (empty when the state is sound). */
export function checkAyoInvariants(state: AyoState): string[] {
  const problems: string[] = [];
  if (state.pits.length !== AYO_PITS || state.owners.length !== AYO_PITS) {
    problems.push('wrong number of pits');
  }
  if (state.pits.some((count) => !Number.isInteger(count) || count < 0)) {
    problems.push('a pit holds a bad count');
  }
  if (state.phase === 'playing' && sum(state.pits) + sum(state.packed) !== AYO_TOTAL_SEEDS) {
    problems.push(`seeds are not conserved (${String(sum(state.pits) + sum(state.packed))})`);
  }
  return problems;
}
