/**
 * Ludo rules, as approved in docs/ludo-rules.md and changed by the RRYDA port (decision #116):
 * no blocks (landing captures every opponent token on the square), a match of 3 or 4 players ends
 * when two have finished, and an AI covers the seat of a player who is away. Pure and deterministic: the dice value is
 * an input (the server rolls it with a CSPRNG and logs it), nothing here reads a clock or random
 * source, and every function returns a new state instead of changing the old one.
 *
 * Positions (`p`, per token, relative to its owner):
 *   -1       in the base
 *   0..50    on the shared 52-square track; 0 is the owner's start square (the second box of the arm).
 *            A token walks 51 squares and never steps on the square directly behind its own start.
 *   51..55   in the owner's private home column
 *   56       home (finished)
 */

export type LudoSeat = 0 | 1 | 2 | 3;
export type LudoPlayerCount = 2 | 3 | 4;

export const TRACK_LENGTH = 52;
export const TOKENS_PER_PLAYER = 4;
export const IN_BASE = -1;
export const LAST_TRACK_STEP = 50;
export const HOME_POSITION = 56;
export const START_SPACING = 13;
/** Squares after a start square that are also safe (the starred squares). */
export const STAR_OFFSET = 8;
export const SIX = 6;
export const MAX_CONSECUTIVE_SIXES = 3;
export const LUDO_TURN_TIMER_MS = 20_000;
/**
 * A seat the AI has covered for this many turns in a row, without its player acting once, is
 * removed from the game.
 */
export const LUDO_AI_COVER_MAX_TURNS = 20;

/** Which of the four board colours (0..3) each seat plays, by player count. */
export function coloursFor(players: LudoPlayerCount): readonly number[] {
  if (players === 2) return [0, 2]; // opposite corners
  if (players === 3) return [0, 1, 2];
  return [0, 1, 2, 3];
}

export function startSquare(colour: number): number {
  return colour * START_SPACING;
}

/** True for the 4 start squares and the 4 star squares. Absolute track squares only. */
export function isSafeSquare(square: number): boolean {
  const offset = square % START_SPACING;
  return offset === 0 || offset === STAR_OFFSET;
}

/** Absolute track square (0..51) of a token at relative position `p`, or null off the track. */
export function trackSquare(colour: number, p: number): number | null {
  if (p < 0 || p > LAST_TRACK_STEP) return null;
  return (startSquare(colour) + p) % TRACK_LENGTH;
}

export type LudoPhase = 'roll' | 'move' | 'finished';
export type LudoEndReason = 'completed' | 'forfeit';

export interface LudoState {
  readonly players: LudoPlayerCount;
  /** `colours[seat]` is the board colour of that seat. */
  readonly colours: readonly number[];
  /** `tokens[seat][i]` is the relative position of token i. */
  readonly tokens: readonly (readonly number[])[];
  readonly toMove: LudoSeat;
  readonly phase: LudoPhase;
  /** The die value waiting to be used (phase 'move'), else null. */
  readonly roll: number | null;
  /** Consecutive sixes rolled by the seat to move. */
  readonly sixes: number;
  /** Seats with all four tokens home, in the order they finished. */
  readonly finished: readonly LudoSeat[];
  /** Seats removed from the game (left, disconnected, timed out), in the order they left. */
  readonly removed: readonly LudoSeat[];
  /** Turns in a row the server has played for each seat because its player was away. */
  readonly consecutiveTimeouts: readonly number[];
  /** True for a seat whose player is away: the AI plays it until the player acts or takes it back. */
  readonly ai: readonly boolean[];
  /** Final order, first place first; set when the game is finished. */
  readonly placings: readonly LudoSeat[] | null;
  readonly endReason: LudoEndReason | null;
  /** Number of dice rolled so far (the event log has one entry per roll). */
  readonly rolls: number;
}

export type LudoError =
  | 'GAME_FINISHED'
  | 'NOT_YOUR_TURN'
  | 'WRONG_PHASE'
  | 'INVALID_DIE'
  | 'INVALID_TOKEN'
  | 'ILLEGAL_MOVE'
  | 'INVALID_SEAT'
  | 'NOT_COVERED';

