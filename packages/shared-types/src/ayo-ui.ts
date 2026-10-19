import type { AyoStepView, AyoView, MatchView, PlayerSeat } from './matches.js';
import { displayName, type StatusLine } from './match-ui.js';

type AyoBefore = NonNullable<AyoView['last']>['before'];

/**
 * Pure helpers for the Ayo screen: what to say, which pits are tappable, how the board is turned
 * for each seat, and how a turn is replayed for the animation. The server decides everything about
 * the game; nothing here knows a rule, it only follows what the server sends.
 */

export function ayoOf(view: MatchView): AyoView | null {
  return view.gameId === 'ayo' ? view.ayo : null;
}

/** True when it is my turn to lift a pit (and nobody has to choose quit or continue first). */
export function ayoCanMove(view: MatchView): boolean {
  const game = ayoOf(view);
  return (
    view.status === 'ACTIVE' &&
    game !== null &&
    game.decision === null &&
    game.toMove === view.mySeat
  );
}

/** The pits I can lift now. */
export function ayoMovable(view: MatchView): number[] {
  const game = ayoOf(view);
  return ayoCanMove(view) && game !== null ? [...game.moves] : [];
}

/** The pits a seat owns this round (they change between rounds). */
export function ayoOwnPits(owners: readonly PlayerSeat[], seat: PlayerSeat): number[] {
  const out: number[] = [];
  owners.forEach((owner, pit) => {
    if (owner === seat) out.push(pit);
  });
  return out;
}

/**
 * Pit numbers for the top and bottom rows of the screen, left to right. Each player sees their own
 * starting row at the bottom and the ring running counter-clockwise (left to right along the bottom).
 */
export function ayoRows(mySeat: PlayerSeat): { top: number[]; bottom: number[] } {
  return mySeat === 0
    ? { top: [11, 10, 9, 8, 7, 6], bottom: [0, 1, 2, 3, 4, 5] }
    : { top: [5, 4, 3, 2, 1, 0], bottom: [6, 7, 8, 9, 10, 11] };
}

/**
 * The upright board: two columns of six bowls. My column is on the right and the ring runs up it
 * (bottom to top), then down the opponent's column on the left, which is counter-clockwise.
 * Each list is top to bottom. Pits stay where they are; the colour of a bowl follows its owner.
 */
export function ayoColumns(mySeat: PlayerSeat): { left: number[]; right: number[] } {
  return mySeat === 0
    ? { right: [5, 4, 3, 2, 1, 0], left: [6, 7, 8, 9, 10, 11] }
    : { right: [11, 10, 9, 8, 7, 6], left: [0, 1, 2, 3, 4, 5] };
}

/**
 * How long each kind of step stays on screen while a turn is replayed (milliseconds): RRYDA's
 * timings. The server uses the same numbers to start the next turn clock only after everyone has
 * watched the move, so watching never costs anyone time.
 */
export const AYO_REPLAY_MS = {
  lift: 320,
  drop: 220,
  pack: 600,
  final: 800,
  round: 3000,
  maxTurn: 9000,
  /** Slack added to every replayed move. */
  slack: 300,
} as const;

/** The time a drop stays on screen: shortened for a very long sow so the move never drags on. */
export function ayoDropMs(steps: readonly AyoStepView[]): number {
  const drops = steps.filter((step) => step.k === 'drop').length;
  return drops > 0
    ? Math.min(AYO_REPLAY_MS.drop, Math.floor(AYO_REPLAY_MS.maxTurn / drops))
    : AYO_REPLAY_MS.drop;
}

/** How long replaying `steps` takes. */
export function ayoAnimationMs(steps: readonly AyoStepView[]): number {
  const dropMs = ayoDropMs(steps);
  let ms = 0;
  for (const step of steps) {
    if (step.k === 'drop') ms += dropMs;
    else if (step.k === 'lift') ms += AYO_REPLAY_MS.lift;
    else if (step.k === 'pack') ms += AYO_REPLAY_MS.pack;
    else if (step.k === 'final') ms += AYO_REPLAY_MS.final;
    else ms += AYO_REPLAY_MS.round;
  }
  return ms + AYO_REPLAY_MS.slack;
}

/** One picture of a replayed turn: the board, who has seeds in hand, and what just happened. */
export interface AyoReplayFrame {
  pits: number[];
  owners: PlayerSeat[];
  packed: [number, number];
  /** The pit the step is about (lit up on screen); -1 when it is about the whole board. */
  focus: number;
  /** Seeds still in the sower's hand after this step. */
  hand: number;
  /** Every pit a seed has been dropped into so far this turn. */
  trail: number[];
  kind: AyoStepView['k'];
  /** Set on the frame that starts a new round, for the banner. */
  round: number | null;
  /** How long to show this frame. */
  ms: number;
}

