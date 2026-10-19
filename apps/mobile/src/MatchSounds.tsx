import {
  canMove,
  draughtsCanMove,
  ludoCanRoll,
  ludoEventSound,
  ludoMovableTokens,
  type MatchView,
  type SoundName,
} from '@gameverse/shared-types';
import { useRef } from 'react';
import { useMatchSounds } from './use-match-sounds';

/**
 * Plays a match's sound effects. It draws nothing; each game screen renders it once. The sound for
 * a change is worked out from what the server's new view shows. Ayo plays its own sounds during the
 * seed-by-seed replay, so here it only gets the win/lose/draw sound (no turn ping: the player's
 * clock only starts after the replay).
 */
export function MatchSounds({ match }: { match: MatchView }) {
  const filled = useRef<number | null>(null);
  const plies = useRef<number | null>(null);

  let change: SoundName | null = null;
  let myTurn = false;

  if (match.gameId === 'tictactoe') {
    const count = match.series?.board.filter((cell) => cell !== null).length ?? 0;
    if (filled.current !== null && count > filled.current) change = 'place';
    filled.current = count;
    myTurn = canMove(match);
  } else if (match.gameId === 'ludo') {
    change = ludoEventSound(match.ludo?.lastEvents ?? []);
    myTurn = ludoCanRoll(match) || ludoMovableTokens(match).length > 0;
  } else if (match.gameId === 'draughts') {
    const game = match.draughts;
    if (game) {
      if (plies.current !== null && game.plies > plies.current && game.last) {
        change = game.last.captures.length > 0 ? 'capture' : 'place';
      }
      plies.current = game.plies;
    }
    myTurn = draughtsCanMove(match);
  }

  useMatchSounds(match, myTurn, change);
  return null;
}
