import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerOptions } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AppConfig } from '../config/config.js';

const ONE_MINUTE_MS = 60_000;

function requestOf(context: ExecutionContext): Request {
  return context.switchToHttp().getRequest<Request>();
}

/**
 * Three limiters, all in-memory (single-instance launch architecture; see docs/architecture.md for
 * the shared-store change needed before running more than one API instance):
 *  - default: every route, per client IP
 *  - auth:    /v1/auth/* only, per client IP, much stricter
 *  - login:   POST /v1/auth/login only, per target email (stops distributed credential stuffing
 *             against one account; the trade-off is a brief lockout window for that email)
 */
export function buildThrottlers(config: AppConfig): ThrottlerOptions[] {
  return [
    {
      name: 'default',
      ttl: ONE_MINUTE_MS,
      limit: config.RATE_LIMIT_DEFAULT_PER_MIN,
    },
    {
      name: 'auth',
      ttl: ONE_MINUTE_MS,
      limit: config.RATE_LIMIT_AUTH_PER_MIN,
      skipIf: (context) => !requestOf(context).path.startsWith('/v1/auth'),
    },
    {
      name: 'login',
      ttl: ONE_MINUTE_MS,
      limit: config.RATE_LIMIT_AUTH_PER_MIN,
      skipIf: (context) => requestOf(context).path !== '/v1/auth/login',
      getTracker: (request) => {
        const email = (request as { body?: { email?: unknown } }).body?.email;
        return typeof email === 'string' && email.length > 0
          ? `login-email:${email.trim().toLowerCase().slice(0, 254)}`
          : `login-ip:${String(request['ip'])}`;
      },
    },
  ];
}
