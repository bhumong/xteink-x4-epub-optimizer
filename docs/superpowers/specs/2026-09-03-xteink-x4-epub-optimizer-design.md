# Xteink X4 EPUB Optimizer: Design Spec

Status: approved for spec review (2026-09-03)
Branch: `main`
Submodules: `crosspoint-reader/crosspoint-firmware` @ `badfa95f` (v1.4.1-265), `crosspoint-reader/crosspoint-simulator` @ `c55f168b`

## 1. Goal

Build a website, separate from the firmware project, that optimizes EPUB books for the Xteink X4 running CrossPoint firmware. All processing happens in the client (Chromium-based browser). Hono exists only to host and serve the web app; it performs no book processing.

The app offers two export modes from one shared pipeline:

1. **Optimized EPUB** (`.epub`): repacked for the device's on-reader EPUB engine, within its memory and CSS limits.
2. **Pre-rendered XTC** (`.xtc` 1-bit, `.xtch` 2-bit grayscale): pages laid out and rasterized in the browser to 480x800 bitmaps, so page turns are instant and no on-device layout pass occurs.

Both modes are **downloaded by the user**. The app never uploads to the device and never talks to the reader's web server. Delivery to the SD card is out of scope (Section 3).

## 2. Hard rules

These override convenience anywhere in this spec.

1. **`crosspoint-reader/**` is not ours.** It is a read-only vendored reference. No upstream source, docs, or build config in either submodule may be changed in a way that is committed.
2. **Nothing is staged, committed, or pushed from either submodule.** Untracked files and local modifications inside the submodules are permitted (needed to build the simulator), but commits are not.
3. **The superproject gitlinks never move.** `crosspoint-reader/crosspoint-firmware` stays at `badfa95f` and `crosspoint-reader/crosspoint-simulator` stays at `c55f168b`. This is the machine-checkable form of rule 2, and it is what `tools/sim/guard.sh` asserts (Section 9).
4. **Output is download-only.** No device HTTP calls, no WebUSB, no WebDAV client.

## 3. Scope

In scope:

- Repo scaffold: npm workspaces, TypeScript strict, Vite, Svelte 5 SPA, Hono static host, ESLint flat config, Prettier, Vitest (node + browser-playwright projects).
- `AGENTS.md` with the hard rules above, verified commands, and module map.
- Simulator setup, built locally without committing to the submodule (Section 9).
- EPUB ingest: unzip, OPF/spine/TOC/metadata parse, resource inventory.
- Normalization transforms, each gated on a measured device limit (Section 7).
- Optimized EPUB repack, preserving OCF constraints.
- Browser layout and rasterization: hidden paginated viewport, `foreignObject` capture, quantization, 2x supersampling.
- XTC/XTCH writer with byte-exact tests (Section 8).
- Report UI: per-book before/after sizes, estimated output size, warnings, page-level failure log.
- Fixture-based golden-image verification against the simulator.

Out of scope:

- Any change to CrossPoint firmware, its formats, or the simulator library.
- Uploading to the device; talking to `crosspoint.local`; Calibre, OPDS, or WebDAV integration.
- Accounts, quotas, server-side storage, analytics, and multi-user concerns (the server is a static file host).
- Non-X4 devices (X3, X4 Pro, X4 Classic, Sticky, PaperMono), and non-`Portrait` orientation output.
- `.txt`, `.xtc`-input, and `.bmp` input formats. EPUB 2 and EPUB 3 only.
- Server-side rendering, Node canvas, or any fallback path outside the browser.
- DRM'd EPUBs and encrypted containers.
- On-device settings management (fonts, themes, refresh cadence).

## 4. Device contract (verified)

All of the following was read from the pinned submodule, not assumed. Implementations must not contradict it.

