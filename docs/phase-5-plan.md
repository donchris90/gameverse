# Phase 5 plan: MVP hardening and gate

Owner approved Phase 5 on 2026-10-18. Goal: every item of the MVP gate (`docs/product-spec.md` section 8) is verified or explicitly listed as unverified/blocked. Many gate items need devices, keys or accounts that only the owner has; those stay "unverified" and get a runbook, never a claim.

| Slice | What                                                                                                                                | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 5A    | Route audit (auth and rate-limit on every route, enforced by a test), dependency audit, mobile retry on 503                          | done: `route-audit.e2e-spec.ts` (exact public allowlist, admin RolesGuard, 401 for anonymous and garbage tokens on every guarded route; mutation-checked), `dependency-audit.md`, mobile 503 retry (`retry.ts`, unit-tested; device-unverified). Throttler classes are not asserted per route: the global default throttler is covered by 5B rate-limit tests. |
| 5B    | Security test suite: cross-user access sweep, invalid/expired tokens, WS access, bans on sockets, rate limits, server-authority      |        |
| 5C    | Sentry (API and mobile), optional by config, with data scrubbing                                                                     |        |
| 5D    | Migrations on an empty database, backup/restore rehearsal (script + recorded result)                                                 |        |
| 5E    | WebSocket load test with the single-instance ceiling measured locally                                                                |        |
| 5F    | Maestro flows (auth, friends, a full match, voice join/leave) written for Android and iOS; cannot be run here                         |        |
| 5G    | EAS build profiles, store-compliance notes, privacy/terms drafts updated, soft-launch checklist                                      |        |
| 5H    | MVP gate table (item by item: verified / unverified / blocked, with evidence), checkpoint report                                     |        |
