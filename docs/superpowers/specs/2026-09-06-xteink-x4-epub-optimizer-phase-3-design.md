# Xteink X4 EPUB Optimizer: Phase 3 Design Spec

Status: ready for spec review (2026-09-06)
Parent spec: `docs/superpowers/specs/2026-09-03-xteink-x4-epub-optimizer-design.md`
Phase 2 spec: `docs/superpowers/specs/2026-09-06-xteink-x4-epub-optimizer-phase-2-design.md`

## 1. Goal

Build the browser pre-render pipeline: paginate each normalized spine document
at 480x800 in a hidden Chromium layout, capture every page through
`foreignObject` rasterization at 2x with downsampling, quantize each page to
device codes in a Worker, and write a downloadable `.xtc` (1-bit) or `.xtch`
(2-bit) container with the Phase 2 writer. The phase ships the XTC mode in the
Svelte UI and proves one EPUB flows end to end into both output modes. Simulator
golden-image verification stays Phase 4.

## 2. Scope

In scope:

- A new `packages/pipeline` workspace package: hidden pagination, page capture,
  quantization, a Worker, and `preRenderXtc()` orchestration.
- A shared front-half refactor in `packages/optimize`: one reusable
  ingest + normalize step that both EPUB output and XTC pre-render call.
- A memory-bounded assembly entry in `packages/xtc` that accepts already-packed
  page bitmaps (`writeXtcFromBitmaps`), byte-identical to `writeXtc`.
- XTC mode in the Svelte app: mode selector, `.xtc` and opt-in `.xtch`
  conversion, mode-aware report and download, XTC naming from metadata.
- Cover page 0 when the source has detectable cover metadata, and chapter
  records from spine documents.
- `.xtc` support first, `.xtch` layered on the same pipeline.
- Deterministic browser/node tests and e2e flows for both modes.

Out of scope:

- Simulator golden-image oracle and quality tuning (Phase 4).
- On-device transforms, upload, WebUSB, WebDAV, or server-side processing.
- New fonts, hyphenation algorithms, or EPUB-mode behavior changes beyond the
  front-half refactor (output bytes for EPUB mode stay identical).
- TOC navigation-point-level chapters, page scrubbing UI, bookmarks, or batch
  mode.
- Non-480x800 geometry, landscape, or non-X4 devices.

## 3. Hard project rules that apply

1. `crosspoint-reader/**` is read-only; nothing is committed or pushed inside
   either submodule.
2. Output is download-only.
3. All book processing runs in the browser. `packages/xtc` stays DOM-free;
   `packages/pipeline` is browser code except its pure modules.
4. `apps/server` stays a static host.
5. No new runtime dependency without a reason. The pipeline needs none: layout,
   canvas, `DOMParser`, `XMLSerializer`, Workers, `TextEncoder`, and `crypto`
   are all native.

## 4. Architecture

Three packages change:

| Package             | Change                                                                                     | DOM | Tests           |
| ------------------- | ------------------------------------------------------------------------------------------ | --- | --------------- |
| `packages/optimize` | extract `prepareEpub()`; generic safe filename; no behavior change to EPUB output          | yes | existing + node |
| `packages/xtc`      | add `XtcBitmapBook` + `writeXtcFromBitmaps()` sharing writer internals                     | no  | node            |
| `packages/pipeline` | new: types, layout, capture, quantize, quantize worker, css-inline, orchestration, UI glue | yes | node + browser  |
| `apps/web`          | mode selector; mode-aware report/download; depends on `@xteink/pipeline`                   | yes | browser + e2e   |

Dependency direction: `apps/web -> @xteink/pipeline -> @xteink/optimize and
@xteink/xtc`. The pipeline imports `@xteink/optimize/ingest.ts` and
`@xteink/optimize/filename.ts` subpaths only for DOM-free helpers, and the new
shared `prepareEpub` from `@xteink/optimize`.

## 5. Shared front half and writer extension

### 5.1 `prepareEpub` in `packages/optimize`

The body of today's `optimizeEpub` between ingestion and repack is moved into a
new exported function so EPUB output and XTC pre-render normalize exactly the
same bytes:

