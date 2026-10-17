# Progress

## Last verified checkpoint: Phase 0 — API foundation (2026-10-17)

Phase 0 is **not complete**. The API, shared packages, CI, and mobile/admin scaffolds are in place and verified as far as stated below; the `game-rules` package (deferred to Phase 2, nothing to put in it yet) and the Agora spike are not done.

### Commands run and real results (sandbox, local PostgreSQL 16)

| Command                                                                                     | Result                                                                                               |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npx prettier --check .`                                                                    | All matched files use Prettier code style                                                            |
| `pnpm lint` (oxlint)                                                                        | 0 warnings, 0 errors in all 3 packages                                                               |
| `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true npx turbo run typecheck build test --env-mode=loose` | 10/10 tasks successful. Unit tests: shared-types 23/23, design-system 24/24, api 24/24               |
| `pnpm --filter @gameverse/api test:integration`                                             | 5 files, **90/90 passed** (real Postgres, real HTTP app)                                             |
| `node dist/main.js` smoke test against dev DB                                               | live/ready OK; register OK; under-16 rejected `UNDER_MINIMUM_AGE`; unauthenticated `/v1/me` rejected |
| `pnpm db:seed` (dev) / with `NODE_ENV=production`                                           | seeds 3 local users / refuses to run                                                                 |

Mutation checks: five deliberately introduced bugs were each caught by the suite (5/5), then reverted; the unit and integration suites were re-run green afterwards (rows above).

### Mobile and admin scaffolds

- `apps/mobile`: Expo SDK 58, Expo Router, `expo-dev-client`, `react-native-agora` 4.6.4 installed (not yet used). One screen that calls the API `/health/ready` and reports the real result. `tsc` and `oxlint` clean; `expo export --platform android` produced a Hermes bundle. **Never run on a device or emulator.**
- `react-native-agora` is not in Expo's SDK 58 version table; 4.6.4 is simply the latest on npm. Compatibility with React Native 0.88 is **unverified** until the spike runs. `expo install` was blocked by the sandbox proxy, so versions were taken from `expo/bundledNativeModules.json`.
- `apps/admin`: Vite + React 19 + Refine installed; a static shell only (no admin features until Phase 1). `tsc`, `oxlint` and `vite build` clean. Not opened in a browser.
- pnpm prints an unmet-peer warning (`react@^19.3.1` found 19.3.0) from the mobile tree because Expo pins React 19.3.0. Left as is.
- Full run after adding them: `npx prettier --check . && npx turbo run lint typecheck build test --env-mode=loose` -> exit 0, 18/18 tasks.

### Caveats about how verification was done

- The sandbox blocks `binaries.prisma.sh`, so the Prisma schema engine cannot download. `prisma generate` was run with `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true` (client generation does not need the engine) and the initial migration SQL was **hand-written and applied with psql**. **Unverified:** that `prisma migrate deploy` accepts it and that `migrate diff` shows no drift. The CI workflow runs both on a real runner; **CI has not yet run** (nothing is pushed).
- Docker is unavailable here, so `docker-compose.yml` is **unverified**; a local Postgres was used instead.
- Turbo strips unlisted env vars; the workaround env var above needs `--env-mode=loose` locally. Not needed on CI where the engine downloads normally.

### Unverified (needs credentials, devices or a real environment)

- Google and Apple sign-in against real provider tokens. Tests use locally generated RSA keys through the injectable key resolver; remote JWKS fetching is untested.
- Email delivery: no real provider exists; config refuses `console`/`memory` in staging/production.
- Agora voice: nothing built or tested. See `docs/voice-spike.md`.
- Argon2 timing equalisation is tested loosely (CI-jitter tolerant), not as a security proof.

### Remaining for Phase 0

1. Backend Agora token endpoint, then the two-phone spike (needs Agora App ID/certificate and two physical phones, one low-end Android).
2. Push to GitHub and confirm CI is green (owner action: create the repo).
3. Owner checkpoint: review schema, auth design, spike result.

### Next exact action

Build the backend Agora token endpoint behind a `VoiceProvider` interface, then ask the owner for Agora credentials and two phones to run the spike.
