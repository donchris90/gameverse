#!/usr/bin/env bash
# Boots the COMPILED API under plain Node and checks readiness. Vitest transpiles on the fly and
# hides CommonJS/ESM interop failures (for example a named import from a CommonJS package), so
# only running dist/ proves the production build can start.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${SMOKE_PORT:-3919}"
LOG="$(mktemp)"
PORT="$PORT" node dist/main.js >"$LOG" 2>&1 &
PID=$!
trap 'kill "$PID" 2>/dev/null || true; rm -f "$LOG"' EXIT
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/health/ready" >/dev/null 2>&1; then
    echo "compiled API is up and ready"
    exit 0
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "compiled API exited during startup:" >&2
    head -30 "$LOG" >&2
    exit 1
  fi
  sleep 0.5
done
echo "compiled API did not become ready in time:" >&2
head -30 "$LOG" >&2
exit 1
