import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode, type MessageResponse } from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';
import { TokenService } from '../auth/token.service.js';
import { MailService } from '../mail/mail.service.js';
import { recordAudit } from '../moderation/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeHub } from '../realtime/realtime.hub.js';

const DELETION_TOKEN_TTL_MS = 60 * 60 * 1000;
const REQUEST_COOLDOWN_MS = 60 * 1000;

function invalidToken(): AppException {
  return new AppException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.ONE_TIME_TOKEN_INVALID,
    'This link is invalid or has expired',
  );
}

/**
 * Account deletion (required by both app stores). Two steps, so a stolen session alone cannot erase
 * an account: the signed-in user asks for a link, the link goes to the account's email address, and
 * the deletion needs both the session and the link.
 *
 * Deletion removes personal data and leaves an anonymised tombstone row (status DELETED). Kept on
 * purpose, and to be stated in the privacy policy: moderation reports (with their evidence
 * snapshots), moderation actions and the audit log, which protect other users and the service.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    private readonly hub: RealtimeHub,
  ) {}

  async requestDeletion(userId: string, now: Date = new Date()): Promise<MessageResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, status: true },
    });
    this.requireDeletable(user.status);
    if (await this.recentlyRequested(userId, now)) {
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorCode.VERIFICATION_TOO_SOON,
        'Please wait a minute before requesting another link',
      );
    }
    await this.issueLink(user, now);
    return { message: 'We emailed you a link to confirm deleting your account' };
  }

  /**
   * The same request without the app, for the public web page (Google Play requires a way to ask
   * for deletion that does not need the app installed). Answers identically whether or not the
   * address belongs to an account, so it cannot be used to find out who has one. Whoever controls
   * the mailbox controls the account already (password reset), so the emailed link is enough.
   */
  async requestDeletionByEmail(email: string, now: Date = new Date()): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, email: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE') return;
    if (await this.recentlyRequested(user.id, now)) return;
    try {
      await this.issueLink(user, now);
    } catch {
      // Same answer either way; the person can ask again.
    }
  }

  private async recentlyRequested(userId: string, now: Date): Promise<boolean> {
    const recent = await this.prisma.oneTimeToken.findFirst({
      where: {
        userId,
        type: 'ACCOUNT_DELETION',
        createdAt: { gt: new Date(now.getTime() - REQUEST_COOLDOWN_MS) },
      },
      select: { id: true },
    });
    return recent !== null;
  }

  private async issueLink(user: { id: string; email: string }, now: Date): Promise<void> {
    const userId = user.id;
    const { raw, hash } = this.tokens.generateOpaqueToken();
    const [, created] = await this.prisma.$transaction([
      this.prisma.oneTimeToken.deleteMany({
        where: { userId, type: 'ACCOUNT_DELETION', usedAt: null },
      }),
      this.prisma.oneTimeToken.create({
        data: {
          userId,
          type: 'ACCOUNT_DELETION',
          tokenHash: hash,
          expiresAt: new Date(now.getTime() + DELETION_TOKEN_TTL_MS),
        },
      }),
    ]);
    try {
      await this.mail.sendAccountDeletionEmail(user.email, raw);
    } catch {
      // The link never left the building: drop it so the player can retry straight away instead
      // of waiting out the cooldown, and say plainly that nothing was sent.
      await this.prisma.oneTimeToken.delete({ where: { id: created.id } }).catch(() => undefined);
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.SERVICE_UNAVAILABLE,
        'We could not send the email right now. Please try again in a few minutes.',
      );
    }
  }

  async confirmDeletion(userId: string, rawToken: string, now: Date = new Date()): Promise<void> {
    const token = await this.prisma.oneTimeToken.findUnique({
      where: { tokenHash: this.tokens.hashOpaqueToken(rawToken) },
    });
    // The link must belong to the signed-in account: it works for nobody else.
    if (
      !token ||
      token.type !== 'ACCOUNT_DELETION' ||
      token.userId !== userId ||
      token.usedAt ||
      token.expiresAt <= now
    ) {
      throw invalidToken();
    }

    await this.erase(token.id, userId, now);
  }

  /** Confirmation from the web page: the emailed link alone identifies the account. */
  async confirmDeletionByToken(rawToken: string, now: Date = new Date()): Promise<void> {
    const token = await this.prisma.oneTimeToken.findUnique({
      where: { tokenHash: this.tokens.hashOpaqueToken(rawToken) },
    });
    if (!token || token.type !== 'ACCOUNT_DELETION' || token.usedAt || token.expiresAt <= now) {
      throw invalidToken();
    }
    await this.erase(token.id, token.userId, now);
  }

  private async erase(tokenId: string, userId: string, now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.oneTimeToken.updateMany({
        where: { id: tokenId, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw invalidToken();

      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { status: true },
      });
      this.requireDeletable(user.status);

      const involved = { OR: [{ userLowId: userId }, { userHighId: userId }] };
      // Conversations cascade to their members and messages (both sides' copies are removed).
      await tx.conversation.deleteMany({ where: involved });
      await tx.friendship.deleteMany({ where: involved });
      await tx.friendRequest.deleteMany({ where: involved });
      await tx.blockedUser.deleteMany({
        where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      });
      await tx.userProfile.deleteMany({ where: { userId } });
      await tx.userSettings.deleteMany({ where: { userId } });
      await tx.authIdentity.deleteMany({ where: { userId } });
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.deviceToken.deleteMany({ where: { userId } });
      await tx.oneTimeToken.deleteMany({ where: { userId } });
      await tx.user.update({
        where: { id: userId },
        data: {
          status: 'DELETED',
          // Unique, undeliverable (.invalid is reserved), and frees the real address for reuse.
          email: `deleted-${userId}@deleted.invalid`,
          passwordHash: null,
          dateOfBirth: new Date('1970-01-01T00:00:00.000Z'),
          emailVerifiedAt: null,
          lastLoginAt: null,
          deletedAt: now,
        },
      });
      await recordAudit(tx, {
        actorId: userId,
        action: 'ACCOUNT_DELETED',
        targetType: 'user',
        targetId: userId,
      });
    });

    this.hub.disconnectUser(userId);
  }

  /**
   * Banned and suspended accounts cannot erase themselves: deleting and re-registering would be a
   * way around a ban. They keep the ban until a moderator reinstates them.
   */
  private requireDeletable(status: string): void {
    if (status === 'ACTIVE') return;
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.INVALID_STATE,
      'This account cannot be deleted right now. Contact support.',
    );
  }
}
