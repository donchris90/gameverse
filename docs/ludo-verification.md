# Ludo: what only a phone can verify

Everything below is **UNVERIFIED**. The Ludo screens type-check and lint, their logic is unit-tested (`packages/shared-types/src/ludo-ui.ts`, `packages/game-rules/src/ludo-board.ts`), and the board geometry was drawn to an image once and checked by eye. None of it has run on a device. The mobile app has never run on a device yet at all.

## Before testing

1. Build a development client with the new native modules (`react-native-svg`, `react-native-reanimated`, `react-native-worklets`, `expo-haptics`). An old dev client will crash on import.
2. Apply the migrations through `20261019180000_ludo_lobby` and turn Ludo on for testing: `UPDATE games SET enabled = true WHERE id = 'ludo';` (it ships off until slice 4E).
3. Two or more phones for the multiplayer checks; one is enough for bots.

## Checklist

| #   | Check                                                                                                           | Result |
| --- | --------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | The app starts and the Play tab shows a Ludo card (and does not when Ludo is disabled)                          |        |
| 2   | Practice game with bots, 2/3/4 players: board draws, die rolls, tokens move, game finishes                      |        |
| 3   | Reanimated runs (no "worklets" or babel error at startup); tokens hop square by square                          |        |
| 4   | Tapping a token works on a small phone (tokens are ~24 px on a 360 px screen; hit area is enlarged to 48 px)    |        |
| 5   | A capture sends the token back to base; two tokens on one square are both visible and tappable                  |        |
| 6   | Rolling twice quickly, or on a bad connection, never moves twice (watch the match event count)                  |        |
| 7   | Private table: host creates, guests join with the code, the match starts when full; Start early; Fill with bots |        |
| 8   | Quick match for 3 or 4 players with real phones; the bot offer after 20 s                                       |        |
| 9   | Leave in a 3-4 player game: the others carry on; the leaver can start another game                              |        |
| 10  | Voice with 3-4 phones (see `docs/voice-verification.md`), and the per-player Report/Block buttons               |        |
| 11  | Settings, Game animations: Reduced removes hopping and pulsing; Follow phone matches the OS reduce-motion       |        |
| 12  | TalkBack / VoiceOver read tokens ("Red token 2, on the track, 14 squares from its start") and the status line   |        |

## Frame rate on a low-end Android phone (not measured)

Target: the board stays smooth (no visible stutter) while a token hops, on a phone with about 2 GB of RAM, in a release or preview build (not the dev client, which is slower).

1. Install the preview build. Start a 4-player bot game.
2. Run `adb shell dumpsys gfxinfo com.gameverse.app.dev reset`, play about 20 turns, then `adb shell dumpsys gfxinfo com.gameverse.app.dev`. Record "Janky frames" and the 90th/95th percentile frame time.
3. Repeat with Settings, Game animations, Reduced.
4. Report both results. If full animation is janky, reduce more (fewer simultaneous shared values, no pulse) before launch.

The app turns animations to "reduced" by default on Android 9 and below. That default is a guess, not a measurement.
