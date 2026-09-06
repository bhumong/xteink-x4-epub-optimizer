#!/usr/bin/env bash
# Local golden-oracle driver (replaces the removed CI oracle job).
#
# Usage:
#   tools/oracle/run-oracle.sh [artifacts-dir]
#
# Prereqs:
#   1. Render books first (playwright/chromium available locally):
#        node tools/oracle/render-fixture.mjs fixtures/epubs/minimal-epub3 minimal xtc  artifacts/books
#        node tools/oracle/render-fixture.mjs fixtures/epubs/cover       cover    xtc  artifacts/books
#        node tools/oracle/render-fixture.mjs fixtures/epubs/minimal-epub3 minimal xtch artifacts/books
#        node tools/oracle/render-fixture.mjs fixtures/epubs/long        long     xtc  artifacts/books
#   2. Build the simulator on a machine with the host deps and point this
#      script at it:
#        ORACLE_SIM_PROGRAM=/path/to/.pio/build/simulator/program tools/oracle/run-oracle.sh
#
# Exit codes: 0 all captures compared and passed; 2 prerequisites missing or a
# capture failed; 1 a strict comparison failed (report files in artifacts/reports).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACTS="${1:-$ROOT/tools/oracle/artifacts}"
BOOKS_DIR="$ARTIFACTS/books"
PROGRAM="${ORACLE_SIM_PROGRAM:-$ROOT/crosspoint-reader/crosspoint-firmware/.pio/build/simulator/program}"

if [[ ! -x "$PROGRAM" ]]; then
	echo "simulator program missing: $PROGRAM" >&2
	echo "build it locally (npm run sim:setup && npm run sim:build) or set ORACLE_SIM_PROGRAM" >&2
	exit 2
fi

CASES=("minimal.xtc:0" "cover.xtc:0" "cover.xtc:1" "long.xtc:0" "long.xtc:1" "minimal.xtch:0")
mkdir -p "$ARTIFACTS/captures" "$ARTIFACTS/reports"

status=0
for spec in "${CASES[@]}"; do
	case_name="${spec%%:*}"
	page="${spec##*:}"
	book="$BOOKS_DIR/$case_name"
	if [[ ! -f "$book" ]]; then
		echo "missing rendered book: $book (run the render-fixture commands first)" >&2
		exit 2
	fi
	mkdir -p "$ARTIFACTS/sd-$case_name/books"
	cp "$book" "$ARTIFACTS/sd-$case_name/books/$case_name"
	"$ROOT/tools/sim/capture.sh" "$case_name" "$page" "$ARTIFACTS/captures/$case_name-p$page.bmp" \
		"$ARTIFACTS/sd-$case_name/books" || status=2

	reference="$ROOT/fixtures/golden-bmps/$case_name-p$page.bmp"
	if [[ ! -f "$reference" ]]; then
		echo "REFERENCE_MISSING $reference (candidate saved to $ARTIFACTS/captures/)"
		continue
	fi
	if ! node "$ROOT/tools/oracle/compare-bmp.mjs" "$reference" \
		"$ARTIFACTS/captures/$case_name-p$page.bmp" \
		--report "$ARTIFACTS/reports/$case_name-p$page.json"; then
		status=1
	fi
done

if [[ "$status" -eq 0 ]]; then
	echo "oracle: all captures matched references"
fi
exit "$status"
