import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  FRIEND_REQUEST_REJECTION_COOLDOWN_DAYS,
  MAX_FRIENDS,
  MAX_PENDING_OUTGOING_REQUESTS,
  type FriendRequestResult,
  type FriendRequestView,
  type Page,
  type UserCard,
  type UserProfileView,
} from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushService } from '../push/push.service.js';
import { orderedPair } from './pair.js';
import { requireOwnProfile, requireVisibleUser, userNotFound } from './guards.js';
import { areFriends, isBlockedEitherWay, relationshipsFor, toCard } from './relationships.js';
import { runSerializable, type Tx } from './serializable.js';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /** Tells `to` about something `actorId` did. Best effort and never blocks the request. */
  private async pushFriendEvent(
    actorId: string,
    to: string,
    kind: 'FRIEND_REQUEST' | 'FRIEND_ACCEPTED',
  ): Promise<void> {
    const actor = await this.prisma.userProfile.findUnique({
      where: { userId: actorId },
      select: { username: true },
    });
    if (!actor) return;
    this.push.notify(to, {
      title: 'GameVerse',
      body:
        kind === 'FRIEND_REQUEST'
          ? `${actor.username} sent you a friend request`
          : `${actor.username} accepted your friend request`,
      data: { type: kind, userId: actorId },
    });
  }

  async sendRequest(
    me: string,
    targetId: string,
    now: Date = new Date(),
  ): Promise<FriendRequestResult> {
    if (me === targetId) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'You cannot send a friend request to yourself',
      );
    }
    // Set inside the transaction callback (reset on every retry); acted on only after commit.
    let notify: { to: string; kind: 'FRIEND_REQUEST' | 'FRIEND_ACCEPTED' } | null = null;
    const result = await runSerializable(this.prisma, async (tx) => {
      notify = null;
      await requireOwnProfile(tx, me);
      await requireVisibleUser(tx, me, targetId);

      if (await areFriends(tx, me, targetId)) return { status: 'FRIENDS' as const };

      const { low, high } = orderedPair(me, targetId);
      const existing = await tx.friendRequest.findUnique({
        where: { userLowId_userHighId: { userLowId: low, userHighId: high } },
      });

      if (existing?.status === 'PENDING') {
        if (existing.senderId === me) return { status: 'PENDING' as const }; // idempotent resend
        // They already asked me: both sides want this, so it becomes a friendship now.
        await this.acceptInTx(tx, existing.id, low, high);
        notify = { to: existing.senderId, kind: 'FRIEND_ACCEPTED' };
        return { status: 'FRIENDS' as const };
      }

      if (existing?.status === 'REJECTED' && existing.senderId === me) {
        const respondedAt = existing.respondedAt ?? existing.createdAt;
        const cooldownEnds =
          respondedAt.getTime() + FRIEND_REQUEST_REJECTION_COOLDOWN_DAYS * DAY_MS;
        // Within the cooldown the sender is told "sent" and nothing happens, so a rejection is
        // never revealed and cannot be turned into a harassment loop.
        if (now.getTime() < cooldownEnds) return { status: 'PENDING' as const };
      }

      await this.requireOutgoingCapacity(tx, me);
      if (existing) {
        // Reuse the row (the pair key is unique): either the cooldown has passed, or the rejecter
        // changed their mind and is now the one asking.
        await tx.friendRequest.update({
          where: { id: existing.id },
          data: {
            senderId: me,
            receiverId: targetId,
            status: 'PENDING',
            respondedAt: null,
            createdAt: now,
          },
        });
      } else {
        await tx.friendRequest.create({
          data: { senderId: me, receiverId: targetId, userLowId: low, userHighId: high },
        });
      }
      notify = { to: targetId, kind: 'FRIEND_REQUEST' };
      return { status: 'PENDING' as const };
    });
    const pending = notify as { to: string; kind: 'FRIEND_REQUEST' | 'FRIEND_ACCEPTED' } | null;
    if (pending) await this.pushFriendEvent(me, pending.to, pending.kind);
    return result;
  }

  private async requireOutgoingCapacity(tx: Tx, me: string): Promise<void> {
    const pending = await tx.friendRequest.count({ where: { senderId: me, status: 'PENDING' } });
    if (pending >= MAX_PENDING_OUTGOING_REQUESTS) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.TOO_MANY_PENDING_REQUESTS,
        'You have too many pending friend requests',
      );
    }
  }

  /** Deletes the request and creates the friendship, enforcing the friend cap for both people. */
  private async acceptInTx(tx: Tx, requestId: string, low: string, high: string): Promise<void> {
    const [lowCount, highCount] = await Promise.all([
      tx.friendship.count({ where: { OR: [{ userLowId: low }, { userHighId: low }] } }),
      tx.friendship.count({ where: { OR: [{ userLowId: high }, { userHighId: high }] } }),
    ]);
    if (lowCount >= MAX_FRIENDS || highCount >= MAX_FRIENDS) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.FRIEND_LIMIT_REACHED,
        'A friend list is full, so this request cannot be accepted',
      );
    }
    await tx.friendRequest.deleteMany({ where: { id: requestId } });
    await tx.friendship.createMany({
      data: [{ userLowId: low, userHighId: high }],
      skipDuplicates: true,
    });
  }

  async acceptRequest(me: string, requestId: string): Promise<void> {
    let senderId: string | null = null;
    await runSerializable(this.prisma, async (tx) => {
      senderId = null;
      const request = await tx.friendRequest.findUnique({ where: { id: requestId } });
      // 404 (not 403) for someone else's request, so request ids cannot be probed.
      if (!request || request.receiverId !== me || request.status !== 'PENDING') {
        throw new AppException(
          HttpStatus.NOT_FOUND,
          ErrorCode.NOT_FOUND,
          'Friend request not found',
        );
      }
      if (await isBlockedEitherWay(tx, me, request.senderId)) {
        throw new AppException(
          HttpStatus.NOT_FOUND,
          ErrorCode.NOT_FOUND,
          'Friend request not found',
        );
      }
      await this.acceptInTx(tx, request.id, request.userLowId, request.userHighId);
      senderId = request.senderId;
    });
    const accepted = senderId as string | null;
    if (accepted) await this.pushFriendEvent(me, accepted, 'FRIEND_ACCEPTED');
  }

  async rejectRequest(me: string, requestId: string, now: Date = new Date()): Promise<void> {
    await runSerializable(this.prisma, async (tx) => {
      const request = await tx.friendRequest.findUnique({ where: { id: requestId } });
      if (!request || request.receiverId !== me) {
        throw new AppException(
          HttpStatus.NOT_FOUND,
          ErrorCode.NOT_FOUND,
          'Friend request not found',
        );
      }
      if (request.status === 'REJECTED') return; // idempotent
      await tx.friendRequest.update({
        where: { id: request.id },
        data: { status: 'REJECTED', respondedAt: now },
      });
    });
  }

  /** The sender withdraws a pending request. A rejected request is left alone (cooldown stays). */
  async cancelRequest(me: string, requestId: string): Promise<void> {
    await runSerializable(this.prisma, async (tx) => {
      const request = await tx.friendRequest.findUnique({ where: { id: requestId } });
      if (!request || request.senderId !== me) {
        throw new AppException(
          HttpStatus.NOT_FOUND,
          ErrorCode.NOT_FOUND,
          'Friend request not found',
        );
      }
      if (request.status === 'PENDING')
        await tx.friendRequest.delete({ where: { id: request.id } });
    });
  }

  async removeFriend(me: string, otherId: string): Promise<void> {
    const { low, high } = orderedPair(me, otherId);
    await this.prisma.friendship.deleteMany({ where: { userLowId: low, userHighId: high } });
  }

  async listRequests(
    me: string,
    direction: 'incoming' | 'outgoing',
    limit: number,
    cursor?: string,
  ): Promise<Page<FriendRequestView>> {
    const rows = await this.prisma.friendRequest.findMany({
      where: {
        status: 'PENDING',
        ...(direction === 'incoming' ? { receiverId: me } : { senderId: me }),
        sender: { status: 'ACTIVE' },
        receiver: { status: 'ACTIVE' },
      },
      include: { sender: { include: { profile: true } }, receiver: { include: { profile: true } } },
      orderBy: { id: 'asc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const items: FriendRequestView[] = [];
    for (const row of rows.slice(0, limit)) {
      const other = direction === 'incoming' ? row.sender : row.receiver;
      if (!other.profile) continue;
      items.push({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        user: toCard(other.profile, direction === 'incoming' ? 'REQUEST_RECEIVED' : 'REQUEST_SENT'),
      });
    }
    return { items, nextCursor: hasMore ? (rows[limit - 1]?.id ?? null) : null };
  }

  async listFriends(me: string, limit: number, cursor?: string): Promise<Page<UserCard>> {
    const rows = await this.prisma.friendship.findMany({
      where: { OR: [{ userLowId: me }, { userHighId: me }] },
      include: {
        userLow: { include: { profile: true } },
        userHigh: { include: { profile: true } },
      },
      orderBy: { id: 'asc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const items: UserCard[] = [];
    for (const row of rows.slice(0, limit)) {
      const other = row.userLowId === me ? row.userHigh : row.userLow;
      if (other.status !== 'ACTIVE' || !other.profile) continue;
      items.push(toCard(other.profile, 'FRIEND'));
    }
    return { items, nextCursor: hasMore ? (rows[limit - 1]?.id ?? null) : null };
  }

  async search(me: string, query: string): Promise<UserCard[]> {
    // Prisma's startsWith does not escape LIKE wildcards, and "_" is legal in usernames, so escape
    // them here: otherwise "ad_" would match "adX...".
    const prefix = query
      .trim()
      .toLowerCase()
      .replace(/[\\%_]/g, (char) => `\\${char}`);
    const profiles = await this.prisma.userProfile.findMany({
      where: {
        usernameLower: { startsWith: prefix },
        userId: { not: me },
        user: {
          status: 'ACTIVE',
          blocksMade: { none: { blockedId: me } },
          blocksReceived: { none: { blockerId: me } },
        },
      },
      orderBy: { usernameLower: 'asc' },
      take: 20,
    });
    const relationships = await relationshipsFor(
      this.prisma,
      me,
      profiles.map((p) => p.userId),
    );
    return profiles.map((p) => toCard(p, relationships.get(p.userId) ?? 'NONE'));
  }

  async viewProfile(me: string, targetId: string): Promise<UserProfileView> {
    if (me === targetId) {
      const own = await this.prisma.userProfile.findUnique({ where: { userId: me } });
      if (!own) throw userNotFound();
      return { ...toCard(own, 'NONE'), bio: own.bio, restricted: false };
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      include: { profile: true, settings: true },
    });
    if (!target || target.status !== 'ACTIVE' || !target.profile) throw userNotFound();
    if (await isBlockedEitherWay(this.prisma, me, targetId)) throw userNotFound();

    const relationship =
      (await relationshipsFor(this.prisma, me, [targetId])).get(targetId) ?? 'NONE';
    const visibility = target.settings?.profileVisibility ?? 'FRIENDS';
    const canSeeAll = visibility === 'EVERYONE' || relationship === 'FRIEND';
    return {
      ...toCard(target.profile, relationship),
      bio: canSeeAll ? target.profile.bio : null,
      restricted: !canSeeAll,
    };
  }
}
