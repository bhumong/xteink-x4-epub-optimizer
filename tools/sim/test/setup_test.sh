#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "${BASH_SOURCE[0]%/*}/../../.." && pwd)"
FW="$ROOT/crosspoint-reader/crosspoint-firmware"
TARGET="$FW/platformio.local.ini"
TPL="$ROOT/tools/sim/platformio.local.ini.tpl"

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

if [ -f "$TARGET" ]; then ok "platformio.local.ini installed"; else bad "platformio.local.ini missing"; fi

if [ -f "$TARGET" ] && cmp -s "$TARGET" "$TPL"; then
  ok "installed copy matches template"
else
  bad "installed copy differs from template"
fi

# The firmware repo ignores *.local*, so the installed copy can never be
# committed there. Assert it rather than trusting the pattern.
if git -C "$FW" check-ignore -q platformio.local.ini; then
  ok "installed copy is git-ignored by the submodule"
else
  bad "installed copy is NOT ignored; it could be committed"
fi

if [ -d "$FW/freeink-sdk/libs/ui/FreeInkUI" ]; then
  ok "nested freeink-sdk submodule initialized"
else
  bad "freeink-sdk not initialized (needed by simulator lib_deps)"
fi

if git -C "$FW" diff --cached --quiet && git -C "$ROOT" diff --cached --quiet; then
  ok "nothing staged in submodule or superproject"
else
  bad "setup staged changes; that violates the read-only rule"
fi

if [ "$fails" -ne 0 ]; then
  echo "setup_test: $fails FAILED"
  exit 1
fi
echo "setup_test: PASS"
