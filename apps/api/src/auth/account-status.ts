import { HttpStatus } from '@nestjs/common';
import { ErrorCode, type UserStatus } from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';

/**
 * Single source of truth for "may this account use the service right now?".
 * Used by login, refresh, social sign-in and the JWT guard, so a ban takes effect everywhere at once.
 */
export function assertAccountUsable(status: UserStatus): void {
  switch (status) {
    case 'ACTIVE':
      return;
    case 'SUSPENDED':
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCOUNT_SUSPENDED,
        'This account is suspended',
      );
    case 'BANNED':
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCOUNT_BANNED,
        'This account is banned',
      );
    default:
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCOUNT_UNAVAILABLE,
        'This account is not available',
      );
  }
}
