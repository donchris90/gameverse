# Ayo: what only a phone can verify

Everything below is **UNVERIFIED**. The rules, bots, server driver and API are tested (`packages/game-rules/src/ayo.spec.ts`, `apps/api/test/ayo.e2e-spec.ts`) and the screen logic is unit-tested (`packages/shared-types/src/ayo-ui.ts`). The board screen type-checks and lints but has not run on a device.

## Before testing

1. Update the development build's JS (`npx expo start -c --dev-client`).
2. The API must have migration `20261021000000_ayo` applied (a Render redeploy does that).
3. Ayo ships **off**. Turn it on from the admin Games tab (a reason is required) or `UPDATE games SET enabled = true WHERE id = 'ayo';` for local testing.

## Checklist

| #   | Check                                                                                                              | Result |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------ |
| 1   | The Play tab shows "Coming soon" while off and a playable Ayo card once enabled                                    |        |
| 2   | Practice against easy, medium and hard bots: pits draw, tapping your pit sows, the bot answers                     |        |
| 3   | Pits are big enough to tap on a 360 px screen (about 48 px) and the counts are readable                            |        |
| 4   | The sowing replay shows seeds moving pit by pit and then settles on the real board; Reduced animations skips it    |        |
| 5   | A reap at four: the pit empties and "reaped" goes up for the right player (own pit, opponent's pit, last seed)     |        |
| 6   | The opponent reaps a four you made mid-sowing                                                                      |        |
| 7   | A relay: the last seed lands in a pit with seeds and the sowing carries on                                         |        |
| 8   | End of a round: the last eight seeds go to whoever reaps, the banner says so, the next round starts with the loser |        |
| 9   | A player with fewer pits in a later round: lost pits show dashed and sowing skips them                             |        |
| 10  | The match ends when a player has one pit left; the result and final count are right                                |        |
| 11  | With two pits left: "Offer to end the game", the other phone sees Accept/Decline, the bigger total wins            |        |
| 12  | Two phones: play with a friend by room code; quick match; the bot offer after 20 s                                 |        |
| 13  | Let the 20 s clock run out: you lose the match                                                                     |        |
| 14  | Leave: the other player wins; a rematch gives the first move to the other seat                                     |        |
| 15  | Tapping twice quickly or on a bad connection never plays two turns (watch the match event count)                   |        |
| 16  | Players who know Ayo check the rules against how they play it (see `docs/ayo-rules.md`)                            |        |
