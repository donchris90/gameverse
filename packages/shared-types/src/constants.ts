/** Minimum age to create an account. Legal review is required per market before launch. */
export const MIN_AGE_YEARS = 16;

/** Upper sanity bound used to reject obviously fabricated dates of birth. */
export const MAX_AGE_YEARS = 120;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Version string of the terms of service / privacy policy a user accepts at signup.
 * DRAFT - the real documents must be reviewed by counsel before launch.
 */
export const CURRENT_TERMS_VERSION = 'draft-1';

export const SOCIAL_PROVIDERS = ['google', 'apple'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export const USER_ROLES = ['USER', 'MODERATOR', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = [
  'ACTIVE',
  'SUSPENDED',
  'BANNED',
  'PENDING_DELETION',
  'DELETED',
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Free avatar set shipped with the app. Paid or earned avatars arrive with the shop (post-MVP). */
export const AVATAR_IDS = Array.from(
  { length: 12 },
  (_, index) => `avatar-${String(index + 1).padStart(2, '0')}`,
) as readonly string[] as readonly [string, ...string[]];
export type AvatarId = string;

export const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{2,19}$/;
export const BIO_MAX_LENGTH = 160;
/** Minimum days between username changes (stops evasion of blocks/reports by renaming). */
export const USERNAME_CHANGE_COOLDOWN_DAYS = 7;

export const PROFILE_VISIBILITIES = ['EVERYONE', 'FRIENDS'] as const;
export type ProfileVisibility = (typeof PROFILE_VISIBILITIES)[number];

export const ONLINE_STATUS_VISIBILITIES = ['EVERYONE', 'FRIENDS', 'NOBODY'] as const;
export type OnlineStatusVisibility = (typeof ONLINE_STATUS_VISIBILITIES)[number];

export const DIRECT_MESSAGE_POLICIES = ['EVERYONE', 'FRIENDS', 'NOBODY'] as const;
export type DirectMessagePolicy = (typeof DIRECT_MESSAGE_POLICIES)[number];

export const MAX_FRIENDS = 500;
export const MAX_PENDING_OUTGOING_REQUESTS = 100;
/** After a rejection, the sender cannot re-send for this long (silently ignored). */
export const FRIEND_REQUEST_REJECTION_COOLDOWN_DAYS = 30;
export const USER_SEARCH_MIN_LENGTH = 2;
export const PAGE_SIZE_MAX = 100;
