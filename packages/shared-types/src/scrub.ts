const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
/** One-time tokens and refresh tokens are 32 random bytes in base64url. */
const LONG_TOKEN = /\b[A-Za-z0-9_-]{40,}\b/g;

export function scrubText(value: string): string {
  return value
    .replace(JWT, '[token]')
    .replace(BEARER, 'Bearer [token]')
    .replace(EMAIL, '[email]')
    .replace(LONG_TOKEN, '[token]');
}

/** The parts of a Sentry event we touch. Structural, so API and mobile SDK types both fit. */
export interface ScrubbableEvent {
  message?: string | undefined;
  server_name?: string | undefined;
  request?: { method?: string | undefined; url?: string | undefined } | undefined;
  user?: { id?: string | number | undefined } | undefined;
  exception?: { values?: { value?: string | undefined }[] | undefined } | undefined;
  breadcrumbs?: { message?: string | undefined; data?: unknown }[] | undefined;
  extra?: Record<string, unknown> | undefined;
}

/**
 * Runs on every event before it leaves the process. The goal is "stack, route, request id and
 * account id only": no headers, cookies, bodies, query strings, IP addresses, emails or tokens.
 */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request) {
    const { method, url } = event.request;
    event.request = {
      ...(method ? { method } : {}),
      ...(url ? { url: scrubText(url.split('?')[0] ?? '') } : {}),
    } as T['request'];
  }
  if (event.user) event.user = (event.user.id ? { id: event.user.id } : {}) as T['user'];
  if (event.message) event.message = scrubText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubText(exception.value);
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = scrubText(crumb.message);
    delete crumb.data;
  }
  if (event.extra) {
    event.extra = Object.fromEntries(
      Object.entries(event.extra).map(([key, value]) => [
        key,
        typeof value === 'string' ? scrubText(value) : '[removed]',
      ]),
    );
  }
  delete event.server_name;
  return event;
}
