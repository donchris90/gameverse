import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ErrorCode, type UserRole } from '@gameverse/shared-types';
import { errors, jwtVerify, SignJWT } from 'jose';
import { AppException } from '../common/app.exception.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

const ISSUER = 'gameverse-api';
const AUDIENCE = 'gameverse-app';

export interface AccessClaims {
  /** User id. */
  sub: string;
  role: UserRole;
}

export interface OpaqueToken {
  /** Sent to the client / emailed. Never stored. */
  raw: string;
  /** SHA-256 hex digest. This is what the database stores. */
  hash: string;
}

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.key = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
  }

  async signAccessToken(user: { id: string; role: UserRole }): Promise<{
    token: string;
    expiresIn: number;
  }> {
    const expiresIn = this.config.ACCESS_TOKEN_TTL_SECONDS;
    const token = await new SignJWT({ role: user.role })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${expiresIn}s`)
      .sign(this.key);
    return { token, expiresIn };
  }

  /** Verifies signature, algorithm (HS256 only), issuer, audience and expiry. */
  async verifyAccessToken(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      if (typeof payload.sub !== 'string' || typeof payload['role'] !== 'string') {
        throw new errors.JWTInvalid('missing claims');
      }
      return { sub: payload.sub, role: payload['role'] as UserRole };
    } catch (error) {
      if (error instanceof errors.JWTExpired) {
        throw new AppException(
          HttpStatus.UNAUTHORIZED,
          ErrorCode.TOKEN_EXPIRED,
          'Your session has expired',
        );
      }
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.TOKEN_INVALID,
        'Your session is not valid',
      );
    }
  }

  /** 256 bits of CSPRNG output, URL-safe. */
  generateOpaqueToken(): OpaqueToken {
    const raw = randomBytes(32).toString('base64url');
    return { raw, hash: this.hashOpaqueToken(raw) };
  }

  hashOpaqueToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
