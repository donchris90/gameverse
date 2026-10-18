# Phase 8 plan: bonus coins and the RRYDA game port (Ludo, Tic-tac-toe, Ayo)

Requested by the owner on 2026-10-18 (decisions #110 to #113). **Status: plan only, nothing built. It needs the owner's approval, and approval of the Ayo rule changes below, before slice 8A starts.** Every slice ships switched off where a game is involved and is turned on from the admin Games tab after the owner's device check (decision #104).

## What the owner asked for

- Keep the money tie from RRYDA, but as **bonus coins only**: free, not withdrawable (and, by the same logic, not purchasable or transferable).
- Free sources only. Bonus coins are used for entry fees and pots only.
- Port Ludo, Tic-tac-toe and Ayo from the RRYDA backup: backend, features and visuals.

## What the RRYDA backup contains (read-only audit, nothing copied yet)

| Part                  | RRYDA files                                                                                | Use in GameVerse                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tic-tac-toe ("Ox")    | `games/ox/ox.rules.ts`, `ox.engine.ts`, `ox.service.ts`, mobile `OxScreen.tsx`             | Rules and bots port. EASY, MEDIUM and HARD bots, HARD is perfect play. Series of 1 or 3.                                                                                                                                      |
| Ludo                  | `ludo.rules.ts` (378 lines), `ludo.service.ts` (1,201), mobile `LudoScreen.tsx` + `ludo/*` | Rules, the smarter AI (captures, safe squares, danger scoring), autopilot when a human is away, disconnect takeover and reconnect grace port. The service does not (it is tied to RRYDA wallets, parties and spectator bets). |
| Ayo                   | `ayo.rules.ts` (332), `ayo.service.ts` (877), mobile `AyoScreen.tsx`, `ayo/*`              | Rules, move-event replay and bots port after owner approval. The service does not.                                                                                                                                            |
| Wallet and ledger     | `economy/wallet.service.ts`, `game-payout.ts`                                              | **Idea ports, code is rewritten**: only a BONUS wallet and an idempotent ledger. RRYDA's coin wallet, purchases, gifts, creator payouts, KYC, withdrawals and spectator bets are left out.                                    |
| Not ported on purpose | spectator bets, parties, payouts, crash/spin/sum-dice/water-sort                           | Out of scope (decision #110). The backup was only opened to read; none of its credentials, data or live config come over (CLAUDE.md: isolation).                                                                              |

## How the port is done (and why not a straight copy)

GameVerse already has the structure RRYDA lacks: pure rules in `packages/game-rules` with injected RNG, a `GameDriver` per game, an action id on every move, stale-version refusal and a per-viewer match view. RRYDA's rules call `randomInt` inside the rules and its services mix in money, parties and spectators. So each game is **re-implemented on GameVerse's structure from RRYDA's rules**, with RRYDA's rule specs used as a source of test cases. Visuals are redrawn in `react-native-svg` and Reanimated, which the app already has.

Two dependencies the RRYDA screens use are **not** in the GameVerse app: `expo-linear-gradient` (a native module, so adding it forces a new dev-client build) and `socket.io-client`/`@tanstack/react-query`. The plan avoids all three: gradients are drawn with SVG, and the existing realtime and `useMatch` stay.

## Slices

| Slice | What                                                                                                                                                                                                                                                                                                                                                                                        | Size   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 8A    | **Bonus-coin ledger.** Migration (`Wallet`, `LedgerEntry`, hand-written SQL), wallet service (credit, debit, balance never below zero, unique idempotency key), starter grant, daily check-in, level-up reward, admin grant with audit log, balance shown in the app. Tests: concurrency (two debits at once), duplicate key is a no-op, no negative balance, nothing can leave the wallet. | medium |
| 8B    | **Entry and pot in the match flow.** Entry tiers per game from the admin, entry taken in the transaction that starts a match, pot paid once in the transaction that completes it, full refund on cancel, expiry or abandon before the first move, bot practice free. Tests: double settlement impossible, short balance refused, refund paths, restart mid-match, draw.                     | medium |
| 8C    | **Tic-tac-toe port.** Rules and three bot levels from `ox.rules.ts`, series of 1 or 3, RRYDA screen look redrawn. GameVerse's tic-tac-toe already has a series; this slice adds the bot behaviour and the visuals and keeps the existing 595-test suite green.                                                                                                                              | small  |
| 8D    | **Ludo port.** Add RRYDA's AI scoring, autopilot, disconnect takeover and 2-player opposite corners where they differ from `docs/ludo-rules.md`; redraw the board, dice and screen. Any rule that differs from the approved Ludo rules is listed for approval first.                                                                                                                        | large  |
| 8E    | **Ayo port.** New `docs/ayo-rules.md` (below), rules, replay events, bots, driver, screen. The 18 Ayo integration tests and the Ayo unit tests are rewritten for the new rules (rules changed, so tests change; no test is skipped or loosened).                                                                                                                                            | large  |
| 8F    | Catalogue and artwork, per-game ratings, load check with entry/pot traffic, Maestro flows, privacy and store-policy notes, checkpoint report.                                                                                                                                                                                                                                               | small  |

Order: 8A, 8B (nothing is playable for coins until both are done), then 8C, 8D, 8E.

## Defaults I chose (recorded in decisions #111 and #112, change any of them)

- Winner takes the whole pot, no house cut. A draw refunds everyone. Bot matches cost and pay nothing.
- Ludo with 3 or 4 players: first to finish takes the pot (RRYDA's Ludo payout splits it differently; I will read `ludo-payout.ts` and list the difference when I start 8D rather than guess now).
- Earning: one starter grant, a daily check-in, a small reward per level. Amounts are admin settings; I will propose numbers when 8A starts, since the right size depends on the entry tiers.
- No purchases, no referrals, no rewarded ads.

## Ayo: what changes if you approve the RRYDA rules

The GameVerse Ayo you approved today and the RRYDA Ayo are different games in the details. Replacing it means these change:

| Point                   | GameVerse Ayo (approved today, decision #109)                                     | RRYDA Ayo (from `ayo.rules.ts`)                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| End of a round          | When 8 seeds are left, whoever reaps a four takes all 8                           | When only the last 4 seeds are left, they go to the player who received the previous four                                                   |
| Pits for the next round | Each player refills up to 6 pits from their store, so never more than 6           | One pit per 4 seeds won, so a player can own 7 and the other 5                                                                              |
| Who starts a round      | The loser of the round                                                            | The starter alternates every round                                                                                                          |
| End of the match        | A player can fill one pit or none, or both agree when a player has exactly 2 pits | A player with no pits loses; a player starting a round with exactly one pit may quit or continue; the owner's other pit rules are different |
| Safety limits           | None (flagged to you earlier: matches can run very long)                          | At most 400 turns per round and 30 rounds, then whoever owns more pits wins; sowing capped at 2,000 seeds                                   |
| Seed in hand lift rule  | A lift of 12 or more seeds skips its origin pit                                   | Not in the RRYDA rules file                                                                                                                 |
| Money                   | None                                                                              | Entry fee and prize pool (becomes bonus coins here)                                                                                         |

Both games reap on four and relay-sow, so the basic move is the same. The safety limits are an advantage of the RRYDA version: they solve the very long matches I flagged.

**Please confirm one of:** (1) use the RRYDA Ayo rules as written, (2) use the RRYDA rules but keep one or more GameVerse points from the table, or (3) keep the GameVerse Ayo and port only RRYDA's visuals.

## Risks

- **Store policy.** Google Play and Apple review games where players stake virtual currency. With no purchase and no cash-out the risk is lower, but it is not zero. The store-compliance notes (`docs/store-compliance.md`) get an entry in 8F, and any later idea of selling coins must come back to the owner.
- **Balances are money-like.** Ledger bugs are the main risk, so 8A and 8B come first, with concurrency and idempotency tests, before any game can charge an entry.
- **Rule drift.** RRYDA code is not proven here. Its specs are used as test cases, but nothing counts as verified until it passes in GameVerse's suite and on a device.
- **Existing matches.** The games are switched off, so no live match exists to migrate. New state shapes are safe.
- **Test changes.** The Ayo tests change only because the rules change, and the plan lists exactly which (CLAUDE.md rule 4 stays in force).

## Done means

1. Rules documents approved by the owner for every game that changes.
2. Server decides everything; the client never sends a result, a score, a coin amount or a winner.
3. Ledger tests pass: no negative balance, no double payout, no double refund, nothing leaves the bonus wallet.
4. Full gate and integration suite green; device checklist written per game; each game switched on only by the owner.
