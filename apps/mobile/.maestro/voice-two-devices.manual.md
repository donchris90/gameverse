# Voice join/leave: two physical devices (manual run, not part of config.yaml)

Maestro drives one device per run, and voice needs real Agora credentials and two phones, so this is
a procedure plus one flow per device (`voice-device.yaml`). Cross-device audio itself is judged by
ear and logged in `docs/voice-verification.md`.

1. API with real `AGORA_APP_ID` / `AGORA_APP_CERTIFICATE`, `VOICE_PROVIDER=agora`.
2. Create two accounts and a live private match between them (any REST client or the app).
3. Phone A: `maestro --device <serialA> test -e EMAIL=a@... -e PASSWORD=... .maestro/voice-device.yaml`
4. Phone B: the same with `--device <serialB>` and B's credentials, at the same time.
5. Both flows join voice, assert the participant list, mute, unmute, leave. Listen for audio both ways
   in between (pause the flow with `--continuous` or run the steps by hand).
