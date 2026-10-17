import { z } from 'zod';
import {
  AVATAR_IDS,
  BIO_MAX_LENGTH,
  DIRECT_MESSAGE_POLICIES,
  ONLINE_STATUS_VISIBILITIES,
  PROFILE_VISIBILITIES,
  USERNAME_PATTERN,
} from './constants.js';

export const usernameSchema = z
  .string()
  .trim()
  .regex(
    USERNAME_PATTERN,
    'must be 3-20 characters: letters, digits or underscore, starting with a letter',
  );

export const updateProfileSchema = z.object({
  username: usernameSchema,
  avatarId: z.enum(AVATAR_IDS),
  bio: z
    .string()
    .trim()
    .max(BIO_MAX_LENGTH)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .default(null),
});

export const usernameCheckQuerySchema = z.object({ username: z.string().trim().min(1).max(64) });

export const updateSettingsSchema = z
  .object({
    profileVisibility: z.enum(PROFILE_VISIBILITIES),
    onlineStatusVisibility: z.enum(ONLINE_STATUS_VISIBILITIES),
    dmPolicy: z.enum(DIRECT_MESSAGE_POLICIES),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one setting is required',
  });

export interface ProfileView {
  userId: string;
  username: string;
  avatarId: string;
  bio: string | null;
}

export interface SettingsView {
  profileVisibility: (typeof PROFILE_VISIBILITIES)[number];
  onlineStatusVisibility: (typeof ONLINE_STATUS_VISIBILITIES)[number];
  dmPolicy: (typeof DIRECT_MESSAGE_POLICIES)[number];
}

export type UsernameUnavailableReason = 'INVALID' | 'TAKEN' | 'NOT_ALLOWED';
export interface UsernameCheckResult {
  available: boolean;
  reason?: UsernameUnavailableReason;
}
