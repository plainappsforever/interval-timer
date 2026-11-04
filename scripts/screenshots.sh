#!/usr/bin/env bash
# Store listing screenshots (RELEASE_KIT 3e): home, running, editor, history, settings, captured by Maestro
# (.maestro/screenshots/listing.yaml) on a fresh install of an installed Release build, with a clean status bar.
# Usage: scripts/screenshots.sh <ios|android> [preview|production]
#   iOS: the App Store's 6.9-inch size (1320 x 2868) needs an iPhone 17 Pro Max. The script uses the simulator
#        SCREENSHOT_IOS_SIM (default "Intervals iPhone Pro Max", created on IOS_RUNTIME by boot.sh if missing) and installs
#        the variant's newest simulator Release .app from DerivedData there (build it first: scripts/native.sh ios <variant>).
#        SCREENSHOT_IOS_SIM="Intervals iPhone" uses the app's own 6.3-inch simulator instead (1206 x 2622).
#   Android: this app's emulator (Pixel 9, 1080 x 2424), the build already installed (scripts/native.sh android <variant>).
#        Google Play allows at most 2:1, so a copy padded to 1212 x 2424 goes to artifacts/screenshots/android/play/.
# Output: artifacts/screenshots/<platform>/0N-<name>.png (overwritten on the next run; Maestro's own run folder stays).
# Nothing leaves the Mac. The status-bar override is removed again at the end.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh

platform=${1:?Usage: screenshots.sh <ios|android> [preview|production]}
variant=${2:-preview}
[[ $variant == preview || $variant == production ]] || { echo "Screenshots come from a Release build: preview or production." >&2; exit 1; }

config=$(APP_VARIANT=$variant npx expo config --json --type public)
app_id=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).ios.bundleIdentifier)' <<<"$config")
scheme=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).scheme)' <<<"$config")
dest="artifacts/screenshots/$platform"
run="artifacts/maestro/$platform-$variant-screenshots-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$dest" "$run"

if [[ $platform == ios ]]; then
  export IOS_SIMULATOR="${SCREENSHOT_IOS_SIM:-Intervals iPhone Pro Max}"
  [[ $IOS_SIMULATOR == "Intervals iPhone" ]] || export IOS_DEVICE_TYPE="iPhone 17 Pro Max"
  device=$(scripts/boot.sh ios)
  if ! xcrun simctl get_app_container "$device" "$app_id" >/dev/null 2>&1; then
    product=$(APP_VARIANT=$variant node -e 'const c=JSON.parse(process.argv[1]); console.log(c.name.replace(/[^A-Za-z0-9]/g, ""))' "$config")
    app=$(ls -dt "$HOME/Library/Developer/Xcode/DerivedData/$product"-*/Build/Products/Release-iphonesimulator/"$product".app 2>/dev/null | head -1 || true)
    [[ -n $app ]] || { echo "No $product.app Release build found. Run: scripts/native.sh ios $variant" >&2; exit 1; }
    echo "Installing $app on $IOS_SIMULATOR"
    xcrun simctl install "$device" "$app"
  fi
  xcrun simctl status_bar "$device" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100
  cleanup() { xcrun simctl status_bar "$device" clear >/dev/null 2>&1 || true; }
else
  device=$(scripts/boot.sh android)
  adb -s "$device" shell pm path "$app_id" >/dev/null 2>&1 || { echo "$app_id is not installed. Run: scripts/native.sh android $variant" >&2; exit 1; }
  # System UI demo mode: fixed clock, full battery and signal, no notification icons.
  adb -s "$device" shell settings put global sysui_demo_allowed 1
  demo() { adb -s "$device" shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null; }
  demo enter
  demo clock -e hhmm 0941
  demo battery -e level 100 -e plugged false
  demo network -e wifi show -e level 4 -e mobile show -e datatype none -e level 4
  demo notifications -e visible false
  cleanup() { demo exit || true; }
fi
trap cleanup EXIT

status=0
maestro --device "$device" test -e APP_ID="$app_id" -e SCHEME="$scheme" --test-output-dir "$run" .maestro/screenshots/listing.yaml || status=$?

# Maestro 2.x files each takeScreenshot under <output>/<run>/<flow>/takeScreenshot/ (price-book large-text.sh).
count=0
for name in 01-home 02-running 03-editor 04-history 05-settings; do
  shot=$(find "$run" -name "$name.png" | head -1)
  if [[ -z $shot ]]; then
    echo "MISSING: $name" >&2
    status=1
    continue
  fi
  cp "$shot" "$dest/$name.png"
  count=$((count + 1))
  if [[ $platform == android ]]; then
    mkdir -p "$dest/play"
    # pad the width so the long side is exactly twice the short side (Play's limit); colour = the light background
    read -r w h < <(sips -g pixelWidth -g pixelHeight "$dest/$name.png" | awk '/pixelWidth/ {w=$2} /pixelHeight/ {h=$2} END {print w, h}')
    target=$(((h + 1) / 2))
    if ((w < target)); then
      sips --padToHeightWidth "$h" "$target" --padColor FFFFFF "$dest/$name.png" --out "$dest/play/$name.png" >/dev/null 2>&1
    else
      cp "$dest/$name.png" "$dest/play/$name.png"
    fi
  fi
done
echo "Screenshots: $count of 5 in $dest (Maestro run: $run)"
# RELEASE_KIT D17: the store icon is uploaded next to these; say so while it is still the Expo template's (P9 check).
if [[ "$(shasum assets/images/icon.png | cut -d' ' -f1)" == 80bf044d3f2d87b752e55c7a5bcafc055a084224 ||
  "$(shasum assets/images/android-icon-foreground.png | cut -d' ' -f1)" == 4c23e2d68168afb9f5af2b3fdeeac9e313cf04ab ]]; then
  echo "NOTE: the app icon is still the Expo template's (RELEASE_KIT D17) - no upload before it is replaced."
fi
for f in "$dest"/0*.png; do [[ -f $f ]] && sips -g pixelWidth -g pixelHeight "$f" | awk -v f="$f" '/pixelWidth/ {w=$2} /pixelHeight/ {h=$2} END {print "  " f ": " w " x " h}'; done
exit "$status"
