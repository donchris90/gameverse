# CLAUDE.md — GameVerse working rules

Read this at the start of every session. Product details live in `docs/product-spec.md`. Phase tasks live in `docs/phases.md`. Progress lives in `docs/progress.md`.

## Identity and isolation

- GameVerse is a separate business from RydaApp/RRYDA. Separate repo, database, cloud project, credentials, payment config, user accounts.
- Never import production data or credentials from any other product.
- Internal shared packages (auth, WebSocket gateway, webhook idempotency) may be copied or extracted as versioned packages. Review them before reuse. Never reference another product's live config.

## Honesty rules (non-negotiable)

1. Never claim a test passed unless you ran it and it passed. Paste the real command and result in `docs/progress.md`.
2. Never claim an integration works without valid credentials and a real-device check. Label it "unverified" until then.
3. No fake success responses in production code. No empty handlers, no buttons that do nothing, no TODO in core logic.
4. Never weaken, skip, or delete a test or lint/type rule to get green. Fix the cause.
5. Never trust the client for score, dice, move legality, winner, reward, purchase, or entitlement. The server decides.
6. Never show a game as available unless it is playable end to end.
7. Never silently add a fake human. Bots are labelled "Bot" in UI and data, and move through the same validators as humans.

## Engineering rules

- TypeScript strict. pnpm + Turborepo monorepo. NestJS + Prisma + PostgreSQL. Expo (dev build) + Expo Router. Redis only when a measured need appears.
- Every schema change is a Prisma migration. Never run destructive DB commands outside local dev.
- Game rules live in `packages/game-rules` as pure, deterministic functions (state, action) -> state. No I/O, no randomness inside; RNG is injected and seeded on the server.
- Every state-changing endpoint and socket event: DTO validation, auth, object-level authorization, idempotency where duplicates are possible, rate limit.
- Use transactions for match completion, rewards, purchases, entitlements.
- No secrets in code or logs. `.env.example` has placeholders only.
- Do not deploy, spend money, publish apps, or touch production without explicit owner approval.

## Workflow

- One phase at a time. Do not start the next phase until the current definition of done is met and the owner approves at the checkpoint.
- Before each phase: short plan (files, deps, risks, tests). Then implement without re-asking.
- Ask the owner only about true blockers or product decisions not already in the spec. Otherwise pick a default and record it in `docs/decisions.md`.
- Commit at each green milestone. Update `docs/progress.md`: last verified checkpoint, test status, next exact action.
- Run before declaring a phase done: format, lint, typecheck, unit tests, integration tests, backend build, migration check.

## Out of scope for MVP (do not build)

Live streaming, virtual gifting, cash wagering or prizes, paid-entry matches, seasonal passes, rewarded ads, custom voice transport, voice recording, multi-instance WebSocket scaling, multiple languages beyond English (keep i18n-ready only).
