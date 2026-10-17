# GameVerse

Social multiplayer games (tic-tac-toe first, then Ludo) with optional voice. Separate product from RydaApp/RRYDA. See `CLAUDE.md` for working rules, `docs/product-spec.md` for the product, `docs/phases.md` for the plan and `docs/progress.md` for current status.

## Local setup

Requirements: Node 22 (`.nvmrc`), pnpm 10, PostgreSQL 16 (`docker compose up -d` or a local install).

```sh
pnpm install
cp .env.example apps/api/.env   # fill in local values; placeholders only are committed
pnpm --filter @gameverse/api generate
pnpm --filter @gameverse/api db:migrate:deploy
pnpm --filter @gameverse/api db:seed      # local users; prints a random password once
pnpm --filter @gameverse/api start:dev
```

Checks: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:integration`.
Integration tests need `TEST_DATABASE_URL` pointing at a database whose name ends in `_test`; they drop its schema.
