import { scrubEvent } from '@gameverse/shared-types';
import * as Sentry from '@sentry/node';

export interface ErrorContext {
  requestId?: string | undefined;
  route?: string | undefined;
  userId?: string | undefined;
}

/** Where unexpected server errors go. The default does nothing; Sentry is opt-in by config. */
export abstract class ErrorReporter {
  abstract capture(error: unknown, context: ErrorContext): void;
  /** Waits for queued events to be sent; called on shutdown. */
  flush(): Promise<void> {
    return Promise.resolve();
  }
}

export class NoopErrorReporter extends ErrorReporter {
  override capture(): void {
    // Reporting is not configured.
  }
}

export interface SentryOptions {
  dsn: string;
  environment: string;
  release?: string | undefined;
  /** Tests inject a transport so nothing touches the network. */
  transport?: Sentry.NodeOptions['transport'];
}

export class SentryErrorReporter extends ErrorReporter {
  constructor(options: SentryOptions) {
    super();
    Sentry.init({
      dsn: options.dsn,
      environment: options.environment,
      ...(options.release ? { release: options.release } : {}),
      ...(options.transport ? { transport: options.transport } : {}),
      tracesSampleRate: 0,
      includeLocalVariables: false,
      beforeSend: (event) => scrubEvent(event),
    });
  }

  override capture(error: unknown, context: ErrorContext): void {
    Sentry.withScope((scope) => {
      if (context.requestId) scope.setTag('request_id', context.requestId);
      if (context.route) scope.setTag('route', context.route);
      if (context.userId) scope.setUser({ id: context.userId });
      Sentry.captureException(error);
    });
  }

  override async flush(): Promise<void> {
    await Sentry.close(2000);
  }
}