export type LudoEvent =
  | { readonly type: 'ROLLED'; readonly seat: LudoSeat; readonly value: number }
  | { readonly type: 'NO_MOVE'; readonly seat: LudoSeat }
  | { readonly type: 'THIRD_SIX'; readonly seat: LudoSeat }
  | {
      readonly type: 'MOVED';
      readonly seat: LudoSeat;
      readonly token: number;
      readonly from: number;
      readonly to: number;
    }
  | {
      readonly type: 'CAPTURED';
      readonly seat: LudoSeat;
      readonly victim: LudoSeat;
      readonly token: number;
    }
  | { readonly type: 'TOKEN_HOME'; readonly seat: LudoSeat; readonly token: number }
  | { readonly type: 'SEAT_FINISHED'; readonly seat: LudoSeat; readonly place: number }
  | {
      readonly type: 'SEAT_REMOVED';
      readonly seat: LudoSeat;
      readonly reason: 'forfeit' | 'timeout';
    }
  | { readonly type: 'AI_COVER_STARTED'; readonly seat: LudoSeat }
  | { readonly type: 'AI_COVER_ENDED'; readonly seat: LudoSeat }
  | { readonly type: 'EXTRA_ROLL'; readonly seat: LudoSeat }
  | { readonly type: 'TURN'; readonly seat: LudoSeat }
  | { readonly type: 'GAME_OVER'; readonly placings: readonly LudoSeat[] };

export type LudoResult =
  | { readonly ok: true; readonly state: LudoState; readonly events: readonly LudoEvent[] }
  | { readonly ok: false; readonly error: LudoError };

export interface LudoMove {
  readonly token: number;
  readonly from: number;
  readonly to: number;
  /** The seat whose token(s) on the landing square this move captures, if any. */
  readonly captures: LudoSeat | null;
  readonly entersFromBase: boolean;
  readonly reachesHome: boolean;
}

const fail = (error: LudoError): LudoResult => ({ ok: false, error });

export function createLudo(players: LudoPlayerCount, openingSeat: LudoSeat = 0): LudoState {
  if (openingSeat >= players) throw new Error('The opening seat must be one of the players');
  return {
    players,
    colours: coloursFor(players),
    tokens: Array.from({ length: players }, () => Array<number>(TOKENS_PER_PLAYER).fill(IN_BASE)),
    toMove: openingSeat,
    phase: 'roll',
    roll: null,
    sixes: 0,
    finished: [],
    removed: [],
    consecutiveTimeouts: Array<number>(players).fill(0),
    ai: Array<boolean>(players).fill(false),
    placings: null,
    endReason: null,
    rolls: 0,
  };
}

export function seatsOf(state: LudoState): LudoSeat[] {
  return Array.from({ length: state.players }, (_, index) => index as LudoSeat);
}

export function isActiveSeat(state: LudoState, seat: LudoSeat): boolean {
  return !state.finished.includes(seat) && !state.removed.includes(seat);
}

export function activeSeats(state: LudoState): LudoSeat[] {
  return seatsOf(state).filter((seat) => isActiveSeat(state, seat));
}

/** Tokens of other seats standing on the absolute track square `square`. */
function occupants(
  state: LudoState,
  square: number,
  exceptSeat: LudoSeat,
): { seat: LudoSeat; token: number }[] {
  const found: { seat: LudoSeat; token: number }[] = [];
  for (const seat of seatsOf(state)) {
    if (seat === exceptSeat) continue;
    const colour = state.colours[seat] ?? 0;
    (state.tokens[seat] ?? []).forEach((p, token) => {
      if (trackSquare(colour, p) === square) found.push({ seat, token });
    });
  }
  return found;
}

