#!/usr/bin/env bash
# Runs scripts/load-test.mjs against a throwaway database and a freshly started compiled API, with
# bonus-coin entry fees, and fails if the players' coin total changes.
#   bash scripts/paid-load.sh --game tictactoe --pairs 20 --matches 2 --fee 50
#   bash scripts/paid-load.sh --game ludo --pairs 5 --matches 1 --fee 50
# Needs a running PostgreSQL, a built API (dist/) and a TEST_DATABASE_URL in .env. Local use only.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_URL="${TEST_DATABASE_URL:-$(grep -E '^TEST_DATABASE_URL=' .env | head -1 | cut -d= -f2-)}"
BASE="${ENV_URL%/*}"
DB=gv_paidload
PORT="${LOAD_PORT:-3927}"
SECRET="loadtest-only-$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
LOG="$(mktemp)"
API_PID=""
cleanup() {
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  psql "$BASE/postgres" -qAt -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1 || true
}
trap cleanup EXIT
psql "$BASE/postgres" -qAt -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB" >/dev/null
for dir in $(ls -d prisma/migrations/*/ | sort); do
  psql "$BASE/$DB" -v ON_ERROR_STOP=1 -q -f "${dir}migration.sql" >/dev/null
done
# Ludo ships switched off; the load test needs it on in this scratch database only.
psql "$BASE/$DB" -qAt -c "UPDATE games SET enabled = true WHERE id = 'ludo'" >/dev/null
DATABASE_URL="$BASE/$DB" DB_POOL_MAX="${DB_POOL_MAX:-10}" NODE_ENV=development PORT="$PORT" LOG_LEVEL=warn \
  JWT_ACCESS_SECRET="$SECRET" EMAIL_PROVIDER=console \
  RATE_LIMIT_DEFAULT_PER_MIN=100000 RATE_LIMIT_AUTH_PER_MIN=10000 \
  node dist/main.js >"$LOG" 2>&1 &
API_PID=$!
until curl -fsS "http://127.0.0.1:$PORT/health/ready" >/dev/null 2>&1; do
  kill -0 "$API_PID" 2>/dev/null || { cat "$LOG"; exit 1; }
  sleep 0.5
done
node scripts/load-test.mjs --api "http://127.0.0.1:$PORT" "$@"
