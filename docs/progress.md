# Progress

**Current status (2026-10-17): Phase 1 code is complete (slices 1A-1F plus closing work) and Phase 0 code is complete. Both are waiting on owner inputs listed under "What cannot be finished without the owner". Phase 2 was approved to start by the owner on 2026-10-17; the plan is in `docs/phase-2-plan.md`.** Details in the Phase 1 section below.

## Last verified checkpoint: Phase 0 — API foundation (2026-10-17)

Phase 0 is **not complete**. The API, shared packages, CI, and mobile/admin scaffolds are in place and verified as far as stated below; the `game-rules` package (deferred to Phase 2, nothing to put in it yet) and the Agora spike are not done.

### Commands run and real results (sandbox, local PostgreSQL 16)

| Command                                                                                     | Result                                                                                               |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npx prettier --check .`                                                                    | All matched files use Prettier code style                                                            |
| `pnpm lint` (oxlint)                                                                        | 0 warnings, 0 errors in all 3 packages                                                               |
| `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true npx turbo run typecheck build test --env-mode=loose` | 10/10 tasks successful. Unit tests: shared-types 23/23, design-system 24/24, api 31/31               |
| `pnpm --filter @gameverse/api test:integration`                                             | 5 files, **90/90 passed** (real Postgres, real HTTP app)                                             |
| `node dist/main.js` smoke test against dev DB                                               | live/ready OK; register OK; under-16 rejected `UNDER_MINIMUM_AGE`; unauthenticated `/v1/me` rejected |
| `pnpm db:seed` (dev) / with `NODE_ENV=production`                                           | seeds 3 local users / refuses to run                                                                 |

Mutation checks: five deliberately introduced bugs were each caught by the suite (5/5), then reverted; the unit and integration suites were re-run green afterwards (rows above).

### Voice spike code (added after the first commits)

Backend `VoiceProvider` + Agora implementation and the spike token endpoint, plus a mobile spike screen. Mutation check: bypassing the `VOICE_SPIKE_ENABLED` gate made the 404 test fail; restored and re-run green. Details and the unverified list are in `docs/voice-spike.md`. **The spike itself has not run.**

### Mobile and admin scaffolds

- `apps/mobile`: Expo SDK 58, Expo Router, `expo-dev-client`, `react-native-agora` 4.6.4 installed (not yet used). One screen that calls the API `/health/ready` and reports the real result. `tsc` and `oxlint` clean; `expo export --platform android` produced a Hermes bundle. **Never run on a device or emulator.**
- `react-native-agora` is not in Expo's SDK 58 version table; 4.6.4 is simply the latest on npm. Compatibility with React Native 0.88 is **unverified** until the spike runs. `expo install` was blocked by the sandbox proxy, so versions were taken from `expo/bundledNativeModules.json`.
- `apps/admin`: Vite + React 19 + Refine installed; a static shell only (no admin features until Phase 1). `tsc`, `oxlint` and `vite build` clean. Not opened in a browser.
- pnpm prints an unmet-peer warning (`react@^19.3.1` found 19.3.0) from the mobile tree because Expo pins React 19.3.0. Left as is.
- Full run after adding them: `npx prettier --check . && npx turbo run lint typecheck build test --env-mode=loose` -> exit 0, 18/18 tasks.

### Caveats about how verification was done

- The sandbox blocks `binaries.prisma.sh`, so the Prisma schema engine cannot download. `prisma generate` was run with `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true` (client generation does not need the engine) and the initial migration SQL was **hand-written and applied with psql**. **Unverified:** that `prisma migrate deploy` accepts it and that `migrate diff` shows no drift. The CI workflow runs both on a real runner; **CI has not yet run** (nothing is pushed).
- Docker is unavailable here, so `docker-compose.yml` is **unverified**; a local Postgres was used instead.
- Turbo strips unlisted env vars; the workaround env var above needs `--env-mode=loose` locally. Not needed on CI where the engine downloads normally.

### Unverified (needs credentials, devices or a real environment)

- Google and Apple sign-in against real provider tokens. Tests use locally generated RSA keys through the injectable key resolver; remote JWKS fetching is untested.
- Email delivery: no real provider exists; config refuses `console`/`memory` in staging/production.
- Agora voice: nothing built or tested. See `docs/voice-spike.md`.
- Argon2 timing equalisation is tested loosely (CI-jitter tolerant), not as a security proof.

### Remaining for Phase 0

1. Run the two-phone spike (needs Agora App ID/certificate and two physical phones, one low-end Android); steps in `docs/voice-spike.md`.
2. Push to GitHub and confirm CI is green (owner action: create the repo).
3. Owner checkpoint: review schema, auth design, spike result.

### Next exact action

Owner supplies Agora credentials and two phones; run the spike and record the result.

## Phase 1 (in progress)

Started 2026-10-17 on the owner's go-ahead ("can we start building?"). Phase 0 items still open: the voice spike result and the first CI run (no GitHub repo yet). Neither blocks Phase 1; the voice fallback decision is still needed before Phase 3.

| Slice                                           | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1A profiles, username, avatar, settings, filter | done. Unit 66/66, integration 133/133 at that point (`npx turbo run lint typecheck build test --env-mode=loose` then `pnpm --filter @gameverse/api test:integration`), exit 0. Mutation checks: disabling the rename cooldown and the username filter were each caught; one mutation (same-user retry) survived because the code was dead, so it was removed. Migration `20261017120000_profiles_settings` hand-written and applied with psql; **Prisma drift check still unverified (CI only)** |
| 1B blocks and friends                           | done (commit e7809aa): 31 integration tests incl. concurrent A<->B requests and block-vs-accept races; mutation checks 3/3 caught (remove serializable retry, sorted-pair key, block check)                                                                                                                                                                                                                                                                                                      |
| 1C chat                                         | done (commit 08363b5): 31 chat + 16 WebSocket integration tests (auth, expiry close, delivery, cross-user access fails closed); mutation checks 5/5 caught                                                                                                                                                                                                                                                                                                                                       |
| 1D moderation and admin API                     | done (commit 3fd1277): 26 unit + 31 integration tests; mutation checks 7/7 caught after test fix                                                                                                                                                                                                                                                                                                                                                                                                 |
| 1E presence, push, account deletion             | done (commit 2ea6a2c): 16 engagement + 10 account-deletion integration tests; mutation checks 5/5 caught after strengthening one test. UNVERIFIED: Expo push against live Expo/a real device; real email delivery of the deletion link                                                                                                                                                                                                                                                           |
| 1F admin app and mobile screens                 | done in code, see "Slice 1F" below. Admin verified in a real browser against the compiled API; mobile only typechecked, linted and bundled, NOT run on a device                                                                                                                                                                                                                                                                                                                                  |

### Slice 1F: admin app and mobile screens

**Admin (`apps/admin`)**: staff sign-in (non-staff sessions are discarded at once), report queue with message-snapshot context, user search and detail, ban / suspend / reinstate with a required reason, role change (admins), audit log (admins). Plain React plus a small fetch client; Refine was not used (decision 39).

- Automated: `tsc`, `oxlint`, `vite build` pass inside the full gate. There are no automated UI tests.
- Manual browser run (headless Chromium via Playwright, built admin + compiled API + local Postgres): a normal player is refused with a clear message; staff sign in; the open report shows; the Ban button stays disabled until a reason is typed; banning resolves the report and removes it from the OPEN list; a page reload keeps the session; the RESOLVED tab shows it; user search finds the banned user; the audit tab lists entries; sign out returns to the login form. Straight after the ban the banned user's old access token got `403 ACCOUNT_BANNED`. This script is not in the repo and not in CI.

**Mobile (`apps/mobile`)**: sign in, register (client-side 16+ check, server decides), profile onboarding (username availability, 12 avatars, bio), Friends tab (search, add, requests in and out, online dots), Chats tab (unread badges, live updates), chat screen (optimistic send with a stable `clientMessageId` so retries never duplicate, tap-to-retry, older-message paging, live delivery over WebSocket with refetch on reconnect, mute, long-press to report a message), player profile (add / accept / cancel / remove, message, report, block), blocked list with unblock, privacy settings, notifications opt-in, sign out, account deletion request and confirm screen.

- Verified: `tsc` strict, `oxlint`, and `expo export --platform android` (Metro bundles every route into a Hermes bundle).
- **NOT verified**: nothing has run on a device or emulator. Layout, keyboard handling, accessibility labels, SecureStore, the React Native WebSocket path, push registration (needs a physical phone, an EAS project id and FCM/APNs credentials), and tapping notifications are all untested.

**Bug found and fixed while testing the admin app**: the compiled API could not start under plain Node because `agora-token` is CommonJS and the named import failed. Vitest hid it. Fixed with a default import, and CI now runs `pnpm --filter @gameverse/api smoke:dist` (boots `dist/` and waits for `/health/ready`). Proven by reverting the fix: the smoke check failed with the original error, then passed again after restoring.

### Phase 1 gate (2026-10-17, local Postgres 16)

| Command                                                    | Result                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx prettier --check .`                                   | clean                                                                                                                                                                                                                                                     |
| `npx turbo run lint typecheck build test --env-mode=loose` | 18/18 tasks; unit tests: design-system 24, shared-types 23, api 100                                                                                                                                                                                       |
| `pnpm --filter @gameverse/api test:integration`            | 13 files, **268/268**                                                                                                                                                                                                                                     |
| `pnpm --filter @gameverse/api smoke:dist`                  | compiled API up and ready                                                                                                                                                                                                                                 |
| `expo export --platform android` (mobile)                  | bundle produced                                                                                                                                                                                                                                           |
| Migration check                                            | all migrations apply in order to an empty database (done by the integration test setup). `prisma migrate deploy` and `prisma migrate diff --exit-code` are **not verified**: the Prisma schema engine cannot be downloaded in this sandbox. CI runs both. |

