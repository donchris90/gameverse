import { describe, expect, it } from 'vitest';
import type { RoomView } from './lobby.js';
import type { LudoEventView, LudoView, MatchPlayerView, MatchView, PlayerSeat } from './matches.js';
import {
  DIE_PIPS,
  LUDO_COLOUR_NAMES,
  colourName,
  diePips,
  iAmOut,
  ludoCanRoll,
  ludoEventTexts,
  ludoMovableTokens,
  ludoName,
  ludoPlace,
  leaveLabel,
  ludoStatus,
  ordinal,
  placingRows,
  roomSummary,
  iAmCovered,
  seatSummaries,
  shownDie,
  tokenDescription,
} from './ludo-ui.js';

const NAMES = ['Ada', 'Bayo', 'Chidi', 'Dami'];

function player(seat: PlayerSeat, over: Partial<MatchPlayerView> = {}): MatchPlayerView {
  return {
    seat,
    userId: `user-${String(seat)}`,
    bot: null,
    username: NAMES[seat] ?? 'X',
    avatarId: 'avatar-01',
    ready: true,
    connected: true,
    reconnectBy: null,
    out: false,
    ...over,
  };
}

function ludo(over: Partial<LudoView> = {}): LudoView {
  return {
    phase: 'roll',
    players: 3,
    colours: [0, 1, 2],
    tokens: [
      [-1, -1, -1, -1],
      [-1, -1, -1, -1],
      [-1, -1, -1, -1],
    ],
    toMove: 0,
    roll: null,
    sixes: 0,
    moves: [],
    finished: [],
    removed: [],
    ai: [false, false, false, false],
    placings: null,
    endReason: null,
    rolls: 0,
    lastEvents: [],
    ...over,
  };
}

function match(over: Partial<MatchView> = {}, game: Partial<LudoView> = {}): MatchView {
  return {
    id: 'm1',
    gameId: 'ludo',
    kind: 'PRIVATE',
    status: 'ACTIVE',
    version: 7,
    mySeat: 0,
    players: [player(0), player(1), player(2)],
    series: null,
    ludo: ludo(game),
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
    createdAt: '2026-10-18T11:00:00.000Z',
    endedAt: null,
    ...over,
  };
}

const move = (token: number) => ({
  token,
  from: -1,
  to: 0,
  capturesSeat: null,
  entersFromBase: true,
  reachesHome: false,
});

describe('small helpers', () => {
  it('names the four colours in rule order', () => {
    expect(LUDO_COLOUR_NAMES).toEqual(['Red', 'Green', 'Yellow', 'Blue']);
    expect(colourName(2)).toBe('Yellow');
    expect(colourName(9)).toBe('Grey');
  });

  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
  ])('writes %i as %s', (n, text) => {
    expect(ordinal(n)).toBe(text);
  });

  it('calls the viewer You and labels bots', () => {
    const m = match({ players: [player(0), player(1, { bot: 'hard', userId: null }), player(2)] });
    expect(ludoName(m, 0)).toBe('You');
    expect(ludoName(m, 1)).toBe('Bot (hard)');
    expect(ludoName(m, 2)).toBe('Chidi');
    expect(ludoName(m, 3)).toBe('Someone');
  });
});