/**
 * The turn as a list of frames, starting from the table before the move: seeds in hand, a trail of
 * pits already sown, the packed totals, the closing steps of a round, and a time for each frame.
 */
export function ayoReplayTimeline(
  before: AyoBefore,
  steps: readonly AyoStepView[],
): AyoReplayFrame[] {
  const dropMs = ayoDropMs(steps);
  let board = [...before.pits];
  let owners = [...before.owners];
  const packed: [number, number] = [before.packed[0], before.packed[1]];
  const trail: number[] = [];
  let hand = 0;
  const frames: AyoReplayFrame[] = [];
  for (const step of steps) {
    let ms: number = dropMs;
    let focus = -1;
    let round: number | null = null;
    if (step.k === 'lift') {
      board[step.pit] = 0;
      hand = step.count;
      focus = step.pit;
      ms = AYO_REPLAY_MS.lift;
    } else if (step.k === 'drop') {
      board[step.pit] = (board[step.pit] ?? 0) + 1;
      hand = Math.max(0, hand - 1);
      focus = step.pit;
      if (!trail.includes(step.pit)) trail.push(step.pit);
    } else if (step.k === 'pack') {
      board[step.pit] = 0;
      if (step.by === 0 || step.by === 1) packed[step.by] += step.amount;
      focus = step.pit;
      ms = AYO_REPLAY_MS.pack;
    } else if (step.k === 'final') {
      board = Array.from({ length: board.length }, () => 0);
      if (step.by === 0 || step.by === 1) packed[step.by] += step.amount;
      ms = AYO_REPLAY_MS.final;
    } else {
      board = Array.from({ length: board.length }, () => 4);
      owners = [...step.owners];
      packed[0] = 0;
      packed[1] = 0;
      round = step.round;
      ms = AYO_REPLAY_MS.round;
    }
    frames.push({
      pits: [...board],
      owners: [...owners],
      packed: [packed[0], packed[1]],
      focus,
      hand,
      trail: [...trail],
      kind: step.k,
      round,
      ms,
    });
  }
  return frames;
}

/** The packs of a turn, in order. */
export function ayoPacks(
  steps: readonly AyoStepView[],
): { pit: number; by: PlayerSeat; amount: number }[] {
  return steps.flatMap((step) =>
    step.k === 'pack' ? [{ pit: step.pit, by: step.by, amount: step.amount }] : [],
  );
}

const REASONS: Record<NonNullable<AyoView['endReason']>, string> = {
  no_pits: 'A player has no pit left',
  quit: 'A player quit with one pit',
  max_rounds: 'The last round was played: more pits wins',
  timeout: 'A player ran out of time three turns in a row',
  forfeit: 'A player left the game',
};

/** What happened in the round that just finished, for the banner at the top. */
export function ayoRoundNote(view: MatchView): string | null {
  const game = ayoOf(view);
  if (!game || game.lastRound === null || game.phase === 'finished') return null;
  const me = view.mySeat === 1 ? 1 : 0;
  const mine = game.lastRound.packed[me];
  const theirs = game.lastRound.packed[me === 0 ? 1 : 0];
  return `Round ${String(game.lastRound.round)}: you packed ${String(mine)}, they packed ${String(theirs)}`;
}

/** How many pits each seat has this round, from the owners. */
export function ayoPitCounts(owners: readonly PlayerSeat[]): [number, number] {
  const mine = owners.filter((owner) => owner === 0).length;
  return [mine, owners.length - mine];
}

/** The quit-or-continue control: choose it, wait for the other player, or nothing. */
export function ayoDecisionControl(view: MatchView): 'choose' | 'waiting' | 'none' {
  const game = ayoOf(view);
  if (view.status !== 'ACTIVE' || game === null || game.phase !== 'playing') return 'none';
  if (game.decision === null) return 'none';
  return game.decision === view.mySeat ? 'choose' : 'waiting';
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
      if (game.decision !== null) {
        if (game.decision === view.mySeat) {
          return {
            headline: `One pit left${timer}`,
            detail: 'Quit and lose, or keep playing',
            tone: 'warn',
          };
        }
        const them = player(game.decision);
        const name = them ? displayName(them) : 'Opponent';
        return {
          headline: `${name} is choosing${timer}`,
          detail: `${name} started the round with one pit: quit or continue`,
          tone: 'neutral',
        };
      }
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
