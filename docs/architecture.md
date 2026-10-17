# Architecture (Phase 0)

## Monorepo

```
apps/api            NestJS REST API (ESM, Express 5), Prisma 7, PostgreSQL 16
apps/mobile         Expo SDK 58 dev build + Expo Router (scaffold)
apps/admin          Vite + Refine admin (static shell until Phase 1)
packages/shared-types   zod schemas + error codes shared by API and clients
packages/design-system  dark-first design tokens + WCAG contrast helpers
packages/game-rules     pure game logic (created in Phase 2)
```

## API layout (`apps/api/src`)

- `config/` validates environment with zod at boot and refuses unsafe production settings.
- `auth/` password hashing, access/refresh tokens, social ID-token verification, `JwtAuthGuard`, `AuthService`, controller.
- `users/` `GET /v1/me`. `health/` `/health/live`, `/health/ready` (outside the `/v1` prefix, 2 s DB timeout, fails closed with 503).
- `common/` exception filter, zod validation pipe, rate-limit config, DB error mapping.
- `mail/` provider abstraction. `prisma/` service and module.

## Request pipeline

helmet, 100 kb body limit, CORS off by default, `TRUST_PROXY` flag, pino logging with redaction, throttler (default per IP; `/v1/auth/*` per IP; login per email), zod validation, `JwtAuthGuard` (DB lookup every request), handler, uniform error envelope with request id.

## Auth flows

- Register: age check (16+), terms version recorded, email verification token (24 h, single use).
- Login: argon2id verify with timing equalisation; returns access token (15 min) and refresh token.
- Refresh: rotate within a family; replay after the 10 s leeway revokes the family.
- Password reset: single-use 1 h token; revokes all refresh tokens on success.
- Google/Apple: ID token verified against provider JWKS (issuer, audience, expiry, nonce where supplied).

## Scaling limits

Rate limiting is in-memory and per process. Before a second API instance, move the throttler storage to a shared store (Redis) and revisit WebSocket fan-out. Recorded as decision 9.