```ts
// packages/optimize/src/types.ts additions
export interface PreparedEpub {
	source: EpubSource;
	resources: Map<string, Uint8Array>; // normalized, images renamed to .jpg
	entries: ReportEntry[];
	sourceBytes: number;
	imageRenameMap: Map<string, string>;
}

// packages/optimize/src/pipeline.ts
export async function prepareEpub(
	file: File,
	options: OptimizeOptions,
	callbacks: OptimizeCallbacks,
	signal?: AbortSignal
): Promise<PreparedEpub>;
```

`optimizeEpub` becomes: `prepareEpub` + repack + report + filename. The stage
order, progress percentages, entry codes, and output bytes of the EPUB path do
not change; existing pipeline browser tests are the regression net.

### 5.2 Generic output filename

`filename.ts` gains a generic helper and `safeEpubFilename` delegates to it:

```ts
export function safeOutputFilename(
	title: string,
	author: string,
	sourceName: string,
	renameFromMetadata: boolean,
	extension: string
): string;
```

The EPUB caller passes `.epub` and keeps today's behavior. The pipeline passes
`.xtc` or `.xtch`. When `renameFromMetadata` is false — or metadata produces no
clean name — the base is `sourceName` with its last extension removed, and
`extension` is appended, so every result ends in the requested extension. EPUB
delegation is unchanged because stripping `.epub` and re-appending it
reproduces the source name exactly. Node tests cover both.

### 5.3 `writeXtcFromBitmaps` in `packages/xtc`

```ts
// packages/xtc/src/types.ts additions
export interface XtcBitmapPage {
	bitmap: Uint8Array; // device-order packed bytes, 48,000 (XTG) or 96,000 (XTH)
}

export interface XtcBitmapBook {
	mode: XtcMode;
	title?: string;
	author?: string;
	chapters?: XtcChapter[];
	pages: XtcBitmapPage[];
}

// packages/xtc/src/writer.ts
export function writeXtcFromBitmaps(book: XtcBitmapBook): Uint8Array;
```

Writer internals are refactored so layout, metadata validation, chapter
validation, and offset arithmetic live in one private `assemble` path.
`writeXtc` validates pixel frames, packs them with `planes.ts`, then calls the
shared path; `writeXtcFromBitmaps` validates bitmap lengths
(`pixels-length-mismatch` when wrong) and calls the same path. Invariant:
`writeXtcFromBitmaps` of packed pages is byte-identical to `writeXtc` of the
same book. Existing tests, goldens, and public `writeXtc` API are untouched.

## 6. `packages/pipeline` contracts

```ts
// src/types.ts
import type { ProgressEvent, ReportEntry } from '@xteink/optimize';
import type { XtcMode } from '@xteink/xtc';

export interface PreRenderOptions {
	mode: XtcMode; // 'xtc' | 'xtch'
}

export interface PreRenderReport {
	sourceBytes: number;
	outputBytes: number;
	pageCount: number;
	chapterCount: number;
	warningCount: number;
	errorCount: number;
	entries: ReportEntry[];
}

export interface PreRenderResult {
	blob: Blob;
	fileName: string;
	report: PreRenderReport;
}

export type PreRenderCallbacks = OptimizeCallbacks;

export async function preRenderXtc(
	file: File,
	options: PreRenderOptions,
	callbacks: PreRenderCallbacks,
	signal?: AbortSignal
): Promise<PreRenderResult>;
```

Module responsibilities:

| File                 | Responsibility                                                                          | DOM |
| -------------------- | --------------------------------------------------------------------------------------- | --- |
| `types.ts`           | contracts above                                                                         | no  |
| `css-inline.ts`      | rewrite external CSS and CSS `url()` references to embedded data (pure text work)       | no  |
| `quantize.ts`        | luminance, tile classification, 1-bit/2-bit code mapping and dithering (pure byte work) | no  |
| `layout.ts`          | self-contained per-document HTML; hidden multi-column pager; column measurement         | yes |
| `capture.ts`         | serialize one page column, rasterize at 2x, downsample to 480x800 RGBA                  | yes |
| `quantize.worker.ts` | message wrapper: RGBA in, packed device bitmap out (transferable)                       | no  |
| `pipeline.ts`        | stage orchestration, chapters/cover policy, progress, cancellation, writer call         | yes |
| `index.ts`           | exports `preRenderXtc`, types                                                           | no  |

