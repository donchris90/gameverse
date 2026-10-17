# GameVerse — Phase prompts

Each phase: read `CLAUDE.md` and `docs/product-spec.md`, plan briefly, implement, run gates, update `docs/progress.md`, then stop at the checkpoint for owner review.

---

## Phase 0 — Foundation and risk spikes

Build:

- pnpm + Turborepo monorepo: `apps/api`, `apps/mobile`, `apps/admin`, `packages/game-rules`, `packages/shared-types`, `packages/design-system`.
- TypeScript strict, ESLint, Prettier, Jest/Vitest, GitHub Actions CI (lint, typecheck, test, build).
- Prisma + Postgres via Docker compose, first migration, seed script, health/readiness endpoints, structured logging, `.env.example`.
- Auth: register, login, refresh rotation and revocation, email verification, password reset, Apple and Google sign-in, age gate (16+).
- Design tokens (dark-first) in `packages/design-system`.
- **Agora spike**: bare Expo dev build, `react-native-agora`, backend token endpoint, join from two physical phones (one low-end Android), mute, leave, reconnect. Record result in `docs/voice-spike.md`.

Done when: all apps start; CI green; auth integration tests pass (including expired/invalid/revoked tokens); migration runs on empty DB; voice spike result documented honestly (pass or fail, with devices used).

Checkpoint: owner reviews schema, auth design, spike result. If spike fails, decide fallback before Phase 3.

---

## Phase 1 — Social foundation

Build: profiles, avatar picker, username checks, settings and privacy, friends (request/accept/reject/remove/search, duplicate and simultaneous-request safety), presence, 1:1 chat (REST history + WS delivery, pagination, read state, mute), block, report, text filter, push notifications, account deletion, minimal Refine admin (user lookup, report queue, ban/unban, audit log).

Done when: two test users can befriend, chat, block, report; blocked users cannot message or see each other; privacy settings enforced server-side; race tests for friend requests pass; admin ban revokes access immediately; cross-user message access test fails closed.

---

## Phase 2 — Session framework and Tic-tac-toe

Build:

- `packages/game-rules` tic-tac-toe (pure) with exhaustive tests.
- Session service: states, versioned transitions, GameEvent log, ready state, timers, disconnect grace, reconnect/resume, abandon/expire, results, rematch.
- Matchmaking queue (rating band, widening, timeout, cancel, retry), private room codes, friend invites.
- Authenticated WS gateway: room authorization, event validation, rate limits, idempotent actions.
- Labelled bots (easy/medium/hard) via the same validator.
- Mobile: lobby, game library, match screen, result screen, rematch, in-match chat.
- Elo-style rating, XP award (idempotent), per-game leaderboard.

Done when: two clients complete best-of-3; reconnect mid-match restores state; timeout and forfeit work; duplicate move requests ignored; client cannot choose winner; two simultaneous queue joins never double-match; bot matches work; load test baseline recorded.

---

## Phase 3 — Voice in matches

Build: `VoiceProvider` interface + Agora implementation + fake; token endpoint (membership check, short TTL, renewal); UID mapping; voice join/leave/mute UI; speaker indicators; participant list; permission-denied handling; interruption and background handling (Android foreground service, iOS background audio); reconnect; usage logging per user-minute; report/block from voice UI; auto-leave when match ends or user leaves.

Done when: unit tests with the fake provider pass; token endpoint rejects non-members; on two real devices, join/mute/leave/reconnect verified and logged in `docs/voice-verification.md`; anything untested is listed as unverified.

---

## Phase 4 — Ludo

Pre-step: write `docs/ludo-rules.md`, stop, get owner approval of rules.
Build: pure rules module, server CSPRNG dice with logged rolls, all rules covered by unit + property-based/fuzz tests (no illegal states reachable), 2/3/4 players, private/public, bots, reconnect, results, rematch, board UI with Reanimated + SVG, profiled on a low-end Android.

Done when: rules tests and fuzz tests pass; full 4-player game completes in an integration test; invalid moves rejected; abandoned seats handled per spec; frame-rate on low-end device measured and recorded.

---

## Phase 5 — MVP hardening and gate

Build: Maestro E2E flows, security test suite, WS load test, backup/restore rehearsal, Sentry integration, rate-limit audit, dependency audit, EAS build profiles, store-compliance review notes (UGC moderation, account deletion, age rating, privacy labels), draft privacy policy and terms for legal review, soft-launch checklist for 2-3 markets.

Done when: every item in the MVP gate in `docs/product-spec.md` is verified or explicitly listed as unverified/blocked.

---

## Post-MVP (separate prompts, written when reached)

- v1.1: Trivia, Word battles, clubs, achievements/challenges, events, referrals and deep links.
- v1.2: cosmetics shop, GameVerse Plus, IAP validation, entitlements, refunds, regional pricing and tax.
