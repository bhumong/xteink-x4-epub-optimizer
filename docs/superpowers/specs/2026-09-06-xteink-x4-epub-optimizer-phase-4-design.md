# Xteink X4 EPUB Optimizer: Phase 4 Design Spec

Status: ready for spec review (2026-09-06)
Parent spec: `docs/superpowers/specs/2026-09-03-xteink-x4-epub-optimizer-design.md`
Phase 3 spec: `docs/superpowers/specs/2026-09-06-xteink-x4-epub-optimizer-phase-3-design.md`

## 1. Goal

Prove pre-rendered output against the device, not against our own assumptions:
render fixture EPUBs with the real app pipeline, open the resulting `.xtc` and
`.xtch` files in the pinned CrossPoint simulator, capture what the firmware
actually displays, and diff those screenshots pixel-for-pixel against committed
reference BMPs. The loop runs on GitHub Actions, where the simulator host deps
can be installed. Tuning happens only when a comparison fails, and only through
the constants and modules the Phase 3 spec already exposes.

## 2. Scope

In scope:

- A GitHub Actions oracle job: install simulator host deps, build the
  simulator, run a headless browser render of fixture books into `.xtc`/`.xtch`,
  navigate the simulator to fixed pages with its input script, capture BMPs,
  and compare them with committed references.
- `tools/oracle/render-fixture.mjs`: Playwright drives the real Svelte UI to
  convert a fixture and save the download, so the bytes under test are the
  product path, not a test-only call.
- `tools/oracle/compare-bmp.mjs`: pure-node BMP reader and pixel comparator
  with exact-match default and diff reporting.
- `tools/sim/capture.sh`: runs one simulator capture case (SD root, input
  script, screenshot schedule, output directory) with an Xvfb wrapper when no
  display is available.
- Reference BMPs for both output modes committed under
  `fixtures/golden-bmps/` after first-run screenshots are reviewed.
- A documented tuning loop with a deterministic first probe of simulator
  navigation timing (enter library, open the only book, page turns).

Out of scope:

- Local simulator builds in this workspace (host deps are absent and cannot be
  installed here); the job runs on CI instead.
- Conversion-performance work (measured Phase 3 speed of the `long` fixture is
  recorded but deliberately not tuned in this phase).
- New layout features, font additions, or changes to the Phase 3 paint subset
  unless a failing comparison demands one, in which case the change is
  scoped through the normal spec process.
- Reference generation on every push: default job only compares; regenerating
  references is a separate reviewable step.

## 3. Hard project rules that apply

1. `crosspoint-reader/**` stays read-only; simulator build outputs land only in
   submodule-ignored paths, and `npm run guard` must pass after every job.
2. Output is download-only. The oracle writes files into the simulator SD
   root, never onto a device.
3. All book processing runs in the browser; the render helper drives the
   shipped Svelte app.
4. No new runtime dependency: compare and render scripts use Node built-ins,
   Playwright (already present), and the existing workspace packages.

## 4. Device contract (verified)

The pinned simulator is the ground truth; facts used by the oracle come from
its README and source:

| Fact                                                                                              | Source                                                                                        |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `CROSSPOINT_SIM_INPUT_SCRIPT` schedules key/touch input as `ms:action` items from process start   | `crosspoint-reader/crosspoint-simulator/README.md` (Automated QA section)                     |
| `CROSSPOINT_SIM_SCREENSHOTS` saves BMP frames as `ms:path` items; destination dirs must pre-exist | simulator `README.md` (same section), `src/HalDisplay.cpp:64-137`                             |
| `CROSSPOINT_SIM_SD` overrides the SD root; books live under the SD root                           | `crosspoint-reader/crosspoint-simulator/src/HalStorage.cpp:21`                                |
| The screenshot is the SDL renderer output at the host drawable resolution                         | simulator `README.md` (Automated QA section)                                                  |
| XTC page rendering draws black ink per page bit and the default status-bar mode is hidden         | firmware `src/activities/reader/XtcReaderActivity.cpp:260-271` and `CrossPointSettings.h:372` |

