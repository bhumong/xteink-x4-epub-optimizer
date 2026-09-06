# Xteink X4 EPUB Optimizer: Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the device-truth golden oracle: render fixture books through the real app in Chromium, open the output in the pinned CrossPoint simulator on CI, screenshot fixed pages, and pixel-compare against reviewed, committed BMP references.

**Architecture:** Three small tools plus one CI job. `tools/oracle/render-fixture.mjs` drives the shipped Svelte UI with Playwright and saves downloads; `tools/sim/capture.sh` runs one simulator case with deterministic input/screenshot env vars (Xvfb when headless); `tools/oracle/compare-bmp.mjs` is a pure-node BMP comparator with strict equality by default. References live under `fixtures/golden-bmps/` and are committed only after human review of first-run captures.

**Tech Stack:** Node 24, Playwright (existing dev dep), bash, GitHub Actions ubuntu-latest with `libsdl2-dev`, `libssl-dev`, `xvfb`, and PlatformIO installed in the oracle job.

**Spec:** `docs/superpowers/specs/2026-09-06-xteink-x4-epub-optimizer-phase-4-design.md`. Read it and the simulator README's Automated QA section before starting.

## Global Constraints

- `crosspoint-reader/**` read-only; simulator build artifacts stay in ignored paths; `npm run guard` must pass after oracle runs.
- Tools use Node built-ins and existing deps only. No package.json changes.
- References are reviewed by a human before commit; the default CI job never silently regenerates them.
- Compare is strict by default (exact pixel equality); any tolerance is a documented per-case exception after probe evidence.
- Bash scripts are checked with `bash -n`; render behavior is verified locally (no simulator needed); simulator steps verify on CI.
- No `git add -A`; explicit paths only.

---

### Task 0: BMP compare tool

**Files:**

- Create: `tools/oracle/compare-bmp.mjs`

**Interfaces:**

- Produces:

```text
node tools/oracle/compare-bmp.mjs <reference.bmp> <actual.bmp> [--report <path>]
exit 0 = identical, 1 = pixels differ, 2 = missing file
```

- [ ] **Step 1: Implement the tool**

Create `tools/oracle/compare-bmp.mjs`:

```js
import { readFileSync, writeFileSync } from 'node:fs';

function readU16(bytes, offset) {
	return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes, offset) {
	return (
		bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)
	);
}

function readInt32(bytes, offset) {
	const value = readU32(bytes, offset);
	return value > 0x7fffffff ? value - 0x100000000 : value;
}

function loadBmp(path) {
	const bytes = readFileSync(path);
	if (bytes.length < 54 || String.fromCharCode(bytes[0], bytes[1]) !== 'BM') {
		throw new Error(`${path}: not a BMP`);
	}
	const headerSize = readU32(bytes, 14);
	if (headerSize < 40) {
		throw new Error(`${path}: unsupported BMP header size ${headerSize}`);
	}
	const width = readInt32(bytes, 18);
	const heightRaw = readInt32(bytes, 22);
	if (width <= 0 || heightRaw === 0) {
		throw new Error(`${path}: unsupported dimensions ${width}x${heightRaw}`);
	}
	const height = Math.abs(heightRaw);
	const bottomUp = heightRaw > 0;
	const bpp = readU16(bytes, 28);
	const compression = readU32(bytes, 30);
	if (bpp !== 24 && bpp !== 32) {
		throw new Error(`${path}: unsupported bit depth ${bpp}`);
	}
	if (compression !== 0) {
		throw new Error(`${path}: unsupported compression ${compression}`);
	}
	const dataOffset = readU32(bytes, 10);
	const rowBytes = Math.ceil((width * bpp) / 32) * 4;
	const channels = bpp / 8;
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const sourceY = bottomUp ? height - 1 - y : y;
		const rowStart = dataOffset + sourceY * rowBytes;
		for (let x = 0; x < width; x++) {
			const pixel = rowStart + x * channels;
			const target = (y * width + x) * 4;
			data[target] = bytes[pixel + 2]; // R
			data[target + 1] = bytes[pixel + 1]; // G
			data[target + 2] = bytes[pixel]; // B
			data[target + 3] = 255;
		}
	}
	return { width, height, data };
}

function main() {
	const [referencePath, actualPath, flag, flagValue] = process.argv.slice(2);
	if (!referencePath || !actualPath) {
		console.error('usage: compare-bmp.mjs <reference.bmp> <actual.bmp> [--report <path>]');
		process.exit(2);
	}
	let reportPath = null;
	if (flag === '--report' && flagValue) {
		reportPath = flagValue;
	}
	let reference;
	let actual;
	try {
		reference = loadBmp(referencePath);
		actual = loadBmp(actualPath);
	} catch (error) {
		console.error(String(error.message ?? error));
		process.exit(2);
	}
	if (reference.width !== actual.width || reference.height !== actual.height) {
		const message = `dimensions differ: reference ${reference.width}x${reference.height}, actual ${actual.width}x${actual.height}`;
		console.error(message);
		process.exit(1);
	}
	const { width, height } = reference;
	let differing = 0;
	let maxDiff = 0;
	let totalDiff = 0;
	for (let i = 0; i < width * height; i++) {
		const base = i * 4;
		for (let channel = 0; channel < 3; channel++) {
			const diff = Math.abs(reference.data[base + channel] - actual.data[base + channel]);
			if (diff > 0) differing++;
			if (diff > maxDiff) maxDiff = diff;
			totalDiff += diff;
		}
	}
	const report = {
		width,
		height,
		differingPixels: differing,
		maxChannelDiff: maxDiff,
		meanChannelDiff: Number((totalDiff / (width * height * 3)).toFixed(3)),
		identical: differing === 0
	};
	if (reportPath) {
		writeFileSync(reportPath, JSON.stringify(report, null, 2));
	}
	console.log(JSON.stringify(report));
	process.exit(report.identical ? 0 : 1);
}

main();
```

