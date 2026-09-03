#!/usr/bin/env bash
# Make the firmware submodule buildable as a desktop simulator without
# committing anything to it. Safe to re-run.
set -euo pipefail

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FW="$ROOT/crosspoint-reader/crosspoint-firmware"
TPL="$SCRIPT_DIR/platformio.local.ini.tpl"

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "setup: missing required command '$1'." >&2
    echo "setup: install with: $2" >&2
    exit 3
  fi
}

[ -d "$FW" ] || { echo "setup: $FW missing; run git submodule update --init" >&2; exit 3; }

require git "your OS package manager"
require python3 "your OS package manager"
require sdl2-config "sudo apt install libsdl2-dev"
if ! command -v pio >/dev/null 2>&1; then
  echo "setup: 'pio' not found. Install with: pip install platformio (or pipx install platformio)" >&2
  echo "setup: then re-run npm run sim:setup" >&2
  exit 3
fi

npm --prefix "$ROOT" run --silent guard

# The firmware's own .gitmodules declares this nested submodule and the
# simulator's lib_deps symlink into it. --init is recursive so the SDK pin
# recorded by the firmware is what gets checked out.
echo "setup: initializing nested freeink-sdk submodule"
git -C "$FW" submodule update --init --recursive --depth 1 freeink-sdk

echo "setup: installing simulator env -> $FW/platformio.local.ini"
cp "$TPL" "$FW/platformio.local.ini"

npm --prefix "$ROOT" run --silent guard
bash "$SCRIPT_DIR/test/setup_test.sh"
