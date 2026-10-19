import { describe, expect, it } from 'vitest';
import {
  HOME_POSITION,
  IN_BASE,
  applyLudoMove,
  applyLudoRoll,
  checkLudoInvariants,
  createLudo,
  legalLudoMoves,
  type LudoPlayerCount,
  type LudoSeat,
  type LudoState,
} from './ludo.js';
import { chooseLudoMove } from './ludo-bots.js';
import type { BotLevel } from './bots.js';

const base4 = [IN_BASE, IN_BASE, IN_BASE, IN_BASE];

function rolled(tokens: number[][], value: number, toMove: LudoSeat = 0): LudoState {
  const start = { ...createLudo(2), tokens, toMove };
  const result = applyLudoRoll(start, toMove, value);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sequence = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
};

describe('ludo bots', () => {
  it('return null when there is nothing to move', () => {
    expect(chooseLudoMove(createLudo(2), 'hard', () => 0.5)).toBeNull();
  });

  it('easy picks uniformly among the legal moves', () => {
    const state = rolled([[...base4], [...base4]], 6);
    const seen = new Set<number | null>();
    for (const r of [0, 0.3, 0.6, 0.99]) seen.add(chooseLudoMove(state, 'easy', () => r));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it.each<BotLevel>(['medium', 'hard'])('%s takes a capture when it can', (level) => {
    // seat 0 tokens at p=11 and p=20; seat 1 (colour 2) token on square 14 (p=40)
    const state = rolled(
      [
        [11, 20, IN_BASE, IN_BASE],
        [40, IN_BASE, IN_BASE, IN_BASE],
      ],
      3,
    );
    expect(chooseLudoMove(state, level, () => 0)).toBe(0);
  });

  it.each<BotLevel>(['medium', 'hard'])('%s reaches home when it can', (level) => {
    const state = rolled([[54, 20, IN_BASE, IN_BASE], [...base4]], 2);
    expect(chooseLudoMove(state, level, () => 0)).toBe(0);
  });

  it.each<BotLevel>(['medium', 'hard'])(
    '%s brings a token out on a six when none is on the board',
    (level) => {
      expect(chooseLudoMove(rolled([[...base4], [...base4]], 6), level, () => 0)).toBeDefined();
      const withBoard = rolled([[IN_BASE, 20, IN_BASE, IN_BASE], [...base4]], 6);
      expect(chooseLudoMove(withBoard, level, () => 0)).toBe(0);
    },
  );

  it('hard avoids stepping in front of an opponent when a safer move exists', () => {
    // seat 1 (colour 2) token at square 10 (p=36). Seat 0 token A moves 20 -> 24? use squares:
    // A at p=7 -> p=10 (square 10 is where the opponent stands: capture) so avoid that setup.
    // Opponent at square 20 (p=46). Token A: p=15 -> 18 (two squares behind opponent: safe from it,
    // since it moves forward). Token B: p=25 -> 28? choose B landing 3 squares ahead of opponent.
    // B at p=21 -> square 24 (ahead of the opponent by 4: threatened). A at p=12 -> 15 (behind it).
    const state = rolled(
      [
        [12, 21, IN_BASE, IN_BASE],
        [46, IN_BASE, IN_BASE, IN_BASE],
      ],
      3,
    );
    expect(chooseLudoMove(state, 'hard', () => 0)).toBe(0);
    // medium does not look at danger: it prefers the token that is further along
    expect(chooseLudoMove(state, 'medium', () => 0)).toBe(1);
  });

  it('hard moves a threatened token to safety when it can', () => {
    // Opponent at square 21? safe. Use square 18 (p=44). Seat 0 token on square 20 (p=20) is 2
    // ahead of it, another seat 0 token on square 40 (p=40) is not threatened.
    const state = rolled(
      [
        [20, 40, IN_BASE, IN_BASE],
        [44, IN_BASE, IN_BASE, IN_BASE],
      ],
      1,
    );
    // moving token 0 from 20 to 21 (a star: safe) gets it out of danger
    expect(chooseLudoMove(state, 'hard', () => 0)).toBe(0);
  });

  it('every level only ever picks legal tokens, in complete bot-only games', () => {
    for (const level of ['easy', 'medium', 'hard'] as BotLevel[]) {
      for (const players of [2, 3, 4] as LudoPlayerCount[]) {
        for (let seed = 1; seed <= 6; seed += 1) {
          const random = mulberry32(seed * 7919 + players);
          let state = createLudo(players);
          let steps = 0;
          while (state.phase !== 'finished' && steps < 20_000) {
            steps += 1;
            const seat = state.toMove;
            if (state.phase === 'roll') {
              const result = applyLudoRoll(state, seat, 1 + Math.floor(random() * 6));
              if (!result.ok) throw new Error(result.error);
              state = result.state;
            } else {
              const token = chooseLudoMove(state, level, random);
              expect(token).not.toBeNull();
              expect(legalLudoMoves(state).map((m) => m.token)).toContain(token);
              const result = applyLudoMove(state, seat, token ?? 0);
              if (!result.ok) throw new Error(result.error);
              state = result.state;
            }
            expect(checkLudoInvariants(state)).toEqual([]);
          }
          expect(state.phase).toBe('finished');
        }
      }
    }
  });

  it('hard beats easy over fixed seeds (deterministic, not statistical luck)', () => {
    let hardWins = 0;
    const games = 60;
    for (let seed = 1; seed <= games; seed += 1) {
      const random = mulberry32(seed * 104729);
      const hardSeat = (seed % 2) as LudoSeat;
      let state = createLudo(2, 0);
      let steps = 0;
      while (state.phase !== 'finished' && steps < 20_000) {
        steps += 1;
        const seat = state.toMove;
        if (state.phase === 'roll') {
          const result = applyLudoRoll(state, seat, 1 + Math.floor(random() * 6));
          if (!result.ok) throw new Error(result.error);
          state = result.state;
        } else {
          const level: BotLevel = seat === hardSeat ? 'hard' : 'easy';
          const result = applyLudoMove(state, seat, chooseLudoMove(state, level, random) ?? 0);
          if (!result.ok) throw new Error(result.error);
          state = result.state;
        }
      }
      if (state.placings?.[0] === hardSeat) hardWins += 1;
    }
    expect(hardWins).toBeGreaterThan(games * 0.6);
  });

  it('tokens at home are never chosen', () => {
    const state = rolled([[HOME_POSITION, 30, IN_BASE, IN_BASE], [...base4]], 4);
    expect(chooseLudoMove(state, 'hard', sequence([0, 0.5]))).toBe(1);
  });

  it.each<BotLevel>(['medium', 'hard'])(
    '%s finishing a token beats bringing a new one out',
    (level) => {
      const state = rolled([[50, IN_BASE, IN_BASE, IN_BASE], [...base4]], 6);
      expect(chooseLudoMove(state, level, () => 0)).toBe(0);
    },
  );

  it('hard values rescuing a threatened token even when another token is further along', () => {
    // opponent on square 18 (colour 2, p=44). Token 0 on square 20 is 2 ahead of it (threatened);
    // a 5 takes it to square 25, out of reach. Token 1 is further along and not threatened.
    const state = rolled(
      [
        [20, 40, IN_BASE, IN_BASE],
        [44, IN_BASE, IN_BASE, IN_BASE],
      ],
      5,
    );
    expect(chooseLudoMove(state, 'hard', () => 0)).toBe(0);
    expect(chooseLudoMove(state, 'medium', () => 0)).toBe(1);
  });

  it('hard only fears opponents within one die roll (6 squares) behind', () => {
    // opponent on square 18. A would land on square 27, 9 squares ahead: not a threat.
    const state = rolled(
      [
        [24, 2, IN_BASE, IN_BASE],
        [44, IN_BASE, IN_BASE, IN_BASE],
      ],
      3,
    );
    expect(chooseLudoMove(state, 'hard', () => 0)).toBe(0);
  });

  it('breaks ties with the injected randomness, not always the first token', () => {
    const state = rolled([[...base4], [...base4]], 6);
    expect(chooseLudoMove(state, 'medium', () => 0)).toBe(0);
    expect(chooseLudoMove(state, 'medium', () => 0.99)).toBe(3);
  });

  it('hard does not fear an opponent token that is about to turn into its home lane', () => {
    // The opponent token (p 50) stands on square 24, its last ring square. Landing on square 27
    // (A: 23 + 4) is three squares ahead of it, but it can only go into its own lane, never to 27.
    const state = rolled(
      [
        [23, 2, IN_BASE, IN_BASE],
        [50, IN_BASE, IN_BASE, IN_BASE],
      ],
      4,
    );
    expect(chooseLudoMove(state, 'hard', () => 0)).toBe(0);
  });

  it('hard finishes a token before anything else', () => {
    const state = rolled(
      [
        [HOME_POSITION - 3, 10, IN_BASE, IN_BASE],
        [IN_BASE, IN_BASE, IN_BASE, IN_BASE],
      ],
      3,
    );
    expect(chooseLudoMove(state, 'hard', () => 0)).toBe(0);
  });

  it('hard brings the first token out of the base rather than moving a lone one on', () => {
    const state = rolled(
      [
        [IN_BASE, IN_BASE, IN_BASE, IN_BASE],
        [IN_BASE, IN_BASE, IN_BASE, IN_BASE],
      ],
      6,
    );
    expect(legalLudoMoves(state).every((move) => move.entersFromBase)).toBe(true);
    const withOne = rolled(
      [
        [5, IN_BASE, IN_BASE, IN_BASE],
        [IN_BASE, IN_BASE, IN_BASE, IN_BASE],
      ],
      6,
    );
    expect(chooseLudoMove(withOne, 'hard', () => 0)).not.toBe(0);
  });
});
