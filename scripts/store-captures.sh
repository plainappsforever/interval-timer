#!/usr/bin/env bash
# Raw captures for the store frames (R2b): .maestro/screenshots/store.yaml on a fresh install of the installed Release build
# (variant preview), on the 6.9-inch simulator "Intervals iPhone Pro Max" (1320 x 2868), clean status bar.
# Usage: scripts/store-captures.sh <en|de|fr|es|it>
# Output: artifacts/store/captures/<lang>/NN-name.png  (the app has no Dutch: nl frames reuse the English captures)
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh

lang=${1:?Usage: store-captures.sh <en|de|fr|es|it>}
case $lang in
  en) locale=en_US ;; de) locale=de_DE ;; fr) locale=fr_FR ;; es) locale=es_ES ;; it) locale=it_IT ;;
  *) echo "Language: en de fr es it." >&2; exit 1 ;;
esac
config=$(APP_VARIANT=preview npx expo config --json --type public)
app_id=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).ios.bundleIdentifier)' <<<"$config")
scheme=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).scheme)' <<<"$config")
export IOS_SIMULATOR="${SCREENSHOT_IOS_SIM:-Intervals iPhone Pro Max}"
export IOS_DEVICE_TYPE="iPhone 17 Pro Max"
device=$(scripts/boot.sh ios)
xcrun simctl get_app_container "$device" "$app_id" >/dev/null 2>&1 || { echo "$app_id not installed on $IOS_SIMULATOR" >&2; exit 1; }
xcrun simctl status_bar "$device" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100
trap 'xcrun simctl status_bar "$device" clear >/dev/null 2>&1 || true' EXIT
run="artifacts/maestro/ios-preview-store-$lang-$(date +%Y%m%d-%H%M%S)"
dest="artifacts/store/captures/$lang"
mkdir -p "$dest" "$run"
status=0
maestro --device "$device" test -e APP_ID="$app_id" -e SCHEME="$scheme" -e LANGTAG="$lang" -e LOCALE="$locale" \
  --test-output-dir "$run" .maestro/screenshots/store.yaml || status=$?
# frame 6: seed a believable week of finished workouts into this simulator's database, then capture the history screen
xcrun simctl terminate "$device" "$app_id" >/dev/null 2>&1 || true
dbfile=$(ls "$(xcrun simctl get_app_container "$device" "$app_id" data)"/Documents/SQLite/*.db | head -1)
sqlite3 "$dbfile" < scripts/store-history-seed.sql
maestro --device "$device" test -e APP_ID="$app_id" -e LANGTAG="$lang" -e LOCALE="$locale" \
  --test-output-dir "$run-history" .maestro/screenshots/store-history.yaml || status=$?
run_all=("$run" "$run-history")
for name in 01-run-work 02-home 03-tiles 04-editor 05-run-rest 06-history 07-import 08-settings; do
  shot=$(find "$run-history" "$run" -name "$name.png" 2>/dev/null | head -1)  # history run first: frame 3 has the seeded template colours
  if [[ -z $shot ]]; then echo "MISSING: $name" >&2; status=1; continue; fi
  cp "$shot" "$dest/$name.png"
done
ls "$dest"
exit "$status"