`css-inline.ts` and `quantize.ts` are DOM-free and run in the node project;
everything else runs in browser tests. `layout.ts` and `capture.ts` never touch
each other's internals: layout yields a self-contained page source string and a
page count, capture consumes strings.

## 7. Rendering mechanics

### 7.1 Self-contained documents

For each spine XHTML document, the pipeline builds one self-contained HTML
string before layout:

1. Parse the normalized document with `DOMParser`.
2. Inline every `<link rel="stylesheet">`: resolve the href against the
   document's zip path, embed the text as `<style>`.
3. Rewrite `url(...)` references inside the now-inline stylesheets and any
   inline `<style>`: resolve relative to the stylesheet's own zip path, and when
   the target is a raster resource, replace it with a `data:` URL.
4. Rewrite every `<img src>` to a `data:` URL from the normalized resources.
5. Add a small baseline stylesheet that re-instates generic typographic
   defaults (paragraph margins, heading sizes, list markers, table borders) so
   rendering does not depend on what UA defaults apply inside
   `foreignObject`. Author CSS overrides the baseline; the Phase 1 defensive
   rules stay in the document.

External resources that cannot be inlined (missing resource, unsupported media
type) are dropped with a `warning` entry; the affected element then renders
without the resource. Fonts are already absent after normalization
(`@font-face` stripped, embedded fonts removed), so text renders with system
fonts, which is correct for pre-rendered output: the device never lays out
these pages.

The supported CSS subset is deliberately small and documented in this spec:
inline and inlined stylesheets with color, font, margin/padding, alignment,
decoration, borders, and layout properties Chromium applies inside
`foreignObject`. Anything that depends on external loading does not render and
is reported once per book as an informational entry.

### 7.2 Pagination

Layout keeps one hidden pager per document: a fixed-height 800px container
using CSS multi-column layout with 480px columns and zero gap. The document's
content is measured at that height; the column count comes from the rendered
column geometry of the container (Chromium re-flows the text into columns at
the fixed height). Each spine document is measured in spine order so page
indices and chapter boundaries are known before any capture happens.

Column measurement is the first browser-tested behavior: fixture documents
must produce exact expected page counts in the pinned Chromium, and the tests
assert those counts. Chromium's multicol pagination is the layout engine the
device never sees; Phase 4's oracle decides whether its _visual_ output is
right, and Phase 3 only asserts page counts, geometry, and pixel sanity.

### 7.3 Capture

For page `k` of a document:

1. Take the document's self-contained HTML and wrap it in a clip window showing
   column `k`: a 480x800 viewport translated left by `k * 480` CSS pixels.
2. Serialize that window into an SVG `foreignObject` document whose canvas is
   960x1600 (2x). Chromium rasterizes the HTML at the SVG resolution, so glyphs
   and edges are rendered at device scale 2.
3. Load the SVG through a blob URL into an `Image`, draw it into an
   offscreen 480x800 canvas with smoothing on (the 2x-to-1x downsample that
   produces antialiasing), and read `ImageData`.
4. Transfer the RGBA buffer to the quantize Worker.

One page is in flight at a time. Canvases and blob URLs are reused and revoked
per page; nothing accumulates until the Worker returns the small packed
bitmap.

## 8. Quantization

`quantize.ts` is pure: RGBA bytes in, device-code frame out. All constants are
exported so tests assert exact tables and Phase 4 tunes them without changing
structure.

```ts
export const LUMA_R = 77;
export const LUMA_G = 150;
export const LUMA_B = 29;
export const TILE_SIZE = 16;
export const TEXT_VARIANCE = 900; // per-tile luma variance above this => text
export const TEXT_BLACK_LUMA = 160; // 1-bit: luma below this is ink
export const DITHER_BLACK_LUMA = 128; // 1-bit photo dither center
export const TWO_BIT_BANDS = [64, 128, 192]; // luma band edges
export const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
```