describe('what the viewer can do', () => {
  it('rolls only on their own turn in the roll phase of an active match', () => {
    expect(ludoCanRoll(match())).toBe(true);
    expect(ludoCanRoll(match({}, { toMove: 1 }))).toBe(false);
    expect(ludoCanRoll(match({}, { phase: 'move', roll: 3, moves: [move(0)] }))).toBe(false);
    expect(ludoCanRoll(match({ status: 'READY' }))).toBe(false);
    expect(ludoCanRoll(match({ status: 'COMPLETED' }))).toBe(false);
  });

  it('cannot roll or move once out of the game', () => {
    const out = match({ players: [player(0, { out: true }), player(1), player(2)] });
    expect(iAmOut(out)).toBe(true);
    expect(ludoCanRoll(out)).toBe(false);
    const moving = match(
      { players: [player(0, { out: true }), player(1), player(2)] },
      { phase: 'move', roll: 6, moves: [move(1)] },
    );
    expect(ludoMovableTokens(moving)).toEqual([]);
  });

  it('taps exactly the tokens the server listed, only in my move phase', () => {
    const m = match({}, { phase: 'move', roll: 6, moves: [move(1), move(3)] });
    expect(ludoMovableTokens(m)).toEqual([1, 3]);
    expect(
      ludoMovableTokens(match({}, { phase: 'move', roll: 6, moves: [move(1)], toMove: 2 })),
    ).toEqual([]);
    expect(ludoMovableTokens(match())).toEqual([]);
  });

  it('is never actionable for a non-Ludo match', () => {
    const other = { ...match(), gameId: 'tictactoe' as const, ludo: null };
    expect(ludoCanRoll(other)).toBe(false);
    expect(ludoMovableTokens(other)).toEqual([]);
  });
});

describe('ludoStatus', () => {
  it('tells me to roll, with the countdown, and notes a six', () => {
    expect(ludoStatus(match(), 14)).toMatchObject({
      headline: 'Your turn: roll the die · 14s',
      tone: 'good',
      detail: null,
    });
    expect(ludoStatus(match({}, { sixes: 1 }), null).detail).toMatch(/another roll/);
    expect(ludoStatus(match({}, { sixes: 2 }), null).detail).toMatch(/third six/);
  });

  it('tells me to pick a token and says what I rolled', () => {
    const status = ludoStatus(match({}, { phase: 'move', roll: 4, moves: [move(0)] }), 9);
    expect(status).toMatchObject({
      headline: 'Pick a token to move · 9s',
      detail: 'You rolled a 4',
    });
  });

  it('names whose turn it is, and flags a human who dropped', () => {
    expect(ludoStatus(match({}, { toMove: 1 }), 5).headline).toBe("Bayo's turn · 5s");
    const dropped = match(
      { players: [player(0), player(1, { connected: false }), player(2)] },
      { toMove: 1 },
    );
    expect(ludoStatus(dropped, 5)).toMatchObject({ headline: 'Waiting for Bayo', tone: 'warn' });
    const bot = match(
      {
        players: [player(0), player(1, { bot: 'easy', userId: null, connected: false }), player(2)],
      },
      { toMove: 1 },
    );
    expect(ludoStatus(bot, null).headline).toBe("Bot (easy)'s turn");
  });

  it('tells a removed player they are out', () => {
    const out = match({ players: [player(0, { out: true }), player(1), player(2)] });
    expect(ludoStatus(out, null)).toMatchObject({
      headline: 'You are out of this game',
      tone: 'bad',
    });
  });

  it('asks for ready, then waits for the others by name', () => {
    const waiting = match({
      status: 'READY',
      players: [player(0, { ready: false }), player(1, { ready: false }), player(2)],
    });
    expect(ludoStatus(waiting, null)).toMatchObject({
      headline: 'Press Ready to start',
      detail: 'Waiting for Bayo',
    });
    const readyMe = match({
      status: 'READY',
      players: [player(0), player(1, { ready: false }), player(2, { ready: false })],
    });
    expect(ludoStatus(readyMe, null)).toMatchObject({
      headline: 'Waiting for the others',
      detail: 'Bayo, Chidi need to press Ready',
    });
  });

  it('says how I finished', () => {
    const done = (placings: PlayerSeat[], removed: PlayerSeat[] = []) =>
      match(
        { status: 'COMPLETED' },
        { phase: 'finished', toMove: null, placings, removed, endReason: 'completed' },
      );
    expect(ludoStatus(done([0, 1, 2]), null)).toMatchObject({ headline: 'You won!', tone: 'good' });
    expect(ludoStatus(done([1, 0, 2]), null)).toMatchObject({
      headline: 'You finished 2nd of 3',
      tone: 'neutral',
    });
    expect(ludoStatus(done([1, 2, 0]), null)).toMatchObject({
      headline: 'You finished 3rd of 3',
      tone: 'bad',
    });
  });

  it('a two-player runner-up is a loss, not a neutral result', () => {
    const m = match(
      { status: 'COMPLETED', players: [player(0), player(1)] },
      { players: 2, phase: 'finished', toMove: null, placings: [1, 0], endReason: 'completed' },
    );
    expect(ludoStatus(m, null).tone).toBe('bad');
  });

  it('says so when everyone else left, and when I was the one who left', () => {
    const won = match(
      { status: 'COMPLETED' },
      {
        phase: 'finished',
        toMove: null,
        placings: [0, 2, 1],
        removed: [1, 2],
        endReason: 'forfeit',
      },
    );
    expect(ludoStatus(won, null).detail).toMatch(/left or ran out of time/);
    const left = match(
      { status: 'COMPLETED' },
      { phase: 'finished', toMove: null, placings: [1, 2, 0], removed: [0], endReason: 'forfeit' },
    );
    expect(ludoStatus(left, null)).toMatchObject({ headline: 'You left the game', tone: 'bad' });
  });

  it('covers the terminal states of an unstarted match', () => {
    expect(ludoStatus(match({ status: 'EXPIRED' }), null).headline).toBe('Match expired');
    expect(ludoStatus(match({ status: 'CANCELLED' }), null).headline).toBe('Match cancelled');
    expect(ludoStatus(match({ status: 'ABANDONED' }), null).headline).toBe('Match abandoned');
  });
});

