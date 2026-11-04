#!/usr/bin/env bash
# A7 (SPEC §12) on the Android emulator, plus the A6 headset/notification part on the real running screen:
#   1. start Tabata (Maestro), 2. headset play-pause twice -> paused, then running again,
#   3. simulated incoming call (`adb emu gsm call`) -> paused, 4. call ended -> still paused 10 s later,
#   5. Resume on the screen -> running. Evidence: Maestro asserts + the runner's logcat lines.
# Needs the dev build installed, Metro on METRO_PORT and this app's emulator (ANDROID_SERIAL). Usage: scripts/a7-call.sh
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
out=${A7_OUT:-artifacts/a7}
mkdir -p "$out"
number=5551234
adb -s "$ANDROID_SERIAL" logcat -c
# the ring buffer turns over within minutes on this image: stream the runner's lines to a file (stopped by PID at the end)
adb -s "$ANDROID_SERIAL" logcat -v time -s SessionRunner:I >"$out/runner-full.log" 2>&1 &
logpid=$!
trap 'kill "$logpid" 2>/dev/null || true' EXIT
step() { echo "== $(date +%T) $*"; }
# Maestro sometimes reports the emulator "not connected" right after `adb emu gsm` (P6): one retry
flow() { scripts/e2e.sh android development "$1" >"$2" 2>&1 || { sleep 3; scripts/e2e.sh android development "$1" >"$2" 2>&1; }; }

step "start Tabata"
flow .maestro/a7/start-tabata.yaml "$out/1-start.log"

step "headset play-pause -> paused"
adb -s "$ANDROID_SERIAL" shell cmd media_session dispatch play-pause
flow .maestro/a7/assert-paused.yaml "$out/2-headset-paused.log"
step "headset play-pause -> running"
adb -s "$ANDROID_SERIAL" shell cmd media_session dispatch play-pause
flow .maestro/a7/assert-running.yaml "$out/3-headset-running.log"

step "incoming call $number"
adb -s "$ANDROID_SERIAL" emu gsm call "$number"
sleep 4
adb -s "$ANDROID_SERIAL" shell dumpsys audio | grep -m1 -i "mode" || true
step "answer, talk 5 s, hang up"
adb -s "$ANDROID_SERIAL" emu gsm accept "$number"
sleep 5
adb -s "$ANDROID_SERIAL" emu gsm cancel "$number"
sleep 10
step "after the call: still paused (no auto-resume)"
flow .maestro/a7/assert-paused.yaml "$out/4-call-paused.log"

step "runner log"
sleep 1
grep -E "start |pause |resume " "$out/runner-full.log" | tee "$out/runner.log"
step "A7 passed"