Rules:

- Luma is `(r*77 + g*150 + b*29 + 128) >> 8`, 0 = black, 255 = white.
- Tiles are 16x16. A tile whose luma variance exceeds `TEXT_VARIANCE` is text;
  otherwise it is photo. Tiles are classified independently; no smoothing is
  applied between tiles in this phase.
- 1-bit text tile: code `0` (ink) when luma < `TEXT_BLACK_LUMA`, else code `1`
  (white).
- 1-bit photo tile: ordered 4x4 Bayer dithering centered on
  `DITHER_BLACK_LUMA`. With `offset = (BAYER_4[(y & 3) * 4 + (x & 3)] - 8) *
16`, ink when `luma + offset < DITHER_BLACK_LUMA`, else white.
- 2-bit mapping, text and photo alike, uses the device gray codes:
  luma < 64 => code `3` (black); 64-127 => `1` (dark grey); 128-191 => `2`
  (light grey); >= 192 => `0` (white). Photo tiles dither first: `luma' =
clamp(luma + offset, 0, 255)`, then map `luma'` through the same bands.
- All operations are integer-deterministic: identical RGBA input always yields
  identical frames.

The Worker (`quantize.worker.ts`) receives `{ id, rgba, width, height, mode }`
with the RGBA buffer transferred, runs the matching quantizer, packs the code
frame with `packXtg`/`packXth` from `@xteink/xtc`, and posts
`{ id, bitmap }` back with the bitmap transferred. The pipeline only ever
accumulates these packed bitmaps (48,000 bytes per 1-bit page, 96,000 per
2-bit page), never raw frames or RGBA.

## 9. Chapters and cover

### 9.1 Chapters

Chapters are spine-document granular. Every measured spine document becomes a
chapter unless it is skipped by the cover rule below. The chapter name is the
document's `<title>` text, trimmed, falling back to the file stem. Start and
end pages are the running 0-based page indices that document occupies
(`startPage <= endPage`), stored 1-based by the writer. Documents that fail to
paginate (parse failure yields zero columns) produce a warning and no chapter.

### 9.2 Cover page 0

When `source.metadata.coverItemId` exists and the manifest item is a raster
resource:

- If the cover item is not in the spine, a cover document is synthesized: the
  image centered on a white 480x800 canvas via the same data-URL HTML path, and
  it becomes page 0.
- If the cover item is a spine item that rendered to exactly one page and is
  the first measured document, that page is page 0 and the document is not
  repeated or listed as a chapter.
- Otherwise (cover in the spine but not a one-page first document, or no cover
  at all), the spine renders as-is: the first rendered page is page 0 and an
  informational entry notes the cover arrangement.

All later chapters and page indices shift accordingly. This matches the device
contract that cover art is generated from page 0 at runtime
(`crosspoint-reader/crosspoint-firmware/lib/Xtc/Xtc.cpp:145-176`).

## 10. Memory, progress, lifecycle

Peak memory is bounded: one 2x RGBA page (~6 MB transient) plus the growing
packed-bitmap list (48-96 KB/page) plus the final container in memory at write
time. Nothing else accumulates. Blob URLs and canvas contexts are reused and
revoked. A hidden pager root element (one shared off-screen container) is
created per conversion, emptied between documents, and removed in `finally`.

Progress percentages:

| Range  | Stage          | Meaning                                                                                             |
| ------ | -------------- | --------------------------------------------------------------------------------------------------- |
| 2-45   | read + prepare | shared front half; `prepareEpub` progress events pass through unchanged, identical to the EPUB path |
| 46-60  | measure        | paginate each spine document, chapter policy                                                        |
| 60-95  | render         | capture + quantize + pack, per measured page                                                        |
| 95-100 | write          | `writeXtcFromBitmaps`, report, filename                                                             |

Cancellation is checked inside `prepareEpub` (as today), between documents,
between pages, and before the writer call. Abort discards everything and
removes the pager root.

## 11. Error handling

