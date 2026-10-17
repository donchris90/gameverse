# Phase 2 plan: session framework and tic-tac-toe

Approved to start by the owner on 2026-10-17 (Phase 0 and Phase 1 checkpoints approved; the open Phase 0/1 items in `progress.md` stay open and are still listed there).

## Slices (each ends green: prettier, lint, typecheck, unit, integration, build, smoke:dist)

| Slice | Content                                                                                                                                                                                                            | Main risk                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 2A    | `packages/game-rules`: pure tic-tac-toe (state, action) -> state, win/draw detection, series (best of 3, alternating first player), bot move choosers (easy/medium/hard) as pure functions. Exhaustive tests       | Hard bot must be provably unbeatable (full minimax tested over states) |
| 2B    | Prisma: Game, GameMatch, GameMatchPlayer, GameEvent, GameResult, PlayerRating, PlayerStatistics, PlayerExperience. Session service: states, versioned moves, event log, timers with DB deadlines, results, rematch | Duplicate moves and concurrent writes; timers surviving a restart      |
| 2C ✔  | Matchmaking queue (rating band, widening, 20 s timeout then explicit bot offer, cancel, retry), private room codes, friend invites                                                                                 | Two simultaneous joins must never double-match                         |
| 2D ✔  | Realtime: match state pushed over the existing `/ws`; actions via REST with `clientActionId` + `expectedVersion`; disconnect grace (30 s), reconnect/resume, forfeit                                               | Reconnect restoring exact state                                        |
| 2E ✔  | Labelled bots through the same validator, bot matches, "Bot" in UI and data                                                                                                                                        | Never a silent fake human                                              |
| 2F    | Elo-style rating (seed 1000), XP award (idempotent), per-game leaderboard                                                                                                                                          | Duplicate XP award; rating double-apply                                |
| 2G    | Mobile: game library, lobby, match screen, result screen, rematch, in-match chat; load-test baseline recorded                                                                                                      | Mobile has never run on a device                                       |

## Rules taken from `product-spec.md`

3x3, best of 3, first player alternates each game and on rematch. 20 s turn timer: a timeout loses the game, two consecutive timeouts forfeit the series. Win 1, draw 0.5, loss 0. Match states: waiting, ready, active, completed, cancelled, expired, abandoned.

## Done when (from `phases.md`)

Two clients complete best-of-3; reconnect mid-match restores state; timeout and forfeit work; duplicate move requests are ignored; the client cannot choose the winner; two simultaneous queue joins never double-match; bot matches work; load-test baseline recorded.

## Test plan

Unit: exhaustive rule tests, series logic, bot strength. Integration (real Postgres and HTTP): create/join/move/complete, duplicate move, stale version, wrong player, non-member access, timeout and forfeit, reconnect, concurrent queue joins, rematch, rating and XP idempotency. Mutation checks on the critical paths, as in Phase 1.

## Unverified until a device exists

Everything in 2G on a real phone; push for game invites; WebSocket behaviour on poor mobile networks.
