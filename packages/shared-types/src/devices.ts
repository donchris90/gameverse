import { z } from 'zod';

/** Expo push tokens look like ExponentPushToken[xxxx] (or the older ExpoPushToken[xxxx]). */
export const EXPO_PUSH_TOKEN_PATTERN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{8,128}\]$/;

export const registerDeviceSchema = z.object({
  token: z.string().trim().regex(EXPO_PUSH_TOKEN_PATTERN, 'must be an Expo push token'),
  platform: z.enum(['IOS', 'ANDROID']),
});

export const unregisterDeviceQuerySchema = z.object({
  token: z.string().trim().min(1).max(200),
});

export const presenceQuerySchema = z.object({
  userIds: z.array(z.uuid()).min(1).max(100),
});

export interface PresenceEntry {
  userId: string;
  /** null when the viewer is not allowed to know (hidden, blocked, unknown): all look the same. */
  online: boolean | null;
}

export const confirmDeletionSchema = z.object({ token: z.string().min(1).max(512) });

export const MAX_DEVICES_PER_USER = 10;
