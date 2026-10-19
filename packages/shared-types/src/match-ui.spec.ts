import { describe, expect, it } from 'vitest';
import type { MatchPlayerView, MatchSeriesView, MatchView } from './matches.js';
import {
  canMove,
  canPressReady,
  clockOffset,
  displayName,
  myMark,
  opponentOf,
  outcomeFor,
  rematchState,
  resultLines,
  scoreLine,
  secondsLeft,
  shouldApply,
  statusLine,
  tappableCells,
  isGetReady,
} from './match-ui.js';

function player(seat: 0 | 1, over: Partial<MatchPlayerView> = {}): MatchPlayerView {
  return {
    seat,
    userId: `user-${String(seat)}`,
    bot: null,
    username: seat === 0 ? 'Ada' : 'Bayo',
    avatarId: 'avatar-01',
    ready: true,
    connected: true,
    reconnectBy: null,
    out: false,
    ...over,
  };
}

function series(over: Partial<MatchSeriesView> = {}): MatchSeriesView {
  return {
    bestOf: 3,
    phase: 'playing',
    gameNumber: 1,
    firstSeat: 0,
    board: Array(9).fill(null) as null[],
    seatToMove: 0,
    winLine: null,
    wins: [0, 0],
    draws: 0,
    drawStreak: 0,
    drawLimit: 3,
    history: [],
    winner: null,
    endReason: null,
    ...over,
  };
}

function match(over: Partial<MatchView> = {}): MatchView {
  return {
    id: 'm1',
    gameId: 'tictactoe',
    kind: 'QUICK',
    status: 'ACTIVE',
    version: 5,
    mySeat: 0,
    players: [player(0), player(1)],
    series: series(),
    ludo: null,
    draughts: null,
    ayo: null,
    entryFee: 0,
    pot: 0,
    payout: 0,
    deadline: null,
    serverTime: '2026-10-18T12:00:00.000Z',
    endReason: null,
    winnerSeat: null,
    result: null,
    rematchRequestedBy: [],
    rematchMatchId: null,
    createdAt: '2026-10-18T11:59:00.000Z',
    endedAt: null,
    ...over,
  };
}

const done = (winner: 0 | 1 | 'draw', over: Partial<MatchView> = {}) =>
  match({
    status: 'COMPLETED',
    series: series({ phase: 'completed', winner, wins: [2, 1], seatToMove: null }),
    ...over,
  });

describe('seats and names', () => {
  it('finds the opponent from either seat', () => {
    expect(opponentOf(match()).seat).toBe(1);
    expect(opponentOf(match({ mySeat: 1 })).seat).toBe(0);
  });

  it('always labels a bot as a bot', () => {
    const bot = player(1, { userId: null, bot: 'hard', username: 'Bot', avatarId: 'bot' });
    expect(displayName(bot)).toBe('Bot (hard)');
    expect(displayName(player(0))).toBe('Ada');
  });

  it('the opener of the current game plays X', () => {
    expect(myMark(match())).toBe('X');
    expect(myMark(match({ mySeat: 1 }))).toBe('O');
    expect(myMark(match({ series: series({ firstSeat: 1 }) }))).toBe('O');
    expect(myMark(match({ series: null }))).toBeNull();
  });
});

describe('what the player may do', () => {
  it('can move only on their own turn in an active, playing match', () => {
    expect(canMove(match())).toBe(true);
    expect(canMove(match({ series: series({ seatToMove: 1 }) }))).toBe(false);
    expect(canMove(match({ status: 'READY' }))).toBe(false);
    expect(canMove(match({ series: series({ phase: 'between_games', seatToMove: null }) }))).toBe(
      false,
    );
    expect(canMove(done(0))).toBe(false);
  });

  it('offers only the empty cells, and only when a move is allowed', () => {
    const board = Array(9).fill(null) as (string | null)[];
    board[4] = 'X';
    board[0] = 'O';
    expect(tappableCells(match({ series: series({ board }) }))).toEqual([1, 2, 3, 5, 6, 7, 8]);
    expect(tappableCells(match({ series: series({ board, seatToMove: 1 }) }))).toEqual([]);
  });

  it('ready can be pressed once, before the match starts', () => {
    const waiting = match({ status: 'READY', players: [player(0, { ready: false }), player(1)] });
    expect(canPressReady(waiting)).toBe(true);
    expect(canPressReady(match({ status: 'READY' }))).toBe(false);
    expect(canPressReady(match())).toBe(false);
  });
});

