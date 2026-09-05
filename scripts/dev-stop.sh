#!/usr/bin/env bash
#
# FotoProy — stops the dev API started by `pnpm dev:up`.
# Containers (Postgres/MinIO) are left running; stop them with `pnpm db:down`
# (or `docker compose down`) when you do not need them.
#
# Usage: pnpm dev:stop
set -uo pipefail

echo "Stopping the FotoProy API (:4100)…"

# Prefer the listener PID on :4100, then fall back to known process names.
PID="$(ss -ltnp 2>/dev/null | grep ':4100' | grep -oP 'pid=\K[0-9]+' | sort -u | head -1 || true)"
if [ -n "${PID:-}" ]; then
  kill "$PID" 2>/dev/null || true
  sleep 1
fi

# Kill any remaining dev watchers of this repo's API (nest + pnpm parents).
pkill -f "fotoproy/apps/api.*nest" 2>/dev/null || true
pkill -f "@fotoproy/api.*nest" 2>/dev/null || true
sleep 1

if curl -fsS -m 2 http://localhost:4100/health >/dev/null 2>&1; then
  echo "⚠️  The API is still responding on :4100 — kill it manually if needed."
else
  echo "✓ API stopped."
fi
echo "Containers left running (docker compose ps). Metro, if open, keeps running."
