import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { PresenceEntry } from '@gameverse/shared-types';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeHub } from './realtime.hub.js';

/**
 * Online status, privacy-aware. "Online" means "has at least one authenticated socket". Friends are
 * told about changes over their own sockets; everyone else can only ask (and only gets an answer
 * when the owner's setting allows it).
 */
@Injectable()
export class PresenceService implements OnModuleDestroy {
  private readonly pendingOffline = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly hub: RealtimeHub,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.hub.onPresenceChange((userId, online) => this.handleChange(userId, online));
  }

  onModuleDestroy(): void {
    for (const timer of this.pendingOffline.values()) clearTimeout(timer);
    this.pendingOffline.clear();
  }

  private handleChange(userId: string, online: boolean): void {
    const pending = this.pendingOffline.get(userId);
    if (online) {
      if (pending) {
        // Reconnected inside the grace period (flaky network, app resumed): nothing changed.
        clearTimeout(pending);
        this.pendingOffline.delete(userId);
        return;
      }
      void this.broadcast(userId, true);
      return;
    }
    if (pending) clearTimeout(pending);
    // Delay the "went offline" news so brief disconnects do not flap for friends.
    const timer = setTimeout(() => {
      this.pendingOffline.delete(userId);
      if (!this.hub.isOnline(userId)) void this.broadcast(userId, false);
    }, this.config.PRESENCE_OFFLINE_GRACE_MS);
    timer.unref();
    this.pendingOffline.set(userId, timer);
  }

  private async broadcast(userId: string, online: boolean): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { status: true, settings: { select: { onlineStatusVisibility: true } } },
      });
      if (!user || user.status !== 'ACTIVE') return;
      if ((user.settings?.onlineStatusVisibility ?? 'FRIENDS') === 'NOBODY') return;
      const friendships = await this.prisma.friendship.findMany({
        where: { OR: [{ userLowId: userId }, { userHighId: userId }] },
        select: { userLowId: true, userHighId: true },
      });
      for (const f of friendships) {
        const friendId = f.userLowId === userId ? f.userHighId : f.userLowId;
        if (this.hub.isOnline(friendId)) {
          this.hub.publishToUser(friendId, { type: 'presence.update', userId, online });
        }
      }
    } catch {
      // presence is best effort
    }
  }

  /**
   * Answers "is this person online?" for up to 100 users. Anything the viewer may not know - hidden
   * by the owner, blocked either way, inactive, or not a real user - comes back as null, so the
   * answers cannot be used to tell those cases apart.
   */
  async query(viewerId: string, userIds: readonly string[]): Promise<PresenceEntry[]> {
    const ids = [...new Set(userIds)];
    const others = ids.filter((id) => id !== viewerId);

    const [users, blocks, friendships] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: others }, status: 'ACTIVE' },
        select: { id: true, settings: { select: { onlineStatusVisibility: true } } },
      }),
      this.prisma.blockedUser.findMany({
        where: {
          OR: [
            { blockerId: viewerId, blockedId: { in: others } },
            { blockedId: viewerId, blockerId: { in: others } },
          ],
        },
        select: { blockerId: true, blockedId: true },
      }),
      this.prisma.friendship.findMany({
        where: {
          OR: [
            { userLowId: viewerId, userHighId: { in: others } },
            { userHighId: viewerId, userLowId: { in: others } },
          ],
        },
        select: { userLowId: true, userHighId: true },
      }),
    ]);
    const visibility = new Map(
      users.map((u) => [u.id, u.settings?.onlineStatusVisibility ?? 'FRIENDS']),
    );
    const blocked = new Set(
      blocks.map((b) => (b.blockerId === viewerId ? b.blockedId : b.blockerId)),
    );
    const friends = new Set(
      friendships.map((f) => (f.userLowId === viewerId ? f.userHighId : f.userLowId)),
    );

    return ids.map((id): PresenceEntry => {
      if (id === viewerId) return { userId: id, online: this.hub.isOnline(id) };
      const setting = visibility.get(id);
      if (!setting || blocked.has(id) || setting === 'NOBODY') return { userId: id, online: null };
      if (setting === 'FRIENDS' && !friends.has(id)) return { userId: id, online: null };
      return { userId: id, online: this.hub.isOnline(id) };
    });
  }
}
