# GameVerse Privacy Policy — DRAFT

> **DRAFT for lawyer review. Not legal advice and not yet published.** Fill every `[PLACEHOLDER]`, have a qualified Nigerian data-protection lawyer check it against the Nigeria Data Protection Act 2023 (and any other law that applies where you launch), then bump the terms version in `packages/shared-types/src/constants.ts` (`CURRENT_TERMS_VERSION`, currently `draft-1`). It describes what the code did on 2026-10-17; update it whenever the product changes.

**Who we are.** [COMPANY LEGAL NAME], [ADDRESS], contact: [PRIVACY EMAIL]. We decide how your data is used (the "controller").

## Who can use GameVerse

You must be at least 16. We ask for your date of birth when you sign up and refuse sign-up under 16. If we learn an account belongs to someone under 16 we close it.

## What we collect and why

| Data                                                                                                                  | Why                                                      | Kept until                                                                    |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Email address, password (stored only as a one-way hash), date of birth                                                | Create and secure your account; enforce the age limit    | You delete your account (email and date of birth are then scrubbed)           |
| Sign-in with Google or Apple: the provider's account id and email                                                     | Let you sign in that way                                 | You delete your account                                                       |
| Username, avatar choice, bio                                                                                          | Your public profile                                      | You delete your account                                                       |
| Friends, friend requests, blocks                                                                                      | Social features and safety                               | You delete your account                                                       |
| Chat messages                                                                                                         | Deliver and show your conversations; investigate reports | You delete your account (both sides' copies are removed)                      |
| Privacy settings, muted chats                                                                                         | Honour your choices                                      | You delete your account                                                       |
| Device push token                                                                                                     | Send notifications                                       | Until you sign out, the token is reported invalid, or you delete your account |
| Online status (live connection)                                                                                       | Show friends when you are online, if your settings allow | Held in memory while connected; not stored                                    |
| Reports you make or that are made about you, including a copy of the reported message and the five messages before it | Keep players safe                                        | Kept after account deletion (see below)                                       |
| Moderation actions and an audit log of staff actions                                                                  | Safety, accountability, disputes                         | Kept after account deletion (see below)                                       |
| Technical logs (IP address, request ids, errors)                                                                      | Security and fixing problems                             | [RETENTION PERIOD, e.g. 30 days]                                              |

We do not sell your data. We do not record voice chat. [Voice: describe when voice ships.]

## What we keep after you delete your account

Deleting your account removes your profile, friends, chats and sign-in details and scrubs your email and date of birth. We deliberately keep reports (with their saved message evidence), moderation actions and the audit log, because they protect other players and let us stop people returning after a ban. They are no longer linked to a usable account. Banned or suspended accounts cannot be deleted until reinstated, so deletion cannot be used to escape a ban.

## Who we share data with (processors)

- [EMAIL PROVIDER, e.g. Resend] — sends our emails.
- Expo / Apple / Google — deliver push notifications (they see the notification text, which never contains your message text).
- [HOSTING PROVIDER] and [DATABASE PROVIDER] — run the service.
- Agora — real-time voice, when voice is released.
- Google and Apple — if you use their sign-in.
- Authorities — only when the law requires it.

If data leaves Nigeria, we rely on [TRANSFER MECHANISM — lawyer to specify].

## Your rights

You can see and change your profile and privacy settings in the app, and delete your account in Settings (we email a confirmation link). You can also ask us at [PRIVACY EMAIL] to access, correct, export or erase your data, to object to or restrict processing, and you can complain to the Nigeria Data Protection Commission. We answer within [30 days].

## Security

Passwords are hashed with Argon2id. Sign-in uses short-lived tokens. Moderator actions are logged in a tamper-resistant audit log. No system is perfectly secure; tell us at [SECURITY EMAIL] if you find a problem. We will notify you and the regulator of a breach as the law requires.

## Changes

We will tell you in the app before material changes take effect. Version: [DATE / VERSION].
