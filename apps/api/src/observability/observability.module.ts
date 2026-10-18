import { Global, Module, type OnApplicationShutdown, Inject } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { ErrorReporter, NoopErrorReporter, SentryErrorReporter } from './error-reporter.js';

@Global()
@Module({
  providers: [
    {
      provide: ErrorReporter,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): ErrorReporter =>
        config.SENTRY_DSN
          ? new SentryErrorReporter({
              dsn: config.SENTRY_DSN,
              environment: config.SENTRY_ENVIRONMENT ?? config.NODE_ENV,
              release: config.SENTRY_RELEASE,
            })
          : new NoopErrorReporter(),
    },
  ],
  exports: [ErrorReporter],
})
export class ObservabilityModule implements OnApplicationShutdown {
  constructor(@Inject(ErrorReporter) private readonly reporter: ErrorReporter) {}

  async onApplicationShutdown(): Promise<void> {
    await this.reporter.flush();
  }
}