Refusals before rendering: zero measured pages (`pages-zero`); more than
65,535 pages (`pages-overflow`); any ingest or normalize hard failure surfaces
exactly as it does for the EPUB path today (DRM, missing OPF, empty spine).

Per-page recovery: a capture or quantization failure produces a blank page
(1-bit: every byte `0xFF`, which is all-white; 2-bit: every byte `0x00`, which
is all-white code 0) plus a `warning` entry `page-blank`, and conversion
continues. Per-document recovery: a document that cannot be parsed or measured
is skipped with a warning; the book continues with remaining documents.

Writer errors are converted into report errors before the UI sees them; the
conversion never produces a partial download.

## 12. UI

The Svelte app keeps its four states and gains an export mode:

| Mode   | Label                               | Default | Output  |
| ------ | ----------------------------------- | ------- | ------- |
| `epub` | Optimized EPUB                      | yes     | `.epub` |
| `xtc`  | Pre-rendered XTC (1-bit)            | no      | `.xtc`  |
| `xtch` | Pre-rendered XTCH (2-bit grayscale) | no      | `.xtch` |

A `ModePicker` sits above `OptimizeOptions`. XTCH is labeled opt-in with a
size note (the parent spec's table: 200 pages ~19.2 MB vs 9.6 MB for XTC), and
an informational line explains pre-rendered pages trade file size for instant
page turns. `OptimizeOptions` (JPEG quality, metadata rename) applies to EPUB
mode only and is hidden otherwise; pre-rendered files are always named from
metadata when a title exists (`Title - Author.xtc`), falling back to the source
stem plus the mode extension, because the extension is part of the format.

`ReportPanel` becomes mode-aware through generic props (`downloadLabel`,
summary rows, entries) instead of importing `OptimizeResult`; `App.svelte`
maps both `OptimizeResult` and `PreRenderResult` into that view model. The
XTC summary shows source size, output size, page count, chapter count, and
warnings; the EPUB summary keeps today's fields. Download labels:
`Download optimized EPUB`, `Download pre-rendered XTC`,
`Download pre-rendered XTCH`.

## 13. Testing

### 13.1 Node

- `packages/xtc/test/writer.node.test.ts` additions: `writeXtcFromBitmaps` is
  byte-identical to `writeXtc` for both modes with chapters and metadata;
  bitmap-length rejection; goldens still diff byte-for-byte through the new
  entry.
- `packages/optimize/test/filename.node.test.ts` additions: generic extension
  behavior, EPUB delegation unchanged.
- `packages/pipeline/test/quantize.node.test.ts`: luma values; tile
  classification (uniform vs checkerboard); 1-bit text threshold; 1-bit photo
  dither counts on a known ramp; 2-bit band mapping for solid luma values;
  dither determinism; blank-page byte constants.
- `packages/pipeline/test/css-inline.node.test.ts`: `url()` rewriting relative
  to the stylesheet path; external stylesheet embedding; missing-resource
  handling.

### 13.2 Browser

- `packages/pipeline/test/layout.browser.test.ts`: fixture page counts are
  exact; `<title>`-based chapter names; image and stylesheet data-URL inlining
  leaves no external `src`/`href`.
- `packages/pipeline/test/capture.browser.test.ts`: capture of a colored test
  page yields a 480x800 RGBA buffer whose non-white pixel count is above zero
  and whose overall bounds stay within the page; blank page fallback bytes.
- `packages/pipeline/test/pipeline.browser.test.ts`: fixture EPUB converts to
  XTC bytes that parse through `packages/xtc`'s own writer contract; page count
  equals measure-phase count; cancellation returns nothing; encrypted fixture
  still refuses.

### 13.3 E2E

`apps/web/e2e/prerender.spec.ts`: convert the minimal EPUB fixture in XTC mode
and assert the download name ends `.xtc` and the file is non-empty; same for
XTCH mode. The existing EPUB e2e keeps passing with the mode-aware UI.

Vitest projects: pipeline node tests join the node project, pipeline browser
tests join the browser project, and `@xteink/pipeline` aliases are added to
`vitest.config.ts` and `tsconfig.base.json`. `apps/web` gains the
`@xteink/pipeline` workspace dependency.

## 14. Fixtures

`fixtures/generate-epubs.mjs` gains two deterministic fixtures alongside the
existing ones (same no-network, committed-output pattern):

- `long/`: an EPUB 2 with one spine document long enough to paginate to a known
  multi-page count (generated repeated paragraphs) plus a `<title>`.
- `cover/`: an EPUB 3 whose cover is a manifest-only raster `cover-image`
  followed by one text spine document, so synthesized cover page 0 and the
  chapter shift are testable.

## 15. Files touched

New:

- `packages/pipeline/package.json`
- `packages/pipeline/src/{types.ts, css-inline.ts, quantize.ts, layout.ts, capture.ts, quantize.worker.ts, pipeline.ts, index.ts}`
- `packages/pipeline/test/{quantize.node.test.ts, css-inline.node.test.ts, layout.browser.test.ts, capture.browser.test.ts, pipeline.browser.test.ts}`
- `apps/web/src/lib/ModePicker.svelte`
- `apps/web/e2e/prerender.spec.ts`
- `fixtures/epubs/long/book.epub`, `fixtures/epubs/cover/book.epub`

Modified:

- `packages/optimize/src/pipeline.ts` and `types.ts`: `prepareEpub` extraction
  (EPUB path unchanged).
- `packages/optimize/src/filename.ts`: `safeOutputFilename` plus delegation.
- `packages/xtc/src/types.ts` and `writer.ts`: bitmap-book entry.
- `packages/xtc/test/writer.node.test.ts`: byte-equality and rejection tests.
- `packages/optimize/test/filename.node.test.ts`: extension tests.
- `apps/web/src/App.svelte`, `apps/web/src/lib/ReportPanel.svelte`:
  mode-aware view model.
- `apps/web/package.json`: `@xteink/pipeline` dependency.
- `vitest.config.ts`, `tsconfig.base.json`: pipeline aliases and project
  includes.
- `fixtures/generate-epubs.mjs`: long and cover fixtures.
- `AGENTS.md`: module-map row for `packages/pipeline`.

## 16. Phase 3 exit criteria

1. `npm run check`, `check:web`, `lint`, `format`, `npm test`, and
   `npm run test:e2e` pass from a clean checkout.
2. EPUB mode output is byte-identical to Phase 2's behavior (existing pipeline
   tests and e2e green, no output-format change).
