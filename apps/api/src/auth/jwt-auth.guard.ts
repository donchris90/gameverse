import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { SessionAuthenticator } from './session-authenticator.js';

/** Authenticates a Bearer access token and attaches the current user (loaded from the DB) to the request. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionAuthenticator) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer ([^\s]+)$/.exec(header) : null;
    if (!match?.[1]) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHENTICATED,
        'Authentication is required',
      );
    }
    request.user = (await this.sessions.authenticate(match[1])).user;
    return true;
  }
}
