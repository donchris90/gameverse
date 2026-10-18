#!/usr/bin/env bash
# Migration + backup/restore rehearsal. Everything happens in two throwaway databases whose names
# start with "gv_rehearsal_"; nothing else is touched. Needs: psql, pg_dump, pg_restore, a built
# API (pnpm build) and a Postgres server reachable with TEST_DATABASE_URL's credentials.
#
#   1. create an EMPTY database and apply every prisma/migrations/*/migration.sql in order
#   2. start the compiled API on it and play real matches through the REST API (load-test.mjs)
#   3. record per-table row counts and content checksums
#   4. pg_dump (custom format) -> pg_restore into a second EMPTY database
#   5. compare counts and checksums, then boot the API on the restored database
#
# NOTE: this applies the SQL files with psql, exactly as the integration tests do. It does NOT run
# `prisma migrate deploy`, so Prisma's _prisma_migrations bookkeeping and drift detection are not
# exercised here; run `prisma migrate deploy` once against a real database before the first deploy.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_URL="${TEST_DATABASE_URL:-$(grep -E '^TEST_DATABASE_URL=' .env | head -1 | cut -d= -f2-)}"
[ -n "$ENV_URL" ] || { echo "TEST_DATABASE_URL is required" >&2; exit 2; }
BASE="${ENV_URL%/*}"                       # postgresql://user:pass@host:port
SRC=gv_rehearsal_src
DST=gv_rehearsal_restored
ADMIN="$BASE/postgres"
WORK="$(mktemp -d)"
PORT="${REHEARSAL_PORT:-3921}"
API_PID=""

psql_admin() { psql "$ADMIN" -v ON_ERROR_STOP=1 -qAt "$@"; }
cleanup() {
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  psql_admin -c "DROP DATABASE IF EXISTS $SRC WITH (FORCE)" >/dev/null 2>&1 || true
  psql_admin -c "DROP DATABASE IF EXISTS $DST WITH (FORCE)" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

start_api() { # $1 = database name
  DATABASE_URL="$BASE/$1" NODE_ENV=development PORT="$PORT" LOG_LEVEL=warn \
    JWT_ACCESS_SECRET="rehearsal-only-$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')" \
    EMAIL_PROVIDER=console RATE_LIMIT_DEFAULT_PER_MIN=100000 RATE_LIMIT_AUTH_PER_MIN=10000 \
    node dist/main.js >"$WORK/api.log" 2>&1 &
  API_PID=$!
  for _ in $(seq 1 60); do
    curl -fsS "http://127.0.0.1:$PORT/health/ready" >/dev/null 2>&1 && return 0
    kill -0 "$API_PID" 2>/dev/null || { echo "API exited:"; head -20 "$WORK/api.log"; return 1; }
    sleep 0.5
  done
  echo "API not ready"; head -20 "$WORK/api.log"; return 1
}
stop_api() { kill "$API_PID" 2>/dev/null || true; wait "$API_PID" 2>/dev/null || true; API_PID=""; }

# One line per table: name, row count, md5 of all rows (sorted). Skips Prisma's own bookkeeping.
fingerprint() { # $1 = database name
  local url="$BASE/$1" t
  for t in $(psql "$url" -qAt -c "select tablename from pg_tables where schemaname='public' and tablename not like '\\_prisma%' order by 1"); do
    psql "$url" -qAt -c "select '$t', count(*), coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from \"$t\" x"
  done
}

echo "== 1. migrate an empty database"
psql_admin -c "DROP DATABASE IF EXISTS $SRC WITH (FORCE)" -c "DROP DATABASE IF EXISTS $DST WITH (FORCE)" -c "CREATE DATABASE $SRC" -c "CREATE DATABASE $DST"
STARTED=$(date +%s.%N)
count=0
for dir in $(ls -d prisma/migrations/*/ | sort); do
  psql "$BASE/$SRC" -v ON_ERROR_STOP=1 -q -f "${dir}migration.sql" >/dev/null
  count=$((count + 1))
done
echo "applied $count migrations in $(printf '%.1f' "$(echo "$(date +%s.%N) - $STARTED" | bc)")s"
echo "tables: $(psql "$BASE/$SRC" -qAt -c "select count(*) from pg_tables where schemaname='public'")"

echo "== 2. play real matches through the compiled API"
start_api "$SRC"
# games ship seeded by migration; Ludo ships disabled, enable it for this scratch database only.
psql "$BASE/$SRC" -qAt -c "update games set enabled = true where id = 'ludo'" >/dev/null
node scripts/load-test.mjs --api "http://127.0.0.1:$PORT" --pairs 6 --matches 2 | tail -4
node scripts/load-test.mjs --api "http://127.0.0.1:$PORT" --game ludo --pairs 3 --matches 1 | tail -4
stop_api

echo "== 3. fingerprint source"
fingerprint "$SRC" >"$WORK/src.txt"
awk -F'|' '$2 > 0 {n++; r += $2} END {print n " tables hold data, " r " rows in total"}' "$WORK/src.txt"

echo "== 4. dump and restore into an empty database"
STARTED=$(date +%s.%N)
pg_dump "$BASE/$SRC" --format=custom --no-owner --file "$WORK/backup.dump"
DUMPED=$(echo "$(date +%s.%N) - $STARTED" | bc)
STARTED=$(date +%s.%N)
pg_restore --dbname "$BASE/$DST" --no-owner --exit-on-error "$WORK/backup.dump"
RESTORED=$(echo "$(date +%s.%N) - $STARTED" | bc)
printf 'dump %.1fs (%s), restore %.1fs\n' "$DUMPED" "$(du -h "$WORK/backup.dump" | cut -f1)" "$RESTORED"

echo "== 5. compare, then boot the API on the restored database"
fingerprint "$DST" >"$WORK/dst.txt"
if diff -u "$WORK/src.txt" "$WORK/dst.txt"; then
  echo "RESULT: every table matches (row counts and content checksums)"
else
  echo "RESULT: MISMATCH between source and restored database" >&2
  exit 1
fi
start_api "$DST"
echo "RESULT: compiled API is ready on the restored database"
stop_api
