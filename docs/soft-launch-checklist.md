# Soft-launch checklist (2–3 markets)

Spec §1: soft launch in 2–3 markets first; do not claim worldwide availability until provider, payments, privacy and store requirements are verified per market. **Which markets is the owner's decision**; nothing in the code is market-specific. Suggested shortlist to discuss: Nigeria (home market, NDPA applies), plus one or two English-speaking African markets with similar network conditions, because the app is English-only and the voice and load numbers were never measured on those networks. This is a suggestion, not research.

Mark each line **done**, **owner** (needs you), or **blocked** (needs something external). Nothing below is done by default.

## A. Before any external tester

| #   | Item                                                                                                                                                                                                            | State                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| A1  | Run `docs/ludo-verification.md` on two real phones, including one low-end Android; record frame rate                                                                                                            | owner                                |
| A2  | Voice on two physical devices with real Agora keys: join, mute, leave, reconnect, permission denied, background; log in `docs/voice-verification.md`                                                            | owner, blocked on Agora keys         |
| A3  | Build with EAS: `eas init`, development build with the new native modules (Sentry, Ludo's SVG/Reanimated), then install on both phones                                                                          | owner                                |
| A4  | Run the Maestro flows (`apps/mobile/.maestro/README.md`) on Android and on an iOS simulator; fix what the first run shows                                                                                       | owner (iOS needs macOS)              |
| A5  | Apple and Google sign-in with real credentials                                                                                                                                                                  | owner, blocked on developer accounts |
| A6  | Run `prisma migrate deploy` once on a fresh database (never done here; see `backup-restore.md`)                                                                                                                 | owner or first CI run                |
| A7  | First green CI run on GitHub (no CI run has happened)                                                                                                                                                           | owner                                |
| A8  | Deploy the current API to Render (build command must include `game-rules`), apply the **thirteen** migrations, set env: `TRUST_PROXY=true`, `RESEND_*`, `AGORA_*`, `SENTRY_DSN` (optional), `EXPO_ACCESS_TOKEN` | owner                                |
| A9  | Enable Ludo only after A1 (admin toggle or `UPDATE games SET enabled = true WHERE id = 'ludo'`)                                                                                                                 | owner                                |

## B. Legal and policy (a lawyer must do these)

| #   | Item                                                                                                                                                  | State |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| B1  | Fill and review `docs/legal/privacy-policy.draft.md` and `terms-of-service.draft.md` (Nigerian counsel; add every market chosen)                      | owner |
| B2  | Publish both on a stable https URL; set `EXPO_PUBLIC_PRIVACY_URL`, `EXPO_PUBLIC_TERMS_URL`, `EXPO_PUBLIC_SUPPORT_EMAIL` in the production EAS profile | owner |
| B3  | Bump `CURRENT_TERMS_VERSION` when the final terms are live                                                                                            | owner |
| B4  | Registration with the Nigeria Data Protection Commission as a data controller, if counsel says it applies                                             | owner |
| B5  | Decide the data-transfer mechanism for Render, Resend, Agora, Expo, Sentry (privacy draft placeholder)                                                | owner |
| B6  | Per chosen market: any local rules on minors' data, online games, or chat moderation                                                                  | owner |

## C. Operations

| #   | Item                                                                                                                                                    | State |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| C1  | Name who reads the report queue, hours, and a response target; give them admin accounts (`/admin`)                                                      | owner |
| C2  | Support mailbox exists and is watched; tested end to end                                                                                                | owner |
| C3  | Database backups: confirm the hosting plan's retention, take a manual `pg_dump` before each migration deploy, rehearse one restore on the real provider | owner |
| C4  | Sentry project created, DSNs set, one deliberate test error seen; alert goes to a person                                                                | owner |
| C5  | Render instance size chosen after re-running `scripts/ws-load.sh` on it; write the new ceiling into `docs/load-test.md`                                 | owner |
| C6  | Uptime check on `/health/ready`                                                                                                                         | owner |
| C7  | Agora usage alert and monthly budget cap (voice minutes cost money; usage is logged per user-minute)                                                    | owner |
| C8  | After an API restart every phone reconnects; clients now back off with jitter (unit-tested, device-unverified). Re-measure with the idle-socket script  | open  |

## D. Store submission (see `store-compliance.md`)

| #   | Item                                                                                                           | State              |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------ |
| D1  | Confirm production identifier (`com.gameverse.app`), create both store listings, trademark/name/domain checks  | owner              |
| D2  | `eas build --profile production` for each platform; `eas submit`                                               | owner              |
| D3  | Age-rating, Data safety, privacy-label questionnaires                                                          | owner with counsel |
| D4  | Google Play: data-deletion URL `https://<api host>/account-deletion`; foreground-service declaration and video | owner              |
| D5  | App Review notes: demo accounts, how to see a match, background audio justification                            | owner              |
| D6  | Internal testing track (Play) and TestFlight with 10–20 known people first                                     | owner              |

## E. Launch gates (go / no-go)

Go to a wider audience only when, for each chosen market: A1–A9 are done, B1–B3 are done, C1–C4 are done, a week of the internal group has produced no data-loss or auth bug, and `docs/progress.md` lists no unverified item that touches money, safety or accounts.

## F. What to watch in the first two weeks

- Sentry 500 rate; `/health/ready` failures.
- 503 "server busy" rate on room create/join (known contention; see `load-test.md`).
- Registration failures behind shared mobile-carrier IPs (per-IP limit of 10 per minute).
- Voice join success rate and Agora minutes per daily user.
- Report volume and time-to-action.
- Matches abandoned or timed out, and reconnect success.