describe('results', () => {
  const finished = match(
    { status: 'COMPLETED', mySeat: 2 },
    {
      phase: 'finished',
      toMove: null,
      placings: [1, 2, 0],
      removed: [0],
      endReason: 'completed',
    },
  );

  it('lists the final order with me and the player who left marked', () => {
    expect(placingRows(finished)).toEqual([
      { place: 1, seat: 1, name: 'Bayo', isMe: false, left: false },
      { place: 2, seat: 2, name: 'You', isMe: true, left: false },
      { place: 3, seat: 0, name: 'Ada', isMe: false, left: true },
    ]);
    expect(ludoPlace(finished)).toBe(2);
  });

  it('has no place while the game is on, and none for a removed player left out of the order', () => {
    expect(ludoPlace(match())).toBeNull();
    expect(placingRows(match())).toEqual([]);
  });
});

describe('the die', () => {
  it('has the right number of pips on every face, all distinct and inside the 3 x 3 grid', () => {
    for (let value = 1; value <= 6; value += 1) {
      const pips = DIE_PIPS[value] ?? [];
      expect(pips).toHaveLength(value);
      expect(new Set(pips.map(([c, r]) => `${String(c)},${String(r)}`)).size).toBe(value);
      for (const [c, r] of pips) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(2);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(2);
      }
    }
  });

  it('opposite faces are mirror images (a fair-looking die)', () => {
    for (const value of [1, 2, 3, 4, 5, 6]) {
      const pips = diePips(value).map(([c, r]) => `${String(c)},${String(r)}`);
      const mirrored = diePips(value).map(([c, r]) => `${String(2 - c)},${String(2 - r)}`);
      expect(new Set(mirrored)).toEqual(new Set(pips));
    }
  });

  it('shows nothing for no value, and the waiting die before the latest roll', () => {
    expect(diePips(null)).toEqual([]);
    expect(diePips(7)).toEqual([]);
    expect(shownDie(match())).toBeNull();
    expect(shownDie(match({}, { phase: 'move', roll: 5 }))).toBe(5);
    const rolled: LudoEventView[] = [
      { type: 'ROLLED', seat: 1, value: 2 },
      { type: 'NO_MOVE', seat: 1 },
      { type: 'TURN', seat: 2 },
    ];
    expect(shownDie(match({}, { lastEvents: rolled }))).toBe(2);
  });
});

