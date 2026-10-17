import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  MESSAGE_BURST_LIMIT,
  MESSAGE_BURST_WINDOW_SECONDS,
  type ConversationPage,
  type ConversationView,
  type MessageView,
  type Page,
} from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';
import { isUniqueViolation } from '../common/db-errors.js';
import type { Message } from '../generated/prisma/client.js';
import { containsBlockedTerm } from '../moderation/text-filter.js';
import { PushService } from '../push/push.service.js';
import { RealtimeHub } from '../realtime/realtime.hub.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { requireOwnProfile, requireVisibleUser } from '../social/guards.js';
import { orderedPair } from '../social/pair.js';
import { areFriends, isBlockedEitherWay, toCard } from '../social/relationships.js';
import type { Tx } from '../social/serializable.js';

function toMessageView(message: Message): MessageView {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    body: message.body,
    clientMessageId: message.clientMessageId,
    createdAt: message.createdAt.toISOString(),
  };
}

function conversationNotFound(): AppException {
  return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Conversation not found');
}

function cannotMessage(): AppException {
  // One answer for every reason (blocked either way, the recipient's DM setting, inactive account)
  // so a refusal never reveals which one applied.
  return new AppException(
    HttpStatus.FORBIDDEN,
    ErrorCode.CANNOT_MESSAGE,
    'You cannot message this person',
  );
}

function encodeCursor(lastMessageAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: lastMessageAt.toISOString(), id })).toString('base64url');
}

