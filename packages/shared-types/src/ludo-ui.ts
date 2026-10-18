import type { LudoEventView, LudoView, MatchPlayerView, MatchView, PlayerSeat } from './matches.js';
import { displayName, type StatusLine } from './match-ui.js';
import type { RoomView } from './lobby.js';

/**
 * Pure helpers for the Ludo screens: what to say, what is tappable, how the die looks, what
 * happened on the last turn. Like `match-ui.ts` they hold every decision the screen makes so it is
 * unit-tested here (the mobile app has no test runner). The server decides everything about the
 * game; nothing here knows a rule.
 */

/** Board colour (0-3) names, in the order the rules number them (top-left, top-right, ...). */
export const LUDO_COLOUR_NAMES = ['Red', 'Green', 'Yellow', 'Blue'] as const;

export function ludoOf(view: MatchView): LudoView | null {
  return view.gameId === 'ludo' ? view.ludo : null;
}

export function colourName(colour: number): string {
  return LUDO_COLOUR_NAMES[colour] ?? 'Grey';
}

export function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${String(n)}th`;
  const suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${String(n)}${suffix}`;
}

function playerAt(view: MatchView, seat: number): MatchPlayerView | undefined {
  return view.players.find((player) => player.seat === seat);
}

/** Name of a seat for sentences: "You" for the viewer, "Bot (hard)" for bots. */
export function ludoName(view: MatchView, seat: number): string {
  if (seat === view.mySeat) return 'You';
  const player = playerAt(view, seat);
  return player ? displayName(player) : 'Someone';
}

export function iAmOut(view: MatchView): boolean {
  return playerAt(view, view.mySeat)?.out === true;
}

/** True when it is my turn to roll. */
export function ludoCanRoll(view: MatchView): boolean {
  const ludo = ludoOf(view);
  return (
    view.status === 'ACTIVE' &&
    ludo !== null &&
    ludo.phase === 'roll' &&
    ludo.toMove === view.mySeat &&
    !iAmOut(view)
  );
}

/** The tokens I may tap now (the server's list of legal moves for the die I rolled). */
export function ludoMovableTokens(view: MatchView): number[] {
  const ludo = ludoOf(view);
  if (
    view.status !== 'ACTIVE' ||
    ludo === null ||
    ludo.phase !== 'move' ||
    ludo.toMove !== view.mySeat ||
    iAmOut(view)
  ) {
    return [];
  }
  return ludo.moves.map((move) => move.token);
}

/** Where I finished (1 = first) in a completed game, or null if I was removed or it is not over. */
export function ludoPlace(view: MatchView): number | null {
  const placings = ludoOf(view)?.placings;
  if (view.status !== 'COMPLETED' || !placings) return null;
  const index = placings.indexOf(view.mySeat);
  return index === -1 ? null : index + 1;
}

export interface PlacingRow {
  place: number;
  seat: PlayerSeat;
  name: string;
  isMe: boolean;
  /** True for a seat that left or was removed before the end. */
  left: boolean;
}

/** The final order for the result screen. */
export function placingRows(view: MatchView): PlacingRow[] {
  const ludo = ludoOf(view);
  if (!ludo?.placings) return [];
  return ludo.placings.map((seat, index) => ({
    place: index + 1,
    seat,
    name: ludoName(view, seat),
    isMe: seat === view.mySeat,
    left: ludo.removed.includes(seat),
  }));
}

function waitingNames(view: MatchView): string[] {
  return view.players.filter((player) => !player.ready).map((player) => displayName(player));
}

function completedLine(view: MatchView, ludo: LudoView): StatusLine {
  const place = ludoPlace(view);
  const total = ludo.players;
  // Removed seats are ranked behind everyone still in, but they did not finish the game.
  if (place === null || ludo.removed.includes(view.mySeat)) {
    return {
      headline: 'You left the game',
      detail: 'You left, or missed too many turns in a row',
      tone: 'bad',
    };
  }
  if (place === 1) {
    const reason =
      ludo.endReason === 'forfeit'
        ? 'Everyone else left or ran out of time'
        : 'All four tokens home';
    return { headline: 'You won!', detail: reason, tone: 'good' };
  }
  return {
    headline: `You finished ${ordinal(place)} of ${String(total)}`,
    detail: null,
    tone: place === 2 && total > 2 ? 'neutral' : 'bad',
  };
}

