#!/usr/bin/env bash
#
# F4.1 — end-to-end smoke test for read-only share links.
#
# Runs against the local dev API (default http://localhost:4100), creates a
# throwaway organization + project, walks the whole flow (create, list, public
# read, revoke, expire, role and cross-org checks) and deletes its own data on
# exit. Requires: curl, jq, docker (for the psql assertions).
#
# Usage:  pnpm smoke:shares      (API must be running: pnpm dev:up)
set -euo pipefail

API=${API_URL:-http://localhost:4100}
PG_CONTAINER=${PG_CONTAINER:-fotoproy-db}
PG_DB=fotoproy
PG_USER=fotoproy
TS=$(date +%s)
ORG_PREFIX="F41 Smoke $TS"
pass=0
fail=0

cleanup() {
  docker exec "$PG_CONTAINER" psql -q -U "$PG_USER" -d "$PG_DB" \
    -c "delete from organizations where \"legalName\" like '$ORG_PREFIX%';" >/dev/null 2>&1 || true
}
trap cleanup EXIT

check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then
    echo "  ok   $1 ($3)"
    pass=$((pass + 1))
  else
    echo "  FAIL $1 — expected $2 got $3"
    fail=$((fail + 1))
  fi
}

code() { # code <method> <path> [token] [body]
  local method=$1 path=$2 token=${3:-} body=${4:-}
  if [ -n "$body" ]; then
    curl -s -o /tmp/f41-body.json -w '%{http_code}' -X "$method" "$API$path" \
      -H 'Content-Type: application/json' ${token:+-H "Authorization: Bearer $token"} -d "$body"
  else
    curl -s -o /tmp/f41-body.json -w '%{http_code}' -X "$method" "$API$path" \
      ${token:+-H "Authorization: Bearer $token"}
  fi
}

html() { # html <path> — fetches as a browser would (Accept: text/html)
  curl -s -o /tmp/f41-body.html -w '%{http_code}' "$API$1" \
    -H 'Accept: text/html,application/xhtml+xml'
}

contains() { # contains <label> <needle> <file>
  check "$1" "true" "$(grep -qF "$2" "$3" && echo true || echo false)"
}

echo "== 1. Bootstrap organization + project + technician =="
ADMIN=$(curl -s -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"f41-admin-$TS@test.local\",\"password\":\"secret123\",\"fullName\":\"F41 Admin\",\"organizationName\":\"$ORG_PREFIX A\"}")
TOKEN_A=$(echo "$ADMIN" | jq -r .accessToken)
ORG_A=$(echo "$ADMIN" | jq -r .user.organizationId)
check "register admin" "true" "$(echo "$ADMIN" | jq -r 'has("accessToken")')"

PROJECT_ID=$(curl -s -X POST "$API/projects" -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d "{\"code\":\"F41-$TS\",\"name\":\"Proyecto F4.1 $TS\",\"description\":\"Prueba de enlaces\"}" | jq -r .id)
check "create project" "true" "$([ -n "$PROJECT_ID" ] && [ "$PROJECT_ID" != "null" ] && echo true || echo false)"

curl -s -X POST "$API/users" -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d "{\"email\":\"f41-tech-$TS@test.local\",\"password\":\"secret123\",\"fullName\":\"F41 Tech\",\"role\":\"TECHNICIAN\"}" >/dev/null
TOKEN_T=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"f41-tech-$TS@test.local\",\"password\":\"secret123\"}" | jq -r .accessToken)

echo "== 2. Create link (ADMIN, 7 days) =="
SHARE=$(curl -s -X POST "$API/shares" -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$PROJECT_ID\",\"expiresInDays\":7}")
SHARE_ID=$(echo "$SHARE" | jq -r .id)
URL=$(echo "$SHARE" | jq -r .url)
TOKEN=$(echo "$URL" | sed 's|.*/s/||')
check "status ACTIVE" "ACTIVE" "$(echo "$SHARE" | jq -r .status)"
check "url shape" "true" "$(echo "$URL" | grep -qE '^https?://[^ ]+/s/[A-Za-z0-9_-]{20,}$' && echo true || echo false)"
check "raw token not stored" "0" "$(docker exec "$PG_CONTAINER" psql -tA -U "$PG_USER" -d "$PG_DB" -c "select count(*) from shares where \"tokenHash\" = '$TOKEN';")"

echo "== 3. Public read-only endpoint =="
check "public 200" "200" "$(code GET "/s/$TOKEN")"
check "payload project name" "Proyecto F4.1 $TS" "$(jq -r .project.name /tmp/f41-body.json)"
check "payload photos array" "array" "$(jq -r '.photos | type' /tmp/f41-body.json)"
check "unknown token 404" "404" "$(code GET "/s/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")"
check "junk token 404" "404" "$(code GET "/s/abc")"

