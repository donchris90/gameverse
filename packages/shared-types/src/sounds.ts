import type { AyoStepView, LudoEventView, MatchView } from './matches.js';

/**
 * Sound effects. This file only decides WHICH sound goes with what happened; the phone plays it
 * (`apps/mobile/src/sounds.ts`). Keeping the choice here means it is tested without a speaker.
 */
export const SOUND_NAMES = [
  'tap',
  'place',
  'capture',
  'seed',
  'lift',
  'pack',
  'roll',
  'home',
  'turn',
  'win',
  'lose',
  'draw',
] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

/** The one sound for an Ayo replay step. */
export function ayoStepSound(kind: AyoStepView['k']): SoundName {
  switch (kind) {
    case 'lift':
      return 'lift';
    case 'drop':
      return 'seed';
    case 'pack':
    case 'final':
    case 'round':
      return 'pack';
  }
}

/** The most important sound for what a Ludo change did: capture, then home, then a move, then a roll. */
export function ludoEventSound(events: readonly LudoEventView[]): SoundName | null {
  const has = (type: string) => events.some((event) => event.type === type);
  if (has('CAPTURED')) return 'capture';
  if (has('TOKEN_HOME') || has('SEAT_FINISHED')) return 'home';
  if (has('MOVED')) return 'place';
  if (has('ROLLED')) return 'roll';
  return null;
}

/** How a finished match ended for the viewer; null while it is open or the match was cancelled. */
export function endSound(view: MatchView): SoundName | null {
  if (view.status !== 'COMPLETED') return null;
  const winner = view.series?.winner ?? view.winnerSeat;
  if (winner === 'draw' || winner === null || winner === undefined) return 'draw';
  return winner === view.mySeat ? 'win' : 'lose';
}
