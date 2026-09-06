# Project Memory

Last updated: 2026-09-06

## Current Goal

Build a web app that optimizes EPUB books for the Xteink X4 running CrossPoint reader firmware (`crosspoint-reader`). Processing runs in the browser. Hono only hosts the app. Two output modes are planned:

1. Optimized `.epub` for the device's EPUB engine.
2. Pre-rendered `.xtc` / `.xtch` for instant page turns.

Output is download-only. The app never uploads to the device, uses WebUSB, or talks to the reader's web server.

## Hard Rules

- `crosspoint-reader/**` is vendored read-only reference.
- Never stage, commit, or push inside either submodule.
- Untracked and ignored files inside submodules are allowed for simulator builds.
- Submodule pins must not move:
  - firmware: `badfa95ff747a0cbd07cf23186382a43ca9852e9`
  - simulator: `c55f168bc0e677fdb32312c8be4b5874469465e6`
- `tools/sim/guard.sh` enforces this.
- All book processing runs in Chromium.
- `apps/server` stays a static file host.

## Product Decisions

- App is browser-heavy; Hono only hosts the web app.
- EPUB parsing, normalization, image conversion, repack, and report happen in the tab.
- Phase 1 is single-book only.
- Phase 1 uses high-confidence optimization rules only:
  - Downscale/grayscale raster images to 480x800 JPEG.
  - Inject defensive CSS.
  - Strip scripts and inline event handlers.
  - Remove embedded fonts and `@font-face`.
  - Unwrap SVG-only covers/images.
  - Repair OPF media types and cover metadata.
  - Optional metadata-based filename.
- CSS budget splitting and spine splitting are deferred.
- Phase 1 UI controls: JPEG quality (50-95, default 85) and rename-from-metadata toggle (default off).
- Conversion result shows a summary, expandable per-file change log, and an explicit download button.
- Report entries and summary come from the same structured data.
- Architecture is `packages/optimize` with pure modules tested in Node and DOM modules tested in Chromium.

## Repository State

- Repo is an npm workspace with `packages/optimize`, `apps/web`, and `apps/server`.
- Svelte 5 SPA shell exists with a drop zone and file selection.
- Hono server source and smoke test exist.
- Phase 0 scaffold is committed:
  - `7396e6d` first commit with submodule gitlinks and docs
  - `669d788` Phase 0 workspace scaffold
- No Phase 1 source code exists yet.

## Documents

- Overall spec: `docs/superpowers/specs/2026-09-03-xteink-x4-epub-optimizer-design.md`
- Phase 0 plan: `docs/superpowers/plans/2026-09-03-xteink-x4-epub-optimizer-phase-0.md`
- Phase 1 spec: `docs/superpowers/specs/2026-09-06-xteink-x4-epub-optimizer-phase-1-design.md`
- Phase 1 plan: `docs/superpowers/plans/2026-09-06-xteink-x4-epub-optimizer-phase-1.md`
- Phase 2 placeholder: `docs/superpowers/plans/2026-09-06-xteink-x4-epub-optimizer-phase-2-placeholder.md`

## Device Facts

- X4 display: 480x800 portrait.
- Firmware supports `.epub`, `.xtc`, `.xtch`, `.txt`, `.bmp`.
- XTC/XTCH are pre-rendered page containers.
  - XTG: 1-bit row-major, MSB first, 0 = black, 1 = white.
  - XTH: 2-bit, two planes, column-major right-to-left.
- XTC parser never decompresses page data. `compression` must be 0.
- `pageTableOffset` must be >= 56 or chapters silently disable.
- Title at `0x38`, author at `0xB8`.
- Page-table entry 0 sets default dimensions for the whole book.
- Device skips CSS files over 128 KB and refuses CSS parsing under 64 KB free heap.
- Firmware includes an on-device EPUB Optimizer in `src/network/html/FilesPage.html`, readable as a reference.
- Simulator maps `/books/` to `./fs_/books/` and exposes the firmware web server on `127.0.0.1:8080`.

## Simulator Build Fix

- GCC 15 defaults C files to C23.
- QRCode dependency defines C89 `bool`/`true`/`false`, so it fails under C23.
- Fix: `tools/sim/simulator_cflags.py` appends `-std=gnu17` to `CFLAGS`.
- It is registered as a pre extra script in `tools/sim/platformio.local.ini.tpl`.
- This fix was not yet confirmed by a successful full simulator run as of the last user build log.

## Current Blockers / Gaps

- `package.json` has no real dev tool dependencies yet.
- `package-lock.json` is effectively empty.
- `npm run check`, `npm test`, etc. need `npm install` to be runnable.
- The sandbox has `.git` read-only, so git writes require user-side commits or a configured approval provider.
- Simulator binary was not present in `.pio/build/simulator/` as of the last inspection.
- Root contains accidental PlatformIO placeholder dirs (`include/`, `lib/`, empty `src/`, `test/`) pending cleanup confirmation.

## Next Action

Execute `docs/superpowers/plans/2026-09-06-xteink-x4-epub-optimizer-phase-1.md` task by task, starting with installing the real toolchain and completing the runnable scaffold.
