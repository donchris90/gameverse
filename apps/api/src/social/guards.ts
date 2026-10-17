import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';
import { isBlockedEitherWay } from './relationships.js';
import type { Tx } from './serializable.js';

export function userNotFound(): AppException {
  // Same answer for "does not exist", "blocked either way" and "not active", so none can be probed.
  return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'User not found');
}

/** The target must be an active user with a profile and no block in either direction. */
export async function requireVisibleUser(db: Tx, me: string, targetId: string): Promise<void> {
  const target = await db.user.findUnique({
    where: { id: targetId },
    select: { status: true, profile: { select: { userId: true } } },
  });
  if (!target || target.status !== 'ACTIVE' || !target.profile) throw userNotFound();
  if (await isBlockedEitherWay(db, me, targetId)) throw userNotFound();
}

export async function requireOwnProfile(db: Tx, me: string): Promise<void> {
  const own = await db.userProfile.findUnique({ where: { userId: me }, select: { userId: true } });
  if (!own) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.PROFILE_REQUIRED,
      'Choose a username before adding friends or chatting',
    );
  }
}
