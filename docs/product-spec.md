# GameVerse — Product Spec (MVP-focused)

Tagline: "Play together. Make friends. Find your people."
Working name: GameVerse. Trademark, domain, app-store and social-handle checks are required before launch. Do not present the name as available until verified.

## 1. Locked decisions

| Area            | Decision                                                                                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Minimum age     | 16+. Age gate at signup (date of birth), blocked if under 16, no data retained for blocked attempts beyond what abuse prevention needs. Store age rating set accordingly. Legal review required per market (Nigeria NDPA, EU/UK, US). |
| Voice provider  | Agora RTC via `react-native-agora`, Expo dev build (not Expo Go). Thin `VoiceProvider` interface with a fake implementation for tests.                                                                                                |
| Auth            | Own NestJS auth: email + password (argon2), short-lived JWT access tokens, rotating refresh tokens with revocation. Sign in with Apple and Google. Email verification and password reset.                                             |
| Code reuse      | Shared internal packages from prior work allowed (auth patterns, WS gateway, webhook idempotency). Separate DB, credentials, accounts.                                                                                                |
| Stack           | pnpm + Turborepo, NestJS, Prisma, PostgreSQL, Expo Router, TanStack Query, Zustand. Redis deferred. Admin on Refine. E2E on Maestro.                                                                                                  |
| Game rendering  | Reanimated + SVG for boards. Evaluate Skia only if profiling on a low-end Android shows a need.                                                                                                                                       |
| Launch strategy | Soft launch in 2-3 markets first. Do not claim worldwide availability until provider, payments, privacy and store requirements are verified per market.                                                                               |

## 2. MVP scope (v1.0)

In:

- Onboarding, auth, profile, avatar (free set), username uniqueness
- Friends: request, accept, reject, remove, search, online status (privacy-aware)
- 1:1 text chat with history, read state, mute, block, report; server-side text filter
- Games: Tic-tac-toe (first), Ludo (second). Quick match, private room code, invite friend, rematch, reconnect, labelled bots
- Agora voice inside matches and private rooms: opt-in, mute, leave, reconnect, speaker indicator, report/block
- Block / report / ban; minimal admin (user lookup, report queue, ban/unban, game enable/disable, audit log)
- XP and levels (server-awarded, idempotent), basic stats and global leaderboard per game
- Push notifications (friend request, invite, message)
- Account deletion flow (required by both stores)
- Analytics events (no message content, no voice)

v1.1 (after MVP gate): Trivia, Word battles, clubs, achievements and challenges, events, friends/club leaderboards, referrals and deep links.
v1.2: cosmetics shop, GameVerse Plus (US$3.99/mo working price), IAP with server validation, entitlements, refunds.

## 3. Games

### Tic-tac-toe (build first)

- 3x3, 2 players. Best-of-3 series. First player alternates each game and on rematch.
- Turn timer 20s. A timeout loses the game; 2 consecutive timeouts forfeits the series.
- Bot levels: easy (random), medium (heuristic), hard (minimax). Same validator as humans.
- Ranking: win 1, draw 0.5, loss 0. Rating system: Elo-style, seeded 1000.
- Purpose: prove matchmaking, session lifecycle, reconnect, timeouts, results, rematch, event log.

### Ludo (build second)

Rules must be written to `docs/ludo-rules.md` and approved by the owner before implementation. Decisions needed: 6 to leave base, three-sixes rule, extra turn on capture and on reaching home, safe squares, exact roll to finish, 2/3/4 players. Server rolls dice with a CSPRNG, logs every roll, validates every move. Property-based and fuzz tests for the rules package.

### Later: Trivia, Word battles

Trivia: original or licensed questions only, server-timed scoring, no repeats per match. Word: simultaneous rounds (default), language-specific dictionary data required before validation is claimed complete.

## 4. Shared session framework

States: `waiting -> ready -> active -> completed | cancelled | expired | abandoned`.

- Match IDs are unique; every transition is idempotent and guarded (optimistic version or row lock).
- Persist every action as a `GameEvent`; state is reconstructable from the event log.
- Disconnect grace window (default 30s), then forfeit or bot takeover rules per game.
- Matchmaking: queue by game + rating band, widening over time, 20s timeout then offer "play a bot" explicitly. Cancel and retry supported.
- Single-instance WebSocket registry at launch. Document what changes to scale horizontally (Redis adapter, sticky sessions or pub/sub).

## 5. Voice (Agora)

- Backend issues short-lived RTC tokens (`agora-token`) after verifying match/room membership. App secret never leaves the server.
- Channel = `match_<id>` or `room_<id>`, never reused.
- Numeric UID per user, mapped server-side.
- Off by default; explicit join. Mic permission requested on first join only.
- Max participants per room, idle auto-leave, token renewal on expiry callback.
- Android foreground service and iOS audio background mode configured.
- No recording. Reports rely on user flags, usage metadata and moderator review of reported chat text.
- Mark voice "unverified" until tested on real devices (including one low-end Android) with real credentials.
- Pricing: check Agora's current rates before cost modelling; target cost per DAU is set in `docs/costs.md`.

## 6. Safety and privacy

- 16+ gate, privacy defaults conservative (profile and online status friends-only for new accounts, DMs from friends only by default).
- Block, mute, report (user, message, match, voice). Report queue with reasons, moderator actions, audit trail.
- Text filter on usernames, bios, chat. Rate limits on registration, login, friend requests, messages.
- Never expose email, DOB, or exact location on public profiles.
- Do not claim regulatory compliance without assessment.

## 7. Data model (MVP core)

User, UserProfile, UserSettings, RefreshToken, Friendship, FriendRequest, Conversation, ConversationMember, Message, Notification, DeviceToken, BlockedUser, Game, GameMatch, GameMatchPlayer, GameEvent, GameResult, PlayerRating, PlayerStatistics, PlayerExperience, VoiceSession, ModerationReport, ModerationAction, AuditLog, AnalyticsEvent. Add the rest only when their phase starts.

## 8. Quality gates

MVP gate (all required):

1. Register, verify, sign in (email, Apple, Google), manage profile, delete account.
2. Two real users befriend, chat, block, report.
3. Tic-tac-toe and Ludo play correctly end to end, including reconnect, timeout, abandon, rematch, bot.
4. Server authority proven by tests (client cannot supply score, dice, winner).
5. Voice works on two physical devices with real Agora credentials; permission denial, mute, leave, reconnect verified.
6. Admin enforces roles; bans take effect on API and sockets.
7. Concurrency tests pass: simultaneous friend requests, duplicate moves, duplicate XP awards, matchmaking races.
8. Security tests: cross-user access, invalid/expired tokens, WS room access, rate limits.
9. WebSocket load test (k6 or Artillery) with the measured single-instance ceiling recorded.
10. Maestro E2E on Android and iOS for auth, friend flow, a full match, voice join/leave.
11. Migrations run clean on an empty DB; backup/restore rehearsed.
12. Every incomplete or unverified item listed in `docs/progress.md`.

## 9. Owner-obtained accounts

Apple Developer, Google Play Console, Agora project, Google and Apple sign-in credentials, email provider (transactional), push (FCM/APNs via Expo), hosting, error monitoring (Sentry), domain.