function decodeCursor(cursor: string): { t: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      t?: unknown;
      id?: unknown;
    };
    const t = typeof parsed.t === 'string' ? new Date(parsed.t) : null;
    if (!t || Number.isNaN(t.getTime()) || typeof parsed.id !== 'string')
      throw new Error('bad cursor');
    if (!/^[0-9a-f-]{36}$/i.test(parsed.id)) throw new Error('bad cursor');
    return { t, id: parsed.id };
  } catch {
    throw new AppException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, 'Invalid cursor');
  }
}

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hub: RealtimeHub,
    private readonly push: PushService,
  ) {}

  /** May `sender` start or continue a conversation with `recipient` right now? */
  private async canMessage(db: Tx, sender: string, recipient: string): Promise<boolean> {
    const target = await db.user.findUnique({
      where: { id: recipient },
      select: { status: true, settings: { select: { dmPolicy: true } } },
    });
    if (!target || target.status !== 'ACTIVE') return false;
    if (await isBlockedEitherWay(db, sender, recipient)) return false;
    const policy = target.settings?.dmPolicy ?? 'FRIENDS';
    if (policy === 'EVERYONE') return true;
    if (policy === 'NOBODY') return false;
    return areFriends(db, sender, recipient);
  }

  /** Loads a conversation the caller belongs to, or 404 (also when blocked either way). */
  private async requireConversation(db: Tx, me: string, conversationId: string) {
    const conversation = await db.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation || (conversation.userLowId !== me && conversation.userHighId !== me)) {
      throw conversationNotFound();
    }
    const otherId =
      conversation.userLowId === me ? conversation.userHighId : conversation.userLowId;
    if (await isBlockedEitherWay(db, me, otherId)) throw conversationNotFound();
    return { conversation, otherId };
  }

  async openConversation(me: string, targetId: string): Promise<ConversationView> {
    if (me === targetId) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'You cannot message yourself',
      );
    }
    await requireOwnProfile(this.prisma, me);
    await requireVisibleUser(this.prisma, me, targetId);
    if (!(await this.canMessage(this.prisma, me, targetId))) throw cannotMessage();

    const { low, high } = orderedPair(me, targetId);
    // createMany + skipDuplicates is INSERT ... ON CONFLICT DO NOTHING, so simultaneous opens from
    // both sides cannot race into a unique violation (upsert with an empty update can).
    await this.prisma.conversation.createMany({
      data: [{ userLowId: low, userHighId: high }],
      skipDuplicates: true,
    });
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { userLowId_userHighId: { userLowId: low, userHighId: high } },
    });
    await this.prisma.conversationMember.createMany({
      data: [
        { conversationId: conversation.id, userId: low },
        { conversationId: conversation.id, userId: high },
      ],
      skipDuplicates: true,
    });
    return this.viewFor(me, conversation.id);
  }

  private async viewFor(me: string, conversationId: string): Promise<ConversationView> {
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: {
        userLow: { include: { profile: true } },
        userHigh: { include: { profile: true } },
        members: { where: { userId: me } },
        messages: { orderBy: { id: 'desc' }, take: 1 },
      },
    });
    const other = conversation.userLowId === me ? conversation.userHigh : conversation.userLow;
    if (!other.profile) throw conversationNotFound();
    const member = conversation.members[0];
    const unreadCount = await this.prisma.message.count({
      where: {
        conversationId,
        senderId: { not: me },
        ...(member?.lastReadMessageId ? { id: { gt: member.lastReadMessageId } } : {}),
      },
    });
    const last = conversation.messages[0];
    return {
      id: conversation.id,
      user: toCard(other.profile, 'NONE'),
      lastMessage: last ? toMessageView(last) : null,
      unreadCount,
      muted: member?.muted ?? false,
    };
  }

  async listConversations(me: string, limit: number, cursor?: string): Promise<ConversationPage> {
    const after = cursor ? decodeCursor(cursor) : null;
    const rows = await this.prisma.conversation.findMany({
      where: {
        lastMessageAt: { not: null },
        OR: [{ userLowId: me }, { userHighId: me }],
        ...(after
          ? {
              AND: [
                {
                  OR: [
                    { lastMessageAt: { lt: after.t } },
                    { lastMessageAt: after.t, id: { lt: after.id } },
                  ],
                },
              ],
            }
          : {}),
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        lastMessageAt: true,
        userLowId: true,
        userHighId: true,
        userLow: { select: { status: true } },
        userHigh: { select: { status: true } },
      },
    });
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);

    const otherIds = pageRows.map((r) => (r.userLowId === me ? r.userHighId : r.userLowId));
    const blocks = await this.prisma.blockedUser.findMany({
      where: {
        OR: [
          { blockerId: me, blockedId: { in: otherIds } },
          { blockedId: me, blockerId: { in: otherIds } },
        ],
      },
      select: { blockerId: true, blockedId: true },
    });
    const blockedIds = new Set(blocks.map((b) => (b.blockerId === me ? b.blockedId : b.blockerId)));

    const items: ConversationView[] = [];
    for (const row of pageRows) {
      const otherId = row.userLowId === me ? row.userHighId : row.userLowId;
      const otherStatus = row.userLowId === me ? row.userHigh.status : row.userLow.status;
      if (blockedIds.has(otherId) || otherStatus !== 'ACTIVE') continue;
      items.push(await this.viewFor(me, row.id));
    }
    const lastRow = pageRows[pageRows.length - 1];
    return {
      items,
      nextCursor:
        hasMore && lastRow?.lastMessageAt ? encodeCursor(lastRow.lastMessageAt, lastRow.id) : null,
    };
  }

  async sendMessage(
    me: string,
    conversationId: string,
    input: { body: string; clientMessageId: string },
    now: Date = new Date(),
  ): Promise<{ message: MessageView; created: boolean }> {
    const { otherId } = await this.requireConversation(this.prisma, me, conversationId);

    const existing = await this.prisma.message.findUnique({
      where: {
        conversationId_senderId_clientMessageId: {
          conversationId,
          senderId: me,
          clientMessageId: input.clientMessageId,
        },
      },
    });
    if (existing) return { message: toMessageView(existing), created: false };

    if (!(await this.canMessage(this.prisma, me, otherId))) throw cannotMessage();

    if (containsBlockedTerm(input.body)) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.CONTENT_NOT_ALLOWED,
        'Your message contains words that are not allowed',
      );
    }

    const recent = await this.prisma.message.count({
      where: {
        senderId: me,
        createdAt: { gte: new Date(now.getTime() - MESSAGE_BURST_WINDOW_SECONDS * 1000) },
      },
    });
    if (recent >= MESSAGE_BURST_LIMIT) {
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorCode.RATE_LIMITED,
        'You are sending messages too quickly',
        { retryAfterSeconds: MESSAGE_BURST_WINDOW_SECONDS },
      );
    }

    let message: Message;
    try {
      message = await this.prisma.$transaction(async (tx) => {
        const created = await tx.message.create({
          data: {
            conversationId,
            senderId: me,
            body: input.body,
            clientMessageId: input.clientMessageId,
          },
        });
        await tx.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: created.createdAt },
        });
        // Your own message counts as read by you.
        await tx.conversationMember.updateMany({
          where: { conversationId, userId: me },
          data: { lastReadMessageId: created.id },
        });
        return created;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // A concurrent retry of the same clientMessageId won the insert; return its message.
      const winner = await this.prisma.message.findUniqueOrThrow({
        where: {
          conversationId_senderId_clientMessageId: {
            conversationId,
            senderId: me,
            clientMessageId: input.clientMessageId,
          },
        },
      });
      return { message: toMessageView(winner), created: false };
    }

    const view = toMessageView(message);
    const event = { type: 'message.new', conversationId, message: view } as const;
    this.hub.publishToUser(otherId, event);
    this.hub.publishToUser(me, event); // the sender's other devices
    await this.pushNewMessage(me, otherId, conversationId);
    return { message: view, created: true };
  }

  /**
   * Push only when the recipient is not already connected (they got it live) and has not muted the
   * conversation. The text never goes in the notification: lock screens are not private.
   */
  private async pushNewMessage(
    senderId: string,
    recipientId: string,
    conversationId: string,
  ): Promise<void> {
    if (this.hub.isOnline(recipientId)) return;
    const [member, sender] = await Promise.all([
      this.prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId, userId: recipientId } },
        select: { muted: true },
      }),
      this.prisma.userProfile.findUnique({
        where: { userId: senderId },
        select: { username: true },
      }),
    ]);
    if (member?.muted || !sender) return;
    this.push.notify(recipientId, {
      title: sender.username,
      body: 'Sent you a message',
      data: { type: 'MESSAGE', conversationId },
    });
  }

  async getMessages(
    me: string,
    conversationId: string,
    limit: number,
    before?: string,
  ): Promise<Page<MessageView>> {
    await this.requireConversation(this.prisma, me, conversationId);
    const rows = await this.prisma.message.findMany({
      where: { conversationId, ...(before ? { id: { lt: before } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(toMessageView);
    return { items, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null };
  }

  async markRead(me: string, conversationId: string, messageId?: string): Promise<void> {
    const { otherId } = await this.requireConversation(this.prisma, me, conversationId);
    let target: string | undefined = messageId;
    if (target) {
      const message = await this.prisma.message.findFirst({
        where: { id: target, conversationId },
        select: { id: true },
      });
      if (!message) {
        throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Message not found');
      }
    } else {
      const latest = await this.prisma.message.findFirst({
        where: { conversationId },
        orderBy: { id: 'desc' },
        select: { id: true },
      });
      target = latest?.id;
    }
    if (!target) return; // nothing to read yet

    // Monotonic: the read position only moves forward, so a stale or replayed request cannot
    // mark newer messages unread.
    const moved = await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId: me,
        OR: [{ lastReadMessageId: null }, { lastReadMessageId: { lt: target } }],
      },
      data: { lastReadMessageId: target },
    });
    if (moved.count > 0) {
      this.hub.publishToUser(otherId, {
        type: 'message.read',
        conversationId,
        userId: me,
        lastReadMessageId: target,
      });
    }
  }

  async setMuted(me: string, conversationId: string, muted: boolean): Promise<{ muted: boolean }> {
    await this.requireConversation(this.prisma, me, conversationId);
    await this.prisma.conversationMember.updateMany({
      where: { conversationId, userId: me },
      data: { muted },
    });
    return { muted };
  }
}