### Phase 1 definition of done, mapped to evidence

| Requirement                                    | Evidence                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| Two users can befriend, chat, block, report    | `friends`, `chat`, `moderation` integration suites                       |
| Blocked users cannot message or see each other | block tests in `friends` and `chat` suites (identical 404 / generic 403) |
| Privacy settings enforced server-side          | `profiles`, `friends`, `chat`, `engagement` (presence matrix) suites     |
| Race tests for friend requests pass            | concurrent A<->B and block-vs-accept tests, mutation-checked             |
| Admin ban revokes access immediately           | `moderation` suite, plus the manual browser run above                    |
| Cross-user message access fails closed         | `chat` suite                                                             |

### Closing work done after the checkpoint request (2026-10-17)

- **Email links now work end to end in code.** Emails point to `PUBLIC_WEB_URL/verify-email|reset-password|delete-account`. The API serves small no-store, noindex, strict-CSP landing pages there with an "Open GameVerse" button to `gameverse://...` (token checked against a strict pattern before it is placed in the page). 7 integration tests; loosening the pattern made 3 fail (mutation check). Replace with universal / app links once a domain exists.
- **Mobile screens added**: verify email, forgot password, reset password, and a "send verification email" prompt in Settings. Typecheck, lint and the Android bundle pass; not run on a device.
- **Real email provider code added** (`EMAIL_PROVIDER=resend`): tested against a local stand-in only (3 tests), **unverified against the live service**. Staging/production now refuse console/memory and require `RESEND_API_KEY` and a real sender (config tests).
- **Account deletion** no longer locks the player out for a minute when the email fails to send: the link is dropped and the API answers 503 (1 new test).
- **Draft Terms of Service and Privacy Policy** in `docs/legal/`, written to match what the code actually stores. They are drafts for a lawyer; nothing serves them yet and the terms version is still `draft-1`.