All timings (boot to home, open book, page turn settle) are empirical in the
pinned build and are pinned by a probe before references are trusted.

## 5. Architecture

One CI job runs the whole oracle; local scripts stay runnable for anyone with
a built simulator:

```text
fixture .epub
  -> tools/oracle/render-fixture.mjs   (Playwright + the real app UI)
  -> artifacts/books/<case>.xtc|.xtch
  -> tools/sim/capture.sh              (simulator SD root + input script)
  -> artifacts/captures/<case>.bmp
  -> tools/oracle/compare-bmp.mjs      (vs fixtures/golden-bmps/<case>.bmp)
```

### 5.1 Render helper

`tools/oracle/render-fixture.mjs` reuses the existing Playwright web server
configuration: it opens the app, sets the fixture file input, selects the mode
radio (`xtc` or `xtch`), clicks Convert, waits for the mode-specific download
button, and saves the suggested download into `artifacts/books/` under a
stable case name (`minimal.xtc`, `cover.xtc`, `minimal.xtch`, `long.xtc`).
The UI's metadata naming is used for the download; the script renames by case
so simulator navigation and references are stable.

### 5.2 Simulator capture

`tools/sim/capture.sh <case> <bmp-path>`:

1. Locates the built simulator program under the firmware tree (fails with a
   clear message when absent).
2. Prepares an SD root under `tools/oracle/artifacts/sd-<case>/` containing
   `books/<case>.<ext>` plus the firmware's expected default directories.
3. Runs the program with `CROSSPOINT_SIM_SD`, `CROSSPOINT_SIM_INPUT_SCRIPT`,
   and `CROSSPOINT_SIM_SCREENSHOTS` set from the case table, wrapped in
   `xvfb-run` when `DISPLAY` is empty.
4. Exits with the simulator's exit code.

The case table (per-fixture input and screenshot schedule) lives in the script
with the values the probe task records. Navigation is minimal by design: the
SD root contains exactly one book, so home shows one entry; the script enters
it and presses `DOWN` the page-turn count for the case before the screenshot
time.

### 5.3 Compare helper

`tools/oracle/compare-bmp.mjs <reference> <actual> [--report path]` parses
24/32-bit BMPs with Node built-ins, requires identical dimensions, and reports
per-pixel channel differences. The default assertion is exact equality; the
tool exits non-zero on any differing pixel and writes a JSON report (mean,
max, differing-pixel count). If the first probe shows deterministic but
non-zero device pixels (for example waveform settling or the status-bar hide
state), the spec's probe record captures the observed values and the compare
invocation is adjusted once with a documented tolerance; the report always
contains the strict numbers.

## 6. Cases and references

| Case         | Fixture       | Mode | Pages captured                        | Reference BMP                             |
| ------------ | ------------- | ---- | ------------------------------------- | ----------------------------------------- |
| minimal.xtc  | minimal-epub3 | xtc  | page 0 (text page)                    | `fixtures/golden-bmps/minimal-xtc-p0.bmp` |
| cover.xtc    | cover         | xtc  | page 0 (synthesized cover) and page 1 | `cover-xtc-p0.bmp`, `cover-xtc-p1.bmp`    |
| minimal.xtch | minimal-epub3 | xtch | page 0 (2-bit gray text)              | `minimal-xtch-p0.bmp`                     |
| long.xtc     | long          | xtc  | page 0 and one turned page            | `long-xtc-p0.bmp`, `long-xtc-p1.bmp`      |

These cover both output modes, a flat grayscale cover region, text on white,
and a page turn, without making each CI run convert or screenshot hundreds of
pages.

## 7. CI job

`phase4-oracle` runs on `ubuntu-latest` after the existing verify job passes:

1. Checkout recursive, setup Node 24, `npm ci`, install Chromium for
   Playwright.
