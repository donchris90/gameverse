import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { MatchmakingService } from './matchmaking.service.js';
import { RoomsService } from './rooms.service.js';

const LOBBY_SWEEP_INTERVAL_MS = 2_000;

/** Pairs players whose band widened, ends stale searches, expires rooms. Off under NODE_ENV=test. */
@Injectable()
export class LobbyTimersService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(LobbyTimersService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly matchmaking: MatchmakingService,
    private readonly rooms: RoomsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      Promise.all([this.matchmaking.runMatchmaking(), this.rooms.expireRooms()])
        .catch((error: unknown) => {
          this.logger.warn(`lobby sweep failed: ${String(error)}`);
        })
        .finally(() => {
          this.running = false;
        });
    }, LOBBY_SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