describe('ludoEventTexts', () => {
  it('turns the last change into short sentences from my point of view', () => {
    const events: LudoEventView[] = [
      { type: 'ROLLED', seat: 1, value: 6 },
      { type: 'MOVED', seat: 1, token: 0, from: -1, to: 0 },
      { type: 'CAPTURED', seat: 1, victim: 0, token: 2 },
      { type: 'CAPTURED', seat: 1, victim: 2, token: 1 },
      { type: 'TOKEN_HOME', seat: 0, token: 3 },
      { type: 'THIRD_SIX', seat: 2 },
      { type: 'NO_MOVE', seat: 0 },
      { type: 'SEAT_FINISHED', seat: 1, place: 1 },
      { type: 'SEAT_REMOVED', seat: 2 },
      { type: 'EXTRA_ROLL', seat: 1 },
    ];
    expect(ludoEventTexts(match({}, { lastEvents: events }))).toEqual([
      'Bayo rolled a 6',
      'Bayo captured your token',
      "Bayo captured Chidi's token",
      'You got a token home',
      'Chidi rolled three sixes in a row: turn lost',
      'You have no move',
      'Bayo finished 1st',
      'Chidi is out of the game',
    ]);
    expect(ludoEventTexts(match({ ludo: null, gameId: 'tictactoe' }))).toEqual([]);
  });
});

describe('roomSummary', () => {
  const party = (userId: string, username: string) => ({ userId, username, avatarId: 'a' });
  const room = (over: Partial<RoomView> = {}): RoomView => ({
    id: 'r1',
    code: 'ABC234',
    gameId: 'ludo',
    status: 'OPEN',
    host: party('h', 'Ada'),
    invited: null,
    seats: 4,
    entryFee: 0,
    bestOf: 3,
    members: [],
    expiresAt: '2026-10-18T12:10:00.000Z',
    matchId: null,
    createdAt: '2026-10-18T12:00:00.000Z',
    ...over,
  });

  it('counts the host as a player and says how many are missing', () => {
    const s = roomSummary(room({ members: [party('g1', 'Bayo')] }), 'h');
    expect(s).toMatchObject({ joined: 2, seats: 4, missing: 2, isHost: true });
    expect(s.progress).toBe('2 of 4 players here');
    expect(s.names).toEqual(['Ada', 'Bayo']);
  });

  it('lets only the host start, and only with a guest present', () => {
    const lonely = roomSummary(room(), 'h');
    expect(lonely.canStart).toBe(false);
    expect(lonely.canFillWithBots).toBe(false);
    const withGuest = room({ members: [party('g1', 'Bayo')] });
    expect(roomSummary(withGuest, 'h')).toMatchObject({ canStart: true, canFillWithBots: true });
    expect(roomSummary(withGuest, 'g1')).toMatchObject({
      isHost: false,
      canStart: false,
      canFillWithBots: false,
    });
  });

  it('offers no bot fill when the room is full, and nothing once it is not open', () => {
    const full = room({ seats: 2, members: [party('g1', 'Bayo')] });
    expect(roomSummary(full, 'h')).toMatchObject({
      canStart: true,
      canFillWithBots: false,
      missing: 0,
    });
    expect(roomSummary({ ...full, status: 'STARTED' }, 'h').canStart).toBe(false);
    expect(roomSummary({ ...full, status: 'CLOSED' }, 'h').canStart).toBe(false);
  });
});

