#!/usr/bin/env bash
# Raw Android captures for the Play frames (R3): .maestro/screenshots/store-android.yaml on the installed preview Release build,
# on this app's emulator (1080 x 2424), demo-mode status bar (clock 9:41, wifi, mobile icons hidden (no "3G"), full battery).
# Voice cues are switched off in the app's settings at the start of the flow; the emulator runs -no-audio with media volume 0.
# Usage: scripts/store-captures-android.sh <en|de|fr|es|it>
# Output: artifacts/store/captures-android/<lang>/NN-name.png  (the app has no Dutch: nl frames reuse the English captures)
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh

lang=${1:?Usage: store-captures-android.sh <en|de|fr|es|it>}
case $lang in
  en) tag=en-US ;; de) tag=de-DE ;; fr) tag=fr-FR ;; es) tag=es-ES ;; it) tag=it-IT ;;
  *) echo "Language: en de fr es it." >&2; exit 1 ;;
esac
config=$(APP_VARIANT=preview npx expo config --json --type public)
app_id=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).android.package)' <<<"$config")
scheme=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).scheme)' <<<"$config")
device=$(scripts/boot.sh android)
adb -s "$device" shell pm path "$app_id" >/dev/null || { echo "$app_id not installed on $device" >&2; exit 1; }
adb -s "$device" shell cmd media_session volume --stream 3 --set 0 >/dev/null 2>&1 || true
adb -s "$device" shell cmd uimode night no >/dev/null
# The app reads the system language at first launch (templates are stored in it), and per-app locales did not take effect:
# set the system locale and restart the framework (zygote); wait until the device is back.
if [[ "$(adb -s "$device" shell getprop persist.sys.locale | tr -d '\r')" != "$tag" ]]; then
  adb -s "$device" root >/dev/null 2>&1 || true   # the google_apis image allows it; needed for setprop
  adb -s "$device" wait-for-device
  adb -s "$device" shell setprop persist.sys.locale "$tag"
  adb -s "$device" shell setprop ctl.restart zygote
  sleep 8
  until [[ "$(adb -s "$device" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; do sleep 2; done
  sleep 10
  adb -s "$device" shell settings put secure stylus_handwriting_enabled 0
  adb -s "$device" shell cmd media_session volume --stream 3 --set 0 >/dev/null 2>&1 || true
fi
adb -s "$device" shell settings put global sysui_demo_allowed 1
demo() { adb -s "$device" shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null; }
demo enter
demo clock -e hhmm 0941
demo network -e wifi show -e level 4 -e fully true
demo network -e mobile hide   # 'datatype none' still shows "3G" on this image
demo battery -e level 100 -e plugged false
demo notifications -e visible false
trap 'demo exit' EXIT
run="artifacts/maestro/android-preview-store-$lang-$(date +%Y%m%d-%H%M%S)"
dest="artifacts/store/captures-android/$lang"
mkdir -p "$dest" "$run"
status=0
maestro --device "$device" test -e APP_ID="$app_id" -e SCHEME="$scheme" \
  --test-output-dir "$run" .maestro/screenshots/store-android.yaml || status=$?
# frames 3 and 6: seed the colour and history rows into the app's database (adb root; UPDATE + INSERT only), then capture again
adb -s "$device" shell am force-stop "$app_id"
adb -s "$device" root >/dev/null 2>&1 || true
adb -s "$device" wait-for-device
dbfile=$(adb -s "$device" shell "ls /data/data/$app_id/files/SQLite/*.db" | head -1 | tr -d '\r')
adb -s "$device" push scripts/store-history-seed.sql /data/local/tmp/store-history-seed.sql >/dev/null
adb -s "$device" shell "sqlite3 '$dbfile' < /data/local/tmp/store-history-seed.sql"
maestro --device "$device" test -e APP_ID="$app_id" --test-output-dir "$run-history" .maestro/screenshots/store-android-history.yaml || status=$?
for name in 01-run-work 02-home 03-tiles 04-editor 05-run-rest 06-history 07-import 08-settings; do
  shot=$(find "$run-history" "$run" -name "$name.png" 2>/dev/null | head -1)  # history run first: frame 3 has the seeded colours
  if [[ -z $shot ]]; then echo "MISSING: $name" >&2; status=1; continue; fi
  cp "$shot" "$dest/$name.png"
done
ls "$dest"
exit "$status"
