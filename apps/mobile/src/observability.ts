import { scrubEvent } from '@gameverse/shared-types';
import * as Sentry from '@sentry/react-native';

const DSN = process.env['EXPO_PUBLIC_SENTRY_DSN'];

/**
 * Crash and error reporting. Off unless EXPO_PUBLIC_SENTRY_DSN is set at build time. Events are
 * scrubbed before they leave the phone: no emails, tokens, request bodies or IP addresses, and
 * only the account id is attached.
 */
export function initObservability(): void {
  if (!DSN || __DEV__) return;
  Sentry.init({
    dsn: DSN,
    environment: process.env['EXPO_PUBLIC_SENTRY_ENVIRONMENT'] ?? 'production',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => {
      const { data: _dropped, ...rest } = crumb;
      return rest;
    },
  });
}

export function setReportedUser(id: string | null): void {
  if (!DSN || __DEV__) return;
  Sentry.setUser(id ? { id } : null);
}
