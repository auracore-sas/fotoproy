#!/usr/bin/env bash
#
# FotoProy — production deploy (single host, Docker Compose + Caddy).
#
# Idempotent: build the API image, apply pending Prisma migrations, start the
# stack and verify the public health endpoint. Safe to re-run on every release.
#
# Usage (on the server, from the repository root):
#   bash scripts/deploy.sh                  # API + managed/external database
#   bash scripts/deploy.sh --selfhosted-db  # also starts the bundled PostgreSQL
#   bash scripts/deploy.sh --no-pull        # skip `git pull`
#
# Required files:
#   .env                  DOMAIN, ACME_EMAIL and (with --selfhosted-db) POSTGRES_*
#   apps/api/.env         the full API configuration (see .env.production.example)
#
# Full runbook: docs/deployment.md
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.prod.yml)
PROFILES=()
PULL=1

for arg in "$@"; do
  case "$arg" in
    --selfhosted-db) PROFILES=(--profile selfhosted-db) ;;
    --no-pull) PULL=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# 1. Preflight: configuration present?
# ---------------------------------------------------------------------------
echo "[1/6] Checking configuration…"
if [ ! -f apps/api/.env ]; then
  echo "✗ apps/api/.env is missing. Copy apps/api/.env.production.example and fill it in." >&2
  exit 1
fi
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
if [ -z "${DOMAIN:-}" ]; then
  echo "✗ DOMAIN is not set. Put it in .env next to docker-compose.prod.yml." >&2
  exit 1
fi
echo "      DOMAIN=${DOMAIN}"

# ---------------------------------------------------------------------------
# 2. Latest code (the repository is the source of truth for releases)
# ---------------------------------------------------------------------------
if [ "$PULL" = "1" ]; then
  echo "[2/6] Pulling latest code…"
  git pull --ff-only
else
  echo "[2/6] Skipping git pull (--no-pull)."
fi

# ---------------------------------------------------------------------------
# 3. Database container (only when self-hosting PostgreSQL)
# ---------------------------------------------------------------------------
if [ "${#PROFILES[@]}" -gt 0 ]; then
  echo "[3/6] Starting PostgreSQL…"
  "${COMPOSE[@]}" "${PROFILES[@]}" up -d db
  for _ in $(seq 1 30); do
    status="$(docker inspect -f '{{.State.Health.Status}}' fotoproy-db 2>/dev/null || echo starting)"
    [ "$status" = "healthy" ] && break
    sleep 2
  done
  echo "      db=${status:-unknown}"
else
  echo "[3/6] Using the external database configured in apps/api/.env."
fi

# ---------------------------------------------------------------------------
# 4. Build the API image
# ---------------------------------------------------------------------------
echo "[4/6] Building the API image…"
"${COMPOSE[@]}" build api

# ---------------------------------------------------------------------------
# 5. Migrations (Prisma migrate deploy — never `migrate dev` in production)
# ---------------------------------------------------------------------------
echo "[5/6] Applying database migrations…"
"${COMPOSE[@]}" run --rm api pnpm --filter @fotoproy/database db:deploy

# ---------------------------------------------------------------------------
# 6. Start the stack and verify
# ---------------------------------------------------------------------------
echo "[6/6] Starting the stack…"
"${COMPOSE[@]}" "${PROFILES[@]}" up -d

echo "      Waiting for https://${DOMAIN}/health …"
healthy=0
for _ in $(seq 1 20); do
  if curl -fsS -m 5 "https://${DOMAIN}/health" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 3
done

if [ "$healthy" = "1" ]; then
  echo "      ✓ API healthy → https://${DOMAIN}/health"
else
  echo "      ✗ Health check failed." >&2
  echo "        DNS pointing here? TLS issued? Logs:" >&2
  echo "        ${COMPOSE[*]} logs --tail=100 caddy api" >&2
  exit 1
fi

echo "Deployed. Next steps:"
echo "  Follow the logs:   ${COMPOSE[*]} logs -f api"
echo "  Roll back:         git checkout <tag> && bash scripts/deploy.sh --no-pull"
echo "  Optional end-to-end check against production (it creates and deletes its"
echo "  own throwaway organization; needs DB shell access, so only with the"
echo "  self-hosted database profile):"
echo "    API_URL=https://${DOMAIN} PG_CONTAINER=fotoproy-db-1 pnpm smoke:shares"
