#!/usr/bin/env bash
# WebSocket + match load test against a throwaway database and the compiled API on this machine.
# Needs: k6 on PATH (or K6=/path/to/k6), psql, a built API (pnpm build), TEST_DATABASE_URL's server.
#   scripts/ws-load.sh [steps, e.g. 25,50,100,200] [seconds per step]
# Writes loadtest/out/<timestamp>/{summary.json,server.csv,k6.log}.
set -euo pipefail
cd "$(dirname "$0")/.."
STEPS="${1:-25,50,100,200}"
STEP_SECONDS="${2:-60}"
K6="${K6:-k6}"
ENV_URL="${TEST_DATABASE_URL:-$(grep -E '^TEST_DATABASE_URL=' .env | head -1 | cut -d= -f2-)}"
BASE="${ENV_URL%/*}"
DB=gv_loadtest
PORT="${LOAD_PORT:-3923}"
SECRET="loadtest-only-$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
OUT="loadtest/out/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
API_PID=""; SAMPLER_PID=""
cleanup() {
  [ -n "$SAMPLER_PID" ] && kill "$SAMPLER_PID" 2>/dev/null || true
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  psql "$BASE/postgres" -qAt -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1 || true
}
trap cleanup EXIT

PAIRS_TOTAL=$(echo "$STEPS" | tr ',' '\n' | paste -sd+ | bc)
USERS=$((PAIRS_TOTAL * 2))

psql "$BASE/postgres" -qAt -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB" >/dev/null
for dir in $(ls -d prisma/migrations/*/ | sort); do
  psql "$BASE/$DB" -v ON_ERROR_STOP=1 -q -f "${dir}migration.sql" >/dev/null
done
node loadtest/prepare-users.mjs --db "$BASE/$DB" --secret "$SECRET" --count "$USERS" --out "$OUT/tokens.json"

DATABASE_URL="$BASE/$DB" DB_POOL_MAX="${DB_POOL_MAX:-10}" NODE_ENV=development PORT="$PORT" LOG_LEVEL=warn JWT_ACCESS_SECRET="$SECRET" \
  EMAIL_PROVIDER=console RATE_LIMIT_DEFAULT_PER_MIN=100000 RATE_LIMIT_AUTH_PER_MIN=10000 \
  node dist/main.js >"$OUT/api.log" 2>&1 &
API_PID=$!
until curl -fsS "http://127.0.0.1:$PORT/health/ready" >/dev/null 2>&1; do
  kill -0 "$API_PID" 2>/dev/null || { cat "$OUT/api.log"; exit 1; }
  sleep 0.5
done

node loadtest/sample.mjs "$API_PID" "$OUT/server.csv" &
SAMPLER_PID=$!

echo "start epoch: $(date +%s)" | tee "$OUT/k6.log"
"$K6" run --quiet -e API="http://127.0.0.1:$PORT" -e TOKENS="$PWD/$OUT/tokens.json" -e STEPS="$STEPS" \
  -e STEP_SECONDS="$STEP_SECONDS" --summary-export "$OUT/summary.json" loadtest/ws-matches.k6.js 2>&1 | tee -a "$OUT/k6.log" | tail -60
rm -f "$OUT/tokens.json"
echo "results in $OUT"
