import { Injectable } from '@nestjs/common';
import type { AuditLogView, Page } from '@gameverse/shared-types';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/** Record inside the same transaction as the change it describes, so the two cannot diverge. */
export async function recordAudit(db: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
    },
  });
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: {
    limit: number;
    cursor?: string | undefined;
    actorId?: string | undefined;
    targetId?: string | undefined;
  }): Promise<Page<AuditLogView>> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(filter.actorId ? { actorId: filter.actorId } : {}),
        ...(filter.targetId ? { targetId: filter.targetId } : {}),
        ...(filter.cursor ? { id: { lt: filter.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: filter.limit + 1,
    });
    const hasMore = rows.length > filter.limit;
    const items = rows.slice(0, filter.limit).map((row) => ({
      id: row.id,
      actorId: row.actorId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
    }));
    return { items, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null };
  }
}
