# MASTER BUILD SPECIFICATION — GAMEVERSE

## 1. YOUR ROLE

Act as a senior software architect, senior React Native developer, backend engineer, multiplayer game engineer, UI/UX designer, DevOps engineer, security engineer, QA engineer, and product strategist.

Your responsibility is to design, implement, test, and prepare a production-quality social gaming application called **GameVerse**.

Do not stop at a proposal, mockup, static UI, or starter template. Build working software incrementally, validate the implementation, and document exactly what is complete and what remains.

The product must be a completely new application and business, independent of RydaApp.

Do not modify, import production data from, or reuse live credentials from RydaApp. Reuse general engineering knowledge and appropriate open-source libraries, but create a separate repository, application identity, database, cloud environment, configuration, user accounts, and payment configuration.

## 2. PRODUCT VISION

GameVerse is a worldwide mobile social gaming platform where people can:

- Play casual multiplayer games with friends and strangers.
- Discover people with similar interests.
- Make and manage friendships.
- Talk to other players through optional live voice chat.
- Send text messages and reactions.
- Create or join gaming clubs.
- Compete in tournaments, challenges, and leaderboards.
- Customize avatars and profiles.
- Participate in community events.
- Purchase optional premium memberships and cosmetic items.

The central promise is:

"Play together. Make friends. Find your people."

GameVerse must feel like a connected social world, not a list of unrelated mini-games.

Games bring people together. Friendships, clubs, achievements, and shared experiences give them reasons to return.

Voice chat is required in the first release, but GameVerse must not become a live-streaming or virtual-gifting application. Voice should support gameplay, friendship, and community.

## 3. TARGET MARKET

Build for a worldwide audience from launch.

Initial product requirements:

- English as the first language.
- Architecture ready for additional languages.
- Responsive support for different Android and iOS screen sizes.
- Support for variable internet quality.
- Efficient operation on mid-range and lower-end devices.
- UTC-based backend timestamps with localized display.
- International-friendly usernames, profile settings, and time zones.
- Currency and regional pricing configuration for future monetization.
- Region-aware privacy and age-safety controls.

Do not hard-code the application to Nigeria, the United States, or another single country.

Do not claim worldwide availability until the application, voice provider, payments, privacy requirements, and app-store distribution have been verified for the relevant markets.

## 4. WORKING RULES — FOLLOW THESE THROUGHOUT

Before writing code:

1. Inspect the current repository, runtime, installed dependencies, package managers, and available tools.
2. Determine whether the directory is empty or already contains a project.
3. Do not overwrite existing user work without understanding it.
4. Identify the recommended application structure and architecture.
5. Create a detailed implementation plan, including file changes, dependencies, risks, and tests.
6. Create a requirements checklist and a phased delivery plan.
7. Identify any features requiring external credentials or paid providers.
8. Ask only for decisions that genuinely block progress. Otherwise, choose sensible defaults and document them.

After the plan is ready, proceed with implementation in manageable phases.

Do not repeatedly stop after describing what you intend to do. Implement the next actionable phase and continue until the available environment, time, or a genuine external dependency prevents progress.

Engineering requirements:

- Use TypeScript with strict settings wherever practical.
- Follow existing project conventions when a project already exists.
- Prefer maintainable, modular code.
- Use supported and compatible dependency versions.
- Do not invent library APIs or pretend integrations are functional.
- Do not hard-code secrets, tokens, production URLs, or payment credentials.
- Do not disable type checking, lint rules, authentication, or tests to hide errors.
- Do not use fake success responses in production code.
- Do not leave core functions as TODOs, empty handlers, or buttons that do nothing.
- Do not claim a test passed unless it was actually executed and passed.
- Do not claim a provider integration is complete when credentials or configuration are missing.
- Use migrations for database changes.
- Preserve working functionality while implementing improvements.
- Use Git checkpoints or commits at sensible milestones if Git is available.
- Never run destructive database commands against a production environment.
- Do not deploy, spend money, publish applications, or alter production resources without explicit authorization.

If context or execution limits interrupt work, save progress in project documentation and resume from the last verified checkpoint.

## 5. APPLICATION TECHNOLOGY

Use the following as the default architecture, adjusting only when a technically justified alternative is necessary.

