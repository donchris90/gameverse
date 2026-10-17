import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { BOT_SWEEP_INTERVAL_MS, SWEEP_INTERVAL_MS } from './matches.constants.js';
import { MatchesService } from './matches.service.js';

/**
 * Periodically resolves overdue match deadlines. The deadline itself lives in the database, so
 * after a restart the first sweep picks up everything that came due while the server was down.
 * Not started under NODE_ENV=test: tests call `MatchesService.runDueTimers` explicitly so they
 * stay deterministic.
 */
@Injectable()
export class MatchTimersService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MatchTimersService.name);
  private timer: NodeJS.Timeout | null = null;
  private botTimer: NodeJS.Timeout | null = null;
  private running = false;
  private botsRunning = false;

  constructor(
    private readonly matches: MatchesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      Promise.all([this.matches.runDueTimers(), this.matches.runConnectionChecks()])
        .catch((error: unknown) => {
          this.logger.warn(`match sweep failed: ${String(error)}`);
        })
        .finally(() => {
          this.running = false;
        });
    }, SWEEP_INTERVAL_MS);
    this.timer.unref();

    // Bots get their own, faster loop so an answer arrives about when it should.
    this.botTimer = setInterval(() => {
      if (this.botsRunning) return;
      this.botsRunning = true;
      this.matches
        .runBotMoves()
        .catch((error: unknown) => {
          this.logger.warn(`bot sweep failed: ${String(error)}`);
        })
        .finally(() => {
          this.botsRunning = false;
        });
    }, BOT_SWEEP_INTERVAL_MS);
    this.botTimer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.botTimer) clearInterval(this.botTimer);
    this.timer = null;
    this.botTimer = null;
  }
}