describe('shouldApply', () => {
  it('keeps updates that are as new or newer, and drops stale ones', () => {
    expect(shouldApply(match({ version: 5 }), match({ version: 6 }))).toBe(true);
    expect(shouldApply(match({ version: 5 }), match({ version: 5 }))).toBe(true);
    expect(shouldApply(match({ version: 5 }), match({ version: 4 }))).toBe(false);
  });

  it('always accepts the first view and a different match', () => {
    expect(shouldApply(null, match({ version: 1 }))).toBe(true);
    expect(shouldApply(match({ id: 'a', version: 9 }), match({ id: 'b', version: 1 }))).toBe(true);
  });
});

describe('clock helpers', () => {
  it('offset is server time minus the phone clock', () => {
    const received = Date.parse('2026-10-18T12:00:05.000Z');
    expect(clockOffset('2026-10-18T12:00:00.000Z', received)).toBe(-5000);
  });

  it('counts whole seconds up, uses the server clock, and never goes negative', () => {
    const deadline = '2026-10-18T12:00:20.000Z';
    const phoneNow = Date.parse('2026-10-18T12:00:05.000Z');
    expect(secondsLeft(deadline, -5000, phoneNow)).toBe(20); // phone is 5 s fast
    expect(secondsLeft(deadline, 0, phoneNow)).toBe(15);
    expect(secondsLeft(deadline, 0, phoneNow + 14_001)).toBe(1);
    expect(secondsLeft(deadline, 0, phoneNow + 60_000)).toBe(0);
  });
});

describe('outcomeFor and statusLine', () => {
  it('reports win, loss and draw from the viewer’s seat', () => {
    expect(outcomeFor(done(0))).toBe('win');
    expect(outcomeFor(done(1))).toBe('loss');
    expect(outcomeFor(done('draw'))).toBe('draw');
    expect(outcomeFor(done(0, { mySeat: 1 }))).toBe('loss');
    expect(outcomeFor(match())).toBeNull();
  });

  it('tells you to press ready, then that you are waiting', () => {
    const notReady = match({ status: 'READY', players: [player(0, { ready: false }), player(1)] });
    expect(statusLine(notReady, null)).toMatchObject({
      headline: 'Press Ready to start',
      detail: 'Bayo is ready',
    });
    expect(
      statusLine(
        match({ status: 'READY', players: [player(0), player(1, { ready: false })] }),
        null,
      ),
    ).toMatchObject({
      headline: 'Waiting for Bayo',
    });
  });

  it('shows whose turn it is with the timer', () => {
    expect(statusLine(match(), 14)).toMatchObject({ headline: 'Your turn · 14s', tone: 'good' });
    expect(statusLine(match({ series: series({ seatToMove: 1 }) }), 9)).toMatchObject({
      headline: "Bayo's turn · 9s",
      tone: 'neutral',
    });
    expect(statusLine(match(), null).headline).toBe('Your turn');
  });

  it('warns when the opponent lost connection, but never for a bot', () => {
    const away = match({
      series: series({ seatToMove: 1 }),
      players: [
        player(0),
        player(1, { connected: false, reconnectBy: '2026-10-18T12:00:30.000Z' }),
      ],
    });
    expect(statusLine(away, 5)).toMatchObject({ headline: 'Waiting for Bayo', tone: 'warn' });
    const bot = match({
      series: series({ seatToMove: 1 }),
      players: [player(0), player(1, { userId: null, bot: 'easy', connected: true })],
    });
    expect(statusLine(bot, 5).headline).toBe("Bot (easy)'s turn · 5s");
  });

  it('says why a match ended', () => {
    expect(statusLine(done(0, { endReason: 'left' }), null)).toMatchObject({
      headline: 'You won the match!',
      detail: 'Bayo left the match',
    });
    expect(statusLine(done(1, { endReason: 'disconnected' }), null)).toMatchObject({
      headline: 'You lost the match',
      detail: 'You were disconnected for too long',
    });
    expect(statusLine(done(1, { endReason: 'forfeit' }), null).detail).toBe('You ran out of time');
    expect(statusLine(done(0, { endReason: 'score' }), null).detail).toBe('2 – 1');
    expect(statusLine(done('draw'), null).headline).toBe('The match is a draw');
  });

  it('covers matches that never ran', () => {
    expect(statusLine(match({ status: 'EXPIRED' }), null).headline).toBe('Match expired');
    expect(statusLine(match({ status: 'CANCELLED' }), null).headline).toBe('Match cancelled');
    expect(statusLine(match({ status: 'ABANDONED' }), null).tone).toBe('warn');
  });

  it('announces the pause between games', () => {
    const between = match({
      series: series({ phase: 'between_games', seatToMove: null, wins: [1, 0] }),
    });
    expect(statusLine(between, null)).toMatchObject({
      headline: 'Next game starting…',
      detail: '1 – 0',
    });
  });
});