### Mobile application

- React Native.
- Expo with a development build when native modules require it.
- TypeScript.
- React Navigation or Expo Router, chosen consistently.
- TanStack Query or an equivalent reliable server-state solution.
- A lightweight state-management library where needed.
- A reusable design system.
- Native push notifications.
- Secure storage for authentication tokens.

Do not assume that every native voice or gaming library works in Expo Go. Use a development build and configure native modules correctly.

### Backend

- Node.js.
- NestJS.
- TypeScript.
- PostgreSQL.
- Prisma ORM.
- Redis for presence, matchmaking coordination, short-lived state, queues, or rate limiting when justified.
- WebSockets for real-time social events and game updates.
- A background job mechanism for notifications, cleanup, and scheduled events.

Use REST endpoints for normal application operations and WebSockets for real-time interactions where appropriate.

### Infrastructure

Create a deployment-independent architecture that can run locally and later be deployed to a suitable cloud provider.

Include:

- Environment-specific configuration.
- Database migrations.
- Seed scripts for development.
- Health and readiness endpoints.
- Structured logging.
- Error monitoring integration points.
- Database backups and recovery documentation.
- CI checks for linting, type checking, and tests.
- Separate development, staging, and production configurations.

Do not require Redis for every operation if PostgreSQL and a simpler implementation are sufficient during early development.

## 6. BRAND AND VISUAL DESIGN

Create a distinctive, premium social gaming identity.

Working brand: GameVerse.

Before finalizing the name, document the need to check trademarks, domains, app stores, and social handles. Do not represent the name as legally available without verification.

### Visual direction

Use a polished, colorful, modern interface with:

- Deep indigo, midnight purple, or navy foundations.
- Carefully selected electric-blue, violet, and coral accents.
- Soft gradients used selectively.
- Rounded game cards and profile surfaces.
- High-quality avatar illustrations.
- Clear typography and strong visual hierarchy.
- Restrained motion and transitions.
- Consistent icons.
- Excellent contrast and readable text.
- Thoughtful loading, empty, error, offline, and success states.

Avoid excessive neon, clutter, too many competing colors, and unnecessary decorative panels.

Do not make every screen a generic dashboard.

Create a reusable design system with tokens for color, spacing, typography, radii, shadows, and animation.

Support dark mode first, with a consistent theme architecture that can support other themes later.

The experience should feel friendly, alive, premium, and accessible.

## 7. NAVIGATION AND CORE SCREENS

Build the following screens and connect them to real application functionality.

### A. Onboarding and authentication

- Welcome screen.
- Create account.
- Sign in.
- Email verification.
- Password reset.
- Supported social authentication if configured.
- Terms of service and privacy acceptance.
- Date-of-birth or age-eligibility flow appropriate to the selected legal requirements.
- Username selection and uniqueness checks.
- Avatar selection.
- Interest and preferred-game selection.
- Notification permission request at an appropriate time.
- Microphone permission request when the user first enters a voice feature.

Do not request unnecessary permissions during initial onboarding.

### B. Home / social gaming lobby

Show:

- Personalized greeting.
- Player avatar and profile entry.
- Friends currently online.
- Continue playing or recently played games.
- Play with friends.
- Quick match.
- Recommended games.
- Suggested people to play with.
- Clubs and communities.
- Active community events.
- Current challenges.
- Recent achievements.
- Notifications and messages.

The lobby must have real data, useful loading states, and meaningful empty states.

### C. Games library

Provide:

- Game cards and categories.
- Search and filtering.
- Recently played games.
- Favourite games.
- Number of players supported.
- Estimated match duration.
- Public matchmaking.
- Private matches.
- Invite-friend flow.
- Rules and tutorial.
- Clear game loading and error states.

Only display a game as available when its game implementation is functional.

### D. Player profile

Include:

- Avatar.
- Display name and unique username.
- Optional biography.
- Interests and preferred games.
- Friendship status.
- Online or last-seen status subject to privacy settings.
- Player level and experience.
- Achievements and badges.
- Favourite games.
- Club memberships.
- Match history and appropriate statistics.
- Profile customization.
- Block and report actions.

Do not expose email addresses, sensitive account data, private messages, or exact location on public profiles.

### E. Friends