echo "== 3b. Web view (F4.2) =="
check "gallery html 200" "200" "$(html "/s/$TOKEN")"
contains "gallery is html" "<!doctype html>" /tmp/f41-body.html
contains "gallery shows project" "Proyecto F4.1 $TS" /tmp/f41-body.html
contains "gallery empty state" "Todavía no hay fotos" /tmp/f41-body.html
check "unknown photo html 404" "404" "$(html "/s/$TOKEN/p/00000000-0000-4000-8000-000000000000")"
contains "error page copy" "Enlace no encontrado" /tmp/f41-body.html
check "media proxy 404" "404" "$(code GET "/s/$TOKEN/media/00000000-0000-4000-8000-000000000000")"
check "media proxy needs valid token" "404" "$(code GET "/s/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/media/00000000-0000-4000-8000-000000000000")"

echo "== 4. TECHNICIAN is forbidden =="
check "create 403" "403" "$(code POST /shares "$TOKEN_T" "{\"projectId\":\"$PROJECT_ID\"}")"
check "list 403" "403" "$(code GET "/shares?projectId=$PROJECT_ID" "$TOKEN_T")"
check "revoke 403" "403" "$(code DELETE "/shares/$SHARE_ID" "$TOKEN_T")"

echo "== 5. List + revoke =="
check "list 200" "200" "$(code GET "/shares?projectId=$PROJECT_ID" "$TOKEN_A")"
check "list has 1" "1" "$(jq -r 'length' /tmp/f41-body.json)"
check "list hides token" "false" "$(jq -r '.[0] | has("url")' /tmp/f41-body.json)"
check "revoke 200" "200" "$(code DELETE "/shares/$SHARE_ID" "$TOKEN_A")"
check "revoked status" "REVOKED" "$(jq -r .status /tmp/f41-body.json)"
check "public after revoke 410" "410" "$(code GET "/s/$TOKEN")"
check "410 code" "SHARE_REVOKED" "$(jq -r .code /tmp/f41-body.json)"
check "revoked html 410" "410" "$(html "/s/$TOKEN")"
contains "revoked page copy" "Enlace revocado" /tmp/f41-body.html
check "revoke idempotent 200" "200" "$(code DELETE "/shares/$SHARE_ID" "$TOKEN_A")"

echo "== 6. Expired link =="
SHARE2=$(curl -s -X POST "$API/shares" -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$PROJECT_ID\",\"expiresInDays\":1}")
SHARE2_ID=$(echo "$SHARE2" | jq -r .id)
TOKEN2=$(echo "$SHARE2" | jq -r .url | sed 's|.*/s/||')
docker exec "$PG_CONTAINER" psql -q -U "$PG_USER" -d "$PG_DB" \
  -c "update shares set \"expiresAt\" = now() - interval '1 hour' where id = '$SHARE2_ID';" >/dev/null
check "expired 410" "410" "$(code GET "/s/$TOKEN2")"
check "410 code expired" "SHARE_EXPIRED" "$(jq -r .code /tmp/f41-body.json)"
check "expired html 410" "410" "$(html "/s/$TOKEN2")"
contains "expired page copy" "Enlace vencido" /tmp/f41-body.html
check "list status EXPIRED" "EXPIRED" "$(curl -s "$API/shares?projectId=$PROJECT_ID" -H "Authorization: Bearer $TOKEN_A" | jq -r ".[] | select(.id==\"$SHARE2_ID\") | .status")"

echo "== 7. Cross-org isolation =="
TOKEN_B=$(curl -s -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"f41-other-$TS@test.local\",\"password\":\"secret123\",\"fullName\":\"F41 Other\",\"organizationName\":\"$ORG_PREFIX B\"}" | jq -r .accessToken)
check "other org create 404" "404" "$(code POST /shares "$TOKEN_B" "{\"projectId\":\"$PROJECT_ID\"}")"
check "other org list 404" "404" "$(code GET "/shares?projectId=$PROJECT_ID" "$TOKEN_B")"
check "other org revoke 404" "404" "$(code DELETE "/shares/$SHARE2_ID" "$TOKEN_B")"
check "org A share count" "2" "$(docker exec "$PG_CONTAINER" psql -tA -U "$PG_USER" -d "$PG_DB" -c "select count(*) from shares where \"organizationId\"='$ORG_A';")"

echo "== 8. Access metrics =="
# 3 public hits on this token: JSON read, HTML gallery and the HTML photo page.
check "accessCount 3" "3" "$(docker exec "$PG_CONTAINER" psql -tA -U "$PG_USER" -d "$PG_DB" -c "select \"accessCount\" from shares where id='$SHARE_ID';")"

echo
echo "PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ]
