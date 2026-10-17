import { createHash } from 'node:crypto';

/**
 * The idempotency key of a bot move: a UUID derived from the match and the version the bot saw.
 * Two sweepers that both decide to move at the same version produce the same key, so the unique
 * (match, seat, action id) index lets exactly one of them through.
 */
export function botActionId(matchId: string, version: number): string {
  const hex = createHash('sha256')
    .update(`bot-move:${matchId}:${String(version)}`)
    .digest('hex');
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