Implement:

- Friend requests.
- Accept and reject.
- Remove friend.
- Online friends.
- Recently played together.
- Search by username.
- Invite to game.
- Join eligible friend matches.
- Optional favourite friends.
- Notification preferences.

Prevent duplicate requests and handle simultaneous requests correctly.

### F. Messaging and social notifications

Implement:

- One-to-one text messaging.
- Message history.
- Read status where appropriate.
- Delivery and connection states.
- Message notifications.
- Mute conversation.
- Block user.
- Report conversation.
- Pagination and safe message limits.

Messages must be authorized on the server. Users must not be able to retrieve conversations they do not belong to.

### G. Clubs

Users should be able to:

- Create a club.
- Select name, description, and avatar or emblem.
- Join public clubs.
- Request entry to private clubs.
- Invite members.
- Leave a club.
- Assign owner, administrator, and member roles.
- Promote and remove members.
- Manage club descriptions and rules.
- Chat with club members.
- Organize club game sessions.
- View club activity.
- Compete on club leaderboards.

Prevent orphaned clubs when an owner leaves. Provide a defined ownership-transfer or closure process.

### H. Voice-enabled social spaces

Create voice experiences associated with active multiplayer matches and controlled friend or club spaces.

Include:

- Join and leave voice.
- Microphone permission handling.
- Mute and unmute.
- Voice connection status.
- Reconnection handling.
- Speaker indicators.
- Participant list.
- Report and block actions.
- Host or moderator controls for applicable rooms.
- Clear handling of voice-provider errors.
- Automatic disconnection when the user leaves the space.
- Appropriate backgrounding and interruption behavior on mobile.

Voice must be optional, not automatically enabled without the user's consent.

Do not record voice by default.

### I. Profile customization and inventory

Include:

- Avatar selection.
- Basic free cosmetics.
- Cosmetic inventory.
- Equip and unequip.
- Ownership verification on the server.
- Purchase history.
- Seasonal items.
- Locked premium items.
- Item descriptions and prices.

Use a configuration-driven catalog instead of hard-coding every shop item into UI components.

### J. Settings

Include:

- Account settings.
- Privacy settings.
- Friend and message permissions.
- Online status visibility.
- Notification settings.
- Voice preferences.
- Audio settings.
- Language preference.
- Accessibility options.
- Blocked users.
- Help and support.
- Terms and privacy.
- Account deletion request.

Implement the underlying settings behavior, not only the screens.

## 8. MULTIPLAYER GAMES

Launch with three primary games:

1. Ludo.
2. Trivia / quiz battles.
3. Word battles.

Implement one game fully, test it, and then reuse the proven matchmaking and game-session infrastructure for the others.

### A. Ludo

Requirements:

- Private and public matches.
- Support the selected player counts, including two- and four-player games.
- Invite friends.
- Quick matchmaking.
- Correct dice rules.
- Valid token movement.
- Capture rules.
- Safe squares and home-path rules.
- Turn order.
- Extra turns where the rules require them.
- Victory detection.
- Reconnect and resume.
- Match results.
- Rematch.
- Optional in-game text chat.
- Optional voice chat.
- Server-authoritative game state.

Document the precise Ludo rules before implementation and test every important rule.

Use an established, clearly licensed game engine or implement the rules as a well-tested domain module. Do not copy proprietary assets or code from competing applications.

### B. Trivia / quiz battles

Requirements:

- Multiple-choice questions.
- Configurable categories.
- Difficulty levels.
- Timed rounds.
- Score tracking.
- Correct-answer feedback.
- Matchmaking.
- Private friend matches.
- Match results.
- Rematches.
- Question rotation.
- Duplicate-question prevention within a match.
- Server-controlled scoring and timing.

Create a safe content-management mechanism for question banks.

Do not ship copyrighted question collections without appropriate rights. Use original, licensed, or public-domain material.

### C. Word battles

Requirements:

- Turn-based or simultaneous play, selected and documented during planning.
- Clear word-entry rules.
- Round timers where appropriate.
- Server-side validation.
- Scoring.
- Match history.
- Rematches.
- Matchmaking.
- Friend invitations.
- Configurable language-specific dictionaries.

Do not pretend dictionary validation is complete if no suitable dictionary data is installed.