/** The one line (plus detail) that says what is going on. */
export function ludoStatus(view: MatchView, turnSecondsLeft: number | null): StatusLine {
  const ludo = ludoOf(view);
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
    case 'COMPLETED':
      return ludo
        ? completedLine(view, ludo)
        : { headline: 'Match finished', detail: null, tone: 'neutral' };
    case 'WAITING':
    case 'READY': {
      const me = playerAt(view, view.mySeat);
      const waiting = waitingNames(view);
      if (me && !me.ready) {
        return {
          headline: 'Press Ready to start',
          detail:
            waiting.length > 1
              ? `Waiting for ${waiting.filter((n) => n !== displayName(me)).join(', ')}`
              : null,
          tone: 'neutral',
        };
      }
      return {
        headline: 'Waiting for the others',
        detail: waiting.length > 0 ? `${waiting.join(', ')} need to press Ready` : null,
        tone: 'neutral',
      };
    }
    case 'ACTIVE': {
      if (ludo === null) return { headline: 'Starting…', detail: null, tone: 'neutral' };
      if (iAmOut(view)) {
        return {
          headline: 'You are out of this game',
          detail: 'You left or missed too many turns. The others play on',
          tone: 'bad',
        };
      }
      const timer = turnSecondsLeft === null ? '' : ` · ${String(turnSecondsLeft)}s`;
      const seat = ludo.toMove;
      if (seat === null) return { headline: 'Finishing…', detail: null, tone: 'neutral' };
      if (seat === view.mySeat) {
        return ludo.phase === 'roll'
          ? { headline: `Your turn: roll the die${timer}`, detail: sixesNote(ludo), tone: 'good' }
          : {
              headline: `Pick a token to move${timer}`,
              detail: ludo.roll === null ? null : `You rolled a ${String(ludo.roll)}`,
              tone: 'good',
            };
      }
      const name = ludoName(view, seat);
      const them = playerAt(view, seat);
      if (them && them.bot === null && !them.connected) {
        return {
          headline: `Waiting for ${name}`,
          detail: `${name} lost connection. If they do not come back they are removed`,
          tone: 'warn',
        };
      }
      return { headline: `${name}'s turn${timer}`, detail: null, tone: 'neutral' };
    }
  }
}

function sixesNote(ludo: LudoView): string | null {
  if (ludo.sixes === 0) return null;
  return ludo.sixes === 1
    ? 'You rolled a six: you get another roll'
    : `${String(ludo.sixes)} sixes in a row. A third six cancels your turn`;
}

/** Pips on a die face, as [column, row] in a 3 x 3 grid (0-2 each). */
export const DIE_PIPS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [2, 2],
  ],
};

export function diePips(value: number | null): readonly (readonly [number, number])[] {
  return (value !== null && DIE_PIPS[value]) || [];
}

/** The die value to show: the one waiting to be used, else the latest roll in the last change. */
export function shownDie(view: MatchView): number | null {
  const ludo = ludoOf(view);
  if (!ludo) return null;
  if (ludo.roll !== null) return ludo.roll;
  for (let i = ludo.lastEvents.length - 1; i >= 0; i -= 1) {
    const event = ludo.lastEvents[i];
    if (event?.type === 'ROLLED' && typeof event.value === 'number') return event.value;
  }
  return null;
}

/** Short sentences for what the last change did, oldest first (shown as a ticker). */
export function ludoEventTexts(view: MatchView): string[] {
  const ludo = ludoOf(view);
  if (!ludo) return [];
  const texts: string[] = [];
  for (const event of ludo.lastEvents) {
    const text = eventText(view, event);
    if (text !== null) texts.push(text);
  }
  return texts;
}