Gate after this work: prettier clean; `npx turbo run lint typecheck build test --env-mode=loose` 18/18 (unit: design-system 24, shared-types 23, api 104); `pnpm --filter @gameverse/api test:integration` **276/276**; `smoke:dist` OK.

### What cannot be finished without the owner

| Item                             | What is needed                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Voice spike (Phase 0)            | Agora App ID + certificate, two physical phones (one low-end Android)                                                                      |
| First CI run, Prisma drift check | A GitHub repository. The token available to the agent is invalid, so the owner must create the repo and push (or provide a working token). |
| Real email                       | A Resend account (or another provider; the interface is small), API key, and a sending domain with DNS records verified                    |
| Google / Apple sign-in           | Google OAuth client ids and Apple Services id / bundle id; mobile sign-in buttons are not built because they cannot be tested without them |
| Push on a real phone             | An Expo (EAS) project id and APNs / FCM credentials, plus a physical device                                                                |
| Word list                        | A human moderator to curate the starter blocklist (including Pidgin, Yoruba, Igbo, Hausa)                                                  |
| Legal                            | Lawyer review of `docs/legal/*`, then publish and bump the terms version                                                                   |
| Mobile on a device               | Someone to run the app on a phone or emulator and report what is broken                                                                    |
| Phase 0 and Phase 1 checkpoints  | Owner review and approval                                                                                                                  |

### Next exact action

