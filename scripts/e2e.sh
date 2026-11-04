#!/usr/bin/env bash
# Run Maestro flows against the build already installed on the simulator/emulator.
# Usage: scripts/e2e.sh <ios|android> [development|preview|production] [flow.yaml ...]
# With no flows, runs every top-level flow in .maestro/.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh

platform=${1:?Usage: e2e.sh <ios|android> [variant] [flows...]}
variant=${2:-development}
shift $(($# >= 2 ? 2 : 1))
flows=("$@")
[[ ${#flows[@]} -gt 0 ]] || flows=(.maestro)

config=$(APP_VARIANT=$variant npx expo config --json --type public)
app_id=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).ios.bundleIdentifier)' <<<"$config")
# the variant's URL scheme, for flows that open share links (import-link.yaml, start-two-taps.yaml)
scheme=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).scheme)' <<<"$config")

# curl is blocked on this Mac: check Metro with node's fetch.
if [[ $variant == development ]] && ! node -e 'fetch("http://localhost:"+process.argv[1]+"/status").then((r) => r.text()).then((t) => process.exit(t.includes("running") ? 0 : 1)).catch(() => process.exit(1))' "$METRO_PORT"; then
  echo "Metro is not running. Start it with: npm run dev (port $METRO_PORT)" >&2
  exit 1
fi

device=$(scripts/boot.sh "$platform")
out="artifacts/maestro/$platform-$variant-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"
echo "Maestro: $app_id on $platform ($device) -> $out"
extra=()
for kv in ${MAESTRO_ENV:-}; do extra+=(-e "$kv"); done
# iOS-only flows (live-activity.yaml) are skipped on Android; dev-only flows (cue-selftest.yaml: the debug route says
# "Development builds only." in a release build) are skipped on preview/production (P8)
skip=()
[[ $platform == android ]] && skip+=(ios-only)
[[ $variant != development ]] && skip+=(dev-only)
if [[ ${#skip[@]} -gt 0 ]]; then extra+=(--exclude-tags "$(IFS=,; echo "${skip[*]}")"); fi
maestro --device "$device" test -e APP_ID="$app_id" -e SCHEME="$scheme" ${extra[@]+"${extra[@]}"} --test-output-dir "$out" "${flows[@]}"
