# Ads plan (plan only, not started)

Owner decision, 2026-10-18: GameVerse will carry ads. Revenue is otherwise nil until v1.2 (cosmetics shop, GameVerse Plus). Nothing here is built. Rewarded ads, paid entry, wagering and gifting stay out of scope (CLAUDE.md).

## Scope (defaults, owner can change)

| Item              | Default                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| Network           | Google AdMob via `react-native-google-mobile-ads` (needs the dev build, not Expo Go)                |
| Formats           | Banner on Play tab and game screens; one interstitial after a finished match (never during a match) |
| Frequency cap     | Interstitial at most once every 3 finished matches and not within 3 minutes of the last one         |
| Never show ads on | Sign-in, onboarding, settings/delete account, reports, voice rooms, mid-match, reconnect screens    |
| Rewarded ads      | Out of scope (CLAUDE.md)                                                                            |
| Kill switch       | Server config flag `adsEnabled` (admin can turn off, audited, like the game switch)                 |
| Ad-free           | Plus subscription (v1.2) removes ads; entitlement checked on the server                             |

## Slices

- 7A Config and consent: `GET /v1/config` returns `adsEnabled`; admin toggle with audit; consent flow (Google UMP) before the first ad request; no ads until consent is resolved.
- 7B Mobile ads module: init after consent, test ad unit IDs in dev and preview, real IDs only in production env; banner component; interstitial manager with the frequency cap. Failure to load shows nothing, never a blank box or fake ad.
- 7C Placement and tests: placements above; unit tests for the cap logic and the never-show screens; API tests for the flag and its audit rows.
- 7D Compliance: store-compliance.md (Play Data safety, Apple privacy labels, ATT prompt on iOS if the SDK uses the ad ID), privacy policy update, age gate is already 16+ so ads are non-child-directed. Update `docs/legal`.

## Risks

- Unverified until a real AdMob account, app ids and a real device show a test ad, then a live ad. Labelled unverified until then.
- Ad revenue in Nigeria is low per user (low eCPM). Treat this as a start, not the business model.
- Invalid traffic: never ask players to tap ads, never place ads next to buttons. Policy breach can ban the AdMob account.
- Ads add start-up cost and a crash surface (the SDK pulls in more Android libraries; re-check the R8 and WorkManager rules after adding it).
- Interstitials hurt retention if too frequent; the cap above is the starting value, to be tuned from analytics.

## Needed from the owner

1. An AdMob account (Android and iOS app entries) and the app ids and ad unit ids. Do not paste them in chat or code; they go in EAS env.
2. Approval of this plan, and whether it goes before or after Phase 6 (more games).
