# Shared toolchain paths and defaults for project scripts. Source this file; don't run it.
export LANG="${LANG:-en_US.UTF-8}" # CocoaPods requires UTF-8
# Dev builds reach Metro via localhost (Android uses adb reverse); LAN IPs get blocked by firewalls.
export REACT_NATIVE_PACKAGER_HOSTNAME=localhost
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$HOME/.maestro/bin:/opt/homebrew/bin:$PATH"

# Default targets. Override per command, e.g. IOS_SIMULATOR="iPhone 17" npm run ios
export IOS_SIMULATOR="${IOS_SIMULATOR:-Intervals iPhone}"   # this app's own simulator (card-scanner D22 pattern); boot.sh creates it
export IOS_DEVICE_TYPE="${IOS_DEVICE_TYPE:-iPhone 17 Pro}"   # device type used when boot.sh creates IOS_SIMULATOR (P5)
# iOS runtime of that simulator. Empty = newest installed (27.0 with Xcode 27). Older one: IOS_RUNTIME=26.5 npm run ios
# boot.sh (scripts/ios-simulator.js) creates IOS_SIMULATOR on the chosen runtime if it does not exist there yet.
export IOS_RUNTIME="${IOS_RUNTIME:-26.5}"   # dev clients do not start on the 27.0 runtime on this Mac (print-cost D97, Offscan P6)
# This app's own AVD. The first device phase creates it once (same image/device as Pixel_9_API_36):
#   echo no | avdmanager create avd -n Intervals_API_36 -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_9
export ANDROID_AVD="${ANDROID_AVD:-Intervals_API_36}"
# Each new app picks its own emulator port (5554, 5556, ... even numbers) so apps can run emulators in parallel.
export ANDROID_EMULATOR_PORT="${ANDROID_EMULATOR_PORT:-5740}"   # interval-timer (orchestrator, 2026-10-16)
# Pin every adb / Gradle (installDebug, expo run:android) / Maestro call to THIS app's emulator, so a plugged-in
# physical phone (or another app's emulator) is never touched.
export ANDROID_SERIAL="emulator-${ANDROID_EMULATOR_PORT}"

# macOS 27 + Xcode 26: CocoaPods (pod install in `expo prebuild`) picks the Command Line Tools macOS SDK 27,
# whose libSystem.B.tbd fails with "malformed file". Pin the Xcode-shipped SDK. native.sh unsets it after prebuild
# because it must not leak into xcodebuild (it would override the iOS SDK).
if [[ -z "${SDKROOT:-}" ]] && _sdk=$(xcrun --sdk macosx --show-sdk-path 2>/dev/null) && [[ -n $_sdk ]]; then
  export SDKROOT="$_sdk"
fi
unset _sdk

# Variant switch (D10): native.sh runs `expo prebuild --clean` (deletes and re-creates the generated ios/ or android/
# folder) when the last prebuild was for another variant. The owner allowed it on 2026-10-17 00:10 (template D10 status;
# this app was created the day before and still had it off — synced with the template in P8). Set 1 to opt out.
export PREBUILD_KEEP_ON_VARIANT_SWITCH="${PREBUILD_KEEP_ON_VARIANT_SWITCH:-0}"
export METRO_PORT="${METRO_PORT:-8240}"   # unique per app (orchestrator, 2026-10-16)
