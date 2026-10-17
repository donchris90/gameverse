import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertAccountUsable } from './account-status.js';
import type { AuthUser } from './auth.types.js';
import { TokenService } from './token.service.js';

export interface AuthenticatedSession {
  user: AuthUser;
  /** When the presented access token expires (epoch ms). */
  tokenExpiresAtMs: number;
}

/**
 * Turns a bearer access token into the current user. The database lookup is deliberate: suspending
 * or banning an account takes effect on the very next request or socket connection instead of
 * waiting for the token to expire. Shared by the HTTP guard and the WebSocket gateway.
 */
@Injectable()
export class SessionAuthenticator {
  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async authenticate(accessToken: string): Promise<AuthenticatedSession> {
    const claims = await this.tokens.verifyAccessTokenWithExpiry(accessToken);
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
    return {
      tokenExpiresAtMs: claims.expiresAtMs,
      user: {
        id: user.id,
        email: user.email,
        // Role comes from the database, never from the token, so demotions apply immediately.
        role: user.role,
        status: user.status,
        emailVerified: user.emailVerifiedAt !== null,
      },
    };
  }
}
