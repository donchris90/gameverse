import { describe, expect, it } from 'vitest';
import {
  draughtsCanMove,
  draughtsCounts,
  draughtsDrawOrder,
  draughtsMovable,
  draughtsStatus,
  draughtsStep,
  squareName,
} from './draughts-ui.js';
import type { DraughtsMoveView, DraughtsView, MatchPlayerView, MatchView } from './matches.js';

const player = (seat: 0 | 1, over: Partial<MatchPlayerView> = {}): MatchPlayerView => ({
  seat,
  userId: `u${String(seat)}`,
  bot: null,
  username: seat === 0 ? 'Ada' : 'Bayo',
  avatarId: 'avatar-01',
  ready: true,
  connected: true,
  reconnectBy: null,
  out: false,
  ...over,
});

const move = (from: number, path: number[], captures: number[] = []): DraughtsMoveView => ({
  from,
  path,
  captures,
});

function game(over: Partial<DraughtsView> = {}): DraughtsView {
  const board = Array.from({ length: 64 }, () => 0);
  return {
    phase: 'playing',
    board,
    toMove: 0,
    moves: [move(40, [33]), move(42, [33]), move(42, [35])],
    winner: null,
    endReason: null,
    plies: 0,
    sinceProgress: 0,
    last: null,
    ...over,
  };
}

function match(over: Partial<MatchView> = {}, g: Partial<DraughtsView> = {}): MatchView {
  return {
    id: 'm1',
    gameId: 'draughts',
    kind: 'PRIVATE',
    status: 'ACTIVE',
    version: 3,
    mySeat: 0,
    players: [player(0), player(1)],
    series: null,
    ludo: null,
    draughts: game(g),
    deadline: null,
    serverTime: '2026-10-18T12:00:00.000Z',
    endReason: null,
    winnerSeat: null,
    result: null,
    rematchRequestedBy: [],
    rematchMatchId: null,
    createdAt: '2026-10-18T12:00:00.000Z',
    endedAt: null,
    ...over,
  };
}

describe('who can move', () => {
  it('lists the squares I can start from only on my turn', () => {
    expect(draughtsCanMove(match())).toBe(true);
    expect(draughtsMovable(match())).toEqual([40, 42]);
    expect(draughtsMovable(match({}, { toMove: 1 }))).toEqual([]);
    expect(draughtsMovable(match({ status: 'COMPLETED' }))).toEqual([]);
    expect(draughtsMovable(match({ gameId: 'ludo' }))).toEqual([]);
  });
});

describe('entering a move', () => {
  const moves = [move(40, [33]), move(42, [35]), move(21, [30, 46], [26, 38]), move(21, [12])];

  it('offers each landing square of a chosen piece and completes a plain move', () => {
    expect(draughtsStep(moves, 40, [])).toEqual({ complete: null, next: [33] });
    expect(draughtsStep(moves, 40, [33]).complete).toEqual(moves[0]);
  });

  it('follows a multi-jump one landing square at a time', () => {
    const first = draughtsStep(moves, 21, []);
    expect(first.complete).toBeNull();
    expect(first.next.sort()).toEqual([12, 30]);
    const mid = draughtsStep(moves, 21, [30]);
    expect(mid).toEqual({ complete: null, next: [46] });
    expect(draughtsStep(moves, 21, [30, 46]).complete).toEqual(moves[2]);
  });

  it('offers nothing for a piece that cannot move or a wrong square', () => {
    expect(draughtsStep(moves, 1, [])).toEqual({ complete: null, next: [] });
    expect(draughtsStep(moves, 40, [34])).toEqual({ complete: null, next: [] });
  });
});

describe('board orientation and names', () => {
  it('shows seat 1 the board turned round', () => {
    expect(draughtsDrawOrder(0)[0]).toBe(0);
    expect(draughtsDrawOrder(1)[0]).toBe(63);
    expect(new Set(draughtsDrawOrder(1)).size).toBe(64);
  });

  it('names squares like a chess board', () => {
    expect(squareName(56)).toBe('a1');
    expect(squareName(7)).toBe('h8');
  });

  it('counts pieces for each side', () => {
    const board = Array.from({ length: 64 }, () => 0);
    board[1] = 1;
    board[3] = 2;
    board[5] = 4;
    expect(draughtsCounts(game({ board }))).toEqual([2, 1]);
  });
});

describe('draughtsStatus', () => {
  it('says whose move it is, with the clock, and warns about a forced capture', () => {
    expect(draughtsStatus(match(), 12)).toMatchObject({
      headline: 'Your move · 12s',
      tone: 'good',
    });
    const forced = match({}, { moves: [move(21, [30], [26])] });
    expect(draughtsStatus(forced, null).detail).toBe('You must capture');
    expect(draughtsStatus(match({}, { toMove: 1 }), 5)).toMatchObject({
      headline: "Bayo's move · 5s",
    });
  });

  it('flags an opponent who lost connection', () => {
    const dropped = match({ players: [player(0), player(1, { connected: false })] }, { toMove: 1 });
    expect(draughtsStatus(dropped, 5)).toMatchObject({
      headline: 'Waiting for Bayo',
      tone: 'warn',
    });
  });

  it('labels a bot', () => {
    const bot = match(
      { players: [player(0), player(1, { bot: 'hard', userId: null })] },
      { toMove: 1 },
    );
    expect(draughtsStatus(bot, null).headline).toBe("Bot (hard)'s move");
  });

  it('handles the states before and after play', () => {
    expect(
      draughtsStatus(
        match({ status: 'READY', players: [player(0, { ready: false }), player(1)] }),
        null,
      ).headline,
    ).toBe('Press Ready to start');
    expect(draughtsStatus(match({ status: 'READY' }), null).headline).toBe(
      'Waiting for the other player',
    );
    expect(draughtsStatus(match({ status: 'EXPIRED' }), null).headline).toBe('Match expired');
    expect(draughtsStatus(match({ status: 'CANCELLED' }), null).headline).toBe('Match cancelled');
  });

  it('reports a win, a loss, a draw and a walkover', () => {
    const done = { phase: 'finished' as const, toMove: null };
    const won = match(
      { status: 'COMPLETED', winnerSeat: 0 },
      { ...done, winner: 0, endReason: 'no_pieces' },
    );
    expect(draughtsStatus(won, null)).toMatchObject({ headline: 'You won!', tone: 'good' });
    const lost = match(
      { status: 'COMPLETED', winnerSeat: 1 },
      { ...done, winner: 1, endReason: 'timeout' },
    );
    expect(draughtsStatus(lost, null)).toMatchObject({
      headline: 'You lost',
      detail: 'Out of time',
    });
    const draw = match(
      { status: 'COMPLETED' },
      { ...done, winner: 'draw', endReason: 'repetition' },
    );
    expect(draughtsStatus(draw, null)).toMatchObject({ headline: 'Draw' });
    const walkover = match(
      { status: 'COMPLETED', winnerSeat: 0, endReason: 'left' },
      { ...done, winner: 0, endReason: 'forfeit' },
    );
    expect(draughtsStatus(walkover, null)).toMatchObject({ detail: 'The other player left' });
    const iLeft = match(
      { status: 'COMPLETED', winnerSeat: 1, endReason: 'left' },
      { ...done, winner: 1, endReason: 'forfeit' },
    );
    expect(draughtsStatus(iLeft, null).headline).toBe('You left the game');
  });
});
