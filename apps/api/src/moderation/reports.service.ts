import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  MAX_REPORTS_PER_DAY,
  type Page,
  type ReportContextMessage,
  type ReportView,
  type createReportSchema,
} from '@gameverse/shared-types';
import type { z } from 'zod';
import { AppException } from '../common/app.exception.js';
import { isUniqueViolation } from '../common/db-errors.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toCard } from '../social/relationships.js';
import { recordAudit } from './audit.service.js';

export type CreateReportBody = z.output<typeof createReportSchema>;

const DAY_MS = 24 * 60 * 60 * 1000;
const CONTEXT_MESSAGES = 5;

type ReportRow = Prisma.ModerationReportGetPayload<{
  include: { reporter: { include: { profile: true } }; reported: { include: { profile: true } } };
}>;

export function toReportView(row: ReportRow): ReportView {
  return {
    id: row.id,
    status: row.status,
    reason: row.reason,
    details: row.details,
    reporter: row.reporter.profile ? toCard(row.reporter.profile, 'NONE') : null,
    reported: row.reported.profile ? toCard(row.reported.profile, 'NONE') : null,
    reportedUserId: row.reportedUserId,
    reporterId: row.reporterId,
    messageId: row.messageId,
    messageSnapshot: row.messageSnapshot,
    context: (row.contextSnapshot as ReportContextMessage[] | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolutionNote: row.resolutionNote,
  };
}

const reportInclude = {
  reporter: { include: { profile: true } },
  reported: { include: { profile: true } },
} as const;

function notFound(what: string): AppException {
  return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, `${what} not found`);
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Files a report. Idempotent per (reporter, reported user, message): repeats return the open one. */
  async create(
    me: string,
    body: CreateReportBody,
    now: Date = new Date(),
  ): Promise<{ id: string; created: boolean }> {
    if (body.userId === me) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'You cannot report yourself',
      );
    }
    const reported = await this.prisma.user.findUnique({
      where: { id: body.userId },
      select: { id: true },
    });
    if (!reported) throw notFound('User');

    let messageSnapshot: string | null = null;
    let contextSnapshot: ReportContextMessage[] | null = null;
    if (body.messageId) {
      const message = await this.prisma.message.findUnique({
        where: { id: body.messageId },
        include: { conversation: true },
      });
      const inConversation =
        message !== null &&
        (message.conversation.userLowId === me || message.conversation.userHighId === me);
      // Same 404 whether the message does not exist, is not yours to see, or is by someone else.
      if (!message || !inConversation || message.senderId !== body.userId)
        throw notFound('Message');
      messageSnapshot = message.body;
      const earlier = await this.prisma.message.findMany({
        where: { conversationId: message.conversationId, id: { lt: message.id } },
        orderBy: { id: 'desc' },
        take: CONTEXT_MESSAGES,
      });
      contextSnapshot = earlier.reverse().map((m) => ({
        senderId: m.senderId,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      }));
    }

    const dedupeKey = `${me}:${body.userId}:${body.messageId ?? 'user'}`;
    const existing = await this.prisma.moderationReport.findUnique({ where: { dedupeKey } });
    if (existing) return { id: existing.id, created: false };

    const recent = await this.prisma.moderationReport.count({
      where: { reporterId: me, createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
    });
    if (recent >= MAX_REPORTS_PER_DAY) {
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorCode.TOO_MANY_REPORTS,
        'You have sent too many reports today',
      );
    }

    try {
      const created = await this.prisma.moderationReport.create({
        data: {
          reporterId: me,
          reportedUserId: body.userId,
          reason: body.reason,
          details: body.details,
          messageId: body.messageId ?? null,
          messageSnapshot,
          ...(contextSnapshot
            ? { contextSnapshot: contextSnapshot as unknown as Prisma.InputJsonValue }
            : {}),
          dedupeKey,
        },
      });
      return { id: created.id, created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const winner = await this.prisma.moderationReport.findUniqueOrThrow({ where: { dedupeKey } });
      return { id: winner.id, created: false };
    }
  }

  async list(
    status: 'OPEN' | 'RESOLVED' | 'DISMISSED',
    limit: number,
    cursor?: string,
  ): Promise<Page<ReportView>> {
    const rows = await this.prisma.moderationReport.findMany({
      where: { status },
      include: reportInclude,
      // Oldest first: the queue is worked from the front.
      orderBy: { id: 'asc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(toReportView);
    return { items, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null };
  }

  async get(id: string): Promise<ReportView> {
    const row = await this.prisma.moderationReport.findUnique({
      where: { id },
      include: reportInclude,
    });
    if (!row) throw notFound('Report');
    return toReportView(row);
  }

  async dismiss(
    moderatorId: string,
    id: string,
    note: string,
    now: Date = new Date(),
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Conditional update: two moderators closing the same report cannot both succeed.
      const closed = await tx.moderationReport.updateMany({
        where: { id, status: 'OPEN' },
        data: {
          status: 'DISMISSED',
          resolvedAt: now,
          resolvedById: moderatorId,
          resolutionNote: note,
          dedupeKey: null,
        },
      });
      if (closed.count === 0) {
        const exists = await tx.moderationReport.findUnique({
          where: { id },
          select: { id: true },
        });
        if (!exists) throw notFound('Report');
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATE,
          'This report is already closed',
        );
      }
      await recordAudit(tx, {
        actorId: moderatorId,
        action: 'REPORT_DISMISSED',
        targetType: 'report',
        targetId: id,
        metadata: { note },
      });
    });
  }
}