describe('scoreLine', () => {
  it('is shown from the viewer’s side and mentions drawn games', () => {
    expect(scoreLine(match({ series: series({ wins: [1, 2], draws: 1 }) }))).toBe(
      '1 – 2 (1 drawn)',
    );
    expect(scoreLine(match({ mySeat: 1, series: series({ wins: [1, 2] }) }))).toBe('2 – 1');
    expect(scoreLine(match({ series: null }))).toBe('');
    expect(scoreLine(match({ series: series({ bestOf: 1, wins: [1, 0] }) }))).toBe('');
  });
});

describe('resultLines', () => {
  const result = (ratingBefore: number | null, ratingAfter: number | null, xp: number) => ({
    ranked: ratingBefore !== null,
    players: [
      { seat: 0 as const, userId: 'user-0', ratingBefore, ratingAfter, xp },
      { seat: 1 as const, userId: 'user-1', ratingBefore: 1000, ratingAfter: 984, xp: 0 },
    ],
  });

  it('shows the rating change with its sign and the XP earned', () => {
    expect(resultLines(done(0, { result: result(1000, 1016, 30) }))).toEqual({
      rating: 'Rating 1000 → 1016 (+16)',
      xp: '+30 XP',
    });
    expect(resultLines(done(1, { result: result(1016, 1000, 0) }))).toEqual({
      rating: 'Rating 1016 → 1000 (-16)',
      xp: null,
    });
  });

  it('says "Not rated" for friendly matches, and nothing for bot matches', () => {
    expect(resultLines(done(0, { kind: 'PRIVATE', result: result(null, null, 15) }))).toEqual({
      rating: 'Not rated',
      xp: '+15 XP',
    });
    expect(resultLines(done(0, { kind: 'BOT', result: result(null, null, 5) }))).toEqual({
      rating: null,
      xp: '+5 XP',
    });
  });

  it('is null when nothing was recorded', () => {
    expect(resultLines(done(0))).toBeNull();
  });
});

describe('rematchState', () => {
  it('walks from available to waiting to ready', () => {
    expect(rematchState(match())).toBe('none');
    expect(rematchState(done(0))).toBe('available');
    expect(rematchState(done(0, { rematchRequestedBy: [0] }))).toBe('waiting');
    expect(rematchState(done(0, { rematchRequestedBy: [1] }))).toBe('available');
    expect(rematchState(done(0, { rematchMatchId: 'm2' }))).toBe('ready');
  });
});

describe('RRYDA Ox flow lines', () => {
  it('says "Get ready" while the clock shows more than one full turn on an empty first game', () => {
    const view = match({ series: series({ gameNumber: 1 }) });
    expect(statusLine(view, 18).headline).toBe('Get ready…');
    expect(isGetReady(view, 18)).toBe(true);
    expect(isGetReady(view, 15)).toBe(false);
    expect(statusLine(view, 15).headline).toBe('Your turn · 15s');
  });

  it('is never "get ready" once a mark is down or in a later game', () => {
    const board = Array(9).fill(null) as (string | null)[];
    board[4] = 'X';
    expect(isGetReady(match({ series: series({ board }) }), 18)).toBe(false);
    expect(isGetReady(match({ series: series({ gameNumber: 2 }) }), 18)).toBe(false);
  });

  it('tells the players a drawn game is played again', () => {
    const view = match({ series: series({ drawStreak: 1, gameNumber: 2 }) });
    expect(statusLine(view, 10).detail).toBe('Draw – play again (1/3)');
  });

  it('explains a match that ended on three draws in a row', () => {
    const view = match({
      status: 'COMPLETED',
      endReason: 'draw_limit',
      series: series({
        phase: 'completed',
        winner: 'draw',
        endReason: 'draw_limit',
        drawStreak: 3,
      }),
    });
    expect(statusLine(view, null)).toMatchObject({
      headline: 'The match is a draw',
      detail: '3 drawn games in a row',
    });
  });
});