### D. Shared multiplayer infrastructure

All games must use reusable services for:

- Matchmaking.
- Match creation.
- Player assignment.
- Ready state.
- Game start.
- Turn or round state.
- Authoritative validation.
- Timeouts.
- Disconnect detection.
- Reconnection.
- Match completion.
- Results.
- Rematch.
- Match cancellation.
- Abandoned matches.
- Event logging.

Define clear session states, such as waiting, ready, active, completed, cancelled, and expired.

Use unique match identifiers and protect all state transitions against duplicate requests.

Never trust a client-provided score, dice result, winner, reward, or game outcome.

If random dice or other random events affect competition, generate them on the server using a suitable secure random source and validate the resulting moves.

### E. Matchmaking and empty lobbies

Support:

- Quick play.
- Private room codes or invitations.
- Skill-aware matchmaking when enough data exists.
- Region and latency awareness where practical.
- Matchmaking timeouts.
- Cancellation.
- Retry.
- Reconnect to an existing match.

Never silently add a fake human player.

If bots are introduced later, label them honestly and implement their moves through the same authoritative rules as human players.

For the initial release, do not make paid entry or cash betting necessary to play.

## 9. SOCIAL CONNECTIONS AND RETENTION

Implement a connected progression system.

### Player progression

- Experience points.
- Player levels.
- Achievements.
- Daily or weekly challenges.
- Game-specific statistics.
- Streaks that do not punish players unfairly for missing days.
- Cosmetic rewards.

Define how experience is earned and prevent duplicate or fabricated rewards.

### Community events

- Scheduled events.
- Participation status.
- Event leaderboards.
- Configurable objectives.
- Reward eligibility.
- Event announcements.
- Administrative controls.

Use server-controlled event times and outcomes.

### Leaderboards

Provide:

- Global leaderboards.
- Game-specific leaderboards.
- Friends leaderboards.
- Club leaderboards.
- Seasonal leaderboards.

Define ranking rules and prevent obvious score manipulation.

### Invitations and referrals

Implement:

- Shareable invitation links.
- Private match invitations.
- Friend referrals.
- Deep links to the correct app or store listing.
- Deferred invitation handling where supported.
- Referral attribution.
- Abuse protection.

Do not award referral rewards repeatedly for the same person or allow users to generate unlimited fraudulent rewards.

The core growth loop should be:

Discover GameVerse → play a match → meet another player → become friends → play again → join a club → invite others.

## 10. VOICE PROVIDER INTEGRATION

Evaluate Agora RTC or a comparable production-grade real-time voice provider.

Before selecting a provider, compare:

- Audio quality.
- Android and iOS support.
- React Native and Expo development-build compatibility.
- Pricing and free allowances.
- Participant-minute costs.
- Geographic coverage.
- Authentication requirements.
- Reconnection behavior.
- Documentation.
- Data processing and privacy terms.

Use a provider abstraction so the application is not unnecessarily tied to one vendor.

The backend must issue short-lived, appropriately scoped voice tokens. Never embed an administrative provider secret in the mobile application.

Voice channel access must be checked against the relevant match or social-space membership.

Implement:

- Token issuance.
- Token expiration and renewal.
- Channel naming and isolation.
- Join/leave lifecycle.
- Microphone permissions.
- Audio interruptions.
- Network reconnection.
- Provider failure handling.
- Usage metrics.
- Cost alerts where supported.

Do not build a custom low-level voice transport when a reputable provider is suitable for the initial product.

If credentials are unavailable, implement the integration boundary and setup documentation, but clearly label live voice as unverified until tested with valid credentials on real devices.

## 11. MONETIZATION AND REVENUE

Use a free-to-play business model.

### A. GameVerse Plus subscription

Working initial price: US$3.99 per month.

Consider an annual plan after validating willingness to pay.

Possible benefits:

- Premium avatar cosmetics.
- Additional profile customization.
- Exclusive badges.
- Extra personalization.
- Premium club decoration.
- Optional convenience features that do not make competitive matches unfair.

The main games, friend features, and ordinary matchmaking must remain accessible without a subscription.

### B. Cosmetic purchases

Support configurable items such as:

