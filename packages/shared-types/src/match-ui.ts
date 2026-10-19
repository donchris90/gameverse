import type { MatchPlayerView, MatchView } from './matches.js';

/**
 * Pure helpers that turn a server `MatchView` into what a screen shows. They hold every decision
 * the match screen makes (whose turn, what to say, which update to keep, how many seconds are
 * left), so those decisions are tested here rather than inside React components.
 */

export type Outcome = 'win' | 'loss' | 'draw';
export type Tone = 'neutral' | 'good' | 'bad' | 'warn';
export interface StatusLine {
  headline: string;
  detail: string | null;
  tone: Tone;
}

export function opponentOf(view: MatchView): MatchPlayerView {
  const other = view.players.find((player) => player.seat !== view.mySeat);
  if (!other) throw new Error('A match always has two seats');
  return other;
}

export function me(view: MatchView): MatchPlayerView {
  const mine = view.players.find((player) => player.seat === view.mySeat);
  if (!mine) throw new Error('The viewer is always seated');
  return mine;
}

/** Display name for a seat; bots are always labelled as bots. */
export function displayName(player: MatchPlayerView): string {
  return player.bot !== null ? `Bot (${player.bot})` : player.username;
}

export function outcomeFor(view: MatchView): Outcome | null {
  if (view.status !== 'COMPLETED') return null;
  const winner = view.series?.winner ?? null;
  if (winner === null) return null;
  if (winner === 'draw') return 'draw';
  return winner === view.mySeat ? 'win' : 'loss';
}

/** The viewer's mark in the current game: whoever opened the game plays X. */
export function myMark(view: MatchView): 'X' | 'O' | null {
  if (view.series === null) return null;
  return view.series.firstSeat === view.mySeat ? 'X' : 'O';
}

/** Seconds each tic-tac-toe turn lasts; the server uses the same number (game-rules TURN_TIMER_MS). */
export const TTT_TURN_SECONDS = 15;

/**
 * "Get ready" before game 1: the server starts the turn clock only after it, so while the clock
 * shows more than a full turn the board is not open yet.
 */
export function isGetReady(view: MatchView, turnSecondsLeft: number | null): boolean {
  const series = view.series;
  if (series === null || view.status !== 'ACTIVE' || series.phase !== 'playing') return false;
  if (series.gameNumber !== 1 || series.board.some((cell) => cell !== null)) return false;
  return turnSecondsLeft !== null && turnSecondsLeft > TTT_TURN_SECONDS;
}

export function canMove(view: MatchView): boolean {
  return (
    view.status === 'ACTIVE' &&
    view.series?.phase === 'playing' &&
    view.series.seatToMove === view.mySeat
  );
}

export function canPressReady(view: MatchView): boolean {
  return (view.status === 'READY' || view.status === 'WAITING') && !me(view).ready;
}

export function isOpen(view: MatchView): boolean {
  return view.status === 'WAITING' || view.status === 'READY' || view.status === 'ACTIVE';
}

/** Which cells the viewer may tap right now. */
export function tappableCells(view: MatchView): number[] {
  if (!canMove(view) || view.series === null) return [];
  return view.series.board.flatMap((cell, index) => (cell === null ? [index] : []));
}

/** Keep an incoming update only if it is not older than what the screen already has. */
export function shouldApply(current: MatchView | null, incoming: MatchView): boolean {
  if (current === null || current.id !== incoming.id) return true;
  return incoming.version >= current.version;
}

/** Milliseconds to add to the phone's clock to get server time. */
export function clockOffset(serverTimeIso: string, receivedAtMs: number): number {
  return Date.parse(serverTimeIso) - receivedAtMs;
}

/** Whole seconds until `atIso`, never negative, using the server clock offset. */
export function secondsLeft(atIso: string, offsetMs: number, nowMs: number): number {
  const remaining = Date.parse(atIso) - (nowMs + offsetMs);
  return Math.max(0, Math.ceil(remaining / 1000));
}

export function scoreLine(view: MatchView): string {
  const series = view.series;
  if (series === null) return '';
  // One game decides a single-game match: a running score would only be noise.
  if (series.bestOf === 1) return '';
  const mySide = view.mySeat === 1 ? 1 : 0;
  const mine = series.wins[mySide];
  const theirs = series.wins[mySide === 0 ? 1 : 0];
  const draws = series.draws > 0 ? ` (${String(series.draws)} drawn)` : '';
  return `${String(mine)} – ${String(theirs)}${draws}`;
}

