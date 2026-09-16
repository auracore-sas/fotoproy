#!/usr/bin/env bash
#
# FotoProy API — container entrypoint.
#
# Optionally applies pending Prisma migrations before starting the API. This is
# what makes single-process platforms (Dokploy, Render, Fly.io, plain
# `docker run`) work without a separate release step.
#
#   RUN_MIGRATIONS_ON_START=true → `prisma migrate deploy` runs first. It is
#     idempotent; a failure aborts the start (fail loudly instead of serving a
#     stale schema).
#   unset / anything else        → straight to the API.
set -euo pipefail

if [ "${RUN_MIGRATIONS_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] Applying pending database migrations…"
  pnpm --filter @fotoproy/database db:deploy
  echo "[entrypoint] Migrations up to date."
fi

exec "$@"
