# Dependency audit

Command: `pnpm audit --prod` (run 2026-10-18, repo at Phase 5A).
Result: 3 vulnerabilities (2 high, 1 moderate). All three are transitive dependencies of the Expo build toolchain in `apps/mobile`. None is in `apps/api`, `apps/admin` or any package that runs on the server.

| Package | Severity | Path | Assessment |
| --- | --- | --- | --- |
| node-forge (RSA PKCS#1 v1.5 signature verification) | high | `expo > @expo/cli > node-forge` | Dev-server/CLI tooling on the developer machine. Not bundled into the app. |
| braces (stack exhaustion DoS) | high | `expo > @expo/metro > metro-file-map > micromatch > braces` | Metro file watching during development. No upstream patch exists (patched range `<0.0.0`). |
| uuid (buffer bounds check, v3/v5/v6 with `buf`) | moderate | `expo > @expo/config-plugins > xcode > uuid` | Config-plugin build step. We never call uuid with a caller-supplied buffer. |

Decision: accepted for MVP, not suppressed. Re-run the audit before each store build and after each Expo SDK upgrade; clear these by upgrading Expo when a patched release ships. This is an assessment, not a fix. Nothing was overridden or pinned.

`apps/api` runtime dependencies: no findings.