/** All legal moves for the seat to move with the current die value. */
export function legalLudoMoves(state: LudoState): LudoMove[] {
  if (state.phase !== 'move' || state.roll === null) return [];
  const seat = state.toMove;
  const colour = state.colours[seat] ?? 0;
  const roll = state.roll;
  const moves: LudoMove[] = [];
  (state.tokens[seat] ?? []).forEach((from, token) => {
    if (from === HOME_POSITION) return;
    if (from === IN_BASE) {
      if (roll !== SIX) return;
      moves.push({
        token,
        from,
        to: 0,
        captures: null, // a start square is safe: nothing is captured there
        entersFromBase: true,
        reachesHome: false,
      });
      return;
    }
    const to = from + roll;
    if (to > HOME_POSITION) return; // exact roll needed to finish
    const square = trackSquare(colour, to);
    let captures: LudoSeat | null = null;
    if (square !== null && !isSafeSquare(square)) {
      // There are no blocks: whatever one opponent has on this square is captured together.
      captures = occupants(state, square, seat)[0]?.seat ?? null;
    }
    moves.push({
      token,
      from,
      to,
      captures,
      entersFromBase: false,
      reachesHome: to === HOME_POSITION,
    });
  });
  return moves;
}

/** The next seat clockwise that is still playing, or null if nobody is. */
function nextSeat(state: LudoState, from: LudoSeat): LudoSeat | null {
  for (let step = 1; step <= state.players; step += 1) {
    const candidate = ((from + step) % state.players) as LudoSeat;
    if (isActiveSeat(state, candidate)) return candidate;
  }
  return null;
}

function replaceTokens(
  state: LudoState,
  seat: LudoSeat,
  tokens: readonly number[],
): readonly (readonly number[])[] {
  return state.tokens.map((row, index) => (index === seat ? tokens : row));
}

function withTimeouts(state: LudoState, seat: LudoSeat, value: number): readonly number[] {
  return state.consecutiveTimeouts.map((count, index) => (index === seat ? value : count));
}

/** Tokens home, then total progress: how far a seat that did not finish got. */
function progressOf(state: LudoState, seat: LudoSeat): [number, number] {
  const row = state.tokens[seat] ?? [];
  return [tokensHome(state, seat), row.reduce((sum, p) => sum + (p + 1), 0)];
}

/**
 * Ends the game when at most one seat is still playing, or, with 3 or 4 players, once two seats
 * have finished. Seats still racing are placed by how far they got; removed seats come last, the
 * latest leaver ahead.
 */
function settle(state: LudoState, events: LudoEvent[]): LudoState {
  const active = activeSeats(state);
  const raceOver = state.players >= 3 && state.finished.length >= 2;
  if (active.length > 1 && !raceOver) return state;
  const racing = [...active].sort((a, b) => {
    const [homeA, stepsA] = progressOf(state, a);
    const [homeB, stepsB] = progressOf(state, b);
    return homeB - homeA || stepsB - stepsA || a - b;
  });
  const placings = [...state.finished, ...racing, ...[...state.removed].reverse()];
  events.push({ type: 'GAME_OVER', placings });
  return {
    ...state,
    phase: 'finished',
    roll: null,
    sixes: 0,
    placings,
    endReason: state.removed.length > 0 && state.finished.length === 0 ? 'forfeit' : 'completed',
  };
}

function passTurn(state: LudoState, events: LudoEvent[]): LudoState {
  const next = nextSeat(state, state.toMove);
  if (next === null) return settle(state, events);
  events.push({ type: 'TURN', seat: next });
  return { ...state, toMove: next, phase: 'roll', roll: null, sixes: 0 };
}

/** The seat to move rolls `value` (1..6). The caller supplies a securely random die. */
export function applyLudoRoll(state: LudoState, seat: LudoSeat, value: number): LudoResult {
  if (state.phase === 'finished') return fail('GAME_FINISHED');
  if (seat !== state.toMove) return fail('NOT_YOUR_TURN');
  if (state.phase !== 'roll') return fail('WRONG_PHASE');
  if (!Number.isInteger(value) || value < 1 || value > 6) return fail('INVALID_DIE');

  const events: LudoEvent[] = [{ type: 'ROLLED', seat, value }];
  const sixes = value === SIX ? state.sixes + 1 : 0;
  const base: LudoState = { ...state, rolls: state.rolls + 1, sixes };

  if (sixes >= MAX_CONSECUTIVE_SIXES) {
    events.push({ type: 'THIRD_SIX', seat });
    return { ok: true, state: passTurn(base, events), events };
  }

  const ready: LudoState = { ...base, phase: 'move', roll: value };
  if (legalLudoMoves(ready).length === 0) {
    events.push({ type: 'NO_MOVE', seat });
    return { ok: true, state: passTurn({ ...base, roll: null }, events), events };
  }
  return { ok: true, state: ready, events };
}