3. `writeXtcFromBitmaps` is byte-identical to `writeXtc`, and the Phase 2
   golden fixtures still diff byte-for-byte.
4. A fixture EPUB converts end to end in the UI to `.xtc` and to `.xtch`, with
   correct filename and report counts.
5. Measured page counts on `long/` and the synthesized cover on `cover/` are
   asserted in browser tests.
6. `npm run guard` passes and no tracked `crosspoint-reader/**` file changes.

## 17. Decisions locked and risks

Locked decisions:

- One phase covers both output modes, sequenced `.xtc` then `.xtch`.
- Chapters are spine-document granular, named from each document's `<title>`.
- The cover page is synthesized from cover metadata when the cover is not in
  the spine; an in-spine single-page cover document becomes page 0 unlisted.
- The pipeline accumulates packed bitmaps only; the xtc package gains the
  bitmap-book writer entry instead of holding whole-book pixel frames.
- `foreignObject` rendering is trusted only for layout and pixel sanity in this
  phase; visual correctness is Phase 4's oracle.

Risks:

| Risk                                                                   | Mitigation                                                                                                             |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Chromium multicol or `foreignObject` behavior differs from assumptions | pagination/capture browser tests fail loudly; supported CSS subset stays small and documented                          |
| Vitest browser mode cannot host module Workers                         | quantizer tests run the pure functions in page; Worker path is covered by e2e on the built app                         |
| UA defaults inside serialized `foreignObject` differ                   | explicit baseline stylesheet in every self-contained document                                                          |
| Long books still hold output in memory at write time                   | packed-only accumulation; writer errors before writing; per-phase measured caps revisited if a real book shows trouble |
| 2-bit photo quality poor without the simulator oracle                  | deterministic dithering + Phase 4 tuning loop; XTCH remains opt-in                                                     |
