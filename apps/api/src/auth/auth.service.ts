import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AccountView,
  type AuthSession,
  CURRENT_TERMS_VERSION,
  ErrorCode,
  type MessageResponse,
  checkAgeEligibility,
} from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';
import { isUniqueViolation } from '../common/db-errors.js';
import type { RequestMeta } from '../common/request-meta.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import type { Prisma, User } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertAccountUsable } from './account-status.js';
import type {
  ForgotPasswordBody,
  LoginBody,
  RegisterBody,
  ResetPasswordBody,
  SocialLoginBody,
} from './auth.types.js';
import { PasswordService } from './password.service.js';
import { SocialTokenVerifier, type VerifiedSocialIdentity } from './social-token.verifier.js';
import { TokenService } from './token.service.js';

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** See AuthService.refresh: window in which a re-presented, just-rotated token is a benign duplicate. */
export const REFRESH_REUSE_LEEWAY_MS = 10 * 1000;

/** PrismaService (a PrismaClient) is structurally assignable to the transaction client type. */
type Db = Prisma.TransactionClient;

export function toAccountView(
  user: Pick<User, 'id' | 'email' | 'emailVerifiedAt' | 'role' | 'status' | 'createdAt'>,
): AccountView {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}

function invalidRefreshToken(): AppException {
  return new AppException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.REFRESH_TOKEN_INVALID,
    'Your session has ended. Please sign in again.',
  );
}

