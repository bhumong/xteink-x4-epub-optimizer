#!/usr/bin/env bash
# Build and/or run the desktop simulator from the firmware submodule.
# Usage: run.sh [build|run]   (default: run)
set -euo pipefail

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FW="$ROOT/crosspoint-reader/crosspoint-firmware"
MODE="${1:-run}"

if [ ! -f "$FW/platformio.local.ini" ]; then
  echo "run.sh: simulator env not installed; run npm run sim:setup first" >&2
  exit 3
fi

cd "$FW"
npm --prefix "$ROOT" run --silent guard

case "$MODE" in
  build) pio run -e simulator ;;
  run) pio run -e simulator -t run_simulator ;;
  *)
    echo "run.sh: mode must be build or run, got '$MODE'" >&2
    exit 2
    ;;
esac

npm --prefix "$ROOT" run --silent guard
