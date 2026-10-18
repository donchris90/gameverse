# Progress

**Current status (2026-10-18): Phases 0-5 are built and committed; Phase 5 (MVP hardening and gate) is at its checkpoint, waiting for owner review. The MVP gate is NOT fully green: see `docs/phase-5-checkpoint.md` for the item-by-item table and the register of unverified/blocked items.**

_Older status line:_ (2026-10-17) Phase 1 code is complete (slices 1A-1F plus closing work) and Phase 0 code is complete. Both are waiting on owner inputs listed under "What cannot be finished without the owner". Phase 2 was approved to start by the owner on 2026-10-17; the plan is in `docs/phase-2-plan.md`.** Details in the Phase 1 section below.

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

Notes and limits: the in-process sweeper (1 s) is off under `NODE_ENV=test`; tests call `runDueTimers()` directly. Per-user action rate limiting and disconnect grace/reconnect are slice 2D. Deploy note: the API now depends on `@gameverse/game-rules`, so the Render build command must build it too: `pnpm install --frozen-lockfile && pnpm --filter @gameverse/shared-types build && pnpm --filter @gameverse/game-rules build && pnpm --filter @gameverse/api exec prisma generate && pnpm --filter @gameverse/api exec tsc -p tsconfig.build.json --incremental false`.

### Slice 2C: matchmaking, private rooms, friend invites (done, 2026-10-18)

New: migration `20261018120000_lobby` (hand-written; **`prisma migrate deploy` and the CI drift check are unverified**), models GameRoom and MatchQueueEntry, `apps/api/src/lobby/` (policy, matchmaking service, rooms service, controller, sweeper), `packages/shared-types/src/lobby.ts`, `room.update` WebSocket event, push `GAME_INVITE`.