- [ ] **Step 2: Demonstrate both paths locally**

Create two tiny BMPs with a Node one-liner (2x2, 24-bit, bottom-up, one pixel
different) and run the tool:

Run:

```bash
node - <<'EOF'
const { writeFileSync } = require('node:fs');
function bmp(path, pixel) {
	const header = 54;
	const stride = 4; // 1 pixel x 24-bit, padded to 4
	const bytes = Buffer.alloc(header + stride * 2);
	bytes.write('BM', 0);
	bytes.writeUInt32LE(bytes.length, 2);
	bytes.writeUInt32LE(header, 10);
	bytes.writeUInt32LE(40, 14);
	bytes.writeInt32LE(2, 18);
	bytes.writeInt32LE(2, 22);
	bytes.writeUInt16LE(1, 26);
	bytes.writeUInt16LE(24, 28);
	for (let y = 0; y < 2; y++) {
		const row = header + y * stride;
		bytes[row] = pixel;
		bytes[row + 1] = pixel;
		bytes[row + 2] = pixel;
	}
	writeFileSync(path, bytes);
}
bmp('/tmp/ref.bmp', 0);
bmp('/tmp/act.bmp', 0);
EOF
```

Then set the bottom-left pixel (row 0 is stored last in a bottom-up BMP, at
offset 58) to white in `/tmp/act.bmp`, and run:

Run: `node tools/oracle/compare-bmp.mjs /tmp/ref.bmp /tmp/act.bmp --report /tmp/report.json`
Expected: exit 1 and report shows `differingPixels: 1`.

Run: `node tools/oracle/compare-bmp.mjs /tmp/ref.bmp /tmp/ref.bmp`
Expected: exit 0 and `identical: true`.

Run: `node tools/oracle/compare-bmp.mjs /tmp/missing.bmp /tmp/ref.bmp`
Expected: exit 2 with a clear message.

- [ ] **Step 3: Commit**

```bash
git add tools/oracle/compare-bmp.mjs
git commit -m "feat(oracle): add strict BMP pixel comparator"
```

---

### Task 1: Browser render helper

**Files:**

- Create: `tools/oracle/render-fixture.mjs`

**Interfaces:**

- Produces:

```text
node tools/oracle/render-fixture.mjs <fixture-dir> <case> <mode> <out-dir>
```

where `<case>` is one of `minimal`, `cover`, `long`, `<mode>` is `xtc` or
`xtch`, and the output file is `<out-dir>/<case>.<mode>`.

- [ ] **Step 1: Implement the helper**

Create `tools/oracle/render-fixture.mjs`:

```js
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const [, , fixtureDir, caseName, mode, outDir] = process.argv;

if (!fixtureDir || !caseName || !mode || !outDir) {
	console.error('usage: render-fixture.mjs <fixture-dir> <case> <mode> <out-dir>');
	process.exit(2);
}

async function waitForServer(url, timeoutMs) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			// server not up yet
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`app server did not start at ${url}`);
}

const server = spawn(
	'npm',
	['run', 'dev', '-w', 'apps/web', '--', '--port', '5180', '--strictPort'],
	{
		stdio: 'ignore'
	}
);

let browser;
try {
	await waitForServer('http://127.0.0.1:5180', 60_000);
	browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	await page.goto('http://127.0.0.1:5180');
	await page.locator('input[type="file"]').setInputFiles(`${fixtureDir}/book.epub`);
	if (mode === 'xtch') {
		await page.locator('input[value="xtch"]').check();
	} else {
		await page.locator('input[value="xtc"]').check();
	}
	await page.getByRole('button', { name: 'Convert' }).click();
	const label = mode === 'xtch' ? 'Download pre-rendered XTCH' : 'Download pre-rendered XTC';
	const downloadButton = page.getByRole('button', { name: label });
	await downloadButton.waitFor({ timeout: 120_000 });
	const downloadPromise = page.waitForEvent('download');
	await downloadButton.click();
	const download = await downloadPromise;
	await mkdir(outDir, { recursive: true });
	await download.saveAs(`${outDir}/${caseName}.${mode}`);
	console.log(`saved ${caseName}.${mode}`);
} finally {
	await browser?.close();
	server.kill();
}
```

- [ ] **Step 2: Dry-run all four cases locally**

Run:

```bash
node tools/oracle/render-fixture.mjs fixtures/epubs/minimal-epub3 minimal xtc /tmp/oracle-books
node tools/oracle/render-fixture.mjs fixtures/epubs/cover cover xtc /tmp/oracle-books
node tools/oracle/render-fixture.mjs fixtures/epubs/minimal-epub3 minimal xtch /tmp/oracle-books
node tools/oracle/render-fixture.mjs fixtures/epubs/long long xtc /tmp/oracle-books
```

Expected: four files exist; `ls -la /tmp/oracle-books` shows sizes above
48,000/96,000 bytes per mode. The `long` run takes tens of seconds; use a
per-command timeout of 180 s.

- [ ] **Step 3: Verify headers**

Run:

```bash
node -e "const b=require('fs').readFileSync('/tmp/oracle-books/minimal.xtc'); console.log(b.subarray(0,4))"
```

Expected: `<Buffer 58 54 43 00>`; for `minimal.xtch`, `<Buffer 58 54 43 48>`.

- [ ] **Step 4: Commit**

```bash
git add tools/oracle/render-fixture.mjs
git commit -m "feat(oracle): render fixtures through the app UI with Playwright"
```

---

### Task 2: Simulator capture wrapper

**Files:**

- Create: `tools/sim/capture.sh`

**Interfaces:**

- Produces:

```text
ORACLE_SIM_PROGRAM=/path/to/program tools/sim/capture.sh <case> <page> <bmp-out> [books-dir]
```

`<page>` is 0 or 1. `ORACLE_SIM_PROGRAM` defaults to
`crosspoint-reader/crosspoint-firmware/.pio/build/simulator/program`; the books
directory defaults to `tools/oracle/artifacts/sd-<case>/books`. Environment
variables documented in the spec are set for the simulator process.

- [ ] **Step 1: Implement the wrapper**

Create `tools/sim/capture.sh`:

```bash
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
```

- [ ] **Step 2: Syntax check and missing-program path**

Run: `bash -n tools/sim/capture.sh`
Expected: no output, exit 0.

Run: `tools/sim/capture.sh minimal.xtc 0 /tmp/never.bmp`
Expected: exit 2 with the "simulator program missing" message (no simulator
exists locally, so the wrapper must fail loudly and clearly).

- [ ] **Step 3: Verify the env plumbing with a stub program**

Create a stub and run it:

```bash
cat > /tmp/sim-stub <<'EOF'
#!/usr/bin/env bash
env | rg 'CROSSPOINT_SIM_(SD|INPUT_SCRIPT|SCREENSHOTS)' | sort
echo "cwd=$(pwd)"
EOF
chmod +x /tmp/sim-stub
ORACLE_SIM_PROGRAM=/tmp/sim-stub tools/sim/capture.sh cover.xtc 1 /tmp/oracle-bmps/cover-p1.bmp /tmp/sd-cover/books
```

Expected: the three env vars are set, SD root is `/tmp/sd-cover`, and the cwd
is `/tmp`.

- [ ] **Step 4: Commit**

```bash
git add tools/sim/capture.sh
git commit -m "feat(sim): add deterministic capture wrapper for the golden oracle"
```

---

### Task 3: Oracle CI job

**Files:**

- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Produces: a `phase4-oracle` job that renders fixtures, captures simulator
  screenshots, compares against committed references, uploads artifacts on
  failure or missing references, and runs the guard.

- [ ] **Step 1: Add the job**

Append to `.github/workflows/ci.yml`:

```yaml
oracle:
  name: Phase 4 golden oracle
  runs-on: ubuntu-latest
  needs: verify
  timeout-minutes: 120
  steps:
    - uses: actions/checkout@v4
      with:
        submodules: recursive
        fetch-depth: 0
    - uses: actions/setup-node@v4
      with:
        node-version: 24
        cache: npm
    - name: Install simulator host deps
      run: |
        sudo apt-get update
        sudo apt-get install -y libsdl2-dev libssl-dev xvfb
        python3 -m pip install --user platformio
        echo "$HOME/.local/bin" >> "$GITHUB_PATH"
    - run: npm ci
    - run: npx playwright install --with-deps chromium
    - run: npm run sim:setup
    - run: npm run sim:build
    - name: Render fixture books
      run: |
        mkdir -p tools/oracle/artifacts/books
        node tools/oracle/render-fixture.mjs fixtures/epubs/minimal-epub3 minimal xtc tools/oracle/artifacts/books
        node tools/oracle/render-fixture.mjs fixtures/epubs/cover cover xtc tools/oracle/artifacts/books
        node tools/oracle/render-fixture.mjs fixtures/epubs/minimal-epub3 minimal xtch tools/oracle/artifacts/books
        node tools/oracle/render-fixture.mjs fixtures/epubs/long long xtc tools/oracle/artifacts/books
    - name: Capture simulator pages
      run: |
        set -e
        for spec in "minimal.xtc:0" "cover.xtc:0" "cover.xtc:1" "long.xtc:0" "long.xtc:1" "minimal.xtch:0"; do
          case_name="${spec%%:*}"
          page="${spec##*:}"
          mkdir -p "tools/oracle/artifacts/books"
          mkdir -p "tools/oracle/artifacts/sd-$case_name/books"
          cp "tools/oracle/artifacts/books/$case_name" "tools/oracle/artifacts/sd-$case_name/books/$case_name"
          tools/sim/capture.sh "$case_name" "$page" "tools/oracle/artifacts/captures/$case_name-p$page.bmp" "tools/oracle/artifacts/sd-$case_name/books"
        done
    - name: Compare with references
      run: |
        set -e
        for spec in "minimal.xtc:0" "cover.xtc:0" "cover.xtc:1" "long.xtc:0" "long.xtc:1" "minimal.xtch:0"; do
          case_name="${spec%%:*}"
          page="${spec##*:}"
          reference="fixtures/golden-bmps/$case_name-p$page.bmp"
          actual="tools/oracle/artifacts/captures/$case_name-p$page.bmp"
          if [[ ! -f "$reference" ]]; then
            echo "REFERENCE_MISSING $reference"
            continue
          fi
          node tools/oracle/compare-bmp.mjs "$reference" "$actual" \
            --report "tools/oracle/artifacts/reports/$case_name-p$page.json"
        done
    - run: npm run guard
    - name: Upload oracle artifacts
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: oracle-artifacts
        path: tools/oracle/artifacts/**
        if-no-files-found: ignore
```

Note: the reference-compare loop above exits non-zero on pixel differences
(`set -e`) but passes when a reference is missing, so the first CI run after
this job lands uploads candidate BMPs without reddening the suite. Once
references are committed (Task 5), missing-file branches no longer run and the
same loop is strict.

- [ ] **Step 2: Validate YAML locally**