- Avatar outfits.
- Accessories.
- Emotes.
- Profile frames.
- Club emblems.
- Seasonal cosmetic collections.

Prices may be configured around US$0.99–US$9.99 as an initial planning range.

### C. Seasonal passes

Add only after the game loop and retention are validated.

A pass may contain cosmetics, achievements, and optional challenges.

Never make purchased rewards a guarantee of competitive victory.

### D. Rewarded advertising

Design an optional rewarded-ad integration point for later.

Do not require advertisements to complete ordinary matches. Do not display disruptive ads during active voice conversations.

### E. Payment implementation

For digital goods consumed inside mobile apps, evaluate and implement the applicable Apple and Google in-app purchase requirements.

Use a server-side purchase-validation process.

Requirements:

- Product catalog.
- Subscription status.
- Purchase verification.
- Entitlement management.
- Purchase history.
- Refund and revocation handling.
- Subscription renewal handling.
- Duplicate event protection.
- Webhook signature verification.
- Audit logs.
- Restore-purchases support where applicable.

Do not trust a mobile client to declare a purchase successful.

Use idempotency keys and unique transaction identifiers so a purchase or webhook cannot grant the same entitlement twice.

Do not store raw card details.

Do not assume one payment provider or checkout method is permitted in every country.

Do not enable cash betting, real-money wagering, player cash-outs, or cash prizes in the MVP.

## 12. BACKEND MODULES

Organize the backend into maintainable domain modules.

Expected modules include:

- Authentication.
- Users and profiles.
- Privacy settings.
- Friends and relationships.
- Presence.
- Messaging.
- Notifications.
- Games catalog.
- Matchmaking.
- Game sessions.
- Ludo engine.
- Trivia engine.
- Word game engine.
- Voice authorization.
- Clubs.
- Events and challenges.
- Player progression.
- Achievements.
- Leaderboards.
- Cosmetics and inventory.
- Subscriptions and purchases.
- Reporting and moderation.
- Administration.
- Analytics.
- Audit logs.
- Health and system status.

Use clear boundaries between modules and avoid one giant service containing all application logic.

Use DTO validation, consistent API error formats, pagination, authorization guards, and structured logging.

Document the REST endpoints and WebSocket events.

## 13. DATABASE AND DATA INTEGRITY

Design a relational schema that supports the actual product.

Expected entities include:

- User.
- UserProfile.
- UserSettings.
- Friendship.
- FriendRequest.
- Conversation.
- ConversationMember.
- Message.
- Notification.
- Club.
- ClubMember.
- Game.
- GameMatch.
- GameMatchPlayer.
- GameEvent.
- GameResult.
- PlayerStatistics.
- PlayerExperience.
- Achievement.
- UserAchievement.
- Challenge.
- Event.
- EventParticipant.
- CosmeticItem.
- UserInventoryItem.
- Product.
- Purchase.
- PurchaseTransaction.
- SubscriptionEntitlement.
- ModerationReport.
- ModerationAction.
- BlockedUser.
- AuditLog.

Adjust the schema to the final domain design instead of creating unnecessary tables mechanically.

Requirements:

- Correct primary and foreign keys.
- Appropriate indexes.
- Unique constraints.
- Transaction boundaries.
- UTC timestamps.
- Data retention policies.
- Safe deletion and account anonymization workflows.
- Referential integrity.
- Migration history.
- Development seed data.
- Concurrency-safe updates.

Do not store frequently changing game state in a way that makes reconnect and recovery impossible.

Persist enough authoritative match state and events to recover interrupted sessions safely.

Use transactions for multi-step changes involving purchases, rewards, entitlements, or match completion.

## 14. REAL-TIME SYSTEMS

Design real-time communication around authenticated WebSocket connections.

Support:

- Presence updates.
- Friend activity.
- Matchmaking events.
- Game-state events.
- Chat delivery.
- Club activity.
- Notifications.
- Voice-related status where appropriate.

Requirements:

- Authenticate connections.
- Authorize every room subscription.
- Validate every client event.
- Rate-limit abusive activity.
- Handle reconnects.
- Prevent duplicate event processing.
- Handle stale sessions.
- Avoid broadcasting private information.
- Support pagination or recovery for missed messages.
- Use versioned events where useful.

