#!/usr/bin/env bash
# Assert the vendored CrossPoint submodules are untouched where it matters:
# their HEAD commits, and their gitlinks in this repo's index.
#
# Unstaged edits and untracked files inside the submodules are ALLOWED on
# purpose -- building the simulator creates them.
#
# Usage: guard.sh [--pins <file>] [--root <superproject-dir>]
set -euo pipefail

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PINS="$REPO_ROOT/tools/sim/pins.txt"
ROOT="$REPO_ROOT"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --pins) PINS="$2"; shift 2 ;;
    --root) ROOT="$2"; shift 2 ;;
    *) echo "guard: unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -f "$PINS" ] || { echo "guard: missing pins file: $PINS" >&2; exit 2; }

fail=0
report() { printf 'guard: %s\n' "$1" >&2; fail=1; }

superproject_is_git=false
if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  superproject_is_git=true
fi

# With no commits yet, `git diff --cached` compares against an empty tree and
# reports every staged path, so the gitlink check would always fail on a fresh
# repo. The check becomes meaningful once an initial commit records the
# submodules.
if [ "$superproject_is_git" = true ] && ! git -C "$ROOT" rev-parse --verify -q HEAD >/dev/null; then
  superproject_is_git=false
  echo "guard: note: no commits yet in $ROOT; skipping gitlink checks" >&2
fi

while read -r path want; do
  case "$path" in ''|'#'*) continue ;; esac

  if [ ! -e "$ROOT/$path" ]; then
    report "$path: not checked out; run git submodule update --init --recursive"
    continue
  fi

  have="$(git -C "$ROOT/$path" rev-parse HEAD 2>/dev/null || echo unknown)"
  if [ "$have" != "$want" ]; then
    report "$path: HEAD $have != pinned $want"
    continue
  fi

  if ! git -C "$ROOT/$path" diff --cached --quiet; then
    report "$path: staged changes inside submodule; unstage them (git -C $path restore --staged .)"
  fi

  if [ "$superproject_is_git" = true ]; then
    if ! git -C "$ROOT" diff --cached --quiet -- "$path"; then
      report "$ROOT: staged gitlink change for $path; unstage it"
    fi
  fi

  printf 'guard: ok %s @ %s\n' "$path" "${want:0:8}"
done < <(grep -v '^[[:space:]]*#' "$PINS" | grep -v '^[[:space:]]*$')

if [ "$fail" -ne 0 ]; then
  echo "guard: FAILED" >&2
  exit 1
fi
echo "guard: PASS"
