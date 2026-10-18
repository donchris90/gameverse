# Phase 5 checkpoint: MVP hardening and gate (2026-10-18)

Nothing here is deployed. Phase 5 produced tests, scripts, docs and a few fixes. The MVP gate (`docs/product-spec.md` section 8) is **not fully green**: the items that need a phone, a store account or a provider key are listed as unverified or blocked, never as passed.

## Final test run

| Command                                                                                                | Result                                                                         |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `npx prettier --check .`                                                                               | clean                                                                          |
| `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true pnpm exec turbo run lint typecheck build test --env-mode=loose` | 22/22 tasks. Unit: shared-types 146, design-system 28, api 140, game-rules 130 |
| `pnpm --filter @gameverse/api test:integration` (real Postgres, real HTTP app)                         | 27 files, **558/558**                                                          |
| `apps/api/scripts/smoke-dist.sh`                                                                       | compiled API up and ready                                                      |
| Mobile `tsc`, oxlint                                                                                   | clean (run as part of turbo)                                                   |

One earlier full run had 1 failure in `concurrency-matches` ("12 ranked matches played and finished in parallel"); the error text was not captured. It then passed 6 + 8 isolated runs (the 8 with two CPU-burning processes alongside) and the next two full runs. **The cause is unknown.** Treat the test as possibly flaky; if it recurs, capture the assertion text first.

## MVP gate

| #   | Gate item                                                                       | Status                                          | Evidence / what is missing                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Register, verify, sign in (email, Apple, Google), profile, delete account       | **Partly verified**                             | Email register/verify/login/refresh, profile and deletion are covered by API tests, including deletion without the app (`/account-deletion`). Apple and Google sign-in: only against locally generated keys, **unverified with real provider tokens**. No mobile screen has run on a device. Apple token revocation on deletion is **not implemented**. |
| 2   | Two users befriend, chat, block, report                                         | **API verified, device unverified**             | Friends, chat, block, report API tests and the concurrency suite. Maestro `03-friends-chat.yaml` is written but **never run**.                                                                                                                                                                                                                          |
| 3   | Tic-tac-toe and Ludo end to end incl. reconnect, timeout, abandon, rematch, bot | **API and sockets verified; mobile unverified** | Match, Ludo, timer, reconnect, rematch and bot integration tests. Ludo UI never run on a device and **Ludo ships disabled** until the owner's device checklist.                                                                                                                                                                                         |
| 4   | Server authority proven by tests                                                | **Verified**                                    | Client-supplied score/dice/winner are ignored or rejected (security and match suites; mass-assignment test).                                                                                                                                                                                                                                            |
| 5   | Voice on two real devices with real Agora credentials                           | **Blocked**                                     | Needs Agora keys and two phones. Token endpoint, fake provider and consent logic are tested. Nothing about real audio is claimed.                                                                                                                                                                                                                       |
| 6   | Admin roles; bans on API and sockets                                            | **Verified**                                    | Moderation, security (every admin route vs a player, moderator vs admin-only, forged ADMIN claim) and realtime tests. Admin UI was opened in a browser only in Phase 1.                                                                                                                                                                                 |
| 7   | Concurrency tests                                                               | **Verified**                                    | Simultaneous friend requests, duplicate moves (same move sent 8 times), duplicate results/XP (12 matches finished in parallel, results recorded once, zero-sum ratings), matchmaking races.                                                                                                                                                             |
| 8   | Security tests                                                                  | **Verified**                                    | `route-audit.e2e-spec.ts` (5), `security.e2e-spec.ts` (15), `rate-limits.e2e-spec.ts` (3), existing token/ban/429 suites. Mutation-checked.                                                                                                                                                                                                             |
| 9   | WS load test with measured ceiling                                              | **Done locally**                                | `docs/load-test.md`: about 60-75 concurrent pairs (120-150 sockets) on a shared 2-vCPU box; 6,000 idle sockets held, 0 failures. Remaining 503s on room create/join not root-caused. Not measured on production hardware.                                                                                                                               |
| 10  | Maestro E2E on Android and iOS                                                  | **Written, never run**                          | `apps/mobile/.maestro/`. YAML was syntax-parsed only; the two helper scripts were verified against a real API. Needs EAS dev builds and devices.                                                                                                                                                                                                        |
| 11  | Migrations clean on empty DB; backup/restore rehearsed                          | **Partly verified**                             | `scripts/db-rehearsal.sh`: 13 migrations applied with psql, dump/restore with matching per-table counts and md5, API boots on the restored DB. `prisma migrate deploy` and a hosted-provider restore are **unverified**.                                                                                                                                |
| 12  | Incomplete/unverified items listed                                              | **Done**                                        | Register below.                                                                                                                                                                                                                                                                                                                                         |

## Register of unverified, blocked and open items

**Blocked on the owner (keys, accounts, devices)**

- Agora App ID/certificate and the two-phone voice test (gate 5); low-end Android included.
- EAS development builds (new native modules: Sentry, Agora), then the Maestro runs on Android and iOS (gate 10).
- Ludo device checklist, then enabling Ludo.
- Apple and Google developer accounts; Apple and Google sign-in with real tokens; confirm the production bundle id (`com.gameverse.app`).
- Render (or other) deploy: run the 13 migrations, set `TRUST_PROXY=true`, build command must include game-rules. First CI run (nothing is pushed).
- Hosted privacy and terms URLs, legal review, support mailbox; set `EXPO_PUBLIC_PRIVACY_URL`, `EXPO_PUBLIC_TERMS_URL`, `EXPO_PUBLIC_SUPPORT_EMAIL` (links stay hidden until set).
- Moderation owner and response target; Play foreground-service video; Sentry DSNs and source-map upload.

**Unverified code paths**

- All mobile code (never run on a device or emulator), including the 503 retry, reconnect jitter, legal links and Sentry-on-device.
- Real email delivery; `prisma migrate deploy` and `migrate diff`; `docker-compose.yml`.
- Remote JWKS fetching for Apple/Google.

**Known gaps (mine to fix if the owner wants)**

- Apple token revocation on account deletion.
- 503s on room create/join under load (cause not found).
- Possible flake in the concurrency-matches test (above).
- 3 transitive dev-toolchain vulnerabilities, accepted (`docs/dependency-audit.md`).

Supporting docs: `load-test.md`, `backup-restore.md`, `rate-limits.md`, `store-compliance.md`, `soft-launch-checklist.md`, `dependency-audit.md`, `legal/*.draft.md`, `decisions.md` rows 93-100.