Do not assume an in-memory socket registry is sufficient for horizontally scaled production deployments.

Document the single-instance launch architecture and the additional infrastructure required to scale across multiple instances.

## 15. SECURITY AND PRIVACY

Security must be built into the system, not postponed until launch.

Implement:

- Secure password hashing if using password authentication.
- Short-lived access tokens and a secure refresh-token lifecycle.
- Refresh-token revocation.
- Secure token storage on mobile.
- Authorization on every protected endpoint.
- Object-level access control.
- Input validation.
- Rate limiting.
- Abuse-resistant account creation.
- Login and sensitive-action throttling.
- Safe handling of secrets.
- Production CORS configuration where applicable.
- WebSocket authentication and authorization.
- Webhook verification.
- Secure upload validation if uploads are introduced.
- Dependency vulnerability checks.
- Safe error responses that do not leak secrets.
- Audit logs for administrative actions.

Never commit `.env` files or real secrets.

Provide a complete `.env.example` containing placeholders only.

Do not print secret values in logs or diagnostic reports.

### Account and user safety

Implement:

- Block user.
- Report user.
- Report message or match.
- Mute user.
- Voice moderation actions.
- Club moderation.
- Rate limits against spam.
- Moderator suspension and ban actions.
- Appeal or support process.
- Administrative audit trail.

Create age-appropriate onboarding and privacy controls. Review applicable requirements for children, age restrictions, voice communication, direct messaging, user-generated content, and parental consent before distribution.

Do not claim compliance with GDPR, COPPA, or any other regulation without a proper assessment.

## 16. ADMIN DASHBOARD

Build a protected web-based administration dashboard.

The dashboard should include:

### Overview

- Registered users.
- Daily and monthly active users.
- Matches started and completed.
- Matchmaking failures.
- Voice usage.
- New registrations.
- Retention indicators.
- Purchase totals.
- Subscription status.
- Error and crash indicators.

Clearly distinguish measured values from unavailable or estimated metrics.

### User management

- Search users.
- View safe profile information.
- Inspect reported activity with appropriate access controls.
- Suspend or ban users.
- Restore access where authorized.
- Review reports.
- Record moderation reasons.
- Review administrative action history.

### Game management

- Enable or disable a game.
- Manage game metadata.
- Manage trivia questions.
- Manage supported languages.
- Configure seasonal events.
- Configure challenge rules.
- Review suspicious scores.

### Economy and purchases

- View purchases and subscription entitlements.
- Review failed transactions.
- Inspect purchase validation events.
- View refunds and revoked entitlements.
- Manage cosmetic catalog entries.
- Review purchase anomalies.

Administrative tools must use server-side authorization and least-privilege access.

Never expose administrative API keys or privileged database access to the mobile application.

## 17. ANALYTICS AND PRODUCT MEASUREMENT

Create a privacy-conscious analytics layer.

Track meaningful events, such as:

- Registration completed.
- Onboarding completed.
- First match started.
- Match completed.
- Match abandoned.
- Friend request sent.
- Friendship accepted.
- Voice joined.
- Voice disconnected.
- Club joined.
- Invitation shared.
- Subscription purchased.
- Purchase failed.

Do not collect message contents or record voice for analytics.

Define:

- Activation rate.
- Day-1 retention.
- Day-7 retention.
- Day-30 retention.
- Match completion rate.
- Average matchmaking time.
- Social connection rate.
- Voice connection failure rate.
- Paying conversion rate.
- Revenue per paying user.
- Cost per active user.

Provide event schemas and ensure duplicate events do not inflate important business metrics.

## 18. PERFORMANCE AND RELIABILITY

Design for realistic mobile network conditions.

Requirements:

- Efficient list rendering.
- Image caching.
- Pagination.
- Minimal unnecessary re-renders.
- Retry behavior with limits.
- Exponential backoff where appropriate.
- Network failure indicators.
- Match reconnection.
- Idempotent requests.
- Graceful offline handling.
- Memory-conscious game rendering.
- Background/foreground lifecycle handling.
- Error boundaries.
- Crash reporting integration.

Test on Android and iOS, including physical devices where available.

Do not claim reliable low-end-device support without testing.

## 19. TESTING REQUIREMENTS

Build an automated test suite alongside the features.

