# Draughts: what only a phone can verify

Everything below is **UNVERIFIED**. The rules, bots, server driver and API are tested (`packages/game-rules/src/draughts.spec.ts`, `apps/api/test/draughts.e2e-spec.ts`), and the screen logic is unit-tested (`packages/shared-types/src/draughts-ui.ts`). The board screen type-checks and lints but has not run on a device.

## Before testing

1. Rebuild or update the development build so it has the current JS (`npx expo start -c --dev-client`).
2. The API must have the migration `20261020000000_draughts` applied (Render redeploy runs it).
3. Draughts ships **off**. Turn it on from the admin Games tab (a reason is required), or `UPDATE games SET enabled = true WHERE id = 'draughts';` for local testing.
4. One phone is enough for bots; two for the multiplayer checks.

## Checklist

| #   | Check                                                                                                   | Result |
| --- | ------------------------------------------------------------------------------------------------------- | ------ |
| 1   | The Play tab shows "Coming soon" while off and a playable Draughts card once enabled                    |        |
| 2   | Practice game against easy, medium and hard bots: board draws, pieces move, game finishes               |        |
| 3   | Tapping a piece then a square works on a small phone; squares are about 40 px on a 360 px screen        |        |
| 4   | A forced capture: you cannot make a plain move, the status says "You must capture"                      |        |
| 5   | A multi-jump: tap the piece, then each landing square in turn; the move is sent after the last one      |        |
| 6   | Crowning: a man reaching the far row becomes a king (gold ring) and a capture that crowns ends the turn |        |
| 7   | The second player sees the board turned round, with their own pieces at the bottom                      |        |
| 8   | Play with a friend: host creates a room, a friend joins by code, both press Ready, the match starts     |        |
| 9   | Quick match with two phones; the bot offer after 20 s                                                   |        |
| 10  | Let the 20 s clock run out: you lose the game                                                           |        |
| 11  | Leave in a match: the other player wins; a rematch gives the first move to the other seat               |        |
| 12  | Tapping twice quickly or on a bad connection never plays two moves (watch the match event count)        |        |
| 13  | Voice, chat and the Report/Block buttons work in a Draughts match (see `docs/voice-verification.md`)    |        |
| 14  | Colours: the two sides and the board can be told apart in sunlight and with colour-blind simulation     |        |
