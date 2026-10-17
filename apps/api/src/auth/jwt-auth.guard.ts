import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertAccountUsable } from './account-status.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { TokenService } from './token.service.js';

/**
 * Authenticates a Bearer access token, then loads the user from the database on every request.
 * The database lookup is deliberate: suspending or banning an account takes effect on the very next
 * request instead of waiting for the access token to expire.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

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

    const claims = await this.tokens.verifyAccessToken(match[1]);
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, email: true, role: true, status: true, emailVerifiedAt: true },
    });
    if (!user) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.TOKEN_INVALID,
        'Your session is not valid',
      );
    }
    assertAccountUsable(user.status);

    request.user = {
      id: user.id,
      email: user.email,
      // Role comes from the database, never from the token, so demotions apply immediately.
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerifiedAt !== null,
    };
    return true;
  }
}