### Backend tests

Test:

- Authentication.
- Authorization.
- Friend request races.
- Messaging permissions.
- Club roles.
- Matchmaking concurrency.
- Game rule validation.
- Invalid moves.
- Reconnection.
- Duplicate game events.
- Match completion.
- Duplicate rewards.
- Purchase verification.
- Duplicate purchase webhooks.
- Subscription revocation.
- Rate limits.
- Moderation permissions.
- Privacy boundaries.

### Game tests

For each game, test:

- Normal completion.
- Invalid moves.
- Turn order.
- Timeouts.
- Disconnects.
- Reconnection.
- Abandoned sessions.
- Simultaneous requests.
- Duplicate requests.
- Winner calculation.
- Score integrity.

### Mobile tests

Test:

- Authentication flows.
- Navigation.
- Loading and error states.
- Friend interactions.
- Matchmaking.
- Game controls.
- Voice permission denial.
- Voice join and leave.
- App backgrounding.
- Reconnection.
- Purchase restore.
- Account deletion requests.

### Security tests

Test:

- Unauthorized access.
- Cross-user data leakage.
- Privilege escalation.
- Invalid tokens.
- Expired sessions.
- Rate limiting.
- WebSocket room access.
- Webhook forgery.
- Duplicate purchase processing.
- Client-supplied score manipulation.

### Release quality gates

Before declaring a release candidate:

- Run the formatter.
- Run linting.
- Run TypeScript checks.
- Run relevant unit tests.
- Run integration tests.
- Build the backend.
- Build the mobile application when the environment permits.
- Check database migrations.
- Review dependency vulnerabilities.
- Document any untested areas.

Never hide failures by deleting tests or weakening assertions.

## 20. DEPLOYMENT AND OPERATIONS

Create:

- Docker configuration where appropriate.
- Local development instructions.
- PostgreSQL setup.
- Redis setup if required.
- Environment configuration templates.
- Database migration commands.
- Seed commands.
- Backend startup commands.
- Mobile development commands.
- Production build instructions.
- Deployment instructions.
- Health checks.
- Logging configuration.
- Backup and restore documentation.
- Incident recovery notes.

The application must be usable in a local development environment without production credentials.

Provide separate instructions for:

1. Local development.
2. Staging.
3. Production.

Do not deploy automatically.

Document all external provider accounts and approvals that the owner must obtain.

## 21. RECOMMENDED PROJECT STRUCTURE

Use a maintainable monorepo if practical.

Suggested layout:

gameverse/
  apps/
    mobile/
    admin/
    api/
  packages/
    shared-types/
    validation/
    game-rules/
    design-system/
  infrastructure/
    docker/
    deployment/
  docs/
    product-spec.md
    architecture.md
    database.md
    api.md
    websocket-events.md
    security.md
    moderation.md
    voice-provider-setup.md
    payments.md
    deployment.md
    testing.md
    launch-checklist.md
  .env.example
  README.md

Adapt the exact layout to the tools and packages selected. Do not create empty packages merely to match this example.

## 22. DEVELOPMENT PHASES

Implement in this order.

### Phase 0 — Discovery and specification

- Inspect the environment.
- Finalize architecture.
- Document assumptions.
- Create requirements checklist.
- Identify external dependencies.
- Produce implementation plan and acceptance criteria.

Deliverable: approved technical plan and documentation.

### Phase 1 — Project foundation

- Set up repositories or monorepo.
- Configure TypeScript.
- Create backend, mobile, and admin applications.
- Configure PostgreSQL and Prisma.
- Add migrations.
- Set up authentication.
- Establish design tokens.
- Add CI and test commands.

Deliverable: applications start successfully and connect to the development database.

### Phase 2 — Social foundation

- Profiles.
- Friends.
- Presence.
- Messaging.
- Notifications.
- Blocking and reporting.
- Initial admin user-management tools.

Deliverable: two real test users can discover each other, communicate, and manage their relationship.

### Phase 3 — Multiplayer framework

- Matchmaking.
- Private matches.
- Game session lifecycle.
- WebSocket authorization.
- Reconnection.
- Shared game event architecture.

Deliverable: test users can create, join, play, leave, and recover multiplayer sessions.

### Phase 4 — First complete game

