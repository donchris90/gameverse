# GameVerse Privacy Policy — DRAFT

> **DRAFT for lawyer review. Not legal advice and not yet published.** Fill every `[PLACEHOLDER]`, have a qualified Nigerian data-protection lawyer check it against the Nigeria Data Protection Act 2023 (and any other law that applies where you launch), then bump the terms version in `packages/shared-types/src/constants.ts` (`CURRENT_TERMS_VERSION`, currently `draft-1`). It describes what the code did on 2026-10-18 (Phase 5); update it whenever the product changes.

**Who we are.** [COMPANY LEGAL NAME], [ADDRESS], contact: [PRIVACY EMAIL]. We decide how your data is used (the "controller").

## Bots

Some games let you practise against a computer player. Bots are always labelled "Bot" in the app. A game against a bot is never counted for ratings or leaderboards.

## Who can use GameVerse

You must be at least 16. We ask for your date of birth when you sign up and refuse sign-up under 16. If we learn an account belongs to someone under 16 we close it.

## What we collect and why

| Data                                                                                                                                                                                                        | Why                                                                 | Kept until                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email address, password (stored only as a one-way hash), date of birth                                                                                                                                      | Create and secure your account; enforce the age limit               | You delete your account (email and date of birth are then scrubbed)                                                                                                              |
| Sign-in with Google or Apple: the provider's account id and email                                                                                                                                           | Let you sign in that way                                            | You delete your account                                                                                                                                                          |
| Username, avatar choice, bio                                                                                                                                                                                | Your public profile                                                 | You delete your account                                                                                                                                                          |
| Friends, friend requests, blocks                                                                                                                                                                            | Social features and safety                                          | You delete your account                                                                                                                                                          |
| Chat messages                                                                                                                                                                                               | Deliver and show your conversations; investigate reports            | You delete your account (both sides' copies are removed)                                                                                                                         |
| Privacy settings, muted chats                                                                                                                                                                               | Honour your choices                                                 | You delete your account                                                                                                                                                          |
| Device push token                                                                                                                                                                                           | Send notifications                                                  | Until you sign out, the token is reported invalid, or you delete your account                                                                                                    |
| Online status (live connection)                                                                                                                                                                             | Show friends when you are online, if your settings allow            | Held in memory while connected; not stored                                                                                                                                       |
| Reports you make or that are made about you, including a copy of the reported message and the five messages before it                                                                                       | Keep players safe                                                   | Kept after account deletion (see below)                                                                                                                                          |
| Moderation actions and an audit log of staff actions                                                                                                                                                        | Safety, accountability, disputes                                    | Kept after account deletion (see below)                                                                                                                                          |
| Game activity: matches you play, moves, results, rating, experience points (XP), statistics and leaderboard rank; a record of dice rolls in Ludo                                                            | Run fair games, rank players, prevent cheating, settle disputes     | Match and result records are kept after deletion, linked only to your anonymised account record (see below). Your username and rank are visible to other players on leaderboards |
| Bonus-coin balance and ledger: grants, entry fees, pot payouts and refunds, with the match each belongs to                                                                                                  | Run the free in-app currency and settle matches exactly once; audit | Until you delete your account; settlement records tied to a match are kept with the anonymised match record                                                                      |
| Voice chat usage: that you joined a voice channel in a match, when, for how long, and your mute state                                                                                                       | Run and secure voice, control cost, handle reports                  | Until you delete your account                                                                                                                                                    |
| Crash and error reports (only when we have switched them on): the error, the app/server version, the request id and your account id. We remove emails, tokens, message text and IP addresses before sending | Find and fix bugs                                                   | [RETENTION PERIOD set in the error-reporting tool]                                                                                                                               |
| Technical logs (IP address, request ids, errors)                                                                                                                                                            | Security and fixing problems                                        | [RETENTION PERIOD, e.g. 30 days]                                                                                                                                                 |

We do not sell your data and we show no advertising. **We do not record voice chat.** Voice is optional: you choose to join a channel in a match, and we ask for microphone permission only then. Your voice travels in real time through Agora (see below); nothing is saved by us. If someone reports you for what they heard in voice, we have no recording to review and rely on the reports, usage records and any chat text.

## What we keep after you delete your account

Deleting your account removes your profile, friends, chats and sign-in details and scrubs your email and date of birth. We deliberately keep reports (with their saved message evidence), moderation actions and the audit log, because they protect other players and let us stop people returning after a ban. They are no longer linked to a usable account. Match records, results, ratings and voice-usage records are likewise kept, attached only to the anonymised account record (no name, email or date of birth), so other players' histories and ratings stay correct; you disappear from leaderboards at once. Banned or suspended accounts cannot be deleted until reinstated, so deletion cannot be used to escape a ban.

## Who we share data with (processors)

- [EMAIL PROVIDER, e.g. Resend] — sends our emails.
- Expo / Apple / Google — deliver push notifications (they see the notification text, which never contains your message text).
- [HOSTING PROVIDER] and [DATABASE PROVIDER] — run the service.
- Agora — carries live voice audio between players in a match and issues the temporary access we give you; [AGORA'S OWN RETENTION / REGION TERMS — lawyer to confirm].
- Sentry — receives crash and error reports, only if we switch it on, after we strip emails, tokens and message text. [CONFIRM REGION]
- Google and Apple — if you use their sign-in.
- Authorities — only when the law requires it.

If data leaves Nigeria, we rely on [TRANSFER MECHANISM — lawyer to specify].

## Your rights

You can see and change your profile and privacy settings in the app, and delete your account in Settings (we email a confirmation link). You can also delete your account **without the app** at [WEB ADDRESS]/account-deletion: enter your email and we send a link; opening it and pressing Delete removes your account. You can also ask us at [PRIVACY EMAIL] to access, correct, export or erase your data, to object to or restrict processing, and you can complain to the Nigeria Data Protection Commission. We answer within [30 days].

## Security

Passwords are hashed with Argon2id. Sign-in uses short-lived tokens. Moderator actions are logged in a tamper-resistant audit log. No system is perfectly secure; tell us at [SECURITY EMAIL] if you find a problem. We will notify you and the regulator of a breach as the law requires.

## Changes

We will tell you in the app before material changes take effect. Version: [DATE / VERSION].
