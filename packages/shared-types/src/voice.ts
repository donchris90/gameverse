/**
 * Voice inside a match. The server decides who may join (members of an open match with another
 * human, no block between them) and hands out short-lived Agora tokens; the app only sends
 * "I joined" and "I left" for usage logging. Nothing is ever recorded.
 */

/** Match tokens are renewed well before they expire. */
export const VOICE_RENEW_BEFORE_EXPIRY_SECONDS = 60;

/** A voice session older than this is closed by the server even if nobody said they left. */
export const VOICE_MAX_SESSION_SECONDS = 3 * 60 * 60;

/** Token requests per account per minute (joining plus renewals). */
export const VOICE_TOKEN_LIMIT_PER_MINUTE = 10;

export interface VoiceParticipantView {
  /** The Agora uid this player uses in the channel; speaker callbacks report this number. */
  uid: number;
  userId: string;
  username: string;
  avatarId: string;
}

export interface VoiceTokenView {
  appId: string;
  channel: string;
  /** The caller's own uid. */
  uid: number;
  token: string;
  expiresAt: string;
  serverTime: string;
  /** Ask again for a fresh token this many seconds from now. */
  renewInSeconds: number;
  /** Humans who may be in the channel, the caller included. Bots never have voice. */
  participants: VoiceParticipantView[];
}

export interface VoiceSessionView {
  id: string;
  matchId: string;
  channel: string;
  joinedAt: string;
  leftAt: string | null;
  seconds: number | null;
}

export const VOICE_END_REASONS = ['left', 'match_ended', 'blocked', 'timeout'] as const;
export type VoiceEndReason = (typeof VOICE_END_REASONS)[number];

/** Agora uids are the seat number plus one, so they are unique inside a match and never zero. */
export function voiceUidForSeat(seat: number): number {
  return seat + 1;
}

/** One channel per match, never reused. Agora channel names are at most 64 characters. */
export function voiceChannelForMatch(matchId: string): string {
  return `match_${matchId.replaceAll('-', '')}`;
}
