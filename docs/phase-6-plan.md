# Phase 6 plan: more games (Draughts, Ayo, Whot)

Requested by the owner on 2026-10-18. **Status: plan only, nothing built. Needs the owner's approval, and the rules decisions below, before slice 6A starts.** Each game ships switched off and is turned on from the admin Games tab after the owner's device check (decision #104).

## What exists, and what that means for the plan

- Rules live in `packages/game-rules` as pure functions (tic-tac-toe, series, Ludo). Bots go through the same validators as humans.
- The server side is not game-neutral yet. `apps/api/src/matches/matches.service.ts` is 1,118 lines and branches on `gameId === 'ludo'` in several places; Ludo was bolted beside tic-tac-toe through `ludo-driver.ts`. Adding three more games by adding more branches would make it worse and riskier.
- Rooms, queue, bots, rematch, timers, results, ratings, leaderboards and the admin switch already work per `gameId`.
- The mobile app has one board screen per game (`src/ludo/*`, the tic-tac-toe match screen) and the new games home (`GAME_INFO`).
- Match views are built per viewer (`match.view.ts`), which Whot's hidden hands need.

## Slices

| Slice | What                                                                                                                                                                                                                                                                                                                                                                            | Size                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 6A    | **Game driver interface.** One small interface (create state, legal actions, apply action, whose turn, result, per-viewer view, timeout rule) that tic-tac-toe and Ludo implement. `matches.service.ts` calls the driver instead of branching on game ids. **No behaviour change**: the existing 564 integration tests and the Ludo/tic-tac-toe unit tests must pass untouched. | medium, risky, necessary |
| 6B    | **Draughts.** Rules doc for approval, then `game-rules` (moves, forced captures, kings, draws), property/fuzz tests, bots, server driver, migration (row inserted disabled), mobile board and screen, integration tests (full game, illegal move, duplicate move, reconnect, timeout, rematch).                                                                                 | large                    |
| 6C    | **Ayo.** Same shape. Perfect information, small state (pits and seeds), so the cheapest to test.                                                                                                                                                                                                                                                                                | medium                   |
| 6D    | **Whot.** Same shape plus **hidden information**: deck order and each hand stay on the server; the event log, match view, WebSocket events, rematch and spectating-by-id must never expose another player's cards; draw randomness comes from the server's CSPRNG and is logged for audit only. Card art drawn with SVG.                                                        | largest                  |
| 6E    | Cross-cutting: catalogue entries and artwork for the games home, per-game ratings and leaderboards, load check with the new move mix, Maestro flows, docs, checkpoint report.                                                                                                                                                                                                   | small                    |

Order: 6A, then Draughts (closest to tic-tac-toe; proves the driver), then Ayo, then Whot last (hidden information is the highest-risk part, so it comes when the driver is proven).

## Done means, per game

1. Rules doc approved by the owner (like `ludo-rules.md`).
2. Rules are pure and deterministic (RNG injected), with unit and property/fuzz tests; **the client never sends a result, a card or a winner**.
3. Bots (easy, medium, hard) use the same validators and are labelled "Bot".
4. Integration tests: full game to the end, illegal and out-of-turn moves refused, duplicate move is a no-op, reconnect, timeout and forfeit, rematch, results recorded once. For Whot also: a test that no other player's hand appears in any response, event or socket message.
5. Mutation check on the key rule (for example "a forced capture can be skipped").
6. Migration adds the game switched off. Mobile screen written and bundled. **Device behaviour is unverified until the owner plays it on a phone**; the owner turns it on from the admin.

## Decisions I need from the owner before the rules docs

These are house-rule choices; I will draft each rules doc with the default shown and you approve or change it.

| Game     | Question                 | Proposed default                                                                                                                                                                                                                                                                                                                                                       |
| -------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draughts | Board and rules variant  | 8x8 board, men move forward, **captures are compulsory**, kings move one square (English rules). The 10x10 international variant with flying kings is a bigger build. Which do Nigerian players expect?                                                                                                                                                                |
| Ayo      | Variant and capture rule | Ayo Olopon: 2 rows of 6 pits, 4 seeds each (48), counter-clockwise sowing, capture 2 or 3 seeds in the opponent's row, a player must give the opponent a move when possible.                                                                                                                                                                                           |
| Whot     | Which house rules        | 54-card deck (circle, triangle, cross, square, star; numbers 1 to 14 plus the 20s). Specials: 1 hold on, 2 pick two, 5 pick three, 8 suspension, 14 general market, 20 Whot (choose a shape). Whot rules differ a lot between regions and friend groups, so I need yours: which specials, whether specials can be stacked, and whether a "last card" call is required. |

## Risks

- **Rules disputes.** Players argue about house rules; the approved rules doc is the single source, and the app shows a short rules sheet per game.
- **6A regressions** in the two live games. Mitigation: no behaviour change, every existing test green before and after, and the refactor lands alone.
- **Whot information leaks.** Mitigation: per-viewer views only, a dedicated no-leak test over every read path.
- **Low-end phones** (the owner's test phone has about 2 GB RAM): card and board rendering stay simple SVG and views; animations respect the existing Game animations setting.
- **Device verification** is the owner's: nothing here claims a game works on a phone until it has been played on one.

## Not in this phase

More than these three games, tournaments, spectating, money, or any change to ratings maths.