| Fact | Source |
|---|---|
| X4 panel is 480x800 portrait; XTC pages are stored at that geometry | `lib/Xtc/Xtc/XtcTypes.h` (`DISPLAY_WIDTH`/`HEIGHT`) |
| Device accepts `.epub` (2/3), `.xtc`, `.xtch`, `.txt`, `.bmp` natively | `README.md` |
| Firmware only reads XTC; there is no XTC writer anywhere in `lib/Xtc` | `lib/Xtc/` (public API is `open`/`loadPage`/`read*` only) |
| `XtcReaderActivity` blits each page pixel-by-pixel on every load | `src/activities/reader/XtcReaderActivity.cpp:144-288` |
| Bitmap size derives from the page header's own w/h; `compression` is never read and no decode path exists | `lib/Xtc/Xtc/XtcParser.cpp:443-465`, `XtcError::DECOMPRESSION_ERROR` unreferenced |
| Device skips any CSS file over 128 KB and refuses CSS parsing under 64 KB free heap | `lib/Epub/Epub.cpp:244-336` |
| Grayscale AA is silently dropped without a full plane buffer plus 60 KB headroom | `src/activities/reader/EpubReaderActivity.cpp:1578-1620` |
| Status bar can be drawn over XTC pages when `statusBarSpec().xtcMode` is Top or Bottom; default is hide | `src/CrossPointSettings.h:372`, `XtcReaderActivity.cpp:99-137` |
| Reading progress is stored in `/.crosspoint/xtc_<hash>/progress.bin`, not written back into the file | `XtcReaderActivity.cpp:328-338` |
| Cover and thumbnails are generated from page 0 at runtime | `lib/Xtc/Xtc.cpp:140-175` |
| Simulator maps SD `/books/` to `./fs_/books/`, exposes firmware port 80 as `127.0.0.1:8080`, and captures scripted BMPs via `CROSSPOINT_SIM_SCREENSHOTS` | simulator `README.md`, `src/SimulatorLifecycle.cpp` |
| Firmware ships its own in-browser "EPUB Optimizer" (ported from EPUB Optimizer Pro), readable as a reference implementation | `src/network/html/FilesPage.html:3804+`, `USER_GUIDE.md:144` |

Consequence for the product: EPUB cleanup already exists on-device, but it runs inside a browser tab on an ESP32-class host with no memory headroom and no batch mode. Pre-rendering to XTC does not exist on-device at all, because writing XTC would mean the firmware doing work the browser can do better. That asymmetry is this project's value.

## 5. Architecture

npm workspaces, five units. The DOM-free boundary between `packages/xtc` and everything else is the load-bearing design decision: it lets the hardest correctness problem (bit packing and offset arithmetic) be tested in plain Node with no browser.

| Unit | Responsibility | DOM | Test target |
|---|---|---|---|
| `packages/xtc` | XTC/XTCH header, page table, chapter records, XTG/XTH bit-plane packing | no | node (Vitest) |
| `packages/optimize` | per-resource transforms; href and OPF rewriting; report entries | yes (`DOMParser`) | browser |
| `packages/pipeline` | stage orchestration, progress events, cancellation, export fork | yes | browser |
| `apps/web` | Svelte 5 SPA: drop zone, mode selector, options, progress, page preview scrubber, download | yes | browser |
| `apps/server` | Hono on `@hono/node-server`; serves built static assets only | no | one smoke test |
| `fixtures/` | small hand-built EPUBs plus committed golden `.xtc` and reference BMPs | n/a | n/a |
| `tools/sim/` | simulator setup, build, and golden-capture scripts | n/a | n/a |

Dependency direction is one-way: `apps/web` depends on `pipeline`, `optimize`, and `xtc`; `pipeline` depends on `optimize` and `xtc`; `xtc` depends on nothing. `apps/server` depends on no package and imports no app code.

