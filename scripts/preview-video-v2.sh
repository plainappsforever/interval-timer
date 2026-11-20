#!/usr/bin/env bash
# App preview recording (R5 fix round): one run on the 6.9-inch simulator, no audio (simctl records none), cues muted
# except a short Sound-ON window. Needs the preview Release build installed on "Intervals iPhone Pro Max".
# Output: artifacts/store/preview/raw-en-v2.mov (1320x2868); convert with scripts/preview-convert.swift.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
config=$(APP_VARIANT=preview npx expo config --json --type public)
app_id=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).ios.bundleIdentifier)' <<<"$config")
export IOS_SIMULATOR="Intervals iPhone Pro Max" IOS_DEVICE_TYPE="iPhone 17 Pro Max"
device=$(scripts/boot.sh ios)
xcrun simctl status_bar "$device" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100
trap 'xcrun simctl status_bar "$device" clear >/dev/null 2>&1 || true' EXIT
mkdir -p artifacts/store/preview
maestro --device "$device" test -e APP_ID="$app_id" -e SCHEME="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).scheme)' <<<"$config")" -e LANGTAG=en -e LOCALE=en_US \
  --test-output-dir artifacts/maestro/preview-setup-v2 scripts/preview-video-setup-v2.yaml
xcrun simctl io "$device" recordVideo --codec h264 --force artifacts/store/preview/raw-en-v2.mov &
rec=$!
sleep 2
maestro --device "$device" test -e APP_ID="$app_id" -e SCHEME="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).scheme)' <<<"$config")" -e LANGTAG=en -e LOCALE=en_US \
  --test-output-dir artifacts/maestro/preview-rec-v2 scripts/preview-video-flow-v2.yaml || true
sleep 1
kill -INT "$rec"
wait "$rec" || true
