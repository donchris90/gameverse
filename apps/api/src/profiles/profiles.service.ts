import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  USERNAME_CHANGE_COOLDOWN_DAYS,
  USERNAME_PATTERN,
  type ProfileView,
  type SettingsView,
  type UsernameCheckResult,
  updateProfileSchema,
  updateSettingsSchema,
} from '@gameverse/shared-types';
import type { z } from 'zod';
import { AppException } from '../common/app.exception.js';
import { isUniqueViolation } from '../common/db-errors.js';
import { containsBlockedTerm, isUsernameAllowed } from '../moderation/text-filter.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type UpdateProfileBody = z.output<typeof updateProfileSchema>;
export type UpdateSettingsBody = z.output<typeof updateSettingsSchema>;

const DAY_MS = 24 * 60 * 60 * 1000;

function toProfileView(profile: {
  userId: string;
  username: string;
  avatarId: string;
  bio: string | null;
}): ProfileView {
  return {
    userId: profile.userId,
    username: profile.username,
    avatarId: profile.avatarId,
    bio: profile.bio,
  };
}

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string): Promise<ProfileView> {
    const profile = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Profile is not set up yet',
      );
    }
    return toProfileView(profile);
  }

  /** Creates the profile on first call (onboarding) and updates it afterwards. */
  async saveProfile(
    userId: string,
    body: UpdateProfileBody,
    now: Date = new Date(),
  ): Promise<ProfileView> {
    if (!isUsernameAllowed(body.username)) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.USERNAME_NOT_ALLOWED,
        'That username is not allowed',
      );
    }
    if (body.bio !== null && containsBlockedTerm(body.bio)) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.CONTENT_NOT_ALLOWED,
        'Your bio contains words that are not allowed',
      );
    }

    const usernameLower = body.username.toLowerCase();
    const existing = await this.prisma.userProfile.findUnique({ where: { userId } });
    const renaming = existing !== null && existing.usernameLower !== usernameLower;
    if (renaming && existing.usernameChangedAt) {
      const nextAllowed =
        existing.usernameChangedAt.getTime() + USERNAME_CHANGE_COOLDOWN_DAYS * DAY_MS;
      if (now.getTime() < nextAllowed) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.USERNAME_CHANGE_TOO_SOON,
          `You can change your username again after ${new Date(nextAllowed).toISOString()}`,
          { availableAt: new Date(nextAllowed).toISOString() },
        );
      }
    }

    const data = {
      username: body.username,
      usernameLower,
      avatarId: body.avatarId,
      bio: body.bio,
      ...(renaming ? { usernameChangedAt: now } : {}),
    };

    try {
      const saved = await this.prisma.userProfile.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });
      return toProfileView(saved);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // The only other unique key is usernameLower, so a violation means another account holds the
      // name. (A same-user double submit is handled by the database upsert and never lands here;
      // the integration test "double-submitted first save" covers that.) Anything else is a bug and
      // is rethrown rather than reported as a taken username.
      const holder = await this.prisma.userProfile.findUnique({ where: { usernameLower } });
      if (holder && holder.userId !== userId) throw this.usernameTaken();
      throw error;
    }
  }

  async checkUsername(userId: string, raw: string): Promise<UsernameCheckResult> {
    const username = raw.trim();
    if (!USERNAME_PATTERN.test(username)) return { available: false, reason: 'INVALID' };
    if (!isUsernameAllowed(username)) return { available: false, reason: 'NOT_ALLOWED' };
    const holder = await this.prisma.userProfile.findUnique({
      where: { usernameLower: username.toLowerCase() },
      select: { userId: true },
    });
    if (holder && holder.userId !== userId) return { available: false, reason: 'TAKEN' };
    return { available: true };
  }

  async getSettings(userId: string): Promise<SettingsView> {
    const settings = await this.prisma.userSettings.findUnique({ where: { userId } });
    // Absent row means "all defaults": the schema defaults are the conservative friends-only ones.
    return {
      profileVisibility: settings?.profileVisibility ?? 'FRIENDS',
      onlineStatusVisibility: settings?.onlineStatusVisibility ?? 'FRIENDS',
      dmPolicy: settings?.dmPolicy ?? 'FRIENDS',
    };
  }

  async updateSettings(userId: string, body: UpdateSettingsBody): Promise<SettingsView> {
    const saved = await this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...body },
      update: body,
    });
    return {
      profileVisibility: saved.profileVisibility,
      onlineStatusVisibility: saved.onlineStatusVisibility,
      dmPolicy: saved.dmPolicy,
    };
  }

  private usernameTaken(): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.USERNAME_TAKEN,
      'That username is taken',
    );
  }
}
