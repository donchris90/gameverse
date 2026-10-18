# Rate-limit audit

Audited 2026-10-18 (Phase 5A/5B). Every limiter is **in memory in one API process**; with more than one instance each would count separately (a known single-instance limit, see `architecture.md`). Numbers are the shipping defaults; the first three are environment variables.

| Where                                                                                        | Limit                                                  | Keyed by                 | Tested in                                                                                 |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------ | ----------------------------------------------------------------------------------------- |
| Every HTTP route (not `/health/*`)                                                           | 120 per minute (`RATE_LIMIT_DEFAULT_PER_MIN`)          | client IP                | `platform.e2e-spec.ts` (429 in the standard envelope, `Retry-After`)                      |
| `/v1/auth/*` and the two account-deletion web forms (`/account-deletion`, `/delete-account`) | 10 per minute (`RATE_LIMIT_AUTH_PER_MIN`)              | client IP                | `platform.e2e-spec.ts`, `auth-email-password.e2e-spec.ts`                                 |
| `POST /v1/auth/login`                                                                        | 10 per minute (`RATE_LIMIT_AUTH_PER_MIN`)              | target email             | `platform.e2e-spec.ts` (guesses against one account from many IPs; others not locked out) |
| `POST /v1/friends/requests`                                                                  | 30 per hour (`RATE_LIMIT_FRIEND_REQUESTS_PER_HOUR`)    | hash of the bearer token | `rate-limits.e2e-spec.ts` (new in 5A)                                                     |
| Friend requests, pending at once                                                             | 100 outgoing; 30-day silent cooldown after a rejection | account                  | `friends.e2e-spec.ts`                                                                     |
| Chat messages                                                                                | 20 per 10 s                                            | account                  | `chat.e2e-spec.ts`                                                                        |
| Reports                                                                                      | 20 per day                                             | account                  | `moderation.e2e-spec.ts`                                                                  |
| Match actions (ready, move, roll, token move, leave, rematch)                                | 30 per 10 s                                            | account                  | `matches-realtime.e2e-spec.ts`, `ludo.e2e-spec.ts`, `matches-bot.e2e-spec.ts`             |
| Voice token                                                                                  | 10 per minute                                          | account                  | `voice.e2e-spec.ts`                                                                       |
| Wrong room codes                                                                             | 10 per 5 minutes                                       | account                  | `lobby.e2e-spec.ts`                                                                       |
| Verification email / account-deletion email                                                  | 1 per minute                                           | account                  | `auth-email-password.e2e-spec.ts`, `account-deletion.e2e-spec.ts`                         |
| WebSocket frames                                                                             | 30 per 10 s per socket, 4429 close                     | socket                   | `realtime.e2e-spec.ts`                                                                    |
| WebSocket auth                                                                               | 4408 close after the auth timeout                      | socket                   | `realtime.e2e-spec.ts`                                                                    |

## Gaps found and what was done

- **Friend requests had no rate limit** (spec §6 asks for one; only the per-IP default and the 100 pending cap applied). Added the `friend-requests` limiter above. Keyed by a hash of the bearer token rather than a claim read from it, so a forged token cannot spend someone else's allowance (tested).
- **Registration** is covered by the per-IP auth limiter only (10 per minute per IP). Several accounts can still be created from one IP slowly, and carrier-grade NAT in some markets puts many users behind one IP: watch for false positives during the soft launch (see decisions #94 and #100).
- **Behind a proxy**, per-IP limits only work if `TRUST_PROXY=true` is set on the host (Render); otherwise every user shares the proxy's address. This is unverified on the real host.
- Admin routes use the default per-IP limit only.
- No limit on `GET` fan-out beyond the default (120 per minute per IP).
- The route audit test (`route-audit.e2e-spec.ts`) asserts authentication on every route, not the limiter class of each route; the table above is the manual audit.
