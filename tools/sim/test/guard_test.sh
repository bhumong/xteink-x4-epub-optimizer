#!/usr/bin/env bash
# Tests tools/sim/guard.sh against synthetic repos under a temp dir.
set -euo pipefail

GUARD="${BASH_SOURCE[0]%/*}/../guard.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fails=0
expect_status() {
  local want="$1" label="$2"; shift 2
  local got=0
  "$@" >/dev/null 2>&1 || got=$?
  if [ "$got" = "$want" ]; then
    echo "  ok   $label"
  else
    echo "  FAIL $label (expected exit $want, got $got)"
    fails=$((fails + 1))
  fi
}

# advice.addEmbeddedRepo is off because case 6 stages an embedded repo
# deliberately; the advisory is correct for real work and noise here.
g() { git -c user.email=t@t -c user.name=t -c advice.addEmbeddedRepo=false "$@"; }

# new_sub <dir>: make an embedded git repo with one commit
new_sub() {
  mkdir -p "$1"
  g -C "$1" init -q
  echo base > "$1/tracked.txt"
  g -C "$1" add tracked.txt
  g -C "$1" commit -qm init
}

# --- case 1: clean synthetic root passes -------------------------------
C1="$WORK/case1"; mkdir -p "$C1"; new_sub "$C1/sub"
printf 'sub %s\n' "$(g -C "$C1/sub" rev-parse HEAD)" > "$WORK/pins1.txt"
expect_status 0 "clean repo passes" bash "$GUARD" --pins "$WORK/pins1.txt" --root "$C1"

# --- case 2: submodule HEAD moved past the pin -------------------------
C2="$WORK/case2"; mkdir -p "$C2"; new_sub "$C2/sub"
printf 'sub %s\n' "$(g -C "$C2/sub" rev-parse HEAD)" > "$WORK/pins2.txt"
echo change > "$C2/sub/tracked.txt"; g -C "$C2/sub" commit -qam advance
expect_status 1 "moved HEAD fails" bash "$GUARD" --pins "$WORK/pins2.txt" --root "$C2"

# --- case 3: staged change inside the submodule ------------------------
C3="$WORK/case3"; mkdir -p "$C3"; new_sub "$C3/sub"
printf 'sub %s\n' "$(g -C "$C3/sub" rev-parse HEAD)" > "$WORK/pins3.txt"
echo new > "$C3/sub/staged.txt"; g -C "$C3/sub" add staged.txt
expect_status 1 "staged submodule change fails" bash "$GUARD" --pins "$WORK/pins3.txt" --root "$C3"

# --- case 4: unstaged edit plus untracked file is allowed --------------
C4="$WORK/case4"; mkdir -p "$C4"; new_sub "$C4/sub"
printf 'sub %s\n' "$(g -C "$C4/sub" rev-parse HEAD)" > "$WORK/pins4.txt"
echo dirty > "$C4/sub/tracked.txt"; mkdir -p "$C4/sub/ignored" && echo x > "$C4/sub/ignored/f"
expect_status 0 "unstaged and untracked are allowed" bash "$GUARD" --pins "$WORK/pins4.txt" --root "$C4"

# --- case 5: missing submodule directory is reported -------------------
C5="$WORK/case5"; mkdir -p "$C5"
printf 'sub %s\n' 0000000000000000000000000000000000000000 > "$WORK/pins5.txt"
expect_status 1 "missing checkout fails" bash "$GUARD" --pins "$WORK/pins5.txt" --root "$C5"

# --- case 6: staged gitlink change in the superproject -----------------
C6="$WORK/case6"; mkdir -p "$C6"; new_sub "$C6/sub"
g -C "$C6" init -q
printf 'sub %s\n' "$(g -C "$C6/sub" rev-parse HEAD)" > "$WORK/pins6.txt"
# Staging an embedded repo is the whole point of this case, so git's
# "adding embedded git repository" warning is expected noise, not a defect.
g -C "$C6" add sub 2>/dev/null; g -C "$C6" commit -qm 'track gitlink'
echo y > "$C6/sub/other.txt"; g -C "$C6/sub" add other.txt; g -C "$C6/sub" commit -qm 'advance'
g -C "$C6" add sub 2>/dev/null
expect_status 1 "staged gitlink change fails" bash "$GUARD" --pins "$WORK/pins6.txt" --root "$C6"

# --- case 7: the real repo passes with its real pins -------------------
expect_status 0 "real repo passes" bash "$GUARD"

if [ "$fails" -ne 0 ]; then
  echo "guard_test: $fails FAILED"
  exit 1
fi
echo "guard_test: PASS"
