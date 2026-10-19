import { describe, expect, it } from 'vitest';
import {
  ayoCanMove,
  ayoEndControl,
  ayoMovable,
  ayoColumns,
  ayoReaps,
  ayoReplayTimeline,
  ayoReplayFrames,
  ayoRoundNote,
  ayoRows,
  ayoStatus,
} from './ayo-ui.js';
import type { AyoStepView, AyoView, MatchPlayerView, MatchView } from './matches.js';

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

function game(over: Partial<AyoView> = {}): AyoView {
  return {
    phase: 'playing',
    pits: Array(12).fill(4),
    alive: Array(12).fill(true),
    stores: [0, 0],
    toMove: 0,
    round: 1,
    starter: 0,
    moves: [0, 1, 2, 3, 4, 5],
    winner: null,
    endReason: null,
    endOffer: null,
    canOfferEnd: false,
    totals: [24, 24],
    plies: 0,
    last: null,
    lastRound: null,
    ...over,
  };
}

function match(over: Partial<MatchView> = {}, g: Partial<AyoView> = {}): MatchView {
  return {
    id: 'm1',
    gameId: 'ayo',
    kind: 'PRIVATE',
    status: 'ACTIVE',
    version: 3,
    mySeat: 0,
    players: [player(0), player(1)],
    series: null,
    ludo: null,
    draughts: null,
    ayo: game(g),
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
    createdAt: '2026-10-18T12:00:00.000Z',
    endedAt: null,
    ...over,
  };
}

describe('who can move', () => {
  it('lists my pits only on my turn', () => {
    expect(ayoCanMove(match())).toBe(true);
    expect(ayoMovable(match())).toEqual([0, 1, 2, 3, 4, 5]);
    expect(ayoMovable(match({}, { toMove: 1 }))).toEqual([]);
    expect(ayoMovable(match({ status: 'COMPLETED' }))).toEqual([]);
    expect(ayoMovable(match({ gameId: 'ludo' }))).toEqual([]);
  });
});

describe('board orientation', () => {
  it('puts each player row at the bottom and runs the ring counter-clockwise', () => {
    expect(ayoRows(0)).toEqual({ top: [11, 10, 9, 8, 7, 6], bottom: [0, 1, 2, 3, 4, 5] });
    expect(ayoRows(1)).toEqual({ top: [5, 4, 3, 2, 1, 0], bottom: [6, 7, 8, 9, 10, 11] });
    for (const seat of [0, 1] as const) {
      const rows = ayoRows(seat);
      expect([...rows.top, ...rows.bottom].sort((a, b) => a - b)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
      ]);
    }
  });
});