/** The seat to move moves one token by the die value it rolled. */
export function applyLudoMove(state: LudoState, seat: LudoSeat, token: number): LudoResult {
  if (state.phase === 'finished') return fail('GAME_FINISHED');
  if (seat !== state.toMove) return fail('NOT_YOUR_TURN');
  if (state.phase !== 'move' || state.roll === null) return fail('WRONG_PHASE');
  if (!Number.isInteger(token) || token < 0 || token >= TOKENS_PER_PLAYER) {
    return fail('INVALID_TOKEN');
  }
  const move = legalLudoMoves(state).find((candidate) => candidate.token === token);
  if (!move) return fail('ILLEGAL_MOVE');

  const events: LudoEvent[] = [{ type: 'MOVED', seat, token, from: move.from, to: move.to }];
  const mine = (state.tokens[seat] ?? []).map((p, index) => (index === token ? move.to : p));
  let tokens = replaceTokens(state, seat, mine);
  let extra = state.roll === SIX;

  if (move.captures !== null) {
    const victim = move.captures;
    const colour = state.colours[seat] ?? 0;
    const square = trackSquare(colour, move.to);
    const victimColour = state.colours[victim] ?? 0;
    const sent = (state.tokens[victim] ?? []).map((p) =>
      square !== null && trackSquare(victimColour, p) === square ? IN_BASE : p,
    );
    const victimToken = (state.tokens[victim] ?? []).findIndex(
      (p) => square !== null && trackSquare(victimColour, p) === square,
    );
    tokens = tokens.map((row, index) => (index === victim ? sent : row));
    events.push({ type: 'CAPTURED', seat, victim, token: victimToken });
    extra = true;
  }

  let finished = state.finished;
  if (move.reachesHome) {
    events.push({ type: 'TOKEN_HOME', seat, token });
    extra = true;
    if (mine.every((p) => p === HOME_POSITION)) {
      finished = [...finished, seat];
      events.push({ type: 'SEAT_FINISHED', seat, place: finished.length });
    }
  }

  let next: LudoState = {
    ...state,
    tokens,
    finished,
    phase: 'roll',
    roll: null,
  };
  const seatDone = finished.includes(seat);
  if (seatDone || activeSeats(next).length <= 1) {
    next = settle(next, events);
    if (next.phase === 'finished') return { ok: true, state: next, events };
    return { ok: true, state: passTurn(next, events), events };
  }
  if (extra) {
    events.push({ type: 'EXTRA_ROLL', seat });
    return { ok: true, state: next, events };
  }
  return { ok: true, state: passTurn({ ...next, sixes: 0 }, events), events };
}

/** The fixed fallback when a turn times out: the legal move for the token closest to home. */
export function defaultLudoMove(state: LudoState): number | null {
  const moves = legalLudoMoves(state);
  if (moves.length === 0) return null;
  const best = [...moves].sort((a, b) => b.from - a.from || a.token - b.token)[0];
  return best?.token ?? null;
}

/** Removes a seat (left, disconnected, timed out). The game continues if two or more remain. */
export function removeLudoSeat(
  state: LudoState,
  seat: LudoSeat,
  reason: 'forfeit' | 'timeout',
): LudoResult {
  if (state.phase === 'finished') return fail('GAME_FINISHED');
  if (seat >= state.players) return fail('INVALID_SEAT');
  if (!isActiveSeat(state, seat)) return fail('INVALID_SEAT');

  const events: LudoEvent[] = [{ type: 'SEAT_REMOVED', seat, reason }];
  // Their tokens leave the board.
  let next: LudoState = {
    ...state,
    removed: [...state.removed, seat],
    tokens: replaceTokens(state, seat, Array<number>(TOKENS_PER_PLAYER).fill(IN_BASE)),
  };
  const settled = settle(next, events);
  if (settled.phase === 'finished') return { ok: true, state: settled, events };
  if (state.toMove === seat) {
    next = passTurn({ ...next, toMove: seat }, events);
    return { ok: true, state: next, events };
  }
  return { ok: true, state: next, events };
}