- Implement Ludo.
- Test rules and concurrency.
- Validate server authority.
- Test reconnects and abandoned matches.
- Add results and rematches.

Deliverable: a fully working multiplayer Ludo experience.

### Phase 5 — Other games

- Trivia battles.
- Word battles.
- Shared matchmaking and result handling.
- Game-specific statistics and leaderboards.

Deliverable: three playable games with tested server-side rules.

### Phase 6 — Voice and communities

- Voice provider integration.
- Voice permissions and reconnection.
- Friend and club spaces.
- Clubs and roles.
- Club chat.
- Community events.

Deliverable: users can play, communicate, and participate in clubs.

### Phase 7 — Progression and customization

- Experience.
- Achievements.
- Challenges.
- Avatars and inventory.
- Cosmetic catalog.
- Leaderboards.

Deliverable: users have a persistent identity and progression.

### Phase 8 — Monetization

- Subscription catalog.
- Cosmetic purchases.
- Store purchase verification.
- Entitlements.
- Refund handling.
- Purchase audit logs.

Deliverable: test purchases work correctly in the relevant sandbox environments.

### Phase 9 — Hardening

- Security tests.
- Performance tests.
- Device tests.
- Voice cost monitoring.
- Database recovery tests.
- Moderation workflows.
- App-store compliance review.
- Error monitoring.

Deliverable: release candidate with documented remaining risks.

### Phase 10 — Launch preparation

- Store assets.
- Store descriptions.
- Privacy policy and terms drafts for legal review.
- Support contact and moderation procedures.
- Analytics dashboard.
- Beta feedback process.
- Launch checklist.
- Production deployment runbook.

Deliverable: a launch-ready package, subject to owner approval and external approvals.

## 23. ACCEPTANCE CRITERIA

Do not mark GameVerse complete merely because the application opens.

The first release is acceptable only when:

1. Users can register, authenticate, and manage profiles.
2. Users can find and add friends.
3. Two or more users can play supported multiplayer games correctly.
4. Game outcomes are validated on the server.
5. Users can send and receive authorized messages.
6. Users can create and join clubs.
7. Supported matches have functional voice chat when valid provider credentials are configured.
8. Voice permissions, mute, leave, and reconnect behavior work.
9. Blocking and reporting function correctly.
10. The admin dashboard enforces appropriate permissions.
11. Cosmetic ownership and purchase entitlements are validated server-side.
12. Critical duplicate-processing and concurrency tests pass.
13. Database migrations run successfully.
14. Development and deployment instructions are complete.
15. There are no known unresolved critical security issues.
16. Every incomplete integration is explicitly documented.
17. No core feature is falsely represented as implemented.

Where external services are unavailable, demonstrate the feature boundary through tests or a clearly identified development stub. Do not misrepresent a stub as a production integration.

## 24. REQUIRED FINAL DELIVERABLES

When implementation work reaches a stopping point, provide:

1. A summary of the architecture.
2. The project directory structure.
3. The features actually implemented.
4. The features partially implemented.
5. The features not implemented.
6. The files and modules changed.
7. Database schema and migration summary.
8. API and WebSocket documentation.
9. Commands to install, configure, test, and run the application.
10. Build results.
11. Test results, including failures.
12. External accounts and credentials required.
13. Estimated recurring operational costs and the assumptions behind them.
14. Security and performance risks.
15. Remaining launch blockers.
16. A prioritized next-step list.

Do not invent screenshots, test results, deployments, credentials, or successful provider connections.

## 25. FIRST ACTION

Start by inspecting the project environment and producing the implementation plan.

Do not immediately generate the entire application in one uncontrolled pass.

After presenting the plan, proceed with Phase 1 and continue through the phases in order, maintaining a requirements checklist and updating the documentation.

At each milestone:

- Implement the feature.
- Run the relevant tests.
- Fix failures before moving forward where possible.
- Record any external blockers.
- Preserve the last working state.
- Update the progress checklist.

If a long-running task is interrupted, record the last completed phase, current test status, outstanding work, and the exact next action in a project progress document.

Your objective is to deliver a genuinely working, maintainable GameVerse application that can be developed into a worldwide business—not just a visually impressive demo.

Begin with Phase 0 now.