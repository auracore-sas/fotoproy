#!/usr/bin/env bash
#
# F3.3/F4.3 — end-to-end smoke test for plan pins, including the soft-remove
# (detach) flow and its authorization rules.
#
# Runs against the local dev API (default http://localhost:4100), creates a
# throwaway organization with a project + plan + photo, walks the pin lifecycle
# and deletes its own data on exit. Requires: curl, jq, docker (cleanup).
#
# Usage:  pnpm smoke:pins      (API must be running: pnpm dev:up)
set -euo pipefail

API=${API_URL:-http://localhost:4100}
PG_CONTAINER=${PG_CONTAINER:-fotoproy-db}
PG_DB=fotoproy
PG_USER=fotoproy
TS=$(date +%s)
ORG_PREFIX="F43 Pins $TS"
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

uuid() { node -e "console.log(require('crypto').randomUUID())"; }

contains() { # contains <label> <needle> <file>
  check "$1" "true" "$(grep -qF "$2" "$3" && echo true || echo false)"
}

code() { # code <method> <path> <token> [body]
  local method=$1 path=$2 token=${3:-} body=${4:-}
  if [ -n "$body" ]; then
    curl -s -o /tmp/f43-body.json -w '%{http_code}' -X "$method" "$API$path" \
      -H 'Content-Type: application/json' ${token:+-H "Authorization: Bearer $token"} -d "$body"
  else
    curl -s -o /tmp/f43-body.json -w '%{http_code}' -X "$method" "$API$path" \
      ${token:+-H "Authorization: Bearer $token"}
  fi
}

# A 1×1 JPEG is enough for the pipeline (thumbnails are generated with sharp).
JPEG_B64='/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='
echo "$JPEG_B64" | base64 -d > /tmp/f43-photo.jpg
echo "$JPEG_B64" | base64 -d > /tmp/f43-plan.jpg

# upload <presign-path> <json-body> <token> <file> → echoes the storageKey
upload() {
  local path=$1 body=$2 token=$3 file=$4
  curl -s -X POST "$API$path" -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $token" -d "$body" > /tmp/f43-presign.json
  local url key
  url=$(jq -r .uploadUrl /tmp/f43-presign.json)
  key=$(jq -r .storageKey /tmp/f43-presign.json)
  curl -s -o /dev/null -X PUT "$url" -H 'Content-Type: image/jpeg' --upload-file "$file"
  echo "$key"
}

echo "== 1. Bootstrap org (ADMIN) + project =="
ADMIN=$(curl -s -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"f43-admin-$TS@test.local\",\"password\":\"secret123\",\"fullName\":\"F43 Admin\",\"organizationName\":\"$ORG_PREFIX A\"}")
TOKEN=$(echo "$ADMIN" | jq -r .accessToken)
check "register admin" "true" "$(echo "$ADMIN" | jq -r 'has("accessToken")')"

PROJECT=$(curl -s -X POST "$API/projects" -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d "{\"code\":\"F43-$TS\",\"name\":\"Proyecto F43 $TS\"}")
PROJECT_ID=$(echo "$PROJECT" | jq -r .id)

echo "== 2. Plan + photo uploaded to storage =="
PLAN_ID=$(uuid)
PLAN_KEY=$(upload /plans/presign \
  "{\"id\":\"$PLAN_ID\",\"projectId\":\"$PROJECT_ID\",\"contentType\":\"image/jpeg\"}" "$TOKEN" /tmp/f43-plan.jpg)
PLAN=$(curl -s -X POST "$API/plans" -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d "{\"id\":\"$PLAN_ID\",\"projectId\":\"$PROJECT_ID\",\"title\":\"Plano F43\",\"planKind\":\"IMAGE\",\"pageCount\":1,\"storageKey\":\"$PLAN_KEY\"}")
check "plan created" "$PLAN_ID" "$(echo "$PLAN" | jq -r .id)"

PHOTO_ID=$(uuid)
PHOTO_KEY=$(upload /photos/presign \
  "{\"id\":\"$PHOTO_ID\",\"projectId\":\"$PROJECT_ID\",\"contentType\":\"image/jpeg\"}" "$TOKEN" /tmp/f43-photo.jpg)
PHOTO=$(curl -s -X POST "$API/photos" -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d "{\"id\":\"$PHOTO_ID\",\"projectId\":\"$PROJECT_ID\",\"kind\":\"PHOTO\",\"storageKey\":\"$PHOTO_KEY\",\"capturedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"}")
check "photo created" "$PHOTO_ID" "$(echo "$PHOTO" | jq -r .id)"

echo "== 3. Anchor the photo (pin) =="
PIN_ID=$(uuid)
check "create pin" "201" "$(code POST /pins "$TOKEN" \
  "{\"id\":\"$PIN_ID\",\"planId\":\"$PLAN_ID\",\"photoId\":\"$PHOTO_ID\",\"pageNumber\":1,\"xPercentage\":42.5,\"yPercentage\":63.25}")"
check "pin id echoed" "$PIN_ID" "$(jq -r .id /tmp/f43-body.json)"
check "pin removedAt null" "null" "$(jq -r '.removedAt' /tmp/f43-body.json)"
check "create pin idempotent (retry 201)" "201" "$(code POST /pins "$TOKEN" \
  "{\"id\":\"$PIN_ID\",\"planId\":\"$PLAN_ID\",\"photoId\":\"$PHOTO_ID\",\"pageNumber\":1,\"xPercentage\":42.5,\"yPercentage\":63.25}")"

check "list pins 200" "200" "$(code GET "/plans/$PLAN_ID/pins" "$TOKEN")"
check "list has 1 pin" "1" "$(jq -r 'length' /tmp/f43-body.json)"

echo "== 4. Detach (soft-remove) =="
check "delete pin 200" "200" "$(code DELETE "/pins/$PIN_ID" "$TOKEN")"
check "removedAt set" "true" "$(jq -r '.removedAt != null' /tmp/f43-body.json)"
check "delete idempotent 200" "200" "$(code DELETE "/pins/$PIN_ID" "$TOKEN")"
check "list after detach 200" "200" "$(code GET "/plans/$PLAN_ID/pins" "$TOKEN")"
check "list has 0 pins" "0" "$(jq -r 'length' /tmp/f43-body.json)"
check "photo kept in gallery" "200" "$(code GET "/photos/$PHOTO_ID" "$TOKEN")"
check "pin row kept in DB" "1" "$(docker exec "$PG_CONTAINER" psql -tA -U "$PG_USER" -d "$PG_DB" \
  -c "select count(*) from photo_pins where id = '$PIN_ID' and \"removedAt\" is not null;")"