function completedLine(view: MatchView, outcome: Outcome): StatusLine {
  const name = displayName(opponentOf(view));
  const reason = view.endReason;
  if (outcome === 'draw') {
    const detail =
      view.series?.endReason === 'draw_limit'
        ? `${String(view.series.drawLimit)} drawn games in a row`
        : scoreLine(view);
    return { headline: 'The match is a draw', detail, tone: 'neutral' };
  }
  if (outcome === 'win') {
    const detail =
      reason === 'left'
        ? `${name} left the match`
        : reason === 'disconnected'
          ? `${name} lost connection`
          : reason === 'forfeit'
            ? `${name} ran out of time`
            : scoreLine(view);
    return { headline: 'You won the match!', detail, tone: 'good' };
  }
  const detail =
    reason === 'left'
      ? 'You left the match'
      : reason === 'disconnected'
        ? 'You were disconnected for too long'
        : reason === 'forfeit'
          ? 'You ran out of time'
          : scoreLine(view);
  return { headline: 'You lost the match', detail, tone: 'bad' };
}

/** The one line (plus detail) that tells the player what is going on. */
export function statusLine(view: MatchView, turnSecondsLeft: number | null): StatusLine {
  const opponent = opponentOf(view);
  const name = displayName(opponent);

  switch (view.status) {
    case 'CANCELLED':
      return { headline: 'Match cancelled', detail: null, tone: 'neutral' };
    case 'EXPIRED':
      return { headline: 'Match expired', detail: 'Nobody pressed ready in time', tone: 'warn' };
    case 'ABANDONED':
      return { headline: 'Match abandoned', detail: null, tone: 'warn' };
    case 'COMPLETED': {
      const outcome = outcomeFor(view);
      return outcome === null
        ? { headline: 'Match finished', detail: null, tone: 'neutral' }
        : completedLine(view, outcome);
    }
    case 'WAITING':
    case 'READY': {
      if (!me(view).ready) {
        return {
          headline: 'Press Ready to start',
          detail: opponent.ready ? `${name} is ready` : `Waiting for ${name}`,
          tone: 'neutral',
        };
      }
      return {
        headline: `Waiting for ${name}`,
        detail: 'They need to press Ready',
        tone: 'neutral',
      };
    }
    case 'ACTIVE': {
      const series = view.series;
      if (series === null) return { headline: 'Starting…', detail: null, tone: 'neutral' };
      if (series.phase === 'between_games') {
        return { headline: 'Next game starting…', detail: scoreLine(view), tone: 'neutral' };
      }
      if (isGetReady(view, turnSecondsLeft)) {
        return { headline: 'Get ready…', detail: scoreLine(view) || null, tone: 'neutral' };
      }
      const drawNote =
        series.drawStreak > 0
          ? `Draw – play again (${String(series.drawStreak)}/${String(series.drawLimit)})`
          : null;
      const timer = turnSecondsLeft === null ? '' : ` · ${String(turnSecondsLeft)}s`;
      if (!opponent.connected && opponent.bot === null) {
        const gone = opponent.reconnectBy
          ? `${name} lost connection. They have until the timer runs out to come back`
          : `${name} lost connection`;
        return { headline: `Waiting for ${name}`, detail: gone, tone: 'warn' };
      }
      return series.seatToMove === view.mySeat
        ? { headline: `Your turn${timer}`, detail: drawNote ?? scoreLine(view), tone: 'good' }
        : {
            headline: `${name}'s turn${timer}`,
            detail: drawNote ?? scoreLine(view),
            tone: 'neutral',
          };
    }
  }
}

/** Rating and XP lines for the result screen; null when the match recorded nothing. */
export function resultLines(view: MatchView): { rating: string | null; xp: string | null } | null {
  const result = view.result;
  if (!result) return null;
  const mine = result.players.find((player) => player.seat === view.mySeat);
  if (!mine) return null;
  let rating: string | null = null;
  if (mine.ratingBefore !== null && mine.ratingAfter !== null) {
    const delta = mine.ratingAfter - mine.ratingBefore;
    const sign = delta > 0 ? '+' : '';
    rating = `Rating ${String(mine.ratingBefore)} → ${String(mine.ratingAfter)} (${sign}${String(delta)})`;
  } else if (view.kind !== 'BOT') {
    rating = 'Not rated';
  }
  return { rating, xp: mine.xp > 0 ? `+${String(mine.xp)} XP` : null };
}

/** Is the rematch button useful? Only after a finished match nobody has already replayed. */
export function rematchState(view: MatchView): 'none' | 'available' | 'waiting' | 'ready' {
  if (view.status !== 'COMPLETED') return 'none';
  if (view.rematchMatchId !== null) return 'ready';
  return view.rematchRequestedBy.includes(view.mySeat) ? 'waiting' : 'available';
}

/** The result the server flagged is only trustworthy for a finished match. */
export function wasRated(view: MatchView): boolean {
  return view.result?.ranked === true;
}
