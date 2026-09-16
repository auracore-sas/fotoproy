#!/usr/bin/env bash
#
# FotoProy — secret guard (F4.5).
#
# Fails when a real secret looks like it reached the repository:
#   1. an `.env` file (anything but the committed *.example templates) is tracked;
#   2. a tracked file contains a private key, a cloud access key id, or a
#      connection string with an inline password.
#
# Usage:  pnpm check:secrets
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

failures=0
note() { printf '  %s\n' "$1"; }
fail() {
  printf '  ✗ %s\n' "$1"
  failures=$((failures + 1))
}

echo "== 1. Tracked env files =="
tracked_env=$(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '\.example$' || true)
if [ -n "$tracked_env" ]; then
  while IFS= read -r file; do
    [ -n "$file" ] && fail "tracked secret file: $file"
  done <<<"$tracked_env"
else
  note 'no .env files tracked (only *.example templates)'
fi

echo "== 2. Secret patterns in tracked files =="
# Deliberately narrow: placeholders (CHANGE_ME, <...>, example.com) and the
# local credentials that already live in docker-compose.yml must not trip it.
placeholder='CHANGE_ME|usuario:password|localhost|127\.0\.0\.1|xxxx|example\.[a-z]+|<[^>]+>'
patterns=(
  'BEGIN [A-Z ]*PRIVATE KEY'
  'AKIA[0-9A-Z]{16}'
  'postgres(ql)?://[A-Za-z0-9._-]+:[^@[:space:]"'"'"']{8,}@'
  'JWT_SECRET[=:][[:space:]]*[0-9a-f]{32,}'
  'SECRET_ACCESS_KEY[=:][[:space:]]*[A-Za-z0-9/+=]{20,}'
)

found_any=0
for pattern in "${patterns[@]}"; do
  # Only tracked files, skipping the lockfile and this script's own patterns.
  hits=$(git ls-files -z \
    | xargs -0 -r grep -nIE --exclude='pnpm-lock.yaml' --exclude='check-secrets.sh' -e "$pattern" 2>/dev/null \
    | grep -vEI "$placeholder" \
    || true)
  if [ -n "$hits" ]; then
    found_any=1
    while IFS= read -r line; do
      fail "possible secret → $line"
    done <<<"$hits"
  fi
done
[ "$found_any" = "0" ] && note 'no obvious secrets in tracked files'

echo
if [ "$failures" -gt 0 ]; then
  echo "check-secrets: $failures problem(s) found"
  exit 1
fi
echo "check-secrets: clean"
