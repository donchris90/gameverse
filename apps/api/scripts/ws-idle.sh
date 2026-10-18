#!/usr/bin/env bash
# How many idle, authenticated WebSockets one API process holds. Same scratch setup as ws-load.sh.
#   scripts/ws-idle.sh [counts, e.g. 500,1000,2000,4000]
set -euo pipefail
cd "$(dirname "$0")/.."
COUNTS="${1:-500,1000,2000,4000}"
MAX=$(echo "$COUNTS" | tr ',' '\n' | sort -n | tail -1)
ENV_URL="${TEST_DATABASE_URL:-$(grep -E '^TEST_DATABASE_URL=' .env | head -1 | cut -d= -f2-)}"
BASE="${ENV_URL%/*}"; DB=gv_loadtest; PORT="${LOAD_PORT:-3924}"
SECRET="loadtest-only-$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
WORK="$(mktemp -d)"; API_PID=""
trap '[ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null; psql "$BASE/postgres" -qAt -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1; rm -rf "$WORK"' EXIT
psql "$BASE/postgres" -qAt -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB" >/dev/null
for dir in $(ls -d prisma/migrations/*/ | sort); do psql "$BASE/$DB" -v ON_ERROR_STOP=1 -q -f "${dir}migration.sql" >/dev/null; done
node loadtest/prepare-users.mjs --db "$BASE/$DB" --secret "$SECRET" --count "$MAX" --out "$WORK/tokens.json"
DATABASE_URL="$BASE/$DB" NODE_ENV=development PORT="$PORT" LOG_LEVEL=warn JWT_ACCESS_SECRET="$SECRET" \
  EMAIL_PROVIDER=console RATE_LIMIT_DEFAULT_PER_MIN=100000 RATE_LIMIT_AUTH_PER_MIN=10000 \
  node dist/main.js >"$WORK/api.log" 2>&1 &
API_PID=$!
until curl -fsS "http://127.0.0.1:$PORT/health/ready" >/dev/null 2>&1; do kill -0 "$API_PID" || { cat "$WORK/api.log"; exit 1; }; sleep 0.5; done
node loadtest/idle-sockets.mjs --api "ws://127.0.0.1:$PORT/ws" --tokens "$WORK/tokens.json" --pid "$API_PID" --counts "$COUNTS"
