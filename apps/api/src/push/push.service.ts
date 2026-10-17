import { Injectable, Logger } from '@nestjs/common';
import { MAX_DEVICES_PER_USER } from '@gameverse/shared-types';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushProvider } from './push.provider.js';

export interface PushPayload {
  title: string;
  body: string;
  data: Record<string, string>;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: PushProvider,
  ) {}

  /** Registers (or moves) a device token to this account and keeps at most N devices per user. */
  async registerDevice(userId: string, token: string, platform: 'IOS' | 'ANDROID'): Promise<void> {
    await this.prisma.deviceToken.upsert({
      where: { token },
      // A token that was registered by someone else moves to the current account.
      create: { userId, token, platform },
      update: { userId, platform },
    });
    const devices = await this.prisma.deviceToken.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    const surplus = devices.slice(MAX_DEVICES_PER_USER).map((d) => d.id);
    if (surplus.length > 0)
      await this.prisma.deviceToken.deleteMany({ where: { id: { in: surplus } } });
  }

  async unregisterDevice(userId: string, token: string): Promise<void> {
    await this.prisma.deviceToken.deleteMany({ where: { userId, token } });
  }

  async removeAllDevices(userId: string): Promise<void> {
    await this.prisma.deviceToken.deleteMany({ where: { userId } });
  }

  /**
   * Fire-and-forget: a push failure must never fail the request that triggered it. Callers do not
   * await delivery; tests use `idle()` to wait for it.
   */
  notify(userId: string, payload: PushPayload): void {
    const work = this.deliver(userId, payload).catch((error: unknown) => {
      this.logger.warn(
        `Push delivery failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    });
    this.inflight.add(work);
    void work.finally(() => this.inflight.delete(work));
  }

  async idle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.all(this.inflight);
  }

  private async deliver(userId: string, payload: PushPayload): Promise<void> {
    const devices = await this.prisma.deviceToken.findMany({
      where: { userId },
      select: { token: true },
    });
    if (devices.length === 0) return;
    const outcomes = await this.provider.send(devices.map((d) => ({ to: d.token, ...payload })));
    const dead = devices
      .filter((_, index) => outcomes[index] === 'invalid-token')
      .map((d) => d.token);
    // The push service says these devices are gone (app uninstalled): stop sending to them.
    if (dead.length > 0)
      await this.prisma.deviceToken.deleteMany({ where: { token: { in: dead } } });
  }
}
