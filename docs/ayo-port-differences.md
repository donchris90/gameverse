# Ayo: RRYDA rules compared with ours (history: all nine points were then adopted, decision #118)

> **Update 2026-10-19:** the owner asked for the exact RRYDA flow, so the Ayo rules were rewritten to RRYDA's (points 1 to 8) and the replay timings are RRYDA's. Only point 9 (three bot levels) stays ours. See `docs/ayo-rules.md`. The text below is the comparison as it was when I wrote it.

You said both Ayo versions have the same rules. Reading the RRYDA code (`backend/src/games/ayo.rules.ts`, "Rryda house rules") against our approved rules (`docs/ayo-rules.md`, decision #109), they agree on the basics but differ in seven places. No Ayo code changes until you pick.

Same in both: 12 pits, 4 seeds each, 48 seeds; sow counter-clockwise; relay when the last seed lands in a pit that already had seeds; a pit that reaches exactly 4 is packed; a mid-sow 4 goes to the pit's owner; a last-seed 4 goes to the sower (either side); the server decides everything; the winner takes the pot.

| #   | Topic                    | Ours (approved, built)                                                                                 | RRYDA                                                                                                         |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 1   | End of a round           | When 8 seeds are left and someone reaps a 4, that player also takes the last 4                         | When 4 or fewer seeds are left after a move, they go to whoever packed the 4 before; board empty also ends it |
| 2   | Next round board         | Players fill up to 6 pits each from their store; lost pits leave the ring; extra seeds stay in reserve | Board is always 12 pits of 4. Pits owned = store / 4 (28 seeds = 7 pits), the opponent gets the rest          |
| 3   | Who starts a round       | The loser of the last round                                                                            | Alternates: A, B, A, B                                                                                        |
| 4   | A player with few pits   | Auto-loss with one pit or none; end-by-agreement offer at two pits                                     | Auto-loss with no pits; with exactly one pit the player may quit or continue (30 s)                           |
| 5   | Long matches             | No cap                                                                                                 | Cap of 30 rounds (more pits wins, equal is a draw), 400 turns a round                                         |
| 6   | Lifting 12 or more seeds | Skips the pit it was lifted from                                                                       | Does not skip                                                                                                 |
| 7   | Turn clock and absence   | 20 s; running out loses the match                                                                      | Server plays the turn for a slow player; 60 s reconnect grace                                                 |
| 8   | A player with no seeds   | Round ends, other player takes everything left                                                         | Their turn is skipped                                                                                         |
| 9   | Bots                     | Easy, Medium, Hard (alpha-beta)                                                                        | One bot: best net gain 75% of the time                                                                        |

My recommendation: take RRYDA's rules for 1 to 5 and 8, because your existing players know them and RRYDA states they are "as played by the product owner". Keep our three bot levels (9). For 6 and 7, use RRYDA's no-skip rule and keep our 20 s clock, but let the server play for a slow player first (the Ludo AI-cover idea) instead of losing at once.
This is a rewrite of the Ayo rules and its tests, not a patch.
