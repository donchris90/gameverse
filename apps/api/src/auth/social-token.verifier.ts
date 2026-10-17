import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ErrorCode, type SocialProvider } from '@gameverse/shared-types';
import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { AppException } from '../common/app.exception.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

/** DI token for the per-provider signing-key resolvers (overridden with local keys in tests). */
export const SOCIAL_KEY_RESOLVERS = Symbol('SOCIAL_KEY_RESOLVERS');
export type SocialKeyResolvers = Record<SocialProvider, JWTVerifyGetKey>;

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const APPLE_ISSUER = 'https://appleid.apple.com';

/** Production resolvers: fetch and cache the providers' published JWKS. */
export function createRemoteKeyResolvers(): SocialKeyResolvers {
  return {
    google: createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')),
    apple: createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys')),
  };
}

export interface VerifiedSocialIdentity {
  provider: SocialProvider;
  /** Provider's stable subject id. */
  subject: string;
  email?: string;
  emailVerified: boolean;
}

/** JOSE errors that mean "this token is bad" (as opposed to "we could not check it"). */
function isTokenRejection(error: unknown): boolean {
  return (
    error instanceof errors.JWTClaimValidationFailed ||
    error instanceof errors.JWTExpired ||
    error instanceof errors.JWTInvalid ||
    error instanceof errors.JWSInvalid ||
    error instanceof errors.JWSSignatureVerificationFailed ||
    error instanceof errors.JWKSNoMatchingKey ||
    error instanceof errors.JOSEAlgNotAllowed
  );
}

@Injectable()
export class SocialTokenVerifier {
  private readonly logger = new Logger(SocialTokenVerifier.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SOCIAL_KEY_RESOLVERS) private readonly resolvers: SocialKeyResolvers,
  ) {}

  async verify(
    provider: SocialProvider,
    idToken: string,
    nonce?: string,
  ): Promise<VerifiedSocialIdentity> {
    const audiences =
      provider === 'google' ? this.config.GOOGLE_CLIENT_IDS : this.config.APPLE_CLIENT_IDS;
    if (audiences.length === 0) {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.SOCIAL_PROVIDER_NOT_CONFIGURED,
        `${provider === 'google' ? 'Google' : 'Apple'} sign-in is not configured on this server`,
      );
    }

    let payload: Record<string, unknown>;
    try {
      const result = await jwtVerify(idToken, this.resolvers[provider], {
        algorithms: ['RS256'],
        issuer: provider === 'google' ? GOOGLE_ISSUERS : APPLE_ISSUER,
        audience: audiences,
      });
      payload = result.payload as Record<string, unknown>;
    } catch (error) {
      if (isTokenRejection(error)) {
        throw new AppException(
          HttpStatus.UNAUTHORIZED,
          ErrorCode.SOCIAL_TOKEN_INVALID,
          'The sign-in token could not be verified',
        );
      }
      // Could not fetch the provider's keys, etc. Not the user's fault: report unavailability.
      this.logger.error(
        `Social token verification failed for ${provider}: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.SERVICE_UNAVAILABLE,
        'Sign-in with this provider is temporarily unavailable',
      );
    }

    const subject = payload['sub'];
    if (typeof subject !== 'string' || subject.length === 0) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.SOCIAL_TOKEN_INVALID,
        'The sign-in token could not be verified',
      );
    }

    if (nonce !== undefined) {
      const tokenNonce = payload['nonce'];
      const hashed = createHash('sha256').update(nonce).digest('hex');
      if (typeof tokenNonce !== 'string' || (tokenNonce !== nonce && tokenNonce !== hashed)) {
        throw new AppException(
          HttpStatus.UNAUTHORIZED,
          ErrorCode.SOCIAL_TOKEN_INVALID,
          'The sign-in token could not be verified',
        );
      }
    }

    const email =
      typeof payload['email'] === 'string' ? payload['email'].trim().toLowerCase() : undefined;
    const verifiedClaim = payload['email_verified'];
    return {
      provider,
      subject,
      ...(email ? { email } : {}),
      // Apple sends the string "true"; Google sends a boolean.
      emailVerified: verifiedClaim === true || verifiedClaim === 'true',
    };
  }
}
