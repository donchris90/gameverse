import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { SWEEP_INTERVAL_MS } from './matches.constants.js';
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
  private running = false;

  constructor(
    private readonly matches: MatchesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.matches
        .runDueTimers()
        .catch((error: unknown) => {
          this.logger.warn(`match sweep failed: ${String(error)}`);
        })
        .finally(() => {
          this.running = false;
        });
    }, SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