function withAi(state: LudoState, seat: LudoSeat, value: boolean): LudoState {
  return { ...state, ai: state.ai.map((flag, index) => (index === seat ? value : flag)) };
}

/** The AI starts covering a seat whose player dropped off. Does nothing to a seat already covered. */
export function startLudoAiCover(state: LudoState, seat: LudoSeat): LudoResult {
  if (state.phase === 'finished') return fail('GAME_FINISHED');
  if (seat >= state.players || !isActiveSeat(state, seat)) return fail('INVALID_SEAT');
  if (isAiCovered(state, seat)) return fail('NOT_COVERED');
  return {
    ok: true,
    state: withAi(state, seat, true),
    events: [{ type: 'AI_COVER_STARTED', seat }],
  };
}

/** Is the AI playing this seat for its (away) player? */
export function isAiCovered(state: LudoState, seat: LudoSeat): boolean {
  return state.ai[seat] === true;
}

/**
 * The player acted, or asked for the seat back: the AI stops and the count of covered turns
 * restarts. Does nothing (and returns no events) for a seat the AI is not covering.
 */
export function takeBackLudoSeat(
  state: LudoState,
  seat: LudoSeat,
): { state: LudoState; events: LudoEvent[] } {
  if (!isAiCovered(state, seat) && (state.consecutiveTimeouts[seat] ?? 0) === 0) {
    return { state, events: [] };
  }
  const events: LudoEvent[] = isAiCovered(state, seat) ? [{ type: 'AI_COVER_ENDED', seat }] : [];
  return { state: withAi(withTimeouts2(state, seat, 0), seat, false), events };
}

function withTimeouts2(state: LudoState, seat: LudoSeat, value: number): LudoState {
  return { ...state, consecutiveTimeouts: withTimeouts(state, seat, value) };
}

/** Which token the AI moves; null means no choice (it falls back to the fixed default move). */
export type LudoTokenChooser = (state: LudoState) => number | null;

/**
 * A turn ran out of time. The AI starts covering that seat and plays this whole turn. After
 * LUDO_AI_COVER_MAX_TURNS covered turns in a row the seat is removed instead.
 */
export function applyLudoTimeout(
  state: LudoState,
  rollValue: number,
  choose: LudoTokenChooser = defaultLudoMove,
): LudoResult {
  if (state.phase === 'finished') return fail('GAME_FINISHED');
  const seat = state.toMove;
  const turns = (state.consecutiveTimeouts[seat] ?? 0) + 1;
  if (turns > LUDO_AI_COVER_MAX_TURNS) return removeLudoSeat(state, seat, 'timeout');

  const events: LudoEvent[] = [];
  let current = withTimeouts2(state, seat, turns);
  if (!isAiCovered(current, seat)) {
    current = withAi(current, seat, true);
    events.push({ type: 'AI_COVER_STARTED', seat });
  }
  if (current.phase === 'roll') {
    const rolled = applyLudoRoll(current, seat, rollValue);
    if (!rolled.ok) return rolled;
    events.push(...rolled.events);
    current = rolled.state;
    // The rolled die may already have ended the turn (no move, third six).
    if (current.phase !== 'move' || current.toMove !== seat) {
      return { ok: true, state: current, events };
    }
  }
  const token = choose(current) ?? defaultLudoMove(current);
  if (token === null) {
    return { ok: true, state: passTurn(current, events), events };
  }
  const moved = applyLudoMove(current, seat, token);
  if (!moved.ok) return moved;
  events.push(...moved.events);
  return { ok: true, state: moved.state, events };
}

/**
 * One step (a roll, or a move) for a seat the AI is covering. The first step of a turn counts
 * toward LUDO_AI_COVER_MAX_TURNS. Goes through the same validators as a human step.
 */
