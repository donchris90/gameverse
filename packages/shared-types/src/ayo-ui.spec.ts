import { describe, expect, it } from 'vitest';
import {
  AYO_REPLAY_MS,
  ayoAnimationMs,
  ayoCanMove,
  ayoColumns,
  ayoDecisionControl,
  ayoMovable,
  ayoOwnPits,
  ayoPacks,
  ayoPitCounts,
  ayoReplayTimeline,
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
    owners: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1],
    packed: [0, 0],
    toMove: 0,
    round: 1,
    starter: 0,
    moves: [0, 1, 2, 3, 4, 5],
    decision: null,
    winner: null,
    endReason: null,
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

describe('quit or continue', () => {
  it('stops the pits being tappable while a choice is waiting and says who must choose', () => {
    const waiting = match({}, { decision: 0 });
    expect(ayoCanMove(waiting)).toBe(false);
    expect(ayoMovable(waiting)).toEqual([]);
    expect(ayoDecisionControl(waiting)).toBe('choose');
    expect(ayoDecisionControl(match({}, { decision: 1 }))).toBe('waiting');
    expect(ayoDecisionControl(match())).toBe('none');
    expect(ayoDecisionControl(match({ status: 'COMPLETED' }, { decision: 0 }))).toBe('none');
    expect(ayoStatus(waiting, 20)).toMatchObject({ headline: 'One pit left · 20s', tone: 'warn' });
    expect(ayoStatus(match({}, { decision: 1 }), 20).headline).toBe('Bayo is choosing · 20s');
  });
});

describe('pit owners', () => {
  it('lists the pits a seat owns and counts them', () => {
    const owners = [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1] as const;
    expect(ayoOwnPits([...owners], 0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(ayoOwnPits([...owners], 1)).toEqual([7, 8, 9, 10, 11]);
    expect(ayoPitCounts([...owners])).toEqual([7, 5]);
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
        match({ status: 'COMPLETED', winnerSeat: 0 }, { ...done, winner: 0, endReason: 'no_pits' }),
        null,
      ),
    ).toMatchObject({ headline: 'You won!' });
    expect(
      ayoStatus(
        match({ status: 'COMPLETED', winnerSeat: 1 }, { ...done, winner: 1, endReason: 'timeout' }),
        null,
      ),
    ).toMatchObject({
      headline: 'You lost',
      detail: 'A player ran out of time three turns in a row',
    });
    expect(
      ayoStatus(
        match({ status: 'COMPLETED' }, { ...done, winner: 'draw', endReason: 'max_rounds' }),
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
    const lastRound = {
      round: 2,
      packed: [28, 20] as [number, number],
      pits: [7, 5] as [number, number],
      finalTo: 0 as const,
    };
    expect(ayoRoundNote(match({}, { lastRound }))).toBe('Round 2: you packed 28, they packed 20');
    expect(ayoRoundNote(match({ mySeat: 1 }, { lastRound }))).toBe(
      'Round 2: you packed 20, they packed 28',
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

  const owners = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1] as (0 | 1)[];
  const table = (pits: number[], packed: [number, number] = [0, 0]) => ({ pits, owners, packed });

  it('counts seeds in hand, keeps a trail and adds packed seeds to the right seat', () => {
    const steps: AyoStepView[] = [
      { k: 'lift', pit: 0, count: 2 },
      { k: 'drop', pit: 1 },
      { k: 'drop', pit: 2 },
      { k: 'pack', pit: 2, by: 1, amount: 4 },
    ];
    const before = table([2, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0], [4, 8]);
    const frames = ayoReplayTimeline(before, steps);
    expect(frames.map((f) => f.hand)).toEqual([2, 1, 0, 0]);
    expect(frames.map((f) => f.kind)).toEqual(['lift', 'drop', 'drop', 'pack']);
    expect(frames[2]?.trail).toEqual([1, 2]);
    expect(frames[3]?.packed).toEqual([4, 12]);
    expect(frames[3]?.pits[2]).toBe(0);
    expect(frames.map((f) => f.ms)).toEqual([320, 220, 220, 600]);
    expect(before.pits[0]).toBe(2); // the input is not changed
    expect(ayoPacks(steps)).toEqual([{ pit: 2, by: 1, amount: 4 }]);
  });

  it('refills the hand on a relay and speeds up a very long turn', () => {
    const relay = ayoReplayTimeline(table([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), [
      { k: 'lift', pit: 0, count: 1 },
      { k: 'drop', pit: 1 },
      { k: 'lift', pit: 1, count: 2 },
      { k: 'drop', pit: 2 },
      { k: 'drop', pit: 3 },
    ]);
    expect(relay.map((f) => f.hand)).toEqual([1, 0, 2, 1, 0]);
    const long = ayoReplayTimeline(
      table(Array(12).fill(0)),
      Array.from({ length: 90 }, () => ({ k: 'drop' as const, pit: 1 })),
    );
    expect(long[0]?.ms).toBe(100);
    expect(long.reduce((sum, f) => sum + f.ms, 0)).toBeLessThanOrEqual(AYO_REPLAY_MS.maxTurn);
  });

  it('empties the board for the last seeds and sets up the next round', () => {
    const frames = ayoReplayTimeline(table([1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [24, 20]), [
      { k: 'lift', pit: 0, count: 1 },
      { k: 'drop', pit: 1 },
      { k: 'final', by: 1, amount: 4 },
      { k: 'round', round: 2, owners: [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1] },
    ]);
    expect(frames[2]?.pits).toEqual(Array(12).fill(0));
    expect(frames[2]?.packed).toEqual([24, 24]);
    expect(frames[2]?.ms).toBe(800);
    expect(frames[3]?.pits).toEqual(Array(12).fill(4));
    expect(frames[3]?.packed).toEqual([0, 0]);
    expect(frames[3]?.owners.filter((o) => o === 0)).toHaveLength(7);
    expect(frames[3]?.round).toBe(2);
    expect(frames[3]?.ms).toBe(3000);
  });

  it('adds up the time the server waits before the next turn clock starts', () => {
    expect(
      ayoAnimationMs([
        { k: 'lift', pit: 0, count: 2 },
        { k: 'drop', pit: 1 },
        { k: 'drop', pit: 2 },
        { k: 'pack', pit: 2, by: 0, amount: 4 },
      ]),
    ).toBe(320 + 220 + 220 + 600 + 300);
    expect(
      ayoAnimationMs(Array.from({ length: 5000 }, () => ({ k: 'drop' as const, pit: 1 }))),
    ).toBeLessThanOrEqual(AYO_REPLAY_MS.maxTurn + AYO_REPLAY_MS.slack);
  });
});
