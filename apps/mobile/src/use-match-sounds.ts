import { endSound, type MatchView, type SoundName } from '@gameverse/shared-types';
import { useEffect, useRef } from 'react';
import { playSound } from './sounds';

/**
 * Plays the sounds that go with what the server just told us, the same way for every game:
 * a sound for each change (`changeSound`, from the new view), a ping when the turn comes to the
 * player, and a win/lose/draw sound once when the match ends while the screen is open. Opening a
 * match that is already over, or the first view of a match, plays nothing.
 */
export function useMatchSounds(
  match: MatchView,
  myTurn: boolean,
  changeSound: SoundName | null,
): void {
  const seen = useRef<{ id: string; version: number; turn: boolean; done: boolean } | null>(null);

  useEffect(() => {
    const before = seen.current;
    const done = match.status === 'COMPLETED';
    seen.current = { id: match.id, version: match.version, turn: myTurn, done };
    if (!before || before.id !== match.id || match.version <= before.version) return;

    if (done) {
      if (!before.done) {
        const sound = endSound(match);
        if (sound) playSound(sound);
      }
      return;
    }
    if (changeSound) playSound(changeSound);
    else if (myTurn && !before.turn) playSound('turn');
  }, [match, myTurn, changeSound]);
}
