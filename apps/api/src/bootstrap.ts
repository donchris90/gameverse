import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import type { AppConfig } from './config/config.js';

/** Applies HTTP-level configuration. Shared by main.ts and the integration tests. */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.useLogger(app.get(Logger));

  // Versioned API; probes stay at /health/*.
  app.setGlobalPrefix('v1', { exclude: ['health/live', 'health/ready'] });

  // Only trust X-Forwarded-* when explicitly running behind a known proxy; otherwise clients could
  // spoof their IP and defeat per-IP rate limits.
  app.set('trust proxy', config.TRUST_PROXY ? 1 : false);

  app.use(helmet());
  app.enableCors({ origin: config.CORS_ORIGINS.length > 0 ? config.CORS_ORIGINS : false });
  app.useBodyParser('json', { limit: '100kb' });
  app.enableShutdownHooks();
}
