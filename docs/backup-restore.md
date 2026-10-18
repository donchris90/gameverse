# Migrations on an empty database, backup and restore

Script: `apps/api/scripts/db-rehearsal.sh` (needs `pnpm build` first). It uses two throwaway databases named `gv_rehearsal_*` and drops them on exit.

## Result of the run on 2026-10-18 (local PostgreSQL 16, one machine)

| Step | Result |
| --- | --- |
| Apply all 13 migrations to an empty database | Clean, 1.2 s, 29 tables, `ON_ERROR_STOP` on |
| Play real matches through the compiled `dist/` API (6 tic-tac-toe pairs x 2 matches, 3 Ludo tables of 4) | Ran; rows landed in 14 tables, 1,620 rows in total |
| `pg_dump --format=custom` | 0.2 s, 148 KB |
| `pg_restore --exit-on-error` into a second empty database | 0.4 s, no errors |
| Compare every table: row count and an md5 of all rows | Identical for all tables |
| Boot the compiled API on the restored database | `/health/ready` OK |

## What this does and does not prove

- Proves: the migration SQL applies cleanly from nothing, in order, and a custom-format dump of a database with real game data restores to byte-identical table contents and a database the API can start on.
- Does not prove: `prisma migrate deploy`. The migrations are hand-written SQL applied with `psql` (this is also how the integration tests build their schema). Prisma's `_prisma_migrations` table and drift check are not exercised because the Prisma schema engine is not available in this workspace. Run `prisma migrate deploy` once against a fresh real database before the first deploy and record the output here.
- Does not prove: backups of the hosted database. Restore of a Render (or other managed) backup has not been tried. Owner steps: confirm the plan's backup retention and point-in-time recovery, take a manual `pg_dump` before every deploy that carries a migration, and rehearse one restore into a scratch instance with the real provider.
- Scale: a few thousand rows. Dump and restore timings will grow with data; re-measure with realistic volume before launch.

## Runbook (manual backup before a migration)

```
pg_dump "$DATABASE_URL" --format=custom --no-owner --file gameverse-$(date +%F).dump
pg_restore --dbname "$SCRATCH_URL" --no-owner --exit-on-error gameverse-YYYY-MM-DD.dump
```

Restore into a new, empty database, check it, then repoint the API. Never restore over the live database.
