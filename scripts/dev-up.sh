#!/usr/bin/env bash
#
# FotoProy — dev bootstrap: starts the whole backend stack and prepares the
# phone-accessible URLs (LAN IP is detected and written into the dev .env
# files automatically). Metro (Expo) runs separately — see docs/development.md.
#
# Usage:   pnpm dev:up        (from the repository root)
# Logs:    tail -f /tmp/fotoproy-api.log
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ---------------------------------------------------------------------------
# 1. Containers: PostgreSQL (55432) + MinIO (9000 API / 9001 console)
# ---------------------------------------------------------------------------
echo "[1/4] Starting Docker services (Postgres + MinIO)…"
docker compose up -d

echo "      Waiting for healthy containers…"
for _ in $(seq 1 30); do
  db="$(docker inspect -f '{{.State.Health.Status}}' fotoproy-db 2>/dev/null || echo starting)"
  minio="$(docker inspect -f '{{.State.Health.Status}}' fotoproy-minio 2>/dev/null || echo starting)"
  if [ "$db" = "healthy" ] && [ "$minio" = "healthy" ]; then
    break
  fi
  sleep 2
done
echo "      db=${db:-unknown} · minio=${minio:-unknown}"

# ---------------------------------------------------------------------------
# 2. Detect the LAN IP and point the dev .env files at it
# ---------------------------------------------------------------------------
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -z "$IP" ]; then
  IP="127.0.0.1"
  echo "[2/4] ⚠️  No LAN interface found — using 127.0.0.1 (only emulators/simulators will work)."
else
  echo "[2/4] LAN IP detected: $IP"
fi

set_env() { # set_env <file> <key> <value>
  local file="$1" key="$2" value="$3"
  if [ ! -f "$file" ]; then
    echo "      (creating $file from .env.example)"
    cp "$file.example" "$file"
  fi
  sed -i "/^${key}=/d" "$file"
  sed -i "/^# Auto-managed by scripts\/dev-up.sh/d" "$file"
  printf '\n# Auto-managed by scripts/dev-up.sh (dev only)\n%s=%s\n' "$key" "$value" >> "$file"
}

set_env apps/api/.env STORAGE_ENDPOINT "http://${IP}:9000"
set_env apps/mobile/.env EXPO_PUBLIC_API_URL "http://${IP}:4100"
echo "      API_URL=http://${IP}:4100 · STORAGE=http://${IP}:9000 (written to dev .env)"

# ---------------------------------------------------------------------------
# 3. Start the API (NestJS, watch mode) if it is not already running
# ---------------------------------------------------------------------------
echo "[3/4] Starting API on :4100…"
if curl -fsS -m 2 http://localhost:4100/health >/dev/null 2>&1; then
  echo "      API already running — skipping."
else
  (cd apps/api && nohup pnpm dev > /tmp/fotoproy-api.log 2>&1 &)
  for _ in $(seq 1 30); do
    if curl -fsS -m 2 http://localhost:4100/health >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

if curl -fsS -m 2 http://localhost:4100/health >/dev/null 2>&1; then
  echo "      ✓ API healthy → http://localhost:4100/health"
else
  echo "      ✗ API did not become healthy. See: tail -f /tmp/fotoproy-api.log"
fi

# ---------------------------------------------------------------------------
# 4. Summary / next steps
# ---------------------------------------------------------------------------
echo
echo "[4/4] Todo listo. Para probar en el celular:"
echo
echo "  Terminal 2 — Metro (Expo):"
echo "    cd apps/mobile && pnpm start"
echo
echo "  En el celular (mismo WiFi): instala Expo Go y escanea el QR."
echo "  API del dispositivo:  http://${IP}:4100"
echo "  Consola MinIO:        http://localhost:9001  (fotoproy / fotoproy-secret)"
echo "  Logs API:             tail -f /tmp/fotoproy-api.log"
echo "  Detener todo:         pnpm dev:stop"
echo