2. `sudo apt-get install -y libsdl2-dev libssl-dev xvfb` and
   `pip install platformio`.
3. `npm run sim:setup`, `npm run sim:build`.
4. Run the render helper for the four cases.
5. Run `tools/sim/capture.sh` for each case/page in the table.
6. Run the compare helper against committed references.
7. `npm run guard`.
8. On failure, upload `artifacts/` and the compare reports so differences are
   inspectable.

When references are missing (first run after this phase lands), the compare
step exits with a distinct "references missing" status and the job uploads the
candidate BMPs as artifacts instead of failing the suite silently. Reference
generation is therefore an explicit, reviewed commit, not an artifact of the
default job.

## 8. Navigation probe (first CI task)

Before references are trusted, a probe run captures a short sequence of
screenshots across the boot and open-book flow (home at ~1200 ms, post-enter at
~2500 ms, post-page-turn at ~3500 ms) for `minimal.xtc`. The recorded timings
and button sequences become the case table values. The probe is a CI artifact
review, not a committed assertion, because boot timing is empirical to the
pinned simulator build and SD state.

## 9. Tuning loop

On any compare failure the run must distinguish:

- **Deterministic difference**: screenshot differs from the committed
  reference. Inspect the diff report and candidate BMP; if the difference is a
  bug in painter, quantizer, or writer output, fix it in the owning module with
  its normal tests, then rerun.
- **Timing flake**: screenshot is of the wrong screen. Adjust the case table,
  never the reference.
- **Legitimate reference update**: the device-truth changed deliberately
  (upstream submodule or engine change). Updating a reference is a reviewed
  commit with the old and new BMPs shown.

Phase 3 exposed the tunable constants (quantizer thresholds and dither,
painter baseline and metrics) precisely so this loop has a small, documented
knob set.

## 10. Files touched

New:

- `tools/oracle/render-fixture.mjs`
- `tools/oracle/compare-bmp.mjs`
- `tools/sim/capture.sh`
- `.github/workflows/ci.yml` phase4-oracle job
- `fixtures/golden-bmps/*.bmp` (reviewed references)

Modified:

- `AGENTS.md`: module-map rows for `tools/sim/` golden capture and the new
  `tools/oracle/` scripts.
- Phase 4 plan replaces nothing existing; simulator scripts remain untouched
  except the new capture entry.

## 11. Phase 4 exit criteria

1. The `phase4-oracle` CI job passes twice in a row with committed references
   for all six BMPs in the case table.
2. Compare is exact-match by default; any deviation is documented in the spec's
   probe record with numbers.
3. `npm run guard` passes in the oracle job after simulator builds and runs.
4. Existing suites stay green: no change to Phase 1-3 output bytes or tests.
5. The compare tool's failure path is demonstrated once during implementation
   (two hand-built BMPs that differ in one pixel exit non-zero with a report),
   and the CI job's strict comparisons pass after references are committed.

## 12. Decisions locked and risks

Locked decisions:

- The oracle's "expected" image is the device's own render of our pages,
  captured by the simulator; committed references are reviewed before trust.
- Default compare is strict; relaxed tolerance is a documented, per-case
  exception after evidence, never a default.
- References regenerate only through an explicit reviewed commit.
- Both 1-bit and 2-bit modes are in the first case set; long books are sampled,
  not fully converted per page in CI.

Risks:

| Risk                                                        | Mitigation                                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Simulator boot/navigation timing is empirical               | probe task pins timings; failures report wrong-screen screenshots instead of pixel diffs |
| Device pixels differ deterministically from strict equality | probe records exact numbers; per-case documented tolerance; reports keep strict stats    |
| CI job time or flakiness                                    | minimal case set, one page turn max per case, uploaded artifacts for diagnosis           |
| Reference BMPs become stale after upstream changes          | guard pins submodules; reference updates are explicit reviewed commits with old/new BMPs |
| PlatformIO/SDL install drift on ubuntu-latest               | apt and pip versions pinned in the job; failure surfaces install output                  |
