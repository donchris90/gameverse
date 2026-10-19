# Ayo: what only a phone can verify

Everything below is **UNVERIFIED**. The rules, bots, server driver and API are tested (`packages/game-rules/src/ayo.spec.ts`, `apps/api/test/ayo.e2e-spec.ts`; rewritten for the RRYDA rules, decision #119) and the screen logic is unit-tested (`packages/shared-types/src/ayo-ui.ts`). The board screen type-checks and lints but has not run on a device.

## Before testing

1. Update the development build's JS (`npx expo start -c --dev-client`).
2. The API must have migration `20261021000000_ayo` applied (a Render redeploy does that).
3. Ayo ships **off**. Turn it on from the admin Games tab (a reason is required) or `UPDATE games SET enabled = true WHERE id = 'ayo';` for local testing.

## Checklist

| #   | Check                                                                                                                                                                                              | Result |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | The Play tab shows "Coming soon" while off and a playable Ayo card once enabled                                                                                                                    |        |
| 2   | Practice against easy, medium and hard bots: pits draw, tapping your pit sows, the bot answers                                                                                                     |        |
| 3   | Pits are big enough to tap on a 360 px screen (about 48 px) and the counts are readable                                                                                                            |        |
| 4   | **Replay speed:** every move, yours and theirs, is shown seed by seed. Can you follow where each seed goes? Say if it is still too fast (it uses RRYDA's timings; they are in one place to change) |        |
| 5   | The seeds-in-hand counter goes down as you watch, the pit being sown into is lit and the pits already sown into are ringed                                                                         |        |
| 6   | A pit that reaches four: it empties, the line over the board says who packed it, the packed count goes up for the right player (own pit mid-sow, opponent's pit mid-sow, last seed)                |        |
| 7   | A relay: the last seed lands in a pit with seeds and the sowing carries on                                                                                                                         |        |
| 8   | Two moves arriving close together (a bot answering at once) are shown one after the other, never mixed up                                                                                          |        |
| 9   | End of a round (four or fewer seeds left): the last seeds go to whoever packed last, "Round 2" shows for about 3 s, the board refills with 12 pits of four, and the other player starts            |        |
| 10  | Round 2 and later: the bowls with your colour are yours (7 and 5 after 28 v 20), tapping an opponent's bowl does nothing                                                                           |        |
| 11  | A player who starts a round with one pit sees "Keep playing / Quit (you lose)"; the other phone sees "choosing…"; nobody can tap a pit until they answer; 30 s with no answer means it continues   |        |
| 12  | A player with no pit left loses; after round 30 the player with more pits wins                                                                                                                     |        |
| 13  | Two phones: play with a friend by room code; quick match; the bot offer after 20 s                                                                                                                 |        |
| 14  | Let the 20 s clock run out: the server plays a pit for you; after three in a row you lose                                                                                                          |        |
| 15  | Close the app mid-match: you have a minute to come back before you lose                                                                                                                            |        |
| 16  | The 20 s clock starts only after the move has been shown (watch the timer on a long move)                                                                                                          |        |
| 17  | Leave: the other player wins; a rematch gives the first move to the other seat                                                                                                                     |        |
| 18  | Tapping twice quickly or on a bad connection never plays two turns (watch the match event count)                                                                                                   |        |
| 19  | Players who know Ayo check the rules against how they play it (see `docs/ayo-rules.md`)                                                                                                            |        |