Run: `node -e "const yaml=require('js-yaml'); " 2>/dev/null || echo "no yaml parser; visual check"`
If no local YAML parser exists, do a visual indentation review and commit; the
workflow parser is the real validator on push.

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(oracle): add Phase 4 golden oracle job"
git push origin main
```

Expected: the `verify` job is green and the `oracle` job runs; with no
references committed yet, its compare step reports `REFERENCE_MISSING` lines
and uploads `oracle-artifacts` containing the rendered books and captured BMPs.

---

### Task 4: Navigation probe and reference review

**Files:**

- Consumed: `tools/oracle/artifacts/captures/*.bmp` from the first oracle run.
- Produces: recorded probe timings; reviewed candidate BMPs.

- [ ] **Step 1: Fetch artifacts**

Download `oracle-artifacts` from the first oracle run (via the GitHub UI or
`gh run download`) into `tools/oracle/artifacts/`.

- [ ] **Step 2: Inspect the captures**

Open each BMP in `tools/oracle/artifacts/captures/` and verify:

- `minimal.xtc-p0.bmp` shows the text page (dark text on white), not the home
  screen or file browser;
- `cover.xtc-p0.bmp` shows the flat grayscale cover region;
- `cover.xtc-p1.bmp` and `long.xtc-p1.bmp` show the second page (one page
  turn worked);
- `minimal.xtch-p0.bmp` shows the text page with grayscale rendering.

If any capture shows the wrong screen, record the timing adjustment in the
case table of `tools/sim/capture.sh` (home/enter/page-turn/settle), rerun the
oracle job, and repeat until every capture shows the right screen.

- [ ] **Step 3: Get human approval of the candidates**

Present the candidate BMPs to the user and wait for approval before treating
them as ground truth. Rejections become case-table or pipeline fixes; an
approved set becomes the references.

- [ ] **Step 4: Commit references**

```bash
mkdir -p fixtures/golden-bmps
cp tools/oracle/artifacts/captures/*.bmp fixtures/golden-bmps/
git add fixtures/golden-bmps
git commit -m "test(oracle): commit simulator golden BMP references"
git push origin main
```

Expected: the oracle job now runs strict comparisons and passes.

---

### Task 5: Second green run and close-out

**Files:**

- Modify: `AGENTS.md`

- [ ] **Step 1: Re-run until two consecutive green oracle jobs**

Push any no-op documentation change or rerun the workflow; record the two
green run IDs in the commit message or memory notes. Any strict-compare
failure goes through the spec's tuning loop (owning module fix first, timing
fix second, reference update only after review).

- [ ] **Step 2: Update AGENTS.md**

Add rows to the module map:

```text
| `tools/oracle/`                      | golden oracle: render fixtures, capture simulator BMPs, compare strict | n/a  |
| `tools/sim/`                         | simulator setup, guard, golden capture                                 | n/a  |
```

Run `npx prettier --write AGENTS.md` if the table needs realignment.

- [ ] **Step 3: Final verification and commit**

Run locally: `npm run format && npm run lint && npm run check && npm run test:node && npm run guard`
Expected: green. The simulator-dependent steps are verified by the green
oracle job, not locally.

```bash
git add AGENTS.md
git commit -m "docs(agents): document oracle tooling"
git push origin main
```

---

## Self-review notes

Checked against the Phase 4 spec after writing:

- Spec Section 5.1 render helper: Task 1.
- Spec Section 5.2 capture wrapper: Task 2.
- Spec Section 5.3 comparator: Task 0.
- Spec Sections 6-7 CI job and cases: Task 3.
- Spec Section 8 navigation probe: Task 4.
- Spec Section 9 tuning loop: Tasks 4-5.
- Spec Section 10 files touched: Tasks 0-5.
- Spec Section 11 exit criteria: strict compare demo (Task 0), references
  reviewed and committed (Task 4), two consecutive green runs (Task 5).

Execution notes for the agent:

- Local verification covers everything except simulator boot, navigation, and
  pixel ground truth; those are CI-only by design because the host deps cannot
  be installed in this workspace.
- Reference-missing runs exit 0 so the first oracle run does not redden CI,
  but every reference present in the repo is compared strictly.
- If the render helper's spawned Vite server conflicts with an existing
  process on port 5180, pass a different port via an `ORACLE_APP_PORT`
  environment variable and update the script and CI command together.