function invalidOneTimeToken(): AppException {
  return new AppException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.ONE_TIME_TOKEN_INVALID,
    'This link is invalid or has expired',
  );
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    private readonly social: SocialTokenVerifier,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Registration and password login
  // ---------------------------------------------------------------------------------------------

  async register(input: RegisterBody, meta: RequestMeta): Promise<AuthSession> {
    this.assertCurrentTerms(input.termsVersion);
    const dateOfBirth = this.assertEligible(input.dateOfBirth);
    const passwordHash = await this.passwords.hash(input.password);

    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          dateOfBirth,
          termsVersion: input.termsVersion,
          termsAcceptedAt: new Date(),
        },
      });
    } catch (error) {
      // The unique index on users.email is the arbiter for simultaneous registrations.
      if (isUniqueViolation(error)) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.EMAIL_TAKEN,
          'An account with this email already exists',
        );
      }
      throw error;
    }

    await this.sendVerificationEmail(user);
    return this.issueSession(this.prisma, user, meta);
  }

  async login(input: LoginBody, meta: RequestMeta): Promise<AuthSession> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });

    if (!user?.passwordHash) {
      await this.passwords.verifyAgainstDummy(input.password);
      throw this.invalidCredentials();
    }
    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      throw this.invalidCredentials();
    }

    // Only reveal account state after the credentials were proven correct.
    assertAccountUsable(user.status);

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    return this.issueSession(this.prisma, updated, meta);
  }

  // ---------------------------------------------------------------------------------------------
  // Refresh-token lifecycle
  // ---------------------------------------------------------------------------------------------

  /**
   * Rotates a refresh token. Each token is single-use; presenting a token that was rotated more
   * than REFRESH_REUSE_LEEWAY_MS ago is treated as theft and revokes the entire token family.
   *
   * Leeway: when an access token expires, a mobile app typically fires several API calls at once
   * and each one refreshes. Those near-simultaneous duplicates must not be mistaken for theft (that
   * would randomly sign users out), so a token rotated within the leeway window is rotated again
   * into a sibling token instead of failing. Replay after the window still revokes the family.
   */
  async refresh(rawToken: string, meta: RequestMeta): Promise<AuthSession> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.tokens.hashOpaqueToken(rawToken) },
      include: { user: true },
    });
    if (!existing) throw invalidRefreshToken();

    const now = new Date();
    if (existing.revokedAt && !this.isRecentRotation(existing, now)) {
      // Logged-out, revoked, or rotated long ago: a replayed token means the family may be stolen.
      await this.revokeFamily(existing.familyId, now);
      throw invalidRefreshToken();
    }
    if (existing.expiresAt <= now) throw invalidRefreshToken();

    if (existing.user.status !== 'ACTIVE') {
      await this.revokeFamily(existing.familyId, now);
      assertAccountUsable(existing.user.status);
    }

    const rotated = await this.prisma.$transaction(async (tx) => {
      // Atomic claim: of N concurrent refreshes with the same token, exactly one updates a row.
      const claimed = await tx.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: now },
      });

      if (claimed.count !== 1) {
        // Lost the race (or the token was already rotated). Re-read the committed state: only a
        // very recent rotation is a benign duplicate; anything else is not allowed to proceed.
        const current = await tx.refreshToken.findUnique({ where: { id: existing.id } });
        if (!current || !this.isRecentRotation(current, now)) return null;
      }

      const created = await this.createRefreshToken(tx, existing.user.id, meta, existing.familyId);
      if (claimed.count === 1) {
        await tx.refreshToken.update({
          where: { id: existing.id },
          data: { replacedById: created.id },
        });
      }
      return created.raw;
    });
    if (rotated === null) throw invalidRefreshToken();

    const access = await this.tokens.signAccessToken(existing.user);
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: rotated,
      user: toAccountView(existing.user),
    };
  }

  /** Ends one device session. Idempotent: unknown or already-revoked tokens are not an error. */
  async logout(rawToken: string): Promise<MessageResponse> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.tokens.hashOpaqueToken(rawToken) },
      select: { familyId: true },
    });
    if (existing) await this.revokeFamily(existing.familyId, new Date());
    return { message: 'Signed out' };
  }

  async logoutAll(userId: string): Promise<MessageResponse> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'Signed out everywhere' };
  }

  // ---------------------------------------------------------------------------------------------
  // Email verification
  // ---------------------------------------------------------------------------------------------

  async verifyEmail(rawToken: string): Promise<MessageResponse> {
    const now = new Date();
    const token = await this.prisma.oneTimeToken.findUnique({
      where: { tokenHash: this.tokens.hashOpaqueToken(rawToken) },
    });
    if (!token || token.type !== 'EMAIL_VERIFICATION' || token.usedAt || token.expiresAt <= now) {
      throw invalidOneTimeToken();
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.oneTimeToken.updateMany({
        where: { id: token.id, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw invalidOneTimeToken();
      await tx.user.updateMany({
        where: { id: token.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      });
    });
    return { message: 'Email verified' };
  }

  async resendVerification(userId: string): Promise<MessageResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) return { message: 'Email is already verified' };

    const recent = await this.prisma.oneTimeToken.findFirst({
      where: {
        userId,
        type: 'EMAIL_VERIFICATION',
        createdAt: { gt: new Date(Date.now() - VERIFICATION_RESEND_COOLDOWN_MS) },
      },
      select: { id: true },
    });
    if (recent) {
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorCode.VERIFICATION_TOO_SOON,
        'Please wait a minute before requesting another verification email',
      );
    }

    await this.sendVerificationEmail(user);
    return { message: 'Verification email sent' };
  }

  // ---------------------------------------------------------------------------------------------
  // Password reset
  // ---------------------------------------------------------------------------------------------

  /** Always answers identically so it cannot be used to discover which emails are registered. */
  async forgotPassword(input: ForgotPasswordBody): Promise<MessageResponse> {
    const response = { message: 'If an account exists for that email, a reset link has been sent' };
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user || user.status !== 'ACTIVE') return response;

    try {
      const raw = await this.createOneTimeToken(user.id, 'PASSWORD_RESET', PASSWORD_RESET_TTL_MS);
      await this.mail.sendPasswordResetEmail(user.email, raw);
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email for user ${user.id}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
    return response;
  }

  async resetPassword(input: ResetPasswordBody): Promise<MessageResponse> {
    const now = new Date();
    const token = await this.prisma.oneTimeToken.findUnique({
      where: { tokenHash: this.tokens.hashOpaqueToken(input.token) },
    });
    if (!token || token.type !== 'PASSWORD_RESET' || token.usedAt || token.expiresAt <= now) {
      throw invalidOneTimeToken();
    }

    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.oneTimeToken.updateMany({
        where: { id: token.id, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw invalidOneTimeToken();

      await tx.user.update({
        where: { id: token.userId },
        // Receiving the reset email also proves control of the mailbox.
        data: { passwordHash, emailVerifiedAt: now },
      });
      // A password reset must end every existing session (a thief may hold one).
      await tx.refreshToken.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.oneTimeToken.deleteMany({
        where: { userId: token.userId, type: 'PASSWORD_RESET', usedAt: null },
      });
    });
    return { message: 'Password updated. Please sign in with your new password.' };
  }

  // ---------------------------------------------------------------------------------------------
  // Social sign-in (Google / Apple)
  // ---------------------------------------------------------------------------------------------

  async socialLogin(input: SocialLoginBody, meta: RequestMeta): Promise<AuthSession> {
    const identity = await this.social.verify(input.provider, input.idToken, input.nonce);
    const provider = identity.provider === 'google' ? 'GOOGLE' : 'APPLE';

    const linked = await this.prisma.authIdentity.findUnique({
      where: { provider_providerUserId: { provider, providerUserId: identity.subject } },
      include: { user: true },
    });
    if (linked) {
      assertAccountUsable(linked.user.status);
      const user = await this.prisma.user.update({
        where: { id: linked.user.id },
        data: { lastLoginAt: new Date() },
      });
      return this.issueSession(this.prisma, user, meta);
    }

    if (!identity.email) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.SOCIAL_TOKEN_INVALID,
        'The provider did not share an email address for this account',
      );
    }
    if (!identity.emailVerified) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.SOCIAL_EMAIL_NOT_VERIFIED,
        'The email address on this provider account is not verified',
      );
    }

    const existing = await this.prisma.user.findUnique({ where: { email: identity.email } });
    if (existing) {
      return this.linkToExistingUser(existing, identity, provider, meta);
    }
    return this.createUserFromSocial(input, identity, provider, meta);
  }

  private async linkToExistingUser(
    existing: User,
    identity: VerifiedSocialIdentity,
    provider: 'GOOGLE' | 'APPLE',
    meta: RequestMeta,
  ): Promise<AuthSession> {
    assertAccountUsable(existing.status);
    const now = new Date();
    // The provider vouches for ownership of this email. If the existing account never proved it,
    // it may have been pre-registered by someone else who knows its password ("pre-hijacking"):
    // drop that password and every session so only the verified owner keeps access.
    const wasUnverified = existing.emailVerifiedAt === null;

    let user: User;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        await tx.authIdentity.create({
          data: {
            userId: existing.id,
            provider,
            providerUserId: identity.subject,
            email: identity.email ?? null,
          },
        });
        if (wasUnverified) {
          await tx.refreshToken.updateMany({
            where: { userId: existing.id, revokedAt: null },
            data: { revokedAt: now },
          });
          await tx.oneTimeToken.deleteMany({ where: { userId: existing.id, usedAt: null } });
        }
        return tx.user.update({
          where: { id: existing.id },
          data: {
            lastLoginAt: now,
            ...(wasUnverified ? { passwordHash: null, emailVerifiedAt: now } : {}),
          },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          'This sign-in is already being processed. Please try again.',
        );
      }
      throw error;
    }
    return this.issueSession(this.prisma, user, meta);
  }

  private async createUserFromSocial(
    input: SocialLoginBody,
    identity: VerifiedSocialIdentity,
    provider: 'GOOGLE' | 'APPLE',
    meta: RequestMeta,
  ): Promise<AuthSession> {
    if (!input.dateOfBirth || input.acceptedTerms !== true) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.REGISTRATION_DETAILS_REQUIRED,
        'Date of birth and acceptance of the terms are required to create your account',
      );
    }
    const termsVersion = input.termsVersion ?? CURRENT_TERMS_VERSION;
    this.assertCurrentTerms(termsVersion);
    const dateOfBirth = this.assertEligible(input.dateOfBirth);
    const now = new Date();

    try {
      const user = await this.prisma.user.create({
        data: {
          email: identity.email as string,
          passwordHash: null,
          dateOfBirth,
          termsVersion,
          termsAcceptedAt: now,
          emailVerifiedAt: now,
          lastLoginAt: now,
          identities: {
            create: { provider, providerUserId: identity.subject, email: identity.email ?? null },
          },
        },
      });
      return await this.issueSession(this.prisma, user, meta);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          'This sign-in is already being processed. Please try again.',
        );
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------

  private invalidCredentials(): AppException {
    return new AppException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.INVALID_CREDENTIALS,
      'Incorrect email or password',
    );
  }

  private assertCurrentTerms(termsVersion: string): void {
    if (termsVersion !== CURRENT_TERMS_VERSION) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.TERMS_NOT_ACCEPTED,
        'Please review and accept the latest terms and privacy policy',
      );
    }
  }

  /** Enforces the minimum age. Nothing about a rejected attempt is stored or logged. */
  private assertEligible(dateOfBirth: string): Date {
    const check = checkAgeEligibility(dateOfBirth);
    if (!check.ok) {
      if (check.reason === 'too_young') {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          ErrorCode.UNDER_MINIMUM_AGE,
          'You must be at least 16 years old to use GameVerse',
        );
      }
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'The request is invalid',
        [{ path: 'dateOfBirth', message: 'Enter a valid date of birth' }],
      );
    }
    return new Date(`${dateOfBirth}T00:00:00.000Z`);
  }

  private async issueSession(db: Db, user: User, meta: RequestMeta): Promise<AuthSession> {
    const refresh = await this.createRefreshToken(db, user.id, meta, randomUUID());
    const access = await this.tokens.signAccessToken(user);
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: refresh.raw,
      user: toAccountView(user),
    };
  }

  private async createRefreshToken(
    db: Db,
    userId: string,
    meta: RequestMeta,
    familyId: string,
  ): Promise<{ id: string; raw: string }> {
    const { raw, hash } = this.tokens.generateOpaqueToken();
    const row = await db.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ip ?? null,
      },
      select: { id: true },
    });
    return { id: row.id, raw };
  }

  /** True if the token was retired by rotation (not logout/revocation) within the leeway window. */
  private isRecentRotation(
    token: { revokedAt: Date | null; replacedById: string | null },
    now: Date,
  ): boolean {
    return (
      token.revokedAt !== null &&
      token.replacedById !== null &&
      now.getTime() - token.revokedAt.getTime() <= REFRESH_REUSE_LEEWAY_MS
    );
  }

  private revokeFamily(familyId: string, now: Date): Promise<Prisma.BatchPayload> {
    return this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  /** Replaces any outstanding token of the same type, so only the newest link works. */
  private async createOneTimeToken(
    userId: string,
    type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET',
    ttlMs: number,
  ): Promise<string> {
    const { raw, hash } = this.tokens.generateOpaqueToken();
    await this.prisma.$transaction([
      this.prisma.oneTimeToken.deleteMany({ where: { userId, type, usedAt: null } }),
      this.prisma.oneTimeToken.create({
        data: { userId, type, tokenHash: hash, expiresAt: new Date(Date.now() + ttlMs) },
      }),
    ]);
    return raw;
  }

  /** Failure to deliver email must not fail registration; the user can request a resend. */
  private async sendVerificationEmail(user: User): Promise<void> {
    try {
      const raw = await this.createOneTimeToken(
        user.id,
        'EMAIL_VERIFICATION',
        EMAIL_VERIFICATION_TTL_MS,
      );
      await this.mail.sendVerificationEmail(user.email, raw);
    } catch (error) {
      this.logger.error(
        `Failed to send verification email for user ${user.id}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}
