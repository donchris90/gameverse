import { describe, expect, it } from 'vitest';
import type { MatchView } from './matches.js';
import { SOUND_NAMES, ayoStepSound, endSound, ludoEventSound } from './sounds.js';

const view = (over: Partial<MatchView>): MatchView =>
  ({ status: 'COMPLETED', mySeat: 0, winnerSeat: null, series: null, ...over }) as MatchView;

describe('sound choice', () => {
  it('gives every Ayo step kind a known sound', () => {
    for (const kind of ['lift', 'drop', 'pack', 'final', 'round'] as const) {
      expect(SOUND_NAMES).toContain(ayoStepSound(kind));
    }
    expect(ayoStepSound('lift')).toBe('lift');
    expect(ayoStepSound('drop')).toBe('seed');
    expect(ayoStepSound('pack')).toBe('pack');
  });

  it('picks the most important Ludo sound of a change', () => {
    expect(ludoEventSound([{ type: 'ROLLED', value: 6 }])).toBe('roll');
    expect(ludoEventSound([{ type: 'ROLLED' }, { type: 'MOVED' }])).toBe('place');
    expect(ludoEventSound([{ type: 'MOVED' }, { type: 'CAPTURED' }])).toBe('capture');
    expect(ludoEventSound([{ type: 'MOVED' }, { type: 'TOKEN_HOME' }])).toBe('home');
    expect(ludoEventSound([{ type: 'MOVED' }, { type: 'TOKEN_HOME' }, { type: 'CAPTURED' }])).toBe(
      'capture',
    );
    expect(ludoEventSound([{ type: 'NO_MOVE' }])).toBeNull();
    expect(ludoEventSound([])).toBeNull();
  });

  it('says win, lose or draw only for a finished match, from the viewer’s side', () => {
    expect(endSound(view({ winnerSeat: 0 }))).toBe('win');
    expect(endSound(view({ winnerSeat: 1 }))).toBe('lose');
    expect(endSound(view({ winnerSeat: null }))).toBe('draw');
    expect(endSound(view({ mySeat: 1, winnerSeat: 1 }))).toBe('win');
    expect(endSound(view({ status: 'ACTIVE', winnerSeat: 0 }))).toBeNull();
    expect(endSound(view({ status: 'CANCELLED' }))).toBeNull();
  });
});