echo "== 5. Validation + cross-org isolation =="
check "unknown pin 404" "404" "$(code DELETE "/pins/$(uuid)" "$TOKEN")"
check "bad uuid 400" "400" "$(code DELETE /pins/not-a-uuid "$TOKEN")"
check "pin without photo 404" "404" "$(code POST /pins "$TOKEN" \
  "{\"id\":\"$(uuid)\",\"planId\":\"$PLAN_ID\",\"photoId\":\"$(uuid)\",\"pageNumber\":1,\"xPercentage\":10,\"yPercentage\":10}")"
check "pin page out of range 400" "400" "$(code POST /pins "$TOKEN" \
  "{\"id\":\"$(uuid)\",\"planId\":\"$PLAN_ID\",\"photoId\":\"$PHOTO_ID\",\"pageNumber\":9,\"xPercentage\":10,\"yPercentage\":10}")"

OTHER=$(curl -s -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"f43-other-$TS@test.local\",\"password\":\"secret123\",\"fullName\":\"F43 Other\",\"organizationName\":\"$ORG_PREFIX B\"}")
TOKEN_OTHER=$(echo "$OTHER" | jq -r .accessToken)
NEW_PIN=$(uuid)
code POST /pins "$TOKEN" \
  "{\"id\":\"$NEW_PIN\",\"planId\":\"$PLAN_ID\",\"photoId\":\"$PHOTO_ID\",\"pageNumber\":1,\"xPercentage\":15,\"yPercentage\":15}" >/dev/null
check "cross-org detach 404" "404" "$(code DELETE "/pins/$NEW_PIN" "$TOKEN_OTHER")"

# ---------------------------------------------------------------------------
# The read-only web view must show the plan map with its anchors (and hide
# detached ones), all proxied through the API.
# ---------------------------------------------------------------------------
echo "== 6. Public web view: plan map with anchors =="
SHARE=$(curl -s -X POST "$API/shares" -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d "{\"projectId\":\"$PROJECT_ID\",\"expiresInDays\":7}")
SHARE_TOKEN=$(echo "$SHARE" | jq -r .url | sed 's|.*/s/||')
check "share created" "true" "$([ -n "$SHARE_TOKEN" ] && echo true || echo false)"

PAYLOAD=$(curl -s "$API/s/$SHARE_TOKEN")
check "payload exposes the plan" "1" "$(echo "$PAYLOAD" | jq -r '.plans | length')"
check "payload exposes only active pins" "1" "$(echo "$PAYLOAD" | jq -r '.plans[0].pins | length')"

check "gallery html 200" "200" "$(curl -s -o /tmp/f43-gallery.html -w '%{http_code}' \
  -H 'Accept: text/html' "$API/s/$SHARE_TOKEN")"
contains "gallery lists the plan" "Plano F43" /tmp/f43-gallery.html
contains "gallery links the plan page" "/plan/$PLAN_ID" /tmp/f43-gallery.html

check "plan page 200" "200" "$(curl -s -o /tmp/f43-plan.html -w '%{http_code}' \
  -H 'Accept: text/html' "$API/s/$SHARE_TOKEN/plan/$PLAN_ID")"
contains "plan page has the marker" 'class="pin"' /tmp/f43-plan.html
contains "plan page has the title" "Plano F43" /tmp/f43-plan.html
contains "marker links to its photo" "/p/$PHOTO_ID" /tmp/f43-plan.html

check "plan media 200" "200" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$API/s/$SHARE_TOKEN/plan/$PLAN_ID/media?size=full")"
check "plan media type" "image/jpeg" \
  "$(curl -s -o /dev/null -w '%{content_type}' "$API/s/$SHARE_TOKEN/plan/$PLAN_ID/media?size=full")"
check "unknown plan page 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' \
  -H 'Accept: text/html' "$API/s/$SHARE_TOKEN/plan/$(uuid)")"
check "plan page needs valid token" "404" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$API/s/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/plan/$PLAN_ID")"

echo "== 7. Detached anchors disappear from the web view =="
check "detach the last pin" "200" "$(code DELETE "/pins/$NEW_PIN" "$TOKEN")"
curl -s -o /tmp/f43-plan2.html -H 'Accept: text/html' "$API/s/$SHARE_TOKEN/plan/$PLAN_ID"
check "plan page shows no markers" "0" "$(grep -c 'class="pin"' /tmp/f43-plan2.html || true)"
check "payload shows no pins" "0" "$(curl -s "$API/s/$SHARE_TOKEN" | jq -r '.plans[0].pins | length')"
check "photo stays shared" "1" "$(curl -s "$API/s/$SHARE_TOKEN" | jq -r '.photos | length')"

echo
echo "PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ]