Chosen libraries, all proven rather than hand-rolled: `jszip` for zip I/O (the same approach the firmware's own optimizer uses), native `DOMParser`/`XMLSerializer` for XHTML and OPF, native Canvas 2D for rasterization. No CSS parser dependency in phase 1; transforms that need CSS knowledge use targeted, tested rewrites instead.

## 6. Pipeline

Shared front half, fork at the end.

```text
File drop
  -> ingest      unzip; META-INF/container.xml -> OPF; parse metadata, manifest,
                 spine, TOC; build resource inventory and per-file byte sizes
  -> normalize   rewrite each spine document: defensive CSS, strip scripts and
                 inline handlers, repair malformed entities, resolve hrefs,
                 downscale and re-encode images, split or inline oversized CSS,
                 optionally rename from metadata
  -> fork
     ├─ EPUB mode   repack (mimetype first, STORE) -> download .epub
     └─ XTC mode    paginate in hidden viewport -> capture per page ->
                    quantize -> bit-pack -> download .xtc | .xtch
```

Every stage emits structured report entries (`{level, file, message, before, after}`) so the UI and the exported log are the same data, not two renderings of it.

### XTC mode internals

1. Normalized XHTML for one spine document is injected into a hidden 480x800 paginated viewport using CSS multi-column pagination.
2. Each column is serialized and painted through `foreignObject` -> SVG blob -> canvas -> `getImageData`. Fonts are inlined as `data:` `@font-face` and images as data URLs, because `foreignObject` cannot load external resources.
3. Rendering happens at 2x (960x1600) and downsamples to 480x800, so glyph edges carry real antialiasing that survives quantization.
4. Luminance quantizes per region: text thresholds toward crisp 1-bit ink; photographs map onto the 4-level plane with ordered dithering for `.xtch`.
5. Steps 1-2 stay on the main thread, which needs a live DOM. Steps 3-4 plus bit-packing run in a Worker, since that range is `Uint8Array` in, `Uint8Array` out.
6. Chapter boundaries recorded during pagination become chapter records; page 0 is the cover when the source has one, so the sleep screen and library art work.

Layout quality is Chromium's own, which is the point of this approach. If quantized text comes back too soft, the upgrade is to keep the same layout and paint text ourselves from `Range.getClientRects()`, which replaces step 4 only. Layout and rasterization stay in separate modules specifically so that swap is contained.

## 7. EPUB mode rules

Each transform is gated on a measured limit from Section 4, never on taste.

| Rule | Trigger | Action |
|---|---|---|
| Image fit | any image wider than 480 or taller than 800 px | auto-crop white margins, downscale to fit, grayscale, re-encode JPEG at user quality |
| Tall-image split | aspect ratio far beyond one page | split into page-sized parts with configurable overlap and handedness, mirroring the on-device state machine |
| CSS budget | stylesheet over 128 KB | split and scope it, or inline per document; the device otherwise skips it silently |
| Defensive CSS | every XHTML document | inject the firmware's own guard rules: `img,svg{max-width:100%}`, `overflow-wrap:break-word`, `table-layout:fixed`, `pre{white-space:pre-wrap}` |
| Hyphenation | `xml:lang` resolvable | add `hyphens:auto` so long words stop overflowing |
| Spine granularity | single document large enough to stall lazy layout under the device heap budget | split into smaller documents and update spine, TOC, and every internal href |
| Filename | opt-in | rebuild as `Title - Author.epub` from metadata |
| Integrity | always | `mimetype` first and `STORE`; no resource dropped while still referenced; OPF manifest, spine, NCX, and NAV rewritten to match every rename |

## 8. XTC writer contract

`packages/xtc` is the highest-risk unit and is fully specified here so correctness is checkable.

```text
0x00  XtcHeader (56 B)
        magic            u32   "XTC\0" 0x00435458 (1-bit) | "XTCH" 0x48435458 (2-bit)
        versionMajor/Minor u8  1, 0
        pageCount        u16   total pages
        readDirection    u8    0
        hasMetadata      u8    1
        hasThumbnails    u8    0
        hasChapters      u8    0 | 1
        currentPage      u32   0  (device keeps progress in progress.bin, not here)
        metadataOffset   u64   0x38
        pageTableOffset  u64   >= 56, after chapters
        dataOffset       u64   first page data
        thumbOffset      u64   0
        chapterOffset    u32   0 | chapter block
        padding          u32   0
0x38  title   [128 B] NUL-terminated UTF-8
0xB8  author  [64 B]  NUL-terminated UTF-8
      chapter records, 96 B each: name[80], startPage u16 @+0x50, endPage u16 @+0x52
      page table, 16 B each: dataOffset u64, dataSize u32, width u16, height u16
      page data, per page: 22 B page header + bitmap
        header: magic u32 (XTG 0x00475458 | XTH 0x00485458), width u16, height u16,
                colorMode u8 0, compression u8 0, dataSize u32, md5 u64 0
```

Rules the parser forces, each a silent corruption if broken:

1. `compression` must be `0`. The parser ignores the field and never decompresses.
2. `XTG` bitmap: row-major, 8 px/byte, MSB first, **0 = black, 1 = white**. Size `((width+7)/8) * height` = 48,000 B at 480x800.
3. `XTH` bitmap: two sequential planes, **column-major right-to-left**, 8 vertical px/byte, `pixelValue = (bit1 << 1) | bit2`. Size `((width*height+7)/8) * 2` = 96,000 B. Gray mapping: 0 = white, 1 = dark grey, 2 = light grey, 3 = black.
4. `dataOffset` in every page-table entry points at the **22-byte page header**, not the bitmap.
5. `pageTableOffset` must be >= 56. A legacy 48-byte layout makes `hasChapters` inert and silently disables chapter support (`XtcParser.cpp:89`).
6. Chapters must be placed **before** the page table, because the parser derives chapter count from the gap to `pageTableOffset`.
7. Title and author are absolute offsets `0x38`/`0xB8`, independent of `metadataOffset`, so metadata must sit exactly there.
8. `pageCount` is `u16`: reject books over 65,535 pages before writing.
9. `versionMajor`/`Minor` must be `1`/`0`; the parser also tolerates `0`/`1`, which we do not emit.
10. Set `hasThumbnails` 0 and `thumbOffset` 0; the device builds cover and thumbnail BMPs from page 0.
11. Every page-table entry must carry the same `width`/`height` (480x800). Entry 0 becomes the book's default dimensions and therefore the reader's buffer size for all pages, so a mixed geometry corrupts or truncates later pages.
12. Page-table `dataSize` is written as `22 + bitmapSize` for spec hygiene, but note the reader never consumes it: `loadPage` derives size from the page header's own w/h. Correctness of our bytes must never depend on it.

### Size tradeoff, shown in the UI before conversion

| Pages | `.xtc` | `.xtch` |
|---|---|---|
| 200 | 9.6 MB | 19.2 MB |
| 400 | 19.2 MB | 38.4 MB |
| 600 | 28.8 MB | 57.6 MB |

A 400-page EPUB is commonly 2-5 MB, so XTC output is larger than its source and cannot be compressed by us: shrinking it needs a format change the firmware would have to adopt, which we cannot make. What it buys is instant page turns and zero on-device layout. `.xtch` is therefore opt-in, and the estimate appears on the convert button's confirmation.

### Memory

One page is in flight at a time: capture, quantize, pack, hand 48-96 KB to the Worker, discard the image buffer. Live memory stays near one page (~6 MB transient during the 2x render) plus accumulating `Blob` chunks, which the browser can back with disk. Accumulating every page's pixels before writing would need ~600 MB for 400 pages and would kill the tab.

## 9. Simulator setup

The simulator compiles the real firmware as a native binary and renders the panel in an SDL2 window, which makes it the only trustworthy oracle for whether our pages look right. Setup must satisfy Section 2 while still being able to build.

The obstacle: `[env:simulator]` needs the firmware's `platformio.ini` and three `pre:` scripts (`gen_i18n.py`, `git_branch.py`, `build_html.py`) that generate sources inside the firmware tree.

The resolution, verified: the firmware's `platformio.ini` already declares `extra_configs = platformio.local.ini`, and its `.gitignore` covers `*.local*`, `fs_`, and `.pio`. So:

1. `tools/sim/setup.sh` initializes the nested `freeink-sdk` submodule (required by the simulator's `lib_deps` symlinks) and installs `platformio.local.ini` into the firmware dir from our tracked template `tools/sim/platformio.local.ini.tpl`, which starts from the simulator's `sample-platformio-linux-wsl.ini`.
2. All generated sources land on paths the submodule already ignores.
3. `tools/sim/run.sh` builds and launches `pio run -e simulator -t run_simulator` from the firmware dir.
4. `tools/sim/guard.sh` asserts Section 2's invariants before and after every simulator task.

Current host gaps to close in phase 0: `platformio` is not installed, and SDL2 and OpenSSL dev headers are absent (`pkg-config` missing, no `libsdl2-dev`/`libssl-dev`), which needs `sudo apt install libsdl2-dev libssl-dev` plus network. Setup reports these plainly instead of pretending the build is one command away.

## 10. Testing

Three layers, each catching a different failure class.

**1. Byte-exact, pure node (`packages/xtc`).** No browser, no DOM. Covers: header round-trip; plane packing, including the worked example `B W B B W W B W` -> `0b01001101` = `0x4D`; column-major right-to-left indexing for `XTH`; offset arithmetic for all twelve Section 8 rules; chapter bounds; the 65,535-page rejection; and committed golden `.xtc` fixtures diffed byte-for-byte.

**2. Behavioral (browser, Vitest playwright project).** Ingest on fixture EPUBs; each Section 7 rule asserted by measurement (image dimensions after re-encode, CSS files under 128 KB, `mimetype` first and stored, every href resolving, spine and TOC consistency after a split); pagination page counts; cancellation; and report accuracy.

**3. Golden-image oracle (simulator).** `tools/sim/capture.sh` converts a fixture EPUB headlessly, writes the `.xtc` into `crosspoint-reader/crosspoint-firmware/fs_/books/`, launches the simulator with `CROSSPOINT_SIM_SCREENSHOTS`, and diffs the captured BMP against a committed reference for a pixel-perfect match on the 1-bit path. This is the test that proves we match the device rather than our own assumptions, and it is what section 6's supersampling tuning loop measures against. `fs_` is already ignored by the submodule, so this respects Section 2.

Also: `apps/server` gets one smoke test that it serves `index.html` and assets; `apps/web` gets Playwright flows for drop, mode switch, progress, and download.

## 11. Error handling

Per-page recovery, not abort: a capture that fails yields a blank page plus a report entry, because losing a 400-page conversion at page 317 is worse than one blank page. Cancellation is checked between pages and discards partial output.

Refuse before writing, with a reason in the report, for: zero pages produced; page count over 65,535; TOC referencing a missing spine item; a source we cannot unzip or parse; DRM.

Recover and report, keeping the original bytes, for: an image that fails to decode; a CSS file we cannot parse; a stylesheet that cannot be split safely.

Report entries are exportable as text, matching the log affordance the firmware's own optimizer already provides.

## 12. Phasing

| Phase | Deliverable | Proves |
|---|---|---|
| 0 | workspaces, TS strict, lint/format, CI, `AGENTS.md`, Hono serves built SPA, simulator builds locally | repo is real and the oracle runs |
| 1 | ingest, normalize, EPUB repack, report UI | useful output with no rasterizer |
| 2 | `packages/xtc` with byte-exact and golden tests | we can emit bytes the parser accepts |
| 3 | paginate, capture, quantize, Worker pack; `.xtc` then `.xtch` | end to end pre-render |
| 4 | simulator golden-image oracle; tune 2x supersampling against it | output matches the device, not our assumptions |

Phase 1 ships a working product on its own, which is why EPUB mode goes first despite XTC being the more interesting target.

## 13. Files touched

New in this repo, phase 0 and 1:

- `AGENTS.md`
- `package.json`, `tsconfig.base.json`, `eslint.config.js`, `prettier.config.js`, `.editorconfig`
- `packages/xtc/{package.json,src/{types.ts,writer.ts,planes.ts,index.ts},test/*}`
- `packages/optimize/{package.json,src/{ingest.ts,normalize.ts,images.ts,css.ts,repack.ts,report.ts},test/*}`
- `packages/pipeline/{package.json,src/{pipeline.ts,quantize.worker.ts,layout.ts},test/*}`
- `apps/web/{package.json,vite.config.ts,src/*}`
- `apps/server/{package.json,src/index.ts,test/smoke.test.ts}`
- `fixtures/epubs/*`, `fixtures/golden/*`
- `tools/sim/{setup.sh,run.sh,guard.sh,capture.sh,platformio.local.ini.tpl}`
- `.github/workflows/ci.yml`

Modified: none outside the above. Inside the submodules, only untracked ignored paths are created at runtime (`platformio.local.ini`, `.pio/`, `fs_/`, generated `lib/I18n/*`), never committed.

## 14. Assumptions

1. Node 24 and npm are the toolchain; no pnpm, yarn, or bun is installed.
2. XTC target geometry is 480x800 portrait only, matching the simulator's default X4 profile.
3. Chromium is the supported engine; `foreignObject` rasterization behavior is treated as Chromium-specific and verified by the golden tests rather than assumed portable.
4. Users read their own fonts and settings; the app's layout options are its own and do not attempt to mirror the device's full `ReaderRenderSpec`.
5. The device default `xtcMode = XTC_STATUS_BAR_HIDE` is what users should keep; the UI warns that a Top or Bottom status bar overlays pre-rendered page content, which cannot be avoided from our side.
6. Hosting is a plain Node process or container serving static files, with no processing endpoints.

## 15. Risks

| Risk | Mitigation |
|---|---|
| `foreignObject` drops or misrenders CSS we depend on | keep the supported CSS subset small and documented; golden-image test fails loudly rather than silently |
| Quantized text too soft at 1 bit | 2x supersample, then paint text from `Range.getClientRects()` in the same page structure (Section 6) without changing layout |
| Large books exhaust tab memory | one page in flight, `Blob` chunk accumulation, measured page caps, refuse before writing |
| Upstream firmware changes the format | submodule HEAD pinned; `packages/xtc` tests are the tripwire; upgrades are a deliberate decision |
| XTC output bigger than source surprises users | size estimate shown before conversion; `.xtch` opt-in |
| Accidental commit inside a submodule | `tools/sim/guard.sh` runs in CI and pre-commit; `AGENTS.md` states the rule first |
