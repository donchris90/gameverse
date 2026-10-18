# Phase 4 checkpoint: Ludo (2026-10-18)

Owner approval is needed before Phase 5. **Ludo is still switched off** in the `games` table. Turning it on is an admin action (or `UPDATE games SET enabled = true WHERE id = 'ludo'`) and should wait for the device checks in `docs/ludo-verification.md`.

## Definition of done (from `docs/phases.md`)

| Item                                                | Status                                                                                                                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rules and fuzz tests pass                           | **Done.** 66 Ludo tests (48 rules incl. fast-check properties, 18 bots), plus 23 board-geometry tests. Mutation checks on the rules: 21/21 caught.                    |
| Full 4-player game completes in an integration test | **Done.** `ludo.e2e-spec.ts`: a 4-human game, a ranked 4-human game, a walk-away game, and a 3-player game against bots all run to completion over the HTTP API.      |
| Invalid moves rejected                              | **Done.** Wrong turn, wrong phase, illegal token, token outside 0-3, a die value sent by the client (400), stale version (409), rate limit (429), non-members (404).  |
| Abandoned seats handled per spec                    | **Done.** Leave, three timeouts in a row, and disconnect: a 2-player game goes to the other player; in 3-4 players the leaver's tokens go and play continues. Tested. |
| Low-end frame rate measured                         | **Not done: needs a device.** Steps and the Reduced-animation fallback are in `docs/ludo-verification.md`. The default for Android 9 and below is a guess.            |

## What was built

- **4A** rules, bots (easy/medium/hard), tests.
- **4B** server: CSPRNG dice with every roll logged, `roll` and `token-moves` actions (idempotent, version-checked), 20 s turn clock, forfeit/timeout/disconnect, bots, rematch with rotating opener, results by placing (N-player Elo for ranked quick matches, XP by place, statistics).
- **4C** lobby: private tables for 2-4 (code, members, host Start, fill with bots, leave), quick match for 2-4, friend invites (two players).
- **4D** mobile: SVG board, animated tokens, die, match screen, Play-tab card, animation setting, per-player voice report/block. **Device-unverified.**
- **4E** load check for Ludo (below) and this report.

## Load check (local, one machine, compiled API, Postgres on the same box)

`node scripts/load-test.mjs --game ludo --pairs 10 --matches 1`: 40 players, 10 tables of 4 playing random full games with a 350 ms pause between a player's actions.

| Run | Queue phase (40 simultaneous 4-player searches) | Games finished | Notes                                                                                          |
| --- | ----------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------- |
| 1   | 40/40 matched in 3.2 s, 0 failures              | **9/10**       | One table failed: `room.join` still got 503 after the script's 4 retries. 14 retries absorbed. |
| 2   | 40/40 matched in 3.8 s, 0 failures              | 10/10          | 3 retries absorbed.                                                                            |

Latency in run 1 (p50 / p95 / p99 ms): `roll` 50 / 318 / 836, `token-moves` 45 / 256 / 583, `match.get` 14 / 39 / 56, `queue.join` 2166 / 3021 / 3148, `room.join` 352 / 2293 / 2521. About 60-78 requests per second.

What this means, honestly:

- Game actions are fast. Joining under a burst is slow: many simultaneous queue joins and room creations/joins contend on SERIALIZABLE transactions, so some get a 503 "server busy" and clients retry. One of 20 tables lost a join this way. The app should retry a 503 on join; it does not yet (the mobile client shows the error). This is the same pattern found in the Phase 2 load test (decision #71); it is not tuned further.
- This is one run on a development machine against a local database, not a production-like test. No Render numbers exist.
- The test uses random play; real games are slower (people think) and so lighter on the server per game.

## Verified in this environment

Prettier clean; `turbo run lint typecheck build test` 22/22; API integration tests **525/525** at slice 4C and re-run at the end of 4E (see `docs/progress.md`); `smoke:dist` boots the compiled API.

## Unverified (needs you or a device)

- Everything on a phone: board rendering, Reanimated/worklets setup, tap targets, haptics, TalkBack, frame rate.
- Voice with 3-4 players (and voice at all: still needs Agora keys and two phones).
- The hand-written migrations (`20261019120000_ludo_matches`, `20261019180000_ludo_lobby`) against a real `prisma migrate deploy`.
- The Render deploy needs the build command to include `game-rules` (it already did for the API) and the new migrations.
- The `react-dom`/`react` peer warning from the new mobile packages.

## Decisions to confirm or change (see `docs/decisions.md` #77-92)

XP by place (quick 40/25/15/10, private 20/12/8/5, bot flat 5); rooms with bots are bot matches (no rating, no stats); friend invites stay two-player; bigger tables use a room code.

## Next

Phase 5 only after your approval. Suggested order before it: run the device checklist, enable Ludo, and fix the join-retry in the mobile client.
