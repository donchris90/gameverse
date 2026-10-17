import { describe, expect, it } from 'vitest';
import { chooseBotMove, type BotLevel, type Rng } from './bots.js';
import { applyMove, createGame, legalMoves, type Mark, type TicTacToeState } from './tictactoe.js';

/** Small deterministic generator so failures are reproducible. */
function seeded(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function play(cells: number[]): TicTacToeState {
  let state = createGame();
  for (const cell of cells) {
    const moved = applyMove(state, state.next, cell);
    if (!moved.ok) throw new Error('bad test sequence');
    state = moved.state;
  }
  return state;
}

const LEVELS: BotLevel[] = ['easy', 'medium', 'hard'];

/** Every position that can arise in a game and still needs a move. */
function allOpenPositions(): TicTacToeState[] {
  const seen = new Map<string, TicTacToeState>();
  const walk = (state: TicTacToeState): void => {
    const key = state.board.map((cell) => cell ?? '.').join('');
    if (seen.has(key) || state.status !== 'in_progress') return;
    seen.set(key, state);
    for (const cell of legalMoves(state)) {
      const moved = applyMove(state, state.next, cell);
      if (moved.ok) walk(moved.state);
    }
  };
  walk(createGame());
  return [...seen.values()];
}

describe('bots', () => {
  it('always choose a legal move that the normal validator accepts, at every level', () => {
    const positions = allOpenPositions();
    expect(positions).toHaveLength(4_520);
    for (const level of LEVELS) {
      for (const seed of [1, 2, 3]) {
        const rng = seeded(seed);
        for (const state of positions) {
          const cell = chooseBotMove(state, level, rng);
          expect(applyMove(state, state.next, cell).ok).toBe(true);
        }
      }
    }
  });

  it('refuses to move in a finished game', () => {
    const won = play([0, 3, 1, 4, 2]);
    expect(() => chooseBotMove(won, 'hard', seeded(1))).toThrow();
  });

  it('medium takes an immediate win', () => {
    // X: 0,1  O: 3,4  X to move -> must play 2.
    const state = play([0, 3, 1, 4]);
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(chooseBotMove(state, 'medium', seeded(seed))).toBe(2);
    }
  });

  it('medium blocks an immediate loss', () => {
    // X: 0,1  O: 4  O to move -> must block at 2.
    const state = play([0, 4, 1]);
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(chooseBotMove(state, 'medium', seeded(seed))).toBe(2);
    }
  });

  it('hard never loses, as either mark, against every possible opponent reply', () => {
    for (const botMark of ['X', 'O'] as Mark[]) {
      for (const seed of [1, 7, 42]) {
        const rng = seeded(seed);
        let games = 0;
        const walk = (state: TicTacToeState): void => {
          if (state.status !== 'in_progress') {
            games += 1;
            expect(state.winner === null || state.winner === botMark).toBe(true);
            return;
          }
          if (state.next === botMark) {
            const cell = chooseBotMove(state, 'hard', rng);
            const moved = applyMove(state, botMark, cell);
            if (!moved.ok) throw new Error('hard bot made an illegal move');
            walk(moved.state);
            return;
          }
          for (const cell of legalMoves(state)) {
            const moved = applyMove(state, state.next, cell);
            if (moved.ok) walk(moved.state);
          }
        };
        walk(createGame());
        expect(games).toBeGreaterThan(0);
      }
    }
  });

  it('hard plays itself to a draw', () => {
    const rng = seeded(9);
    let state = createGame();
    while (state.status === 'in_progress') {
      const moved = applyMove(state, state.next, chooseBotMove(state, 'hard', rng));
      if (!moved.ok) throw new Error('illegal');
      state = moved.state;
    }
    expect(state.status).toBe('draw');
  });

  it('hard wins when the opponent blunders', () => {
    // O plays badly: X takes the centre line.
    const state = play([0, 1, 4, 2]);
    const cell = chooseBotMove(state, 'hard', seeded(1));
    expect(cell).toBe(8);
  });

  it('easy is not just the first free cell: it varies with the generator', () => {
    const state = createGame();
    const cells = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((seed) =>
        chooseBotMove(state, 'easy', seeded(seed)),
      ),
    );
    expect(cells.size).toBeGreaterThan(1);
  });

  it('medium can be beaten, so it is genuinely weaker than hard', () => {
    // Search every X strategy against a fixed medium O: some line of play must win for X.
    let xCanWin = false;
    const walk = (state: TicTacToeState): void => {
      if (xCanWin) return;
      if (state.status !== 'in_progress') {
        if (state.winner === 'X') xCanWin = true;
        return;
      }
      if (state.next === 'O') {
        const cell = chooseBotMove(state, 'medium', seeded(5));
        const moved = applyMove(state, 'O', cell);
        if (moved.ok) walk(moved.state);
        return;
      }
      for (const cell of legalMoves(state)) {
        const moved = applyMove(state, 'X', cell);
        if (moved.ok) walk(moved.state);
      }
    };
    walk(createGame());
    expect(xCanWin).toBe(true);
  });
});