Endpoints (all need a token): `GET /v1/matchmaking`, `POST /v1/matchmaking/join`, `/cancel`; `GET /v1/rooms` (my hosted room + invites for me), `POST /v1/rooms`, `/rooms/join` (by code), `/rooms/invite`, `/rooms/:id/accept`, `/rooms/:id/decline`, `DELETE /v1/rooms/:id`. Every route produces or ends the same `MatchView` the session service plays, so a quick match, private match or friend match can be readied and played with the 2B endpoints. **No bot-game endpoint yet** (decisions #52): `botOffer` is only a flag until 2E.

| Command                                                                                  | Result                                                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `npx prettier --check .` then `npx turbo run lint typecheck build test --env-mode=loose` | clean; 22/22 tasks (api 120, shared-types 23, design-system 24, game-rules 32) |
| `pnpm --filter @gameverse/api test:integration`                                          | 16 files, **382/382 passed** (51 new in `lobby.e2e-spec.ts`)                   |
| `pnpm --filter @gameverse/api smoke:dist`                                                | compiled API is up and ready                                                   |

What the new tests prove (real Postgres, real HTTP, real WebSocket, real push provider double): two searching players get one shared match and the longer waiter takes seat 0; joining twice is harmless; cancel and retry work; the bot offer flag flips at exactly 20 s and creates nothing; a search ends after 60 s; players 400 rating points apart are paired only once the band reaches 400 (30 s); blocked players are never paired, but a third player still is; a leftover queue row of someone already in a match is skipped; two players joining at the same instant make exactly one match (6 rounds), eight at once make four and nobody is in two; the same account joining from three devices makes one search; room codes work once, in any case; two guests racing for one code give one match and one 404; unknown, closed, expired, taken and not-yours codes answer identically; malformed codes are rejected before the database; a new room replaces the old; only the host can close; a guest already in a match fails cleanly and the room stays open; blocked pairs cannot start a match; 10 wrong guesses lock a guesser out without affecting others; invites are friends-only, the invitee never sees the code, only the invitee can accept or decline, they expire after 2 min, the host can withdraw; the invite push carries only the inviter's username; the invitee is told live over the socket.

Bug found and fixed on the way: the simultaneous-join test returned 500 in about 70% of rounds because `runSerializable` did not recognise Prisma 7's `TransactionWriteConflict` as retryable (decisions #55). A unit spec for `runSerializable` now covers every retryable form, the non-retry of ordinary errors and the attempt cap.

Mutation checks (11): removing the block filter, the in-match filter (first **survived**, test added), the rating-band check, the expiry check, the invitee check, the guest-queue cleanup, the failed-guess counter, the code-visibility rule, the queue-expiry sweep and the hosting check were each caught; originals restored and the suite re-run green.

Limits: ratings are a constant 1000 until 2F; the lobby sweeper (2 s) is off under `NODE_ENV=test` and tests call `runMatchmaking()` / `expireRooms()` directly; join-guess limiting is in memory (single instance, like presence). Deploy: `prisma migrate deploy` in the Render start command will apply the new migration; the build command is unchanged.

### Slice 2D: connection handling, resume, action limits (done, 2026-10-18)

New: migration `20261018180000_match_connection` (adds `disconnectedAt`; hand-written, **`prisma migrate deploy` and drift check unverified**), `ActionLimiter`, hub hooks `onSocketReady` / `sendToSocket`, `MatchesService.runConnectionChecks`, `connected` and `reconnectBy` on each player of `MatchView`, `DISCONNECT_GRACE_MS`. Decisions #56 to #58.

| Command                                                                                  | Result                                                                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `npx prettier --check .` then `npx turbo run lint typecheck build test --env-mode=loose` | clean; 22/22 tasks (api 125, shared-types 23, design-system 24, game-rules 32)                    |
| `pnpm --filter @gameverse/api test:integration`                                          | 17 files, **401/401 passed** on the last two full runs (19 new in `matches-realtime.e2e-spec.ts`) |
| `pnpm --filter @gameverse/api smoke:dist`                                                | compiled API is up and ready                                                                      |

What the tests prove (real Postgres, HTTP and WebSocket): a connecting client gets its match straight away, equal to the REST view; after a drop, moves made while away are all present on reconnect with the same version; a second device gets it too; nothing is sent when there is no open match; an offline player is shown as disconnected to the opponent live, with the deadline, without changing the version; forfeit happens at exactly 30 s and not 1 ms earlier, once, even with three sweepers at once, and the event log stays gap-free; returning inside the grace cancels it at once; a reconnect between check and forfeit wins; if both are gone the earlier leaver loses; matches not yet started are untouched; the 31st action in 10 s gets 429 and changes nothing, it is per account, and reads are unlimited.

Mutation checks (9): each of outer and inner grace check, snapshot send, reconnect clearing, move rate limit, earliest-first choice, sweep clearing, restricting to ACTIVE matches and the opponent publish was caught. One bug found by the tests along the way: a rolled-back retry left the "ended" flag set, so racing sweepers each reported a forfeit; the flag is now reset per attempt. An existing 2B test was updated because a connecting client now receives a snapshot before later updates.

Observed once and not reproduced: in one of four full integration runs, "a deadline that is not yet due is left alone" failed; it passed in the next 8 runs including repeated runs of the match files together. Cause unknown; watch for it in CI.

Limits: sweeping runs every second and only on this instance (in-memory sockets); frame rate limiting on the socket already existed; the grace and limits are constants in shared-types and matches.constants.

### Slice 2E: bots in matches (done, 2026-10-18)

New: `POST /v1/matches/bot`, `MatchesService.startBotMatch` / `runBotMoves` / `botMove`, `botActionId`, `BOT_THINK_MS`, a 250 ms bot sweep in `MatchTimersService`, `botMatchSchema` in shared-types. No schema change. Decisions #59 to #61. The 20 s "play a bot" offer from 2C can now be honoured by the app: it calls this endpoint.

| Command                                                                                  | Result                                                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `npx prettier --check .` then `npx turbo run lint typecheck build test --env-mode=loose` | clean; 22/22 tasks (api 127, shared-types 23, design-system 24, game-rules 32) |
| `pnpm --filter @gameverse/api test:integration`                                          | 18 files, **426/426 passed** (25 new in `matches-bot.e2e-spec.ts`)             |
| `pnpm --filter @gameverse/api smoke:dist`                                                | compiled API is up and ready                                                   |

What the tests prove (real Postgres and HTTP): the bot is labelled `Bot` with no user behind it and the right level is stored; a bot match starts when the human alone presses ready; bad levels, games and extra fields are refused; starting needs sign-in and a profile, is refused inside a match or with an open room, and ends a running search; the bot does not move before its think time and moves once after; it answers a human move exactly once, then waits; three sweepers at one instant make one move; its move sits in the event log like a human one with a derived id and a gap-free log; a human cannot move for it or out of turn and a stranger cannot see the match; four full series against the hard bot with a random human, where the bot never lost a game, every logged move replays legally through the rules and reproduces the stored score; an easy bot finishes a series; leaving, turn timeout and 30 s absence all lose to the bot; rematch is created at once, labelled, and opened by the seat that did not open the last game; a bot is never marked disconnected; bot-match actions count against the rate limit.

Mutation checks (8): removing the think time, always using the easy level, a constant action id, keeping the queue entry, dropping the open-room check, a wrong match kind and the rolled-back-retry flag reset were caught. The flag reset first **survived**; a deterministic test now forces a rolled-back attempt followed by a retry that finds nothing to do, and catches it. One mutant (dropping the "seat belongs to a bot" user check) is harmless: the bot-level check beside it makes the guard redundant, so it is not tested separately.

Limits: random human moves make the series tests non-deterministic by design, but they assert only invariants; the bot has no difficulty tuning beyond three levels; bot sweeping runs on one instance. Not yet visible to players: the apps do not call any of this until 2G.

### Slice 2F: ratings, XP, statistics, leaderboard (done, 2026-10-18)

New: migration `20261018220000_progress` (hand-written; **`prisma migrate deploy` and the drift check are unverified**), tables game_results, game_result_players, player_ratings, player_statistics, player_experience; `packages/game-rules/src/elo.ts`; `apps/api/src/progress/` (results, progress, xp policy, controller); `result` on `MatchView`; `GET /v1/me/progress`, `GET /v1/leaderboards/:gameId?limit&offset`. Matchmaking now reads real ratings. Decisions #62 to #67.

| Command                                                                                          | Result                                                                                            |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `npx prettier --check .` then `npx turbo run lint typecheck build test --env-mode=loose --force` | clean; 22/22 tasks on two forced runs (api 131, shared-types 28, design-system 24, game-rules 41) |
| `pnpm --filter @gameverse/api test:integration`                                                  | 19 files, **455/455 passed** (29 new in `progress.e2e-spec.ts`)                                   |
| `pnpm --filter @gameverse/api smoke:dist`                                                        | compiled API is up and ready                                                                      |

What the tests prove (real Postgres and HTTP): a decided quick match moves both ratings by Elo (1016/984 between equals, 1029/1371 for an upset), pays 30 XP to the winner and 0 to the player who left, counts statistics and streaks, and both players see the change in the match result; a series lost by timeouts pays the loser 15; a drawn series gives each side half a point (the favourite loses points); private, friend and bot matches never touch rating; bot matches touch no statistics and pay 5 XP up to 10 matches a day; matches that never started leave no result; finishing a match through four racing paths records one result and applies everything once; recording the same match again changes nothing; when recording fails the match stays active with no events written, and the same action works once the fault is gone; deleting an account keeps the opponent's rating and history; the same pair gets three rated results a day then none, other opponents unaffected; far-apart ratings wait until the band reaches the gap (400 at 30 s); the leaderboard orders, ranks, breaks ties the same way for the list and for personal rank, pages, hides rookies, suspended and blocked players and shows wins; bad paging and unknown games are 400; everything needs sign-in; strangers cannot see a result.

Mutation checks (13): no idempotency guard, private matches counted as ranked, no pair limit, quitters paid, bot cap off by one, bots counted in statistics, streaks never reset, no completion hook, no minimum games, no block filter, no status filter, wrong tie-break and matchmaking ignoring ratings were each caught (13/13).

Fixed along the way: two exhaustive game-rules specs timed out at vitest's 5 s default when turbo ran other packages' tests at the same time; the package now has a 60 s test timeout (assertions unchanged). One bot-XP test is pinned to a fixed midday clock, because a real-time clock near UTC midnight made the daily cap look wrong.

Limits: ratings are per game but there is one game; XP and rating values are first-pass numbers in one policy file each; the leaderboard counts with offset paging and is fine for thousands of players but would want a cached rank beyond that; nothing is shown in the apps until 2G.

### Slice 2G: mobile games + load-test baseline (done, 2026-10-18)

New (all mobile code is **unverified on a device**; checks were `tsc --noEmit` and `oxlint -D correctness`): a Play tab (progress strip, resume match, game invites accept/decline, find a player with cancel and a "play a bot instead" offer, practice against easy/medium/hard bot, private room with code, join by code), a match screen (ready, board, turn countdown from the server clock, opponent connection warning, leave, result with rating/XP lines, rematch, chat with the human opponent), a leaderboard screen, "Invite to play" on a friend's profile, and `GAME_INVITE` push taps opening the Play tab. `useMatch` fetches, applies `match.update` pushes by version, refetches on reconnect and when the app returns to the foreground. `LobbyOverview` moved to shared-types.

| Command                                                                                  | Result                                                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `npx prettier --check .` then `npx turbo run lint typecheck build test --env-mode=loose` | clean; 22/22 tasks (api 131, shared-types 50, design-system 24, game-rules 41) |
| `pnpm --filter @gameverse/api test:integration`                                          | 19 files, **455/455 passed**                                                   |
| `pnpm --filter @gameverse/api smoke:dist`                                                | compiled API is up and ready                                                   |

Load-test baseline (`apps/api/scripts/load-test.mjs`, real HTTP against the compiled API and local PostgreSQL 16 in a small shared sandbox; **not** a production or phone-network figure): 40 simultaneous queue joins, then 20 pairs x 2 full matches over REST.
Result: 40/40 matches finished, 3585 requests in 25.5 s (about 140 req/s). Latency p50/p95 ms: match.get 13/37, match.move 45/398, match.ready 71/799, room.join 428/1806, queue.join (40 at once) 1414/2028. 19 requests were answered 503 "server busy" and succeeded on retry.
Found and fixed by this run: the first run gave 500s on queue joins and room joins under that stampede (serializable retries ran out). Backoff now has full jitter and exhaustion returns 503 (decision 71). Earlier runs: 28/40 matches before the fix.

Limits: nothing here has run on a phone; the load test is one burst on one machine and says nothing about Render/Supabase latency; the busy responses show serializable matchmaking contends under bursts, so a real launch should re-measure on the deployed stack. Friend invites are sent from the profile only (no picker in the Play tab).

## Phase 3: voice in matches (code done, 2026-10-18; **voice itself is UNVERIFIED on devices and against real Agora**)

Built: migration `20261019000000_voice` (hand-written; `migrate deploy` and drift check unverified) with `voice_sessions`; `POST /v1/matches/:id/voice/token|joined|left`; `FakeVoiceProvider` (`VOICE_PROVIDER=fake`, refused in staging/production); sweeper closing sessions of finished matches; shared-types `VoiceController` (permission, token, renewal, reconnect, mute, leave, usage reports) over a `VoiceEngine` seam plus a state reducer; mobile Agora engine, microphone permission helper, Android foreground-service keep-alive (notifee + config plugin), iOS `audio` background mode, and a voice panel on the match screen (join/leave/mute, participant list, speaker indicator, permission-denied help, report and block). Voice is opt-in per match, humans only, nothing is recorded.

| Command                                                                                  | Result                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx prettier --check .` then `npx turbo run lint typecheck build test --env-mode=loose` | clean; 22/22 tasks (api 132, shared-types 89, design-system 24, game-rules 41)                                                                        |
| `pnpm --filter @gameverse/api test:integration`                                          | 20 files, **473/473 passed** (18 new in `voice.e2e-spec.ts`)                                                                                          |
| `pnpm --filter @gameverse/api smoke:dist`                                                | compiled API is up and ready                                                                                                                          |
| `expo prebuild --platform android --no-install`                                          | succeeded; manifest has RECORD_AUDIO, FOREGROUND_SERVICE_MICROPHONE and the notifee service with type microphone (generated files removed afterwards) |
| Mobile `tsc --noEmit`, `oxlint -D correctness`                                           | clean                                                                                                                                                 |

Mutation checks: API 12/12 caught (membership, open-match, bot, block, limiter, idempotent join, left membership, negative time, sweeper end, timeout, renew time, end time); phone-side 16/16 caught after adding one test (a leave during the microphone prompt) and fixing one mutation pattern.

Not verified (see `docs/voice-verification.md`): Agora accepting our tokens, audio between phones, mute/leave/reconnect on devices, token renewal after 9 minutes, Android foreground service and iOS background audio, low-end Android, report/block in a call, the Phase 0 spike itself. Limit: a blocked player's call is not cut server-side until their next token renewal.

## Phase 4B: Ludo server (2026-10-18)

Ludo matches run on the existing match framework with 2–4 seats: server-side CSPRNG dice, `roll` and `token-moves` actions (idempotent, version-checked), a 20 s turn clock with timeout play and removal after three in a row, leave/forfeit/disconnect handling that keeps 3–4 player games going, labelled bots (2–4 players), generalized rematch with a rotating opener, and placing-based results (N-player Elo, XP, statistics). Ludo stays **disabled** in `games` until 4E.

Verified (run in this environment):

- `pnpm exec prettier --check .`: all files match.
- `pnpm turbo run lint typecheck build test --env-mode=loose`: 22/22 tasks successful (game-rules 107 tests).
- `pnpm --filter @gameverse/api test:integration`: 21 files, 505/505 passed (was 473; `test/ludo.e2e-spec.ts` adds 32, including a full 4-player game, a 4-human ranked game and a walk-away game).
- `pnpm --filter @gameverse/api smoke:dist`: compiled API up and ready.
- Mutation checks on the new server code: 11 of 12 caught on first run; the survivors (Ludo idempotency guard aimed at the wrong copy, walker XP, middle-place scores) were re-run after adding tests and are all caught.

Changed on the way: tests that used `ludo` as the "unknown game" now use `chess`; progress and leaderboards hide disabled games (decision #81).

Unverified: migration `20261019120000_ludo_matches` is hand-written and applied by the test setup, not by `prisma migrate deploy`. No device or load run yet for Ludo.

Next: 4C Ludo lobby (rooms for 2–4, public queue, bot fill, invites, rematch).

## Phase 4C: Ludo lobby (2026-10-18)

Private rooms for 2–4 players with a member list, host Start (with or without labelled bots), guest Leave, and automatic start when full. Quick match for 2–4 players (same-size tables, pairwise rating band, no blocked pair at one table). Friend invites stay two-player. Rematch for N seats was done in 4B. Ludo stays **disabled** until 4E. Migration `20261019180000_ludo_lobby` (hand-written; `migrate deploy` unverified).

Verified (run here):

- `pnpm exec prettier --check .`: clean.
- `pnpm turbo run lint typecheck build test --env-mode=loose`: 22/22 tasks (api unit 139, shared-types 89, game-rules 107).
- `pnpm --filter @gameverse/api test:integration`: 22 files, 525/525 (was 505; `ludo-lobby.e2e-spec.ts` adds 20).
- `pnpm --filter @gameverse/api smoke:dist`: compiled API up and ready.
- Mutation checks on the lobby code: 11 mutants; 10 caught first time, the survivor (queue ignored table size) exposed a test that passed by luck, which now orders searches so it is caught.

Changed on the way: `POST /v1/rooms/join` returns `{ room, match }`; `matchmaking.join` takes `players` before `now`; the mobile API client keeps `joinRoom` (match only) and gains `joinRoomResult`, `startRoom`, `leaveRoom`, and `players` options. The mobile app still typechecks; it has no UI for these yet (4D).

Next: 4D mobile Ludo board (SVG + Reanimated) and screens.

## Phase 4D: Ludo mobile (2026-10-18; **device-unverified**)

Added: the board (`react-native-svg` static layer, Reanimated tokens with hop animation), the die, the match screen (seat legend, status line, event ticker, placings, rematch, voice, chat per human, leave), the Play tab Ludo card (table size 2-4, quick match, bots, private table with code, Start / Fill with bots / Leave / Close), a Game animations setting, per-player Report and Block in the voice panel, and mobile dependencies (`react-native-svg` 15.16.0, `react-native-reanimated` 4.7.1, `react-native-worklets` 0.13.0, `expo-haptics` ~58.0.7, `@gameverse/game-rules`; versions from Expo SDK 58's bundled list). `eas-build-post-install` now builds game-rules too.

Verified (run here):

- `pnpm exec prettier --check .`: clean.
- `pnpm turbo run lint typecheck build test --env-mode=loose`: 22/22 tasks (shared-types 136, game-rules 130, design-system 28, api unit 139). Mobile: `tsc --noEmit` and `oxlint -D correctness app src` clean.
- Mutation checks on the new pure code (board geometry and Ludo UI logic): 15 of 15 caught.
- The board geometry, colours and a mid-game token layout were drawn to an image with the same code and checked by eye: track, home columns, bases, safe-square stars and stacked tokens look right.

Not verified: any of it running on a device or emulator (Reanimated/worklets setup, SVG rendering, tap targets, hop animation, haptics, TalkBack), and frame rate on a low-end Android phone. `docs/ludo-verification.md` lists the checks and how to measure.

`pnpm` reports a peer warning (`react-dom 19.3.1` wants `react ^19.3.1`, the app pins `react 19.3.0`); it arrived with the new packages and is not fixed.

Next: 4E, a full 4-player integration test (done in 4B), a load check with Ludo, enabling the game, and the Phase 4 checkpoint report.

## Phase 4E: load check and checkpoint (2026-10-18)

`scripts/load-test.mjs` gained `--game ludo` (tables of 4, random play, paced like a person). Local run, 40 players / 10 tables: run 1 finished 9/10 (one `room.join` stayed 503 after 4 script retries), run 2 finished 10/10; 40/40 simultaneous 4-player searches matched both times. Roll p50/p95 50/318 ms, token move 45/256 ms. Full numbers and caveats in `docs/phase-4-checkpoint.md`.

Verified: `pnpm --filter @gameverse/api test:integration` 22 files, 525/525 (after the load runs, with Ludo switched back off in the test database).

**Phase 4 checkpoint report:** `docs/phase-4-checkpoint.md`. Ludo stays disabled until the device checks; Phase 5 needs the owner's approval.

## Phase 5: MVP hardening and gate (2026-10-18)

Slices 5A-5H are committed. Verified results (all run this session):

| Command                                                                                                 | Result                                                                           |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `npx prettier --check .`                                                                                | clean                                                                            |
| `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true pnpm exec turbo run lint typecheck build test --env-mode=loose`  | 22/22 tasks; unit shared-types 146, design-system 28, api 140, game-rules 130    |
| `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true pnpm exec vitest run --config ./vitest.config.e2e.ts` (apps/api) | 27 files, 558/558                                                                |
| `apps/api/scripts/smoke-dist.sh`                                                                        | compiled API up and ready                                                        |
| `scripts/db-rehearsal.sh`                                                                               | 13 migrations clean, dump/restore identical per table                            |
| `scripts/ws-load.sh`, `ws-idle.sh`                                                                      | ceiling about 60-75 pairs on a shared 2-vCPU box; 6,000 idle sockets, 0 failures |

One full integration run had a single `concurrency-matches` failure with the error not captured; 14 isolated runs and 2 later full runs passed. Cause unknown.

**Unverified/blocked register and the 12-item gate table: `docs/phase-5-checkpoint.md`.** Not verified: all mobile code on devices, Maestro runs, voice (Agora), Apple/Google sign-in with real tokens, `prisma migrate deploy`, hosted backup restore, real email, first CI run. Not implemented: Apple token revocation on deletion.

**Next exact action:** owner reviews the checkpoint, then supplies Agora keys/devices, EAS builds and store accounts so the blocked items can be run.

## Admin game switch, games home, tab icons (2026-10-18, after the Phase 5 checkpoint)

- Found on the first real-device run: start-up crash (WorkManager vs R8, decision #101), "Unmatched Route" at launch (start route restored, #102), missing tab icons. Fixed in code; **each is unverified until a rebuilt build is run on the phone** except where stated.
- Games home with a card per game and a game screen (#103); Ludo shows as "Coming soon" until the server lists it. Seen only as code and a successful bundle.
- Admin game switch (#104): `GET/PATCH /v1/admin/games`, Games tab in the admin. Verified: `admin-games.e2e-spec.ts` 6/6 (mutation-checked on the admin-only rule), full integration run 564/564 twice, turbo 22/22, Prettier clean, and a real browser run against the real API (turned Ludo on with a reason; the database changed and an audit row was written).

**Not verified:** all mobile screens on a device after these changes; the admin Games tab was not run against the deployed Render API.

## Phase 6, slice 6A: game driver interface (2026-10-18)

- Refactor only, no behaviour change. Added `game-driver.ts`, `tictactoe.driver.ts`, `ludo.driver.ts`, `match-errors.ts`, `game-driver.spec.ts`; `matches.service.ts` now calls the driver.
- Checked: `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true pnpm exec turbo run lint typecheck build test --env-mode=loose` passed (145 API unit tests); `vitest run --config ./vitest.config.e2e.ts` in `apps/api`: 28 files, 564/564 passed (same count as before, no test edited); `scripts/smoke-dist.sh`: "compiled API is up and ready"; `prettier --check .` clean after formatting `apps/mobile/app.json`.
- Not done: `match.view.ts` and `results.service.ts` still branch on game for the view and the result; they move behind the driver when the first new game needs different fields (6B).
- Next exact action: Draughts rules doc for owner approval (slice 6B). Owner decisions still open: Draughts variant, Ayo variant, Whot house rules.

## Phase 6, slice 6B: Draughts (2026-10-18)

- Built: `packages/game-rules/src/draughts.ts` and `draughts-bots.ts` (rules, easy/medium/hard bots), `apps/api/src/matches/draughts.driver.ts`, route `POST /v1/matches/:id/draughts-moves`, result recording for a finished draughts game, migration `20261020000000_draughts` (row added **disabled**), `packages/shared-types/src/draughts-ui.ts`, mobile board `apps/mobile/src/draughts/DraughtsMatch.tsx`, game art, and a Play-tab card ("Coming soon" while off).
- Checked (all run in this sandbox):
  - `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true pnpm exec turbo run lint typecheck build test --env-mode=loose`: 22 of 22 tasks passed (game-rules 24 draughts tests among them; shared-types 158 tests, 12 new).
  - `vitest run --config ./vitest.config.e2e.ts` in `apps/api`: 29 files, 577/577 passed (564 earlier plus 13 new in `draughts.e2e-spec.ts`: full game to the end, illegal and out-of-turn moves, duplicate move, timeout, leave, disconnect, rematch, bot).
  - Mutation checks on the rules: removing compulsory capture failed 6 tests; letting a crowned man keep jumping failed 1. Both reverted.
  - `scripts/smoke-dist.sh`: "compiled API is up and ready". `prettier --check .` clean.
- **Unverified:** the board screen on a phone, touch targets, colours, haptics, and bot strength by feel. Checklist in `docs/draughts-verification.md`. Draughts stays off until the owner plays it and enables it from the admin Games tab.
- Known gaps: `match.view.ts` and `results.service.ts` still branch per game (moved behind the driver later). Hard bot is about 6 plies with a node cap; its strength has not been measured against people.
- Next exact action: owner device check, then Ayo rules doc for approval (slice 6C).

## Phase 6, slice 6C: Ayo (2026-10-18)

- Built: `packages/game-rules/src/ayo.ts` and `ayo-bots.ts` (reap-at-four rules, rounds, end by agreement, bots), `apps/api/src/matches/ayo.driver.ts`, routes `POST /v1/matches/:id/ayo-moves` and `/ayo-end`, result recording, migration `20261021000000_ayo` (row added **disabled**), `packages/shared-types/src/ayo-ui.ts`, mobile board `apps/mobile/src/ayo/AyoMatch.tsx` (with a seed-by-seed replay), game art and a Play-tab card ("Coming soon" while off). Rules are in `docs/ayo-rules.md` (approved by the owner), decision #109.
- Checked (all run in this sandbox):
  - `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true pnpm exec turbo run lint typecheck build test --env-mode=loose`: 22 of 22 tasks passed (game-rules 30 Ayo tests; shared-types 11 new).
  - `vitest run --config ./vitest.config.e2e.ts` in `apps/api`: 30 files, 595/595 passed (577 earlier plus 18 new in `ayo.e2e-spec.ts`). A later lint fix touched only that test file; it was re-run alone (18/18) and the gate re-run (22/22).
  - Mutation checks on the rules, six of six caught: removing the last-seed exception, letting 5+ count as a reap, removing the lap skip, removing the last-eight rule, ignoring seeds in hand when counting the last eight, letting the round winner start the next round. All reverted.
  - `scripts/smoke-dist.sh`: "compiled API is up and ready". `prettier --check .` clean.
- Found while testing: a relay can go round in a circle forever. Fix: a relay that returns to a position it was already in ends the turn (decision #109, in the rules doc; the owner has not seen this case). Random play also showed that matches between two random players can run for hundreds of turns because a round moves only a few seeds; there is no round cap. Both are flagged to the owner.
- **Unverified:** the board screen on a phone, pit size for touch, the replay animation, bot strength by feel, and whether the rules match how people play Ayo locally. Checklist in `docs/ayo-verification.md`. Ayo stays off until the owner enables it from the admin Games tab.
- Next exact action: owner device check of Draughts and Ayo, then the Whot rules doc for approval (slice 6D).

## Fix: blank Ludo match screen (found by the owner on a device)

- Cause: a match starts in the READY stage with no game state. `LudoMatch` returned `null` when the Ludo state was missing, so the screen was blank and the Ready button never appeared. Draughts and Ayo already handled this stage.
- Fix: `LudoMatch` now shows the status line, the Ready button and Leave while the board does not exist yet.
- Checked: `pnpm exec turbo run lint typecheck --filter=@gameverse/mobile` passed. The screen itself is NOT yet seen on a device (unverified); there is no component test harness for mobile screens.
