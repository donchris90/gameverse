import type { DraughtsMoveView, DraughtsView, MatchView, PlayerSeat } from './matches.js';
import { displayName, type StatusLine } from './match-ui.js';

/**
 * Pure helpers for the Draughts screen: what to say, what is tappable, how a multi-jump is
 * entered, how the board is turned for each seat. The server decides everything about the game;
 * nothing here knows a rule, it only follows the list of legal moves the server sends.
 */

export function draughtsOf(view: MatchView): DraughtsView | null {
  return view.gameId === 'draughts' ? view.draughts : null;
}

/** True when it is my turn to move a piece. */
export function draughtsCanMove(view: MatchView): boolean {
  const game = draughtsOf(view);
  return view.status === 'ACTIVE' && game !== null && game.toMove === view.mySeat;
}

/** Squares holding a piece I can start a move from now. */
export function draughtsMovable(view: MatchView): number[] {
  const game = draughtsOf(view);
  if (!draughtsCanMove(view) || game === null) return [];
  return [...new Set(game.moves.map((move) => move.from))];
}

export interface DraughtsStep {
  /** A move that the squares tapped so far complete, if any. */
  complete: DraughtsMoveView | null;
  /** Squares that may be tapped next. */
  next: number[];
}

/**
 * Follows the squares the player has tapped. A piece is chosen first (`from`); a capture is
 * entered one landing square at a time (`path`). The server's moves are the only source.
 */
export function draughtsStep(
  moves: readonly DraughtsMoveView[],
  from: number,
  path: readonly number[],
): DraughtsStep {
  const sameStart = moves.filter((move) => move.from === from);
  const complete =
    sameStart.find(
      (move) => move.path.length === path.length && move.path.every((s, i) => s === path[i]),
    ) ?? null;
  const next = new Set<number>();
  for (const move of sameStart) {
    if (move.path.length > path.length && path.every((s, i) => s === move.path[i])) {
      next.add(move.path[path.length] as number);
    }
  }
  return { complete, next: [...next] };
}

/**
 * Board squares in the order they are drawn, top-left first. Seat 1 sees the board turned round so
 * that their own pieces are at the bottom.
 */
export function draughtsDrawOrder(mySeat: PlayerSeat): number[] {
  return Array.from({ length: 64 }, (_unused, index) => (mySeat === 1 ? 63 - index : index));
}

const FILES = 'abcdefgh';

/** "b3" style name of a square, from the point of view of the seat that sees the board upright. */
export function squareName(square: number): string {
  return `${FILES[square % 8] ?? '?'}${String(8 - Math.floor(square / 8))}`;
}

export function pieceName(cell: number): string {
  switch (cell) {
    case 1:
      return 'man of the first player';
    case 2:
      return 'king of the first player';
    case 3:
      return 'man of the second player';
    case 4:
      return 'king of the second player';
    default:
      return 'empty';
  }
}

export function draughtsCounts(game: DraughtsView): [number, number] {
  let a = 0;
  let b = 0;
  for (const cell of game.board) {
    if (cell === 1 || cell === 2) a += 1;
    else if (cell === 3 || cell === 4) b += 1;
  }
  return [a, b];
}

const REASONS: Record<NonNullable<DraughtsView['endReason']>, string> = {
  no_pieces: 'All of the other pieces were captured',
  no_moves: 'The other side had no move left',
  repetition: 'The same position came up three times',
  forty_moves: '40 moves each with no capture',
  timeout: 'Out of time',
  forfeit: 'A player left the game',
};

/** The one line (plus detail) that says what is going on. */
export function draughtsStatus(view: MatchView, turnSecondsLeft: number | null): StatusLine {
  const game = draughtsOf(view);
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
        const mustCapture = game.moves.some((move) => move.captures.length > 0);
        return {
          headline: `Your move${timer}`,
          detail: mustCapture ? 'You must capture' : null,
          tone: 'good',
        };
      }
      const them = player(game.toMove);
      const name = them ? displayName(them) : 'Opponent';
      if (them && them.bot === null && !them.connected) {
        return {
          headline: `Waiting for ${name}`,
          detail: `${name} lost connection. If they do not come back they lose the game`,
          tone: 'warn',
        };
      }
      return { headline: `${name}'s move${timer}`, detail: null, tone: 'neutral' };
    }
  }
}
