import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type AdminUserDetail,
  type AdminUserSummary,
  type UserRole,
  type UserStatus,
} from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';
import type { AuthUser } from '../auth/auth.types.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushService } from '../push/push.service.js';
import { RealtimeHub } from '../realtime/realtime.hub.js';
import { runSerializable, type Tx } from '../social/serializable.js';
import { recordAudit } from './audit.service.js';

export type ActionType = 'SUSPEND' | 'BAN' | 'REINSTATE';

const ACTION_AUDIT_NAME: Record<ActionType, string> = {
  SUSPEND: 'USER_SUSPENDED',
  BAN: 'USER_BANNED',
  REINSTATE: 'USER_REINSTATED',
};

function insufficientRole(message = 'You do not have permission to do this'): AppException {
  return new AppException(HttpStatus.FORBIDDEN, ErrorCode.INSUFFICIENT_ROLE, message);
}

function userNotFound(): AppException {
  return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'User not found');
}

/** Admins may act on moderators and users; moderators only on users; nobody on admins or themselves. */
export function mayActOn(actorRole: UserRole, targetRole: UserRole): boolean {
  if (targetRole === 'ADMIN') return false;
  if (actorRole === 'ADMIN') return true;
  return actorRole === 'MODERATOR' && targetRole === 'USER';
}

/** The new status for an action, or null when it is already in effect (idempotent no-op). */
export function nextStatus(type: ActionType, current: UserStatus): UserStatus | null {
  const invalid = (): never => {
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.INVALID_STATE,
      `Cannot ${type.toLowerCase()} an account that is ${current.toLowerCase().replace('_', ' ')}`,
    );
  };
  switch (type) {
    case 'BAN':
      if (current === 'BANNED') return null;
      return current === 'ACTIVE' || current === 'SUSPENDED' ? 'BANNED' : invalid();
    case 'SUSPEND':
      if (current === 'SUSPENDED') return null;
      return current === 'ACTIVE' ? 'SUSPENDED' : invalid();
    case 'REINSTATE':
      if (current === 'ACTIVE') return null;
      return current === 'BANNED' || current === 'SUSPENDED' ? 'ACTIVE' : invalid();
  }
}

