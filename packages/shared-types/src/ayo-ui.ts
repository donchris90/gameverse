import type { AyoStepView, AyoView, MatchView, PlayerSeat } from './matches.js';
import { displayName, type StatusLine } from './match-ui.js';

/**
 * Pure helpers for the Ayo screen: what to say, which pits are tappable, how the board is turned
 * for each seat, and how a turn is replayed for the animation. The server decides everything about
 * the game; nothing here knows a rule, it only follows what the server sends.
 */

export function ayoOf(view: MatchView): AyoView | null {
  return view.gameId === 'ayo' ? view.ayo : null;
}

/** True when it is my turn to lift a pit. */
export function ayoCanMove(view: MatchView): boolean {
  const game = ayoOf(view);
  return view.status === 'ACTIVE' && game !== null && game.toMove === view.mySeat;
}

/** The pits I can lift now. */
export function ayoMovable(view: MatchView): number[] {
  const game = ayoOf(view);
  return ayoCanMove(view) && game !== null ? [...game.moves] : [];
}

/**
 * Pit numbers for the top and bottom rows of the screen, left to right. Each player sees their own
 * row at the bottom and the ring running counter-clockwise (left to right along the bottom).
 */
export function ayoRows(mySeat: PlayerSeat): { top: number[]; bottom: number[] } {
  return mySeat === 0
    ? { top: [11, 10, 9, 8, 7, 6], bottom: [0, 1, 2, 3, 4, 5] }
    : { top: [5, 4, 3, 2, 1, 0], bottom: [6, 7, 8, 9, 10, 11] };
}

/** The pits of a seat's own row. */
export const ayoOwnPits = (seat: PlayerSeat): number[] =>
  seat === 0 ? [0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11];

/**
 * Board states while a turn is replayed: one per drop, lift or reap, starting from the board
 * before the turn. The last frame is where the replay ends; the screen then shows the real board.
 */
export function ayoReplayFrames(
  before: readonly number[],
  steps: readonly AyoStepView[],
): number[][] {
  const frames: number[][] = [];
  const board = [...before];
  for (const step of steps) {
    if (step.k === 'lift') board[step.pit] = 0;
    else if (step.k === 'drop') board[step.pit] = (board[step.pit] ?? 0) + 1;
    else if (step.all) board.fill(0);
    else board[step.pit] = 0;
    frames.push([...board]);
  }
  return frames;
}

/**
 * The upright board: two columns of six bowls. My column is on the right and the ring runs up it
 * (bottom to top), then down the opponent's column on the left, which is counter-clockwise.
 * Each list is top to bottom.
 */
export function ayoColumns(mySeat: PlayerSeat): { left: number[]; right: number[] } {
  return mySeat === 0
    ? { right: [5, 4, 3, 2, 1, 0], left: [6, 7, 8, 9, 10, 11] }
    : { right: [11, 10, 9, 8, 7, 6], left: [0, 1, 2, 3, 4, 5] };
}

/** How long each kind of step stays on screen while a turn is replayed (milliseconds). */
export const AYO_REPLAY_MS = {
  lift: 320,
  drop: 220,
  reap: 600,
  reapAll: 800,
  maxTurn: 9000,
} as const;

/** One picture of a replayed turn: the board, who has seeds in hand, and what just happened. */
export interface AyoReplayFrame {
  pits: number[];
  stores: [number, number];
  /** The pit the step is about (lit up on screen). */
  focus: number;
  /** Seeds still in the sower's hand after this step. */
  hand: number;
  /** Every pit a seed has been dropped into so far this turn. */
  trail: number[];
  kind: 'lift' | 'drop' | 'reap';
  /** How long to show this frame. */
  ms: number;
}

/**
 * The turn as a list of frames with seeds in hand, a trail of pits already sown, the reaped totals
 * and a time for each step. A long turn is sped up so it never takes more than `maxTurn` to drop.
 */
export function ayoReplayTimeline(
  before: readonly number[],
  storesBefore: readonly [number, number],
  steps: readonly AyoStepView[],
): AyoReplayFrame[] {
  const drops = steps.filter((step) => step.k === 'drop').length;
  const dropMs =
    drops > 0
      ? Math.min(AYO_REPLAY_MS.drop, Math.floor(AYO_REPLAY_MS.maxTurn / drops))
      : AYO_REPLAY_MS.drop;
  const board = [...before];
  const stores: [number, number] = [storesBefore[0], storesBefore[1]];
  const trail: number[] = [];
  let hand = 0;
  const frames: AyoReplayFrame[] = [];
  for (const step of steps) {
    let ms: number = dropMs;
    if (step.k === 'lift') {
      board[step.pit] = 0;
      hand = step.count;
      ms = AYO_REPLAY_MS.lift;
    } else if (step.k === 'drop') {
      board[step.pit] = (board[step.pit] ?? 0) + 1;
      hand = Math.max(0, hand - 1);
      if (!trail.includes(step.pit)) trail.push(step.pit);
    } else {
      if (step.all) board.fill(0);
      else board[step.pit] = 0;
      if (step.by === 0 || step.by === 1) stores[step.by] += step.amount;
      ms = step.all ? AYO_REPLAY_MS.reapAll : AYO_REPLAY_MS.reap;
    }
    frames.push({
      pits: [...board],
      stores: [stores[0], stores[1]],
      focus: step.pit,
      hand,
      trail: [...trail],
      kind: step.k,
      ms,
    });
  }
  return frames;
}

