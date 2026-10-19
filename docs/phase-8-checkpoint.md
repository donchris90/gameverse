# Phase 8 checkpoint: bonus coins and the RRYDA game port

Date: 2026-10-19. Status: **built and verified on the server side; nothing has been seen on a phone.** Owner approval needed before Whot (6D) or the ads plan (7A to 7D) restarts.

## What exists

| Slice | Result                                                                                                                                        | Commit      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 8A    | Bonus-coin wallet: ledger, starter grant, daily check-in, level-up reward, admin grant, no overdraft, idempotent                              | 016c508     |
| 8B    | Entry fees (0, 50, 100, 250, 500) taken when a match starts, pot paid once, refunds, `paidEntry` kill switch, fee confirmation for rooms      | ca8c406     |
| 8C    | Tic-tac-toe: RRYDA Easy and Medium bots, single game or best of 3, new board look                                                             | aa639f0     |
| 8D    | Ludo: no blocks, ends at two finishers, 4-player pot two thirds / one third, labelled AI cover with Take back control, RRYDA hard-bot weights | fa7a7c8     |
| 8E    | Ayo: owner chose to keep our rules; fees and pots tested, coin line on screen                                                                 | bdaa136     |
| 8F    | Paid load test with a coin-total check, bonus-coin Maestro flow, store-compliance section 9, terms and privacy drafts updated, catalogue text | this commit |

## Verified (real output in `docs/progress.md` and `docs/load-test.md`)

- Turbo gate (lint, typecheck, build, unit tests): 22 of 22 tasks.
- Integration suite: 651 of 651 (two clean full runs after 8F; earlier full runs hit the flakes below).
- Paid load: tic-tac-toe 40 of 40 matches and Ludo 5 of 5, coin totals unchanged.

## Not verified

- Every mobile screen added or changed in Phase 8 (coin banner, fee picker, board looks, Take back control, AI labels, Ayo coin line) has never run on a phone. The Maestro flows, including the new `04-bonus-coins.yaml`, have never run.
- The RRYDA visual look for Ludo and Ayo (board art, dice, seed animation) is not ported. Only tic-tac-toe got its new look. Ludo and Ayo look as they did before Phase 8.
- Store acceptance of virtual-currency entry fees; the lawyer has not seen the new terms clause or the store-compliance section 9.
- Known flakes, each seen once and not reproduced alone: `matches-bot ... ends a running search, but refuses while a room is open`; `matches-bot ... answers a human move exactly once` (a likely test cause was fixed); `lobby ... a player cannot be queued and matched at the same time as joining a room` (a 422); `security ... conversations: a stranger cannot read...` (message not captured). The final two full runs were clean: 651 of 651.

## Owner actions

1. Redeploy the API on Render so migrations `entry_fees`, `best_of` and `ludo_ai_cover` run. Nothing here deployed anything.
2. Install a fresh dev build and try: claim daily coins, a paid tic-tac-toe room with a friend, a Ludo table with a quiet player (watch the AI cover and Take back control), an Ayo paid match. Send back screenshots or the first thing that looks wrong.
3. Have the lawyer read the terms clause 6 (bonus coins) and `docs/store-compliance.md` section 9.
4. Decide whether the RRYDA Ludo and Ayo visuals are worth a dedicated art slice now or after you have played the current versions.
