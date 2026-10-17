import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode, type Page, type UserCard } from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { orderedPair } from './pair.js';
import { toCard } from './relationships.js';
import { runSerializable } from './serializable.js';

@Injectable()
export class BlocksService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Blocks `targetId`. In the same transaction it ends any friendship and removes any friend request
   * in either direction, so a block can never coexist with a friendship. Idempotent.
   */
  async block(me: string, targetId: string): Promise<void> {
    if (me === targetId) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'You cannot block yourself',
      );
    }
    const { low, high } = orderedPair(me, targetId);
    await runSerializable(this.prisma, async (tx) => {
      const target = await tx.user.findUnique({ where: { id: targetId }, select: { id: true } });
      if (!target)
        throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'User not found');
      await tx.blockedUser.createMany({
        data: [{ blockerId: me, blockedId: targetId }],
        skipDuplicates: true,
      });
      await tx.friendship.deleteMany({ where: { userLowId: low, userHighId: high } });
      await tx.friendRequest.deleteMany({ where: { userLowId: low, userHighId: high } });
    });
  }

  async unblock(me: string, targetId: string): Promise<void> {
    await this.prisma.blockedUser.deleteMany({ where: { blockerId: me, blockedId: targetId } });
  }

  async list(me: string, limit: number, cursor?: string): Promise<Page<UserCard>> {
    const rows = await this.prisma.blockedUser.findMany({
      where: { blockerId: me },
      include: { blocked: { include: { profile: true } } },
      orderBy: { id: 'asc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const items: UserCard[] = [];
    for (const row of rows.slice(0, limit)) {
      if (row.blocked.profile) items.push(toCard(row.blocked.profile, 'NONE'));
    }
    return { items, nextCursor: hasMore ? (rows[limit - 1]?.id ?? null) : null };
  }
}