describe('seatSummaries', () => {
  it('lists every seat with its colour, name, tokens home and whose turn it is', () => {
    const m = match(
      {},
      {
        toMove: 1,
        tokens: [
          [57, 57, 3, -1],
          [-1, -1, -1, -1],
          [57, -1, -1, -1],
        ],
      },
    );
    const rows = seatSummaries(m);
    expect(rows.map((r) => [r.seat, r.colourName, r.name, r.home, r.state])).toEqual([
      [0, 'Red', 'You', 2, 'idle'],
      [1, 'Green', 'Bayo', 0, 'turn'],
      [2, 'Yellow', 'Chidi', 1, 'idle'],
    ]);
    expect(rows[0]?.isMe).toBe(true);
  });

  it('uses the colour of the seat, not the seat number (two players sit opposite)', () => {
    const m = match(
      { players: [player(0), player(1)] },
      {
        players: 2,
        colours: [0, 2],
        tokens: [
          [-1, -1, -1, -1],
          [-1, -1, -1, -1],
        ],
      },
    );
    expect(seatSummaries(m).map((r) => r.colourName)).toEqual(['Red', 'Yellow']);
  });

  it('marks removed seats out and finished seats with their place', () => {
    const m = match(
      { players: [player(0), player(1, { out: true }), player(2)] },
      { finished: [2], removed: [1], toMove: 0 },
    );
    const rows = seatSummaries(m);
    expect(rows[1]).toMatchObject({ state: 'out', place: null });
    expect(rows[2]).toMatchObject({ state: 'finished', place: 1 });
    expect(rows[0]?.state).toBe('turn');
  });

  it('shows a dropped human as disconnected but never a bot', () => {
    const m = match({
      players: [
        player(0),
        player(1, { connected: false }),
        player(2, { bot: 'easy', userId: null, connected: false }),
      ],
    });
    const rows = seatSummaries(m);
    expect(rows[1]?.connected).toBe(false);
    expect(rows[2]?.connected).toBe(true);
  });

  it('is empty for a match that is not Ludo', () => {
    expect(seatSummaries({ ...match(), gameId: 'tictactoe', ludo: null })).toEqual([]);
  });
});

describe('tokenDescription', () => {
  it.each([
    [-1, 'Red token 1, in its base'],
    [0, 'Red token 1, on the track, 0 squares from its start'],
    [51, 'Red token 1, on the track, 51 squares from its start'],
    [52, 'Red token 1, in the home column, 5 to go'],
    [56, 'Red token 1, in the home column, 1 to go'],
    [57, 'Red token 1, home'],
  ])('describes position %i', (position, text) => {
    expect(tokenDescription(0, 0, position)).toBe(text);
  });
  it('numbers tokens from one and names the colour', () => {
    expect(tokenDescription(3, 3, -1)).toBe('Blue token 4, in its base');
  });
});

describe('leaveLabel', () => {
  it('says what leaving costs', () => {
    expect(leaveLabel(match({}, { players: 2 }))).toBe('Leave match (you lose)');
    expect(leaveLabel(match({}, { players: 3 }))).toBe('Leave match (you are out)');
    expect(leaveLabel(match({}, { players: 4 }))).toBe('Leave match (you are out)');
  });
  it('is just Leave before the game starts or after you are already out', () => {
    expect(leaveLabel(match({ status: 'READY' }))).toBe('Leave');
    expect(leaveLabel(match({ players: [player(0, { out: true }), player(1), player(2)] }))).toBe(
      'Leave',
    );
  });
});

describe('AI cover', () => {
  it('tells me the AI is playing my seat, and offers the seat back', () => {
    const covered = match({}, { ai: [true, false, false, false], toMove: 1 });
    expect(iAmCovered(covered)).toBe(true);
    expect(ludoStatus(covered, 10)).toMatchObject({
      headline: 'The AI is playing for you',
      tone: 'warn',
    });
    expect(iAmCovered(match({}, { ai: [false, false, false, false] }))).toBe(false);
    expect(iAmCovered(match({ status: 'COMPLETED' }, { ai: [true, false, false, false] }))).toBe(
      false,
    );
  });

  it('labels the AI when it plays for someone else', () => {
    const other = match({}, { ai: [false, true, false, false], toMove: 1 });
    expect(ludoStatus(other, 10)).toMatchObject({ headline: 'AI is playing for Bayo' });
    expect(iAmCovered(other)).toBe(false);
  });

  it('puts the start and end of cover in the ticker', () => {
    const texts = ludoEventTexts(
      match(
        {},
        {
          lastEvents: [
            { type: 'AI_COVER_STARTED', seat: 0 },
            { type: 'AI_COVER_STARTED', seat: 1 },
            { type: 'AI_COVER_ENDED', seat: 1 },
          ],
        },
      ),
    );
    expect(texts).toEqual([
      'You were away: the AI is playing for you',
      'Bayo is away: the AI is playing for them',
      'Bayo is playing again',
    ]);
  });
});
