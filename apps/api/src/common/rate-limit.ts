import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerOptions } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { AppConfig } from '../config/config.js';

const ONE_MINUTE_MS = 60_000;

/** Credential-style endpoints: the API's auth routes and the public account-deletion web forms. */
const AUTH_PATHS = ['/v1/auth', '/account-deletion', '/delete-account'];
const isAuthPath = (path: string): boolean => AUTH_PATHS.some((prefix) => path.startsWith(prefix));

function requestOf(context: ExecutionContext): Request {
  return context.switchToHttp().getRequest<Request>();
}

/**
 * Four limiters, all in-memory (single-instance launch architecture; see docs/architecture.md for
 * the shared-store change needed before running more than one API instance):
 *  - default: every route, per client IP
 *  - auth:    /v1/auth/* and the account-deletion web forms only, per client IP, much stricter
 *  - friend-requests: POST /v1/friends/requests only, per session, 30 per hour by default
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
      skipIf: (context) => !isAuthPath(requestOf(context).path),
    },
    {
      // Sending friend requests: per signed-in session. The tracker is a hash of the bearer token,
      // never a claim read from it, so nobody can spend another account's allowance by forging one.
      name: 'friend-requests',
      ttl: 60 * ONE_MINUTE_MS,
      limit: config.RATE_LIMIT_FRIEND_REQUESTS_PER_HOUR,
      skipIf: (context) => {
        const request = requestOf(context);
        return request.method !== 'POST' || request.path !== '/v1/friends/requests';
      },
      getTracker: (request) => {
        const header = (request as { headers?: Record<string, unknown> }).headers?.[
          'authorization'
        ];
        return typeof header === 'string' && header.length > 0
          ? `friend-requests:${createHash('sha256').update(header).digest('hex')}`
          : `friend-requests-ip:${String(request['ip'])}`;
      },
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
