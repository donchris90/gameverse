# Maestro flows

**Status: written, never run.** There is no emulator, simulator or phone in the workspace where these were
authored, and the mobile app itself has never run on a device. Treat the first run as debugging the flows.
Selectors use the visible text / accessibility labels in the current screens (Button labels, `TextField`
labels, "Cell N, empty"); if copy changes, change the flow.

| Flow                                                | What it covers                                                  | Needs                             |
| --------------------------------------------------- | --------------------------------------------------------------- | --------------------------------- |
| `01-auth.yaml`                                      | register, username, sign out, sign in                           | a build pointing at a scratch API |
| `02-bot-match.yaml`                                 | register, practice match vs a labelled bot to the result screen | same                              |
| `03-friends-chat.yaml`                              | friend request accept, chat send and receive over the socket    | same, plus `-e API_URL=...`       |
| `04-bonus-coins.yaml`                               | starter balance, daily claim, free bot match                    | same                              |
| `voice-device.yaml` + `voice-two-devices.manual.md` | voice join / mute / leave                                       | two phones, real Agora keys       |

Not covered by Maestro: Apple and Google sign-in (need real provider accounts), email verification
links (need the inbox), push notifications.

## Running

```
# Android emulator or device with the preview/dev build installed
maestro test -e API_URL=https://<scratch api> .maestro/01-auth.yaml
maestro test -e API_URL=https://<scratch api> .maestro/02-bot-match.yaml
maestro test -e API_URL=https://<scratch api> .maestro/03-friends-chat.yaml
maestro test -e API_URL=https://<scratch api> .maestro/04-bonus-coins.yaml
```

Point the build at a **scratch** API: the flows register throwaway accounts. iOS needs a simulator build
(`eas build --profile development-simulator --platform ios`) and macOS.