function eventText(view: MatchView, event: LudoEventView): string | null {
  const who = event.seat === undefined ? 'Someone' : ludoName(view, event.seat);
  const verb = (you: string, other: string) => (who === 'You' ? you : other);
  switch (event.type) {
    case 'ROLLED':
      return `${who} rolled a ${String(event.value ?? '?')}`;
    case 'NO_MOVE':
      return `${who} ${verb('have', 'has')} no move`;
    case 'THIRD_SIX':
      return `${who} rolled three sixes in a row: turn lost`;
    case 'CAPTURED': {
      const victim = event.victim === undefined ? 'a token' : ludoName(view, event.victim);
      return victim === 'You' ? `${who} captured your token` : `${who} captured ${victim}'s token`;
    }
    case 'TOKEN_HOME':
      return `${who} got a token home`;
    case 'SEAT_FINISHED':
      return `${who} finished ${ordinal(event.place ?? 0)}`;
    case 'SEAT_REMOVED':
      return `${who} ${verb('are', 'is')} out of the game`;
    default:
      return null;
  }
}

// --------------------------------------------------------------------------------- rooms

export interface RoomSummary {
  /** "2 of 4 players here". */
  progress: string;
  joined: number;
  seats: number;
  missing: number;
  isHost: boolean;
  /** The host can start now with the people who are here. */
  canStart: boolean;
  /** The host can also fill the empty seats with bots. */
  canFillWithBots: boolean;
  /** Names in seat order: the host first, then guests in the order they joined. */
  names: string[];
}

/** What the waiting-room screen shows for a private room. */
export function roomSummary(room: RoomView, viewerId: string): RoomSummary {
  const joined = 1 + room.members.length;
  const missing = Math.max(0, room.seats - joined);
  const isHost = room.host.userId === viewerId;
  const open = room.status === 'OPEN';
  return {
    progress: `${String(joined)} of ${String(room.seats)} players here`,
    joined,
    seats: room.seats,
    missing,
    isHost,
    canStart: isHost && open && room.members.length >= 1,
    canFillWithBots: isHost && open && room.members.length >= 1 && missing > 0,
    names: [room.host.username, ...room.members.map((member) => member.username)],
  };
}

/** Sizes a Ludo table can have, for the picker. */
export const LUDO_TABLE_SIZES = [2, 3, 4] as const;

// ------------------------------------------------------------------------------- the table

export type SeatState = 'turn' | 'out' | 'finished' | 'idle';

export interface SeatSummary {
  seat: PlayerSeat;
  colour: number;
  colourName: string;
  name: string;
  isMe: boolean;
  /** Tokens already home, out of four. */
  home: number;
  state: SeatState;
  /** Place (1 = first) for a seat that finished; null otherwise. */
  place: number | null;
  /** False for a human whose connection dropped. Bots are always connected. */
  connected: boolean;
}

/** One row per seat for the legend above the board. */
export function seatSummaries(view: MatchView): SeatSummary[] {
  const ludo = ludoOf(view);
  if (!ludo) return [];
  return view.players.map((player) => {
    const finishedAt = ludo.finished.indexOf(player.seat);
    const placing = ludo.placings ? ludo.placings.indexOf(player.seat) : -1;
    const isOut = player.out || ludo.removed.includes(player.seat);
    const state: SeatState = isOut
      ? 'out'
      : finishedAt !== -1
        ? 'finished'
        : ludo.toMove === player.seat && view.status === 'ACTIVE'
          ? 'turn'
          : 'idle';
    const colour = ludo.colours[player.seat] ?? player.seat;
    return {
      seat: player.seat,
      colour,
      colourName: colourName(colour),
      name: ludoName(view, player.seat),
      isMe: player.seat === view.mySeat,
      home: (ludo.tokens[player.seat] ?? []).filter((position) => position === 57).length,
      state,
      place: finishedAt !== -1 ? finishedAt + 1 : placing !== -1 && !isOut ? placing + 1 : null,
      connected: player.bot !== null || player.connected,
    };
  });
}

/** What a screen reader says for a token. `position` is the server's value: -1 base, 57 home. */
export function tokenDescription(colour: number, token: number, position: number): string {
  const where =
    position === -1
      ? 'in its base'
      : position === 57
        ? 'home'
        : position >= 52
          ? `in the home column, ${String(57 - position)} to go`
          : `on the track, ${String(position)} squares from its start`;
  return `${colourName(colour)} token ${String(token + 1)}, ${where}`;
}

/** The label of the leave button: it says what leaving costs. */
export function leaveLabel(view: MatchView): string {
  if (view.status !== 'ACTIVE' || iAmOut(view)) return 'Leave';
  return (ludoOf(view)?.players ?? 2) === 2
    ? 'Leave match (you lose)'
    : 'Leave match (you are out)';
}
