#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CASE="${1:?usage: capture.sh <case> <page> <bmp-out> [books-dir]}"
PAGE="${2:?page 0 or 1}"
BMP_OUT="${3:?bmp output path}"
BOOKS_DIR="${4:-$ROOT/tools/oracle/artifacts/sd-$CASE/books}"
PROGRAM="${ORACLE_SIM_PROGRAM:-$ROOT/crosspoint-reader/crosspoint-firmware/.pio/build/simulator/program}"

if [[ ! -x "$PROGRAM" ]]; then
	echo "simulator program missing: $PROGRAM (run npm run sim:build)" >&2
	exit 2
fi

SD_ROOT="$(dirname "$BOOKS_DIR")"
mkdir -p "$SD_ROOT" "$BOOKS_DIR" "$(dirname "$BMP_OUT")"

case "$CASE:$PAGE" in
	minimal.xtc:0)
		INPUT_SCRIPT='1500:ENTER;2800:QUIT'
		SCREENSHOTS="2300:$BMP_OUT"
		;;
	cover.xtc:0)
		INPUT_SCRIPT='1500:ENTER;2800:QUIT'
		SCREENSHOTS="2300:$BMP_OUT"
		;;
	cover.xtc:1)
		INPUT_SCRIPT='1500:ENTER;2400:DOWN;3500:QUIT'
		SCREENSHOTS="3000:$BMP_OUT"
		;;
	long.xtc:0)
		INPUT_SCRIPT='1500:ENTER;2800:QUIT'
		SCREENSHOTS="2300:$BMP_OUT"
		;;
	long.xtc:1)
		INPUT_SCRIPT='1500:ENTER;2400:DOWN;3500:QUIT'
		SCREENSHOTS="3000:$BMP_OUT"
		;;
	minimal.xtch:0)
		INPUT_SCRIPT='1500:ENTER;2800:QUIT'
		SCREENSHOTS="2300:$BMP_OUT"
		;;
	*)
		echo "unknown capture case: $CASE:$PAGE" >&2
		exit 2
		;;
esac

# Timings above are first-guess values; the CI probe task replaces them with
# the recorded values before references are committed.

export CROSSPOINT_SIM_SD="$SD_ROOT"
export CROSSPOINT_SIM_INPUT_SCRIPT="$INPUT_SCRIPT"
export CROSSPOINT_SIM_SCREENSHOTS="$SCREENSHOTS"

cd "$(dirname "$PROGRAM")"
if [[ -z "${DISPLAY:-}" ]]; then
	exec xvfb-run -a "$PROGRAM"
else
	exec "$PROGRAM"
fi
