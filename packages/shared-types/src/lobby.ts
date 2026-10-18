import { z } from 'zod';
import {
  GAME_IDS,
  bestOfSchema,
  type BestOfChoice,
  type GameId,
  type MatchView,
} from './matches.js';
import { entryFeeSchema } from './wallet.js';

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
  /** Players the game starts with when the room is full (2 for tic-tac-toe, 2 to 4 for Ludo). */
  seats: number;
  /** Bonus coins every player pays to play; 0 for a free room. */
  entryFee: number;
  /** Tic-tac-toe: 1 = single game, 3 = best of three. Other games ignore it. */
  bestOf: BestOfChoice;
  /** Guests who joined with the code, in the order they joined. The host is not listed. */
  members: RoomPartyView[];
  expiresAt: string;
  /** Set once the match exists. */
  matchId: string | null;
  createdAt: string;
}

/** Players in a Ludo match: 2 to 4. Other games are always 2. */
export const MIN_ROOM_SEATS = 2;
export const MAX_ROOM_SEATS = 4;
const seatsField = z.number().int().min(MIN_ROOM_SEATS).max(MAX_ROOM_SEATS);

export const createRoomSchema = z
  .object({
    gameId: z.enum(GAME_IDS),
    players: seatsField.optional(),
    entryFee: entryFeeSchema.optional(),
    bestOf: bestOfSchema.optional(),
  })
  .strict();
export type CreateRoomRequest = z.input<typeof createRoomSchema>;

export const inviteFriendSchema = z
  .object({
    gameId: z.enum(GAME_IDS),
    friendUserId: z.uuid(),
    entryFee: entryFeeSchema.optional(),
    bestOf: bestOfSchema.optional(),
  })
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
    /** The entry fee the player has agreed to pay. Required when the room has one. */
    entryFee: entryFeeSchema.optional(),
  })
  .strict();
export type JoinRoomRequest = z.input<typeof joinRoomSchema>;

export const roomIdSchema = z.uuid();

/** The host starts a room that is not full yet; `bots` fills the empty seats with labelled bots. */
export const startRoomSchema = z
  .object({ bots: z.enum(['easy', 'medium', 'hard']).nullable().optional() })
  .strict();
export type StartRoomRequest = z.input<typeof startRoomSchema>;

/** What joining a room with a code did: the match if the room filled up and started, else the room. */
export interface RoomJoinResult {
  room: RoomView;
  match: MatchView | null;
}

export const joinQueueSchema = z
  .object({
    gameId: z.enum(GAME_IDS),
    players: seatsField.optional(),
    entryFee: entryFeeSchema.optional(),
    bestOf: bestOfSchema.optional(),
  })
  .strict();
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
    /** How many players this search is for. */
    players: number;
    /** Bonus coins each player pays; 0 for a free match. */
    entryFee: number;
    bestOf: BestOfChoice;
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
  /** The room I joined with a code (waiting for the host to start, or just started), if any. */
  joined: RoomView | null;
  /** Friend invites waiting for my answer. */
  invites: RoomView[];
}