@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hub: RealtimeHub,
    private readonly push: PushService,
  ) {}

  /**
   * Bans, suspends or reinstates an account. The status change, the action record, the audit entry
   * and (if given) the report resolution commit together. Ban and suspend also revoke every refresh
   * token and drop live sockets, so access ends immediately: the HTTP guard rechecks status on every
   * request regardless.
   */
  async applyAction(
    actor: AuthUser,
    targetId: string,
    type: ActionType,
    reason: string,
    reportId?: string,
    now: Date = new Date(),
  ): Promise<void> {
    if (reportId && type === 'REINSTATE') {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'A reinstatement cannot resolve a report',
      );
    }
    if (targetId === actor.id) throw insufficientRole('You cannot moderate your own account');

    const changed = await runSerializable(this.prisma, async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: targetId },
        select: { id: true, role: true, status: true },
      });
      if (!target) throw userNotFound();
      if (!mayActOn(actor.role, target.role)) throw insufficientRole();

      const status = nextStatus(type, target.status);
      if (reportId) await this.requireOpenReportAbout(tx, reportId, targetId);
      if (status === null) return false;

      await tx.user.update({ where: { id: targetId }, data: { status } });
      await tx.moderationAction.create({
        data: {
          moderatorId: actor.id,
          targetUserId: targetId,
          type,
          reason,
          reportId: reportId ?? null,
        },
      });
      if (type !== 'REINSTATE') {
        await tx.refreshToken.updateMany({
          where: { userId: targetId, revokedAt: null },
          data: { revokedAt: now },
        });
      }
      if (reportId) {
        await tx.moderationReport.update({
          where: { id: reportId },
          data: {
            status: 'RESOLVED',
            resolvedAt: now,
            resolvedById: actor.id,
            resolutionNote: `${type}: ${reason}`.slice(0, 500),
            dedupeKey: null,
          },
        });
      }
      await recordAudit(tx, {
        actorId: actor.id,
        action: ACTION_AUDIT_NAME[type],
        targetType: 'user',
        targetId,
        metadata: {
          reason,
          previousStatus: target.status,
          newStatus: status,
          reportId: reportId ?? null,
        },
      });
      return true;
    });

    if (changed && type !== 'REINSTATE') {
      this.hub.disconnectUser(targetId);
      await this.push.removeAllDevices(targetId);
    }
  }

  private async requireOpenReportAbout(tx: Tx, reportId: string, targetId: string): Promise<void> {
    const report = await tx.moderationReport.findUnique({
      where: { id: reportId },
      select: { status: true, reportedUserId: true },
    });
    if (!report || report.reportedUserId !== targetId) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Report not found');
    }
    if (report.status !== 'OPEN') {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE,
        'This report is already closed',
      );
    }
  }

  async changeRole(
    actor: AuthUser,
    targetId: string,
    role: UserRole,
    reason: string,
  ): Promise<void> {
    if (targetId === actor.id) throw insufficientRole('You cannot change your own role');
    if (role === 'ADMIN') {
      throw insufficientRole('Admin accounts can only be provisioned directly in the database');
    }
    await runSerializable(this.prisma, async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: targetId },
        select: { id: true, role: true },
      });
      if (!target) throw userNotFound();
      if (!mayActOn(actor.role, target.role)) throw insufficientRole();
      if (target.role === role) return;
      await tx.user.update({ where: { id: targetId }, data: { role } });
      await recordAudit(tx, {
        actorId: actor.id,
        action: 'ROLE_CHANGED',
        targetType: 'user',
        targetId,
        metadata: { reason, previousRole: target.role, newRole: role },
      });
    });
  }

  async search(actor: AuthUser, q: string): Promise<AdminUserSummary[]> {
    const term = q.trim();
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(term);
    const isEmail = term.includes('@');
    const where: Prisma.UserWhereInput = isId
      ? { id: term.toLowerCase() }
      : isEmail
        ? { email: term.toLowerCase() }
        : {
            profile: {
              usernameLower: { startsWith: term.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`) },
            },
          };
    const users = await this.prisma.user.findMany({
      where,
      include: { profile: true },
      orderBy: { id: 'asc' },
      take: 20,
    });
    // Lookups expose email addresses to staff, so they are audited (the query itself is not stored).
    await recordAudit(this.prisma, {
      actorId: actor.id,
      action: 'USER_SEARCHED',
      targetType: 'user',
      metadata: { kind: isId ? 'id' : isEmail ? 'email' : 'username', results: users.length },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      username: u.profile?.username ?? null,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  async detail(actor: AuthUser, userId: string): Promise<AdminUserDetail> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) throw userNotFound();
    const [reportsAgainst, openReportsAgainst, reportsMade, friendCount, actions] =
      await Promise.all([
        this.prisma.moderationReport.count({ where: { reportedUserId: userId } }),
        this.prisma.moderationReport.count({ where: { reportedUserId: userId, status: 'OPEN' } }),
        this.prisma.moderationReport.count({ where: { reporterId: userId } }),
        this.prisma.friendship.count({
          where: { OR: [{ userLowId: userId }, { userHighId: userId }] },
        }),
        this.prisma.moderationAction.findMany({
          where: { targetUserId: userId },
          orderBy: { id: 'desc' },
          take: 10,
        }),
      ]);
    await recordAudit(this.prisma, {
      actorId: actor.id,
      action: 'USER_VIEWED',
      targetType: 'user',
      targetId: userId,
    });
    return {
      id: user.id,
      email: user.email,
      username: user.profile?.username ?? null,
      avatarId: user.profile?.avatarId ?? null,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerifiedAt !== null,
      createdAt: user.createdAt.toISOString(),
      reportsAgainst,
      openReportsAgainst,
      reportsMade,
      friendCount,
      recentActions: actions.map((a) => ({
        id: a.id,
        type: a.type,
        reason: a.reason,
        moderatorId: a.moderatorId,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }
}
