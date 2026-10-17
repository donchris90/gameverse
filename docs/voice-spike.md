# Voice spike (Agora) — NOT RUN

Status: **code ready, spike NOT RUN**. No result exists. Nothing about Agora working end to end is verified.

## What is built

- API: `POST /v1/voice/spike/token` (authenticated; body `{ "channel": "spike-<name>" }`). Returns `{ appId, channel, uid, token, expiresAt }`. Returns 404 unless `VOICE_SPIKE_ENABLED=true` (refused by config in staging/production), 503 if Agora credentials are missing. Token is Agora v007, publisher role, TTL `VOICE_TOKEN_TTL_SECONDS`. Tested: token structure, certificate never leaks, per-user uid, channel validation, flag and credential gating (unit + integration, see progress.md).
- Mobile: `app/voice-spike.tsx` (shown only in development builds): sign in with a seeded account, join, mute, leave, with an event log of real SDK callbacks. Typechecks against `react-native-agora` 4.6.4 types and bundles for Android. **Never executed on a device.**
- **Not tested at all:** that Agora accepts the tokens (needs real credentials), audio between devices, reconnect, background behavior. Reconnect has no dedicated UI: test it by toggling airplane mode and reading the log's connection-state lines.

## How to run the spike

1. Create an Agora project with the App Certificate enabled. In `apps/api/.env` set `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, `VOICE_SPIKE_ENABLED=true`.
2. `pnpm --filter @gameverse/api db:seed` (note the printed password), then `start:dev` with the API reachable from the phones (same Wi-Fi LAN IP, or a tunnel). Set `EXPO_PUBLIC_API_URL` for the mobile build. Plain-http LAN URLs need cleartext enabled on Android dev builds.
3. Build a development client on two phones (`eas build --profile development` or `expo run:android`). Sign in as `player1@gameverse.local` on one and `player2@gameverse.local` on the other, join the same `spike-` channel, speak, mute, leave, rejoin, toggle airplane mode.
4. Record the table below. Copy log lines for any failure.

## What the spike must show (from docs/phases.md)

Bare Expo dev build with `react-native-agora`, a backend token endpoint, and two physical phones (one low-end Android) that can join the same channel, mute, leave and reconnect.

## Still needed from the owner

- Agora project App ID and App Certificate (owner must create; never commit).
- Two physical phones and an Expo dev-build pipeline (EAS or local native build). Neither is available in the cloud sandbox.

## Record results here

| Date | Devices (model, OS) | Join | Mute | Leave | Reconnect | Notes |
| ---- | ------------------- | ---- | ---- | ----- | --------- | ----- |
| —    | —                   | —    | —    | —     | —         | —     |

If the spike fails, the owner decides the fallback before Phase 3.
