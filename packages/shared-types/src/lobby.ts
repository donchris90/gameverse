import { z } from 'zod';
import { GAME_IDS, type GameId, type MatchView } from './matches.js';

export const ROOM_CODE_LENGTH = 6;
/** No 0/O or 1/I so a code read aloud or typed from a screenshot is not misread. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

export const ROOM_STATUSES = ['OPEN', 'STARTED', 'CLOSED', 'DECLINED', 'EXPIRED'] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export interface RoomPartyView {
  userId: string;
  username: string;
  avatarId: string;
}

/** A private room, or a friend invite (a room with an `invited` player). */
export interface RoomView {
  id: string;
  /** Only the host sees the code. The invitee gets the invite by id. */
  code: string | null;
  gameId: GameId;
  status: RoomStatus;
  host: RoomPartyView;
  invited: RoomPartyView | null;
  expiresAt: string;
  /** Set once the match exists. */
  matchId: string | null;
  createdAt: string;
}

export const createRoomSchema = z.object({ gameId: z.enum(GAME_IDS) }).strict();
export type CreateRoomRequest = z.input<typeof createRoomSchema>;

export const inviteFriendSchema = z
  .object({ gameId: z.enum(GAME_IDS), friendUserId: z.uuid() })
  .strict();
export type InviteFriendRequest = z.input<typeof inviteFriendSchema>;

export const joinRoomSchema = z
  .object({
    // Codes are shown upper case; accept what people type.
    code: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .pipe(z.string().regex(ROOM_CODE_PATTERN, 'Enter the 6-character room code')),
  })
  .strict();
export type JoinRoomRequest = z.input<typeof joinRoomSchema>;

export const roomIdSchema = z.uuid();

export const joinQueueSchema = z.object({ gameId: z.enum(GAME_IDS) }).strict();
export type JoinQueueRequest = z.input<typeof joinQueueSchema>;

/** Seconds a quick-match search waits before the app offers to play a bot instead. */
export const QUEUE_BOT_OFFER_AFTER_MS = 20_000;
/** A search that nobody joined within this time ends by itself. */
export const QUEUE_TTL_MS = 60_000;

export type MatchmakingState = 'idle' | 'searching' | 'matched';

export interface MatchmakingStatus {
  state: MatchmakingState;
  searching: {
    gameId: GameId;
    joinedAt: string;
    waitedMs: number;
    /** Rating difference currently accepted; widens the longer the search runs. */
    ratingBand: number;
    /** True once the wait is long enough that the app should offer a bot. */
    botOffer: boolean;
    expiresAt: string;
  } | null;
  /** The match found (state 'matched'), or null. */
  match: MatchView | null;
}

export interface LobbyOverview {
  /** The room I am hosting (waiting for a guest, or just started), if any. */
  hosted: RoomView | null;
  /** Friend invites waiting for my answer. */
  invites: RoomView[];
}
