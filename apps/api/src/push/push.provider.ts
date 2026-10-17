import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

export interface PushMessage {
  /** Expo push token of one device. */
  to: string;
  title: string;
  body: string;
  /** Small routing payload for the app (ids only; never message text or personal data). */
  data: Record<string, string>;
}

export type PushOutcome = 'sent' | 'invalid-token' | 'failed';

export abstract class PushProvider {
  /** Returns one outcome per message, in order. Never throws: delivery is best effort. */
  abstract send(messages: PushMessage[]): Promise<PushOutcome[]>;
}

/** PUSH_PROVIDER=none: push is switched off, nothing leaves the server. */
@Injectable()
export class DisabledPushProvider extends PushProvider {
  override async send(messages: PushMessage[]): Promise<PushOutcome[]> {
    return messages.map(() => 'failed' as const);
  }
}

/** TEST ONLY. Records messages; tests can mark tokens as no longer valid. */
export class MemoryPushProvider extends PushProvider {
  readonly sent: PushMessage[] = [];
  readonly invalidTokens = new Set<string>();

  override async send(messages: PushMessage[]): Promise<PushOutcome[]> {
    return messages.map((message) => {
      if (this.invalidTokens.has(message.to)) return 'invalid-token';
      this.sent.push(message);
      return 'sent';
    });
  }

  to(token: string): PushMessage[] {
    return this.sent.filter((m) => m.to === token);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

const EXPO_BATCH_SIZE = 100;
const EXPO_TIMEOUT_MS = 10_000;

interface ExpoTicket {
  status?: string;
  details?: { error?: string };
}

/**
 * Sends through the Expo push service (https://docs.expo.dev/push-notifications/sending-notifications/).
 * UNVERIFIED against the live service: it has only been exercised against a local stand-in that
 * follows the documented request/response shapes. Needs a real device token to verify.
 */
@Injectable()
export class ExpoPushProvider extends PushProvider {
  private readonly logger = new Logger(ExpoPushProvider.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
  }

  override async send(messages: PushMessage[]): Promise<PushOutcome[]> {
    const outcomes: PushOutcome[] = [];
    for (let start = 0; start < messages.length; start += EXPO_BATCH_SIZE) {
      outcomes.push(...(await this.sendBatch(messages.slice(start, start + EXPO_BATCH_SIZE))));
    }
    return outcomes;
  }

  private async sendBatch(batch: PushMessage[]): Promise<PushOutcome[]> {
    const failed = batch.map(() => 'failed' as const);
    try {
      const response = await fetch(this.config.EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(this.config.EXPO_ACCESS_TOKEN
            ? { Authorization: `Bearer ${this.config.EXPO_ACCESS_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(
          batch.map((m) => ({
            to: m.to,
            title: m.title,
            body: m.body,
            data: m.data,
            sound: 'default',
            priority: 'high',
          })),
        ),
        signal: AbortSignal.timeout(EXPO_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`Expo push request failed with HTTP ${String(response.status)}`);
        return failed;
      }
      const json = (await response.json()) as { data?: ExpoTicket[] };
      const tickets = json.data;
      if (!Array.isArray(tickets) || tickets.length !== batch.length) {
        this.logger.warn('Expo push response had an unexpected shape');
        return failed;
      }
      return tickets.map((ticket): PushOutcome => {
        if (ticket.status === 'ok') return 'sent';
        return ticket.details?.error === 'DeviceNotRegistered' ? 'invalid-token' : 'failed';
      });
    } catch (error) {
      this.logger.warn(
        `Expo push request error: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return failed;
    }
  }
}