Owner checkpoint for Phase 1. Needed from the owner: approve (or request changes to) Phase 1; decide on the mobile gaps above (email-link handling and verify / reset screens); provide Agora credentials and two phones for the voice spike. Phase 2 (session framework, tic-tac-toe, `packages/game-rules`) starts only after approval.

## Phase 2 (in progress)

Plan: `docs/phase-2-plan.md`. Owner approval recorded in decisions #47.

### Slice 2A: `packages/game-rules` (done, 2026-10-17)

Pure tic-tac-toe rules, best-of-three series (alternating opener, 20 s turn timeout, forfeit after two consecutive timeouts, forfeit on leave, rematch) and bots (easy random, medium heuristic, hard minimax) that only suggest a cell which must still pass the normal validator.

| Command                                                                                  | Result                                                                                    |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm --filter @gameverse/game-rules test`                                               | 3 files, **32/32 passed**                                                                 |
| `npx prettier --check .` then `npx turbo run lint typecheck build test --env-mode=loose` | clean; 22/22 tasks successful (api 104, shared-types 23, design-system 24, game-rules 32) |

Exhaustive checks inside the tests: every one of the 255,168 possible games is played and the totals equal the known figures (X 131,184 / O 77,904 / draws 46,080; 5,478 reachable positions; 81,792 ninth-move wins) with an independently written winner check; the hard bot never loses as X or O against every possible reply; every bot, at every level, returns a move the validator accepts in all 4,520 open positions.

Mutation checks: five deliberate bugs (no draw detection, opener not alternating, timeouts not cleared by a move, hard bot picking the worst move, timeout awarding the game to the loser) were each caught (5/5), then reverted and the suite re-run green.

Not done yet: everything server-side (2B onward). Nothing in 2A is wired into the API or the apps.

### Slice 2B: match tables and session service (done, 2026-10-18)

New: migration `20261018000000_matches` (hand-written SQL like the others; **`prisma migrate deploy` on it and the CI drift check are unverified**), models Game, GameMatch, GameMatchPlayer, GameEvent; `apps/api/src/matches/` (service, controller, timers, view); `packages/shared-types/src/matches.ts`; `match.update` WebSocket event.

Endpoints (all need a token; non-members get 404): `GET /v1/matches/current`, `GET /v1/matches/:id`, `POST /v1/matches/:id/ready`, `/moves`, `/leave`, `/rematch`. There is **no REST way to create a match yet**: matches are created through `MatchesService.createMatch`, which 2C (queue, private rooms, invites) and 2E (bot games) will call. Bot moves are not played yet (2E).

| Command                                                                                  | Result                                                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `npx prettier --check .` then `npx turbo run lint typecheck build test --env-mode=loose` | clean; 22/22 tasks (api 104, shared-types 23, design-system 24, game-rules 32) |
| `pnpm --filter @gameverse/api test:integration`                                          | 15 files, **331/331 passed** (55 new in `matches.e2e-spec.ts`)                 |
| `pnpm --filter @gameverse/api smoke:dist`                                                | compiled API is up and ready                                                   |

What the new tests prove (real Postgres, real HTTP, real WebSocket): non-members and unknown ids get the same 404; ready is idempotent and two simultaneous readies start the game once; a move needs the current version and a fresh action id; a retried move and five identical simultaneous moves apply once; two different moves racing for one turn land exactly one; unknown body fields (a "winner", a "mark") are refused; out-of-turn and occupied-cell moves change nothing; a full best-of-three with a gap-free event log whose last number equals the version; drawn games; turn timeout, two-timeouts forfeit and the reset by a real move; ready window expiry; an overdue deadline is resolved once even with three sweepers at the same instant; leave before and during a match, and twice; rematch needs both, makes one match even when both ask at once, and alternates the opener; a player cannot be in two open matches, even when two creations race; blocked players are not matched; bot seats are labelled and have no user; each change is pushed to both players with their own seat and to no one else.

Mutation checks (9): removing the move idempotency check, the stale-version check, the already-in-match check, membership enforcement, the due-date check, the ready idempotency, `.strict()` on the move body, the rematch idempotency and the opener alternation were each caught. Two (rematch idempotency, opener alternation) first **survived**; tests were added and both are now caught. All originals restored and the suite re-run green.

Notes and limits: the in-process sweeper (1 s) is off under `NODE_ENV=test`; tests call `runDueTimers()` directly. Per-user action rate limiting and disconnect grace/reconnect are slice 2D. Deploy note: the API now depends on `@gameverse/game-rules`, so the Render build command must build it too (see below).
