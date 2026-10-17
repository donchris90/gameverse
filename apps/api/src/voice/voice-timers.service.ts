import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { VoiceService } from './voice.service.js';

const VOICE_SWEEP_INTERVAL_MS = 10_000;

/** Closes voice sessions of finished matches. Off under NODE_ENV=test (tests call closeStale). */
@Injectable()
export class VoiceTimersService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(VoiceTimersService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly voice: VoiceService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.voice
        .closeStale()
        .catch((error: unknown) => {
          this.logger.warn(`voice sweep failed: ${String(error)}`);
        })
        .finally(() => {
          this.running = false;
        });
    }, VOICE_SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
