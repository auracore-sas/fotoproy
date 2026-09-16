#!/usr/bin/env bash
#
# FotoProy — build a sideloadable release APK locally (no Expo account needed).
#
# Memory-safe defaults: one ABI (arm64 covers every modern phone), two Gradle
# workers and a 2 GB heap. Building all four ABIs in parallel once froze this
# laptop (C++ codegen for 4 architectures + a 3 GB Gradle heap with ~5 GB free).
#
# Usage:
#   bash scripts/build-apk.sh                 # arm64-v8a only (recommended)
#   ABIS="arm64-v8a,armeabi-v7a" bash scripts/build-apk.sh   # + older 32-bit
#   ABIS="arm64-v8a,armeabi-v7a,x86_64" bash scripts/build-apk.sh
#   DAEMON=1 bash scripts/build-apk.sh        # keep a Gradle daemon (faster reruns)
#   PREPARE_ONLY=1 bash scripts/build-apk.sh  # only check the toolchain
#
# Output: ~/fotoproy-builds/fotoproy-<version>-<versionCode>.apk and a build log
# in the same directory (kept outside /tmp so a reboot cannot erase it).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE="$ROOT/apps/mobile"
ANDROID_DIR="$MOBILE/android"
OUT_DIR="${OUT_DIR:-$HOME/fotoproy-builds}"

# Toolchain locations used on this machine (override with env vars if needed).
# JAVA_HOME is forced to the JDK 17 installed for this build: the ambient one on
# this machine is newer (21/25) and React Native 0.86 expects 17.
JDK17_HOME="${JDK17_HOME:-$HOME/tools/jdk17}"
if [ -x "$JDK17_HOME/bin/java" ]; then
  [ -n "${JAVA_HOME:-}" ] && [ "${JAVA_HOME}" != "$JDK17_HOME" ] && \
    echo "note: using $JDK17_HOME instead of JAVA_HOME=$JAVA_HOME"
  JAVA_HOME="$JDK17_HOME"
fi
export JAVA_HOME
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

ABIS="${ABIS:-arm64-v8a}"
MAX_WORKERS="${MAX_WORKERS:-2}"
GRADLE_HEAP="${GRADLE_HEAP:-2g}"
KOTLIN_HEAP="${KOTLIN_HEAP:-1g}"
MIN_FREE_GB="${MIN_FREE_GB:-4}"
# Hard caps so a bad estimate cannot freeze the desktop (see docs/release.md §6).
#   CPUS          CPUs the build may use (taskset); empty disables the pin.
#   MEMORY_MAX    cgroup memory ceiling; the build dies, not your session.
CPUS="${CPUS:-0-2}"
MEMORY_MAX="${MEMORY_MAX:-6G}"
MEMORY_SWAP_MAX="${MEMORY_SWAP_MAX:-1G}"
SANDBOX="${SANDBOX:-1}"
# The API URL is baked into the JS bundle. For a client APK it must be the public
# one, not the LAN address that apps/mobile/.env holds for local development.
API_URL="${API_URL:-https://fotoproy.apx5.com}"
DAEMON_FLAG="--no-daemon"
[ "${DAEMON:-0}" = "1" ] && DAEMON_FLAG=""

step() { printf '\n== %s\n' "$1"; }
fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

step "1/5 Toolchain"
[ -x "$JAVA_HOME/bin/java" ] || fail "no JDK at $JAVA_HOME (set JAVA_HOME)"
JAVA_MAJOR="$("$JAVA_HOME/bin/java" -version 2>&1 | sed -nE 's/.*version "([0-9]+).*/\1/p' | head -1)"
[ "$JAVA_MAJOR" = "17" ] || fail "JDK 17 required by React Native 0.86 (found $JAVA_MAJOR at $JAVA_HOME)"
echo "  JDK 17:      $JAVA_HOME"
[ -d "$ANDROID_HOME/platforms" ] || fail "no Android SDK at $ANDROID_HOME (set ANDROID_HOME)"
echo "  Android SDK: $ANDROID_HOME"
ls "$ANDROID_HOME/ndk" >/dev/null 2>&1 || fail "no NDK installed under $ANDROID_HOME/ndk"
echo "  NDK:         $(ls "$ANDROID_HOME/ndk" | tr '\n' ' ')"

step "2/5 Free memory"
AVAIL_GB="$(free -g | awk '/^Mem:/ {print $7}')"
echo "  available:   ${AVAIL_GB} GB (wanted >= ${MIN_FREE_GB} GB)"
if [ "$AVAIL_GB" -lt "$MIN_FREE_GB" ]; then
  fail "close heavy apps (browser, IDE) before building: ${AVAIL_GB} GB free"
fi

step "3/5 Native project"
if [ ! -d "$ANDROID_DIR" ]; then
  echo "  android/ missing → running expo prebuild"
  (cd "$MOBILE" && npx expo prebuild --platform android --no-install)
fi
echo "sdk.dir=$ANDROID_HOME" >"$ANDROID_DIR/local.properties"
echo "  android/: $ANDROID_DIR"

# Make sure the bundle talks to the public API (see API_URL above).
export EXPO_PUBLIC_API_URL="$API_URL"
env_url="$(grep -hE '^EXPO_PUBLIC_API_URL=' "$MOBILE/.env" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
if [ -n "$env_url" ] && [ "$env_url" != "$API_URL" ]; then
  echo "  note: apps/mobile/.env says EXPO_PUBLIC_API_URL=$env_url → overridden with $API_URL"
fi
echo "  API baked in: $API_URL"

