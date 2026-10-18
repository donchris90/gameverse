# WebSocket and match load test

Tool: **k6 v1.3.0** (`apps/api/loadtest/ws-matches.k6.js`, run by `apps/api/scripts/ws-load.sh`). Idle-connection capacity: `scripts/ws-idle.sh`.

## What it does

Each virtual user is a **pair of signed-in players**, each with a live WebSocket to `/ws`. The pair creates a private room, joins it, presses ready and plays a best-of-3 tic-tac-toe match to the end, then starts another, for the whole step. Moves go over REST exactly as the app sends them; the opponent learns about them over the socket. A player "thinks" 0.4–1.3 s before each move, so a pair produces roughly one move per second. Steps run one after another (pairs: 10, 20, 35, 50 …), separated by 60 s so one step's leftovers do not leak into the next.

Measured per step: socket connect + auth time (`ws_ready_ms`), **event delivery time** (REST move sent → the opponent's socket receives the new match state, `event_delivery_ms`), REST move latency, matches completed or failed, 503 "server busy" retries, unexpected socket closes. The API process's CPU, memory and file descriptors are sampled from `/proc` every 2 s next to PostgreSQL and k6.

Accounts are inserted straight into a scratch database with signed access tokens (`loadtest/prepare-users.mjs`), so the run does not spend its time hashing passwords. Registration cost is a separate thing (≈ 0.5 s of CPU each, see the Phase 4 numbers).

## Environment (read this before quoting any number)

One 2-vCPU, 8 GB cloud container running **everything**: the compiled API (single Node process), PostgreSQL 16, k6, and the sampler. No network latency. Default pool of 10 database connections. Rate limits raised so they do not interfere. So these are **single-machine, shared-CPU numbers**: a lower bound for the API process, not a prediction for any hosting plan. Re-run `scripts/ws-load.sh` on the real instance size before launch. Runs vary; each configuration below was run once or twice.

## Finding: PostgreSQL SERIALIZABLE aborts throttled the whole API (fixed)

First runs collapsed at 75 pairs while the API process used 37 % of one core and the pool had spare connections. 250 of ~300 "server busy" (503) answers came from `POST /matches/:id/moves`. Cause: every match action ran in a SERIALIZABLE transaction. PostgreSQL tracks serializable reads per index page, so unrelated matches whose rows share a page abort each other with "could not serialize", and after ten retries the client gets 503. Proof: the same run with the isolation level switched to READ COMMITTED (experiment only, not kept) finished 75/75 matches with **zero** 503s.

Fix (decision #93): `ready`, tic-tac-toe `moves`, and Ludo `roll` / `token-moves` now run **READ COMMITTED with a compare-and-set on the match row** (`updateMany where version = …`), backed by the unique `(matchId, seq)` and `(matchId, seat, clientActionId)` indexes. Everything that spans owners (creating matches, rematch, leave, timers, the social graph) stays SERIALIZABLE. Tests: all 555 integration tests pass, plus `concurrency-matches.e2e-spec.ts` (12 ranked matches finished at once: every result recorded once, ratings zero-sum per pair, contiguous event logs; one move sent 8 times at once applies once). Mutation check: removing the compare-and-set did **not** fail any test, because the unique indexes catch the same races; that is two independent guards, not a gap, but it means the version check alone is not what the tests prove.

## Results

Event delivery = REST move sent → opponent's socket receives it. "Done" = best-of-3 matches finished inside the 60 s step (matches take about 30–40 s, so ≤ 1 per pair).

**Before** (SERIALIZABLE everywhere), run 2026-10-18 08:50:

| Pairs | Sockets | Done / failed | Delivery median / p95 / max   | Move REST p95 | 503 retries | API CPU (of 1 core) |
| ----: | ------: | ------------: | ----------------------------- | ------------: | ----------: | ------------------: |
|    10 |      20 |        10 / 0 | 27 / 69 / 127 ms              |         75 ms |           1 |                 11% |
|    20 |      40 |        20 / 0 | 24 / 86 / 317 ms              |         92 ms |           7 |                 15% |
|    35 |      70 |        35 / 0 | 29 / 329 / 2231 ms            |        328 ms |          50 |                 34% |
|    50 |     100 |        35 / 0 | 32 / 394 / 2136 ms            |        464 ms |          34 |                 38% |
|    75 |     150 |         0 / 0 | collapsed (no match finished) |       1417 ms |         100 |                 37% |
|   100 |     200 |        0 / 12 | collapsed                     |       3104 ms |         155 |                 51% |

**After** (optimistic match actions), runs 09:23 and 09:43:

| Pairs | Sockets | Done / failed | Delivery median / p95 / max    | Move REST p95 | 503 retries | API CPU (of 1 core) |
| ----: | ------: | ------------: | ------------------------------ | ------------: | ----------: | ------------------: |
|    25 |      50 |        25 / 0 | 29 / 86 / 389 ms               |         95 ms |          12 |                 19% |
|    50 |     100 |        50 / 0 | 39 / 223 / 549 ms              |        236 ms |          31 |                 38% |
|    60 |     120 |        60 / 0 | 38 / 285 / 609 ms              |        297 ms |          44 |                 48% |
|    75 |     150 |        30 / 0 | 27 / 190 / 724 ms              |        445 ms |          48 |                 36% |
|    90 |     180 |         0 / 0 | collapsed (move median 818 ms) |       1082 ms |          69 |                 33% |
|   100 |     200 |       100 / 0 | 193 / 1282 / 1528 ms           |       1393 ms |          56 |                 83% |
|   150 |     300 |       125 / 0 | 297 / 1350 / 1834 ms           |       1481 ms |          69 |                 86% |
|   200 |     400 |         0 / 0 | collapsed                      |       3023 ms |         156 |                 77% |
|   300 |     600 |        0 / 64 | collapsed                      |       4295 ms |         245 |                 86% |

No socket was ever closed unexpectedly in any run. Memory stayed under 500 MB for the API.

## The recorded single-instance ceiling

**Measured ceiling on this machine: about 60–75 concurrent two-player matches (120–150 connected sockets, ≈ 60–75 moves per second) with p95 delivery under 450 ms and no failed matches.** Past about 90 pairs the service degrades sharply and past 100 it stops completing matches. Before the fix the ceiling was about 35–50 pairs and collapse started at 75.

Honest reading of the numbers:

- The 100- and 150-pair rows (the second run) look better than the 90-pair row (the third run). The runs are noisy and the cliff sits between 75 and 100 pairs; do not read the table as a smooth curve.
- At 90 pairs the API used only a third of a core and still stalled, so something other than CPU gives out first. The remaining "server busy" answers are mostly `POST /rooms` and `POST /rooms/join` (SERIALIZABLE, a burst at the start of each step). **Not yet root-caused**; the next step is to profile with `pg_stat_statements` and lock-wait sampling on the real database instance.
- Above 100 pairs the Node process itself approaches one saturated core (83–86 %). Moving past that needs a second instance, which the architecture does not support yet (in-memory sockets, rate limits and matchmaking; decided out of scope for the MVP).

### Idle connections

`scripts/ws-idle.sh`: 6,000 authenticated idle sockets held by one API process, **0 failures, 0 server-side closes**, +141 MB (≈ 24–60 KB per socket, 6,037 file descriptors, limit 20,000). Connecting 100 sockets every 100 ms (≈ 1,000 per second) queued up: auth p50 1.9 s, p95 up to 8 s at the top. That is a reconnect-storm figure (for example after an API restart), not the steady state. Clients now reconnect with jittered backoff (`reconnectDelayMs`, unit-tested; not run on a device); the burst figure above is from the script, which does not jitter.

## Caveats

- The test plays tic-tac-toe. Ludo has more events per match but about the same request rate per player; the Phase 4 Ludo run (10 tables of 4, one machine) is recorded in `phase-4-checkpoint.md`.
- Voice is not part of this test (Agora carries the audio, not our server).
- Everything ran on loopback. Mobile networks add latency and reconnects that this does not model.
- The ceiling is for the API on a shared 2-vCPU machine. Do not quote it as a capacity for hosted plans.
