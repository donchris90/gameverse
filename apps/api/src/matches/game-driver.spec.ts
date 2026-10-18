import { describe, expect, it } from 'vitest';
import { driverFor, findDriver } from './game-driver.js';
import type { MatchRecord } from './match.view.js';

const match = (openingSeat: number, state: unknown = null): MatchRecord =>
  ({ gameId: 'ludo', openingSeat, state, players: [] }) as unknown as MatchRecord;

describe('game driver registry', () => {
  it('has a driver for each game the server can run', () => {
    expect(findDriver('tictactoe')?.gameId).toBe('tictactoe');
    expect(findDriver('ludo')?.gameId).toBe('ludo');
  });

  it('has none for a game the server cannot run, and driverFor refuses it', () => {
    expect(findDriver('chess')).toBeNull();
    expect(() => driverFor('chess')).toThrow('Game not found');
  });

  it('keeps each game fixed-size or not', () => {
    expect(driverFor('tictactoe').fixedPlayerCount).toBe(2);
    expect(driverFor('ludo').fixedPlayerCount).toBeUndefined();
  });

  it('passes the Ludo opening turn clockwise and wraps', () => {
    const ludo = driverFor('ludo');
    expect(ludo.rematchOpening(match(0), 4)).toBe(1);
    expect(ludo.rematchOpening(match(3), 4)).toBe(0);
    expect(ludo.rematchOpening(match(1), 2)).toBe(0);
  });

  it('refuses a roll on a tic-tac-toe match and a placement on a Ludo match', () => {
    const noState = { ...match(0), gameId: 'tictactoe' } as MatchRecord;
    expect(() => driverFor('tictactoe').act(noState, 0, { kind: 'roll' }, 'a', new Date())).toThrow(
      'no dice',
    );
    expect(() =>
      driverFor('ludo').act(match(0), 0, { kind: 'place', cell: 0 }, 'a', new Date()),
    ).toThrow('not in progress');
  });
});