describe('replaying a turn', () => {
  const steps: AyoStepView[] = [
    { k: 'lift', pit: 0, count: 2 },
    { k: 'drop', pit: 1 },
    { k: 'drop', pit: 2 },
    { k: 'reap', pit: 2, by: 0, amount: 4, all: false },
  ];

  it('lifts, drops and reaps one step at a time', () => {
    const before = [2, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const frames = ayoReplayFrames(before, steps);
    expect(frames).toHaveLength(4);
    expect(frames[0]).toEqual([0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(frames[2]).toEqual([0, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(frames[3]?.[2]).toBe(0);
    expect(before[0]).toBe(2); // the input is not changed
  });

  it('clears the whole board when the last eight are taken', () => {
    const frames = ayoReplayFrames(
      [1, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [
        { k: 'lift', pit: 0, count: 1 },
        { k: 'drop', pit: 1 },
        { k: 'reap', pit: 1, by: 1, amount: 8, all: true },
      ],
    );
    expect(frames[2]).toEqual(Array(12).fill(0));
  });

  it('lists the reaps of a turn', () => {
    expect(ayoReaps(steps)).toEqual([{ pit: 2, by: 0, amount: 4 }]);
  });
});

describe('the end-game control', () => {
  it('offers only when allowed, against a person, and tracks who asked', () => {
    expect(ayoEndControl(match())).toBe('none');
    expect(ayoEndControl(match({}, { canOfferEnd: true }))).toBe('offer');
    expect(ayoEndControl(match({}, { canOfferEnd: true, endOffer: 0 }))).toBe('waiting');
    expect(ayoEndControl(match({}, { canOfferEnd: true, endOffer: 1 }))).toBe('answer');
    const bot = match(
      { players: [player(0), player(1, { bot: 'hard', userId: null })] },
      { canOfferEnd: true },
    );
    expect(ayoEndControl(bot)).toBe('none');
    expect(ayoEndControl(match({ status: 'COMPLETED' }, { canOfferEnd: true }))).toBe('none');
  });
});

describe('ayoStatus and the round note', () => {
  it('says whose move it is, with the clock', () => {
    expect(ayoStatus(match(), 12)).toMatchObject({ headline: 'Your move · 12s', tone: 'good' });
    expect(ayoStatus(match({}, { toMove: 1 }), 5)).toMatchObject({ headline: "Bayo's move · 5s" });
  });

  it('flags an opponent who lost connection, and labels a bot', () => {
    const dropped = match({ players: [player(0), player(1, { connected: false })] }, { toMove: 1 });
    expect(ayoStatus(dropped, 5)).toMatchObject({ headline: 'Waiting for Bayo', tone: 'warn' });
    const bot = match(
      { players: [player(0), player(1, { bot: 'hard', userId: null })] },
      { toMove: 1 },
    );
    expect(ayoStatus(bot, null).headline).toBe("Bot (hard)'s move");
  });

  it('handles the states before and after play', () => {
    expect(
      ayoStatus(match({ status: 'READY', players: [player(0, { ready: false }), player(1)] }), null)
        .headline,
    ).toBe('Press Ready to start');
    expect(ayoStatus(match({ status: 'READY' }), null).headline).toBe(
      'Waiting for the other player',
    );
    expect(ayoStatus(match({ status: 'EXPIRED' }), null).headline).toBe('Match expired');
  });

  it('reports a win, a loss, a draw and a walkover', () => {
    const done = { phase: 'finished' as const, toMove: null };
    expect(
      ayoStatus(
        match({ status: 'COMPLETED', winnerSeat: 0 }, { ...done, winner: 0, endReason: 'one_pit' }),
        null,
      ),
    ).toMatchObject({ headline: 'You won!' });
    expect(
      ayoStatus(
        match({ status: 'COMPLETED', winnerSeat: 1 }, { ...done, winner: 1, endReason: 'timeout' }),
        null,
      ),
    ).toMatchObject({ headline: 'You lost', detail: 'Out of time' });
    expect(
      ayoStatus(
        match({ status: 'COMPLETED' }, { ...done, winner: 'draw', endReason: 'agreement' }),
        null,
      ),
    ).toMatchObject({ headline: 'Draw' });
    expect(
      ayoStatus(
        match(
          { status: 'COMPLETED', winnerSeat: 0, endReason: 'left' },
          { ...done, winner: 0, endReason: 'forfeit' },
        ),
        null,
      ),
    ).toMatchObject({ detail: 'The other player left' });
  });

  it('announces how the last round ended', () => {
    expect(ayoRoundNote(match())).toBeNull();
    expect(ayoRoundNote(match({}, { lastRound: { round: 2, winner: 0, took: 8 } }))).toBe(
      'Round 2: You took the last 8 seeds',
    );
    expect(ayoRoundNote(match({}, { lastRound: { round: 2, winner: 1, took: 8 } }))).toBe(
      'Round 2: They took the last 8 seeds',
    );
  });
});

describe('the upright board and the timed replay', () => {
  it('puts my column on the right with the ring running up it', () => {
    expect(ayoColumns(0)).toEqual({ right: [5, 4, 3, 2, 1, 0], left: [6, 7, 8, 9, 10, 11] });
    expect(ayoColumns(1)).toEqual({ right: [11, 10, 9, 8, 7, 6], left: [0, 1, 2, 3, 4, 5] });
    for (const seat of [0, 1] as const) {
      const { left, right } = ayoColumns(seat);
      expect([...left, ...right].sort((a, b) => a - b)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
      ]);
    }
  });

  it('counts seeds in hand, keeps a trail and adds reaped seeds to the right store', () => {
    const frames = ayoReplayTimeline(
      [2, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [4, 8],
      [
        { k: 'lift', pit: 0, count: 2 },
        { k: 'drop', pit: 1 },
        { k: 'drop', pit: 2 },
        { k: 'reap', pit: 2, by: 1, amount: 4, all: false },
      ],
    );
    expect(frames.map((f) => f.hand)).toEqual([2, 1, 0, 0]);
    expect(frames.map((f) => f.kind)).toEqual(['lift', 'drop', 'drop', 'reap']);
    expect(frames[2]?.trail).toEqual([1, 2]);
    expect(frames[3]?.stores).toEqual([4, 12]);
    expect(frames[3]?.pits[2]).toBe(0);
    expect(frames.map((f) => f.ms)).toEqual([320, 220, 220, 600]);
  });

  it('refills the hand on a relay and speeds up a very long turn', () => {
    const relay = ayoReplayTimeline(
      [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0],
      [
        { k: 'lift', pit: 0, count: 1 },
        { k: 'drop', pit: 1 },
        { k: 'lift', pit: 1, count: 2 },
        { k: 'drop', pit: 2 },
        { k: 'drop', pit: 3 },
      ],
    );
    expect(relay.map((f) => f.hand)).toEqual([1, 0, 2, 1, 0]);
    const long = ayoReplayTimeline(
      Array(12).fill(0),
      [0, 0],
      Array.from({ length: 90 }, () => ({ k: 'drop' as const, pit: 1 })),
    );
    expect(long[0]?.ms).toBe(100);
    expect(long.reduce((sum, f) => sum + f.ms, 0)).toBeLessThanOrEqual(9000);
  });

  it('does not change the board it is given and clears everything on a final reap', () => {
    const before = [1, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const frames = ayoReplayTimeline(
      before,
      [0, 0],
      [
        { k: 'lift', pit: 0, count: 1 },
        { k: 'drop', pit: 1 },
        { k: 'reap', pit: 1, by: 0, amount: 8, all: true },
      ],
    );
    expect(before[0]).toBe(1);
    expect(frames[2]?.pits).toEqual(Array(12).fill(0));
    expect(frames[2]?.stores).toEqual([8, 0]);
    expect(frames[2]?.ms).toBe(800);
  });
});