if [ "${PREPARE_ONLY:-0}" = "1" ]; then
  step "prepare-only: toolchain is ready, nothing was built"
  exit 0
fi

step "4/5 Building (abis=$ABIS workers=$MAX_WORKERS heap=$GRADLE_HEAP)"
mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/build-$(date +%Y%m%d-%H%M%S).log"
echo "  log:         $LOG"
echo "  this takes 10-25 min on the first run (C++ codegen); do not close the terminal"

# Resource ceilings: own cgroup for memory (verified: memory.max + swap.max) and
# a fixed CPU set via taskset, plus low priority so interactive work wins.
LAUNCHER=()
if [ "$SANDBOX" = "1" ] && systemd-run --user --scope true >/dev/null 2>&1; then
  LAUNCHER=(systemd-run --user --scope -p "MemoryMax=$MEMORY_MAX" -p "MemorySwapMax=$MEMORY_SWAP_MAX" --)
  echo "  caps:        memory $MEMORY_MAX (swap $MEMORY_SWAP_MAX) · CPUs ${CPUS:-all} · nice 10"
fi

# The JS bundle is produced by a Gradle task whose up-to-date check does NOT
# consider EXPO_PUBLIC_* environment variables, so a cached bundle from an
# earlier build keeps the old API URL (this shipped a LAN address once). Drop the
# generated bundle so it is always regenerated with $API_URL baked in.
rm -rf "$ANDROID_DIR/app/build/generated/assets/react" \
  "$ANDROID_DIR/app/build/intermediates/assets/release/mergeReleaseAssets" 2>/dev/null || true
echo "  js bundle:   regenerated with $API_URL"
PIN=()
if [ -n "$CPUS" ] && command -v taskset >/dev/null 2>&1; then
  PIN=(taskset -c "$CPUS")
fi

set +e
(cd "$ANDROID_DIR" && "${LAUNCHER[@]}" "${PIN[@]}" nice -n 10 ionice -c2 -n7 \
  ./gradlew :app:assembleRelease $DAEMON_FLAG --console=plain \
  --max-workers="$MAX_WORKERS" \
  "-PreactNativeArchitectures=$ABIS" \
  "-Dorg.gradle.jvmargs=-Xmx$GRADLE_HEAP -XX:MaxMetaspaceSize=512m" \
  "-Dkotlin.daemon.jvmargs=-Xmx$KOTLIN_HEAP" 2>&1 | tee "$LOG")
STATUS=${PIPESTATUS[0]}
set -e
if [ "$STATUS" -ne 0 ]; then
  echo
  echo "BUILD FAILED (exit $STATUS). Last lines of the log:"
  tail -25 "$LOG"
  exit "$STATUS"
fi

step "5/5 Verifying the artifact"
APK_SRC="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK_SRC" ] || fail "gradle reported success but $APK_SRC is missing"

VERSION="$(node -p "require('$MOBILE/app.json').expo.version" 2>/dev/null || echo unknown)"
BUILDS="$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)"
AAPT="$ANDROID_HOME/build-tools/$BUILDS/aapt2"
APKSIGNER="$ANDROID_HOME/build-tools/$BUILDS/apksigner"
VERSION_CODE="$("$AAPT" dump badging "$APK_SRC" 2>/dev/null | sed -nE "s/.*versionCode='([0-9]+)'.*/\1/p" | head -1)"
APK_OUT="$OUT_DIR/fotoproy-${VERSION}-${VERSION_CODE:-0}.apk"
cp -f "$APK_SRC" "$APK_OUT"

echo "  file:        $APK_OUT"
echo "  size:        $(du -h "$APK_OUT" | cut -f1)"
"$AAPT" dump badging "$APK_OUT" 2>/dev/null | grep -E "^package:|^sdkVersion|^targetSdkVersion|^application-label:" | sed 's/^/  /'
"$APKSIGNER" verify --print-certs "$APK_OUT" 2>/dev/null | grep -E "Signer #1 (certificate DN|key algorithm)" | sed 's/^/  /'

# The API URL lives in the JS bundle: shipping a LAN address to a client would be
# invisible until they opened the app, so it is checked here.
BUNDLE_URLS="$(unzip -p "$APK_OUT" assets/index.android.bundle 2>/dev/null | strings | grep -c "$API_URL" || true)"
if [ "${BUNDLE_URLS:-0}" -gt 0 ]; then
  echo "  bundle API URL: $API_URL (found)"
else
  echo
  echo "WARNING: the JS bundle does not contain $API_URL."
  echo "         The app would talk to whatever URL ended up baked in."
  if [ "${ALLOW_API_MISMATCH:-0}" != "1" ]; then
    echo "         Re-run with ALLOW_API_MISMATCH=1 to keep this APK anyway."
    exit 3
  fi
fi

cat <<EOF

Listo. Para instalarlo en un teléfono Android:
  1. Copia el APK al teléfono (cable, Drive, Telegram…) o sirve el archivo por HTTP.
  2. En el teléfono: Ajustes → aplicaciones → permitir "instalar apps desconocidas" para la app con la que lo abras.
  3. Abre el APK y confirma la instalación.
  La app apunta a ${API_URL} (verificado dentro del bundle JS del APK).

Notas:
  - El APK va firmado con el keystore de debug del proyecto (válido para instalar por sideload,
    no para publicar en Play; para Play hay que usar EAS con un keystore propio).
  - Si necesitas equipos antiguos de 32 bits: ABIS="arm64-v8a,armeabi-v7a" bash scripts/build-apk.sh
EOF
