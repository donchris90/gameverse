/** How long a private room waits for a guest. */
export const ROOM_TTL_MS = 10 * 60_000;
/** How long a friend invite stays open. */
export const INVITE_TTL_MS = 2 * 60_000;
/** A started room is still shown to its host for this long, so the host app can open the match. */
export const STARTED_VISIBLE_MS = 2 * 60_000;
/** Wrong or unusable codes a player may try before being slowed down (guessing protection). */
export const JOIN_FAILURE_LIMIT = 10;
export const JOIN_FAILURE_WINDOW_MS = 5 * 60_000;
/** Pending invites shown at once. */
export const MAX_INVITES_SHOWN = 20;
