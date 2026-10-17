import { z } from 'zod';
import { PAGE_SIZE_MAX, USER_SEARCH_MIN_LENGTH } from './constants.js';

export const userIdSchema = z.uuid();

export const targetUserSchema = z.object({ userId: userIdSchema });

export const searchUsersQuerySchema = z.object({
  q: z.string().trim().min(USER_SEARCH_MIN_LENGTH).max(20),
});

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(50),
  cursor: z.uuid().optional(),
});

export const friendRequestDirectionSchema = z.object({
  direction: z.enum(['incoming', 'outgoing']).default('incoming'),
});

export type Relationship = 'NONE' | 'FRIEND' | 'REQUEST_SENT' | 'REQUEST_RECEIVED';

/** The minimum another user may see: enough to recognise and befriend, nothing private. */
export interface UserCard {
  userId: string;
  username: string;
  avatarId: string;
  relationship: Relationship;
}

export interface UserProfileView extends UserCard {
  /** Null when hidden by the owner's privacy setting. */
  bio: string | null;
  /** True when the viewer is not allowed to see the full profile. */
  restricted: boolean;
}

export interface FriendRequestView {
  id: string;
  user: UserCard;
  createdAt: string;
}

export interface FriendRequestResult {
  status: 'PENDING' | 'FRIENDS';
}

export interface Page<T> {
  items: T[];
  /** Pass as `cursor` to get the next page; null when there are no more. */
  nextCursor: string | null;
}
