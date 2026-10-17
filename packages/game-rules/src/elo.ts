/** Rating every player starts from in every game. */
export const DEFAULT_RATING = 1000;
/** Ratings never fall below this, so a bad streak cannot push anyone to zero or negative. */
export const RATING_FLOOR = 100;
/** Rated games after which a rating moves more slowly. */
export const PROVISIONAL_GAMES = 30;
export const K_PROVISIONAL = 32;
export const K_ESTABLISHED = 16;

/** Chance (0..1) that a player rated `own` scores against one rated `opponent`. */
export function expectedScore(own: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - own) / 400));
}

/** How far one result may move a rating: new players move faster so they settle quickly. */
export function kFactor(ratedGames: number): number {
  return ratedGames < PROVISIONAL_GAMES ? K_PROVISIONAL : K_ESTABLISHED;
}

/**
 * New rating after one result. `score` is 1 for a win, 0.5 for a draw, 0 for a loss. Pure and
 * integer-valued; each player's change is computed from the ratings *before* the match.
 */
export function ratingAfter(
  own: number,
  opponent: number,
  score: 0 | 0.5 | 1,
  ratedGames: number,
): number {
  const change = kFactor(ratedGames) * (score - expectedScore(own, opponent));
  return Math.max(RATING_FLOOR, Math.round(own + change));
}