export function applyLudoCoverStep(
  state: LudoState,
  rollValue: number,
  choose: LudoTokenChooser,
): LudoResult {
  if (state.phase === 'finished') return fail('GAME_FINISHED');
  const seat = state.toMove;
  if (!isAiCovered(state, seat)) return fail('NOT_COVERED');
  if (state.phase === 'roll') {
    const turns = (state.consecutiveTimeouts[seat] ?? 0) + 1;
    if (turns > LUDO_AI_COVER_MAX_TURNS) return removeLudoSeat(state, seat, 'timeout');
    return applyLudoRoll(withTimeouts2(state, seat, turns), seat, rollValue);
  }
  const token = choose(state) ?? defaultLudoMove(state);
  if (token === null) return fail('ILLEGAL_MOVE');
  return applyLudoMove(state, seat, token);
}

/**
 * Who receives what from the pot: the first player still in the game takes it all, except that
 * with 4 players two-thirds goes to first and the rest to second. A seat that left gets nothing.
 */
export function ludoPayouts(
  pot: number,
  players: LudoPlayerCount,
  placings: readonly LudoSeat[],
  removed: readonly LudoSeat[],
): { seat: LudoSeat; amount: number }[] {
  const eligible = placings.filter((seat) => !removed.includes(seat));
  const first = eligible[0];
  if (first === undefined || pot <= 0) return [];
  const second = eligible[1];
  if (players === 4 && second !== undefined) {
    const top = Math.floor((pot * 2) / 3);
    return [
      { seat: first, amount: top },
      { seat: second, amount: pot - top },
    ];
  }
  return [{ seat: first, amount: pot }];
}

/** Number of tokens a seat has home. */
export function tokensHome(state: LudoState, seat: LudoSeat): number {
  return (state.tokens[seat] ?? []).filter((p) => p === HOME_POSITION).length;
}

/** Checks the invariants that must hold in every reachable state. Returns the problems found. */
export function checkLudoInvariants(state: LudoState): string[] {
  const problems: string[] = [];
  if (state.tokens.length !== state.players) problems.push('wrong number of players');
  const squares = new Map<number, Map<LudoSeat, number>>();
  seatsOf(state).forEach((seat) => {
    const row = state.tokens[seat] ?? [];
    if (row.length !== TOKENS_PER_PLAYER) problems.push(`seat ${String(seat)} token count`);
    row.forEach((p) => {
      if (!Number.isInteger(p) || p < IN_BASE || p > HOME_POSITION) {
        problems.push(`seat ${String(seat)} position ${String(p)} out of range`);
      }
      const square = trackSquare(state.colours[seat] ?? 0, p);
      if (square !== null) {
        const bySeat = squares.get(square) ?? new Map<LudoSeat, number>();
        bySeat.set(seat, (bySeat.get(seat) ?? 0) + 1);
        squares.set(square, bySeat);
      }
    });
  });
  for (const [square, bySeat] of squares) {
    if (!isSafeSquare(square) && bySeat.size > 1) {
      problems.push(`square ${String(square)} shared by different colours`);
    }
  }
  for (const seat of state.removed) {
    if ((state.tokens[seat] ?? []).some((p) => p !== IN_BASE)) {
      problems.push(`removed seat ${String(seat)} still has tokens on the board`);
    }
  }
  for (const seat of state.finished) {
    if (tokensHome(state, seat) !== TOKENS_PER_PLAYER)
      problems.push(`finished seat ${String(seat)}`);
  }
  if (state.phase !== 'finished') {
    if (!isActiveSeat(state, state.toMove)) problems.push('turn belongs to a seat that is out');
    if (activeSeats(state).length < 2) problems.push('game should have ended');
    if (state.phase === 'move' && legalLudoMoves(state).length === 0) {
      problems.push('waiting for a move that does not exist');
    }
    if (state.phase === 'roll' && state.roll !== null) problems.push('die set while rolling');
  } else {
    const placings = state.placings ?? [];
    if (new Set(placings).size !== state.players || placings.length !== state.players) {
      problems.push('placings are not a permutation of the seats');
    }
  }
  return problems;
}