/** The pit each frame of a replay is about (for highlighting), same length as the frames. */
export function ayoReplayFocus(steps: readonly AyoStepView[]): number[] {
  return steps.map((step) => step.pit);
}

export function ayoReaps(
  steps: readonly AyoStepView[],
): { pit: number; by: PlayerSeat; amount: number }[] {
  return steps.flatMap((step) =>
    step.k === 'reap' ? [{ pit: step.pit, by: step.by, amount: step.amount }] : [],
  );
}

const REASONS: Record<NonNullable<AyoView['endReason']>, string> = {
  one_pit: 'A player is down to one pit',
  agreement: 'Ended by agreement',
  timeout: 'Out of time',
  forfeit: 'A player left the game',
};

/** What happened in the round that just finished, for the banner at the top. */
export function ayoRoundNote(view: MatchView): string | null {
  const game = ayoOf(view);
  if (!game || game.lastRound === null || game.phase === 'finished') return null;
  const who = game.lastRound.winner === view.mySeat ? 'You' : 'They';
  return `Round ${String(game.lastRound.round)}: ${who} took the last ${String(game.lastRound.took)} seeds`;
}

/** The end-game control to show: offer it, answer an offer, or wait. */
export function ayoEndControl(view: MatchView): 'offer' | 'answer' | 'waiting' | 'none' {
  const game = ayoOf(view);
  if (view.status !== 'ACTIVE' || game === null || game.phase !== 'playing') return 'none';
  const opponent = view.players.find((player) => player.seat !== view.mySeat);
  if (opponent && opponent.bot !== null) return 'none';
  if (game.endOffer === null) return game.canOfferEnd ? 'offer' : 'none';
  return game.endOffer === view.mySeat ? 'waiting' : 'answer';
}

/** The one line (plus detail) that says what is going on. */
export function ayoStatus(view: MatchView, turnSecondsLeft: number | null): StatusLine {
  const game = ayoOf(view);
  const player = (seat: number) => view.players.find((candidate) => candidate.seat === seat);
  switch (view.status) {
    case 'CANCELLED':
      return { headline: 'Match cancelled', detail: null, tone: 'neutral' };
    case 'EXPIRED':
      return {
        headline: 'Match expired',
        detail: 'Not everyone pressed ready in time',
        tone: 'warn',
      };
    case 'ABANDONED':
      return { headline: 'Match abandoned', detail: null, tone: 'warn' };
    case 'COMPLETED': {
      const reason = game?.endReason ? REASONS[game.endReason] : null;
      if (game?.winner === 'draw') return { headline: 'Draw', detail: reason, tone: 'neutral' };
      if (view.endReason === 'left' || view.endReason === 'disconnected') {
        return view.winnerSeat === view.mySeat
          ? { headline: 'You won!', detail: 'The other player left', tone: 'good' }
          : { headline: 'You left the game', detail: null, tone: 'bad' };
      }
      return view.winnerSeat === view.mySeat
        ? { headline: 'You won!', detail: reason, tone: 'good' }
        : { headline: 'You lost', detail: reason, tone: 'bad' };
    }
    case 'WAITING':
    case 'READY': {
      const me = player(view.mySeat);
      if (me && !me.ready)
        return { headline: 'Press Ready to start', detail: null, tone: 'neutral' };
      return { headline: 'Waiting for the other player', detail: null, tone: 'neutral' };
    }
    case 'ACTIVE': {
      if (game === null || game.toMove === null) {
        return { headline: 'Starting…', detail: null, tone: 'neutral' };
      }
      const timer = turnSecondsLeft === null ? '' : ` · ${String(turnSecondsLeft)}s`;
      if (game.toMove === view.mySeat) {
        return { headline: `Your move${timer}`, detail: 'Pick one of your pits', tone: 'good' };
      }
      const them = player(game.toMove);
      const name = them ? displayName(them) : 'Opponent';
      if (them && them.bot === null && !them.connected) {
        return {
          headline: `Waiting for ${name}`,
          detail: `${name} lost connection. If they do not come back they lose the match`,
          tone: 'warn',
        };
      }
      return { headline: `${name}'s move${timer}`, detail: null, tone: 'neutral' };
    }
  }
}
