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

describe('bot levels ported from RRYDA Ox', () => {
  // X: 0,1  O: 3,4  X to move: 2 wins. O to move after [0,4,1]: 2 blocks.
  const winnable = play([0, 3, 1, 4]);
  const mustBlock = play([0, 4, 1]);
  const noticing = () => 0; // always under the notice chance
  const oblivious = () => 0.99; // never under it (picks the last legal cell)

  it('easy takes a win or blocks only when it happens to notice', () => {
    expect(chooseBotMove(winnable, 'easy', noticing)).toBe(2);
    expect(chooseBotMove(mustBlock, 'easy', noticing)).toBe(2);
    expect(chooseBotMove(winnable, 'easy', oblivious)).not.toBe(2);
    expect(chooseBotMove(mustBlock, 'easy', oblivious)).not.toBe(2);
  });

  it('easy notices roughly four times in ten, not always and not never', () => {
    const rng = seeded(7);
    let wins = 0;
    for (let i = 0; i < 2_000; i += 1) if (chooseBotMove(winnable, 'easy', rng) === 2) wins += 1;
    // Noticing (40%) plus a random pick landing on the winning cell by luck.
    expect(wins / 2_000).toBeGreaterThan(0.35);
    expect(wins / 2_000).toBeLessThan(0.65);
  });

  it('medium never misses a win or a block, whatever the generator says', () => {
    for (const rng of [noticing, oblivious, seeded(1), seeded(2)]) {
      expect(chooseBotMove(winnable, 'medium', rng)).toBe(2);
      expect(chooseBotMove(mustBlock, 'medium', rng)).toBe(2);
    }
  });

  it('medium plays the perfect move on half its free choices and a random one otherwise', () => {
    // Opening position: perfect play is any move (all draw), so test on a position where only
    // one move holds the draw. X: 0 and 8, O: 4, O to move: a corner loses to a fork, an edge holds.
    const state = play([0, 4, 8]);
    const perfect = new Set<number>();
    const loose = new Set<number>();
    for (let i = 0; i < 400; i += 1) {
      const rngLow = seeded(i + 1);
      perfect.add(chooseBotMove(state, 'hard', rngLow));
      // First draw < 0.5 chooses perfect inside medium; force it.
      let first = true;
      const forced: Rng = () => {
        if (first) {
          first = false;
          return 0;
        }
        return seeded(i + 1)();
      };
      loose.add(chooseBotMove(state, 'medium', forced));
    }
    for (const cell of loose) expect(perfect.has(cell)).toBe(true);
    // And with the generator at 0.99 medium picks randomly, so it can pick a losing corner.
    const wild = new Set<number>();
    for (let i = 0; i < 400; i += 1) {
      let first = true;
      const rng: Rng = () => {
        if (first) {
          first = false;
          return 0.99;
        }
        return seeded(i + 1)();
      };
      wild.add(chooseBotMove(state, 'medium', rng));
    }
    expect([...wild].some((cell) => !perfect.has(cell))).toBe(true);
  });
});
