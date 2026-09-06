# Xteink X4 EPUB Optimizer: Phase 1 Design Spec

Status: approved for spec review (2026-09-06)
Parent spec: `docs/superpowers/specs/2026-09-03-xteink-x4-epub-optimizer-design.md`

## 1. Goal

Build the first usable output of the browser-only EPUB optimizer: accept one EPUB, optimize it in the browser, show a report, and let the user download the resulting EPUB. This phase proves the ingest, normalization, image handling, OCF repack, report, and UI flow end to end. XTC pre-rendering remains out of scope.

## 2. Scope

In scope:

- One `.epub` file per conversion.
- EPUB 2 and EPUB 3 containers that are not DRM-encrypted.
- Parsing `META-INF/container.xml`, the OPF manifest, spine, and Dublin Core metadata.
- Image downscaling to fit 480x800, grayscale conversion, and JPEG re-encoding.
- XHTML normalization: defensive CSS, script removal, event-handler removal, embedded-font removal, SVG cover/image unwrapping, and href rewriting.
- OPF normalization: image media types and cover metadata after rewrites.
- OCF-correct repack with `mimetype` first and stored.
- Per-book report with summary and expandable per-file change log.
- JPEG quality and metadata-rename options.
- Cancellation and clear hard-failure paths.
- Svelte UI wiring from file selection through download.

Out of scope:

- XTC/XTCH writing, pagination, rasterization, and simulator golden-image capture.
- Batch or multi-book conversion.
- CSS budget splitting and spine document splitting.
- Hyphenation and other layout-engine tuning.
- Device upload, WebUSB, Calibre, OPDS, and WebDAV.
- Full parity with every transform in the firmware's in-browser EPUB Optimizer.
- Server-side processing.

## 3. Hard project rules that apply

These come from the parent spec and remain in force:

1. `crosspoint-reader/**` is read-only vendored reference; nothing is committed or pushed inside either submodule.
2. Output is download-only; the app never uploads to the device.
3. All book processing runs in the browser.
4. Hono remains a static file host with no book-processing imports.

## 4. Architecture

Phase 1 lives in `packages/optimize`. The web app is a thin owner of the UI state and calls one package entry point. This boundary is important because Phase 2 will reuse the ingest and normalization front half for XTC pagination.

| Module         | Responsibility                                                 | DOM? |
| -------------- | -------------------------------------------------------------- | ---- |
| `paths.ts`     | existing OPF/path resolution helpers                           | no   |
| `types.ts`     | shared contracts for options, source inventory, report, result | no   |
| `options.ts`   | `OptimizeOptions` and defaults                                 | no   |
| `errors.ts`    | typed errors and stable error codes                            | no   |
| `report.ts`    | structured entries, summary derivation, text rendering         | no   |
| `css.ts`       | CSS text helpers such as `@font-face` block removal            | no   |
| `repack.ts`    | OCF-correct EPUB zip writer                                    | no   |
| `ingest.ts`    | JSZip load, OPF/spine/manifest/metadata parse, DRM detection   | yes  |
| `images.ts`    | decode, fit, grayscale, JPEG encode                            | yes  |
| `normalize.ts` | XHTML and OPF DOM rewrites                                     | yes  |
| `pipeline.ts`  | stage orchestration, progress, cancellation, result            | yes  |
| `index.ts`     | package entry point                                            | no   |

Dependency direction is one-way: `index.ts` calls `pipeline.ts`; `pipeline.ts` calls the other browser modules; pure modules never import browser modules. Tests may import subpaths through the existing `@xteink/optimize/*` alias.

## 5. Public contracts

```ts
type OptimizeOptions = {
	jpegQuality: number; // 50..95, default 85
	renameFromMetadata: boolean; // default false
};

type ReportLevel = "info" | "success" | "warning" | "error";

type ReportEntry = {
	level: ReportLevel;
	code: string;
	file?: string;
	message: string;
	beforeBytes?: number;
	afterBytes?: number;
};

type OptimizeReport = {
	entries: ReportEntry[];
	sourceBytes: number;
	outputBytes: number;
	imageCount: number;
	fontRemovedCount: number;
	scriptRemovedCount: number;
	warningCount: number;
	errorCount: number;
};

type OptimizeResult = {
	blob: Blob;
	fileName: string;
	report: OptimizeReport;
};

type OptimizeCallbacks = {
	onProgress(percent: number, stage: string): void;
};

async function optimizeEpub(
	file: File,
	options: OptimizeOptions,
	callbacks: OptimizeCallbacks,
	signal?: AbortSignal,
): Promise<OptimizeResult>;
```

The package does not render UI and does not trigger downloads. `apps/web` owns file selection, option state, progress display, report display, and the download anchor.

## 6. Pipeline

### 6.1 Validate and ingest

1. Reject non-EPUB extensions and files whose zip signature is not `PK`.
2. Load with JSZip and inspect `META-INF/container.xml`.
3. Reject if `META-INF/encryption.xml` exists, with code `encrypted-book`.
4. Resolve the OPF path from the container. Reject if missing or unreadable.
5. Parse OPF metadata (`dc:title`, `dc:creator`), manifest items, and spine itemrefs.
6. Reject if the spine contains no text resource.

Ingest produces a typed source inventory so later phases cannot accidentally diverge:

- zip path for every resource
- OPF directory
- spine hrefs resolved to zip paths
- manifest hrefs resolved to zip paths
- metadata title/author/language
- cover item when detectable from `properties="cover-image"` or OPF `meta[name="cover"]`

### 6.2 Image pass

Process each raster image in the manifest, plus any raster image reachable from a spine XHTML document:

1. Decode PNG/GIF/WebP/BMP/JPEG into an image bitmap.
2. Downscale only when width > 480 or height > 800, preserving aspect ratio.
3. Convert to grayscale on a white background and encode as JPEG at `jpegQuality`.
4. Write the result under a `.jpg` path derived from the original.
5. Update the image-path map used by XHTML and OPF normalization.
6. Preserve the original resource with a warning when decode or encode fails.

SVG assets referenced directly as images are kept and reported as warnings in Phase 1 because rasterizing them is not a browser-native text-free operation. SVG wrappers inside XHTML are handled by the normalization pass.

### 6.3 Text and metadata pass

For every spine XHTML document:

1. Parse as XML with `DOMParser`.
2. Remove `script` elements and event-handler attributes.
3. Remove inline `@font-face` rules.
4. Inject the device defensive CSS into `<head>`.
5. Replace SVG-only cover or image wrappers with equivalent plain `<img>` elements.
6. Rewrite image and resource `href`/`src` values through the zip-path map.
7. If XML parsing fails, preserve the original document and report a warning; the conversion continues.

For the OPF:

1. Update manifest `media-type` entries after image conversion.
2. Add or repair cover metadata when a cover item exists.
3. Preserve all still-referenced resources.

External CSS files are copied with `@font-face` rules removed, but no CSS-budget splitting is attempted in this phase.

Embedded fonts are removed from both the file inventory and manifest. A font removal is recorded once per file and counts toward the report summary.

### 6.4 Repack

`repack.ts` receives normalized resources and writes the output zip with strict OCF ordering:

1. `mimetype` is written first with compression `STORE`; content must be `application/epub+zip`.
2. JPEG outputs are written with `STORE`.
3. XHTML, CSS, OPF, and other text resources use `DEFLATE`.
4. Unchanged binary resources use `STORE`.
5. No output is produced until every resource that remains referenced has been written.

### 6.5 Filename

With `renameFromMetadata` false, use the source filename unchanged. With it true:

- Use `Title - Author.epub` when both are present.
- Use `Title.epub` when only title is present.
- Fall back to the source filename with a report warning when metadata is missing or cannot be sanitized.

Sanitization removes filesystem-hostile characters, trims whitespace, normalizes Unicode to NFC, limits the final name to 180 characters, and preserves `.epub`.

## 7. UI

The app is a single-page operational tool with four states:

1. `ready`: drop zone or file picker.
2. `configured`: selected file name/size, quality slider `50-95` default `85`, metadata-rename toggle default off, Convert and Choose Another File actions.
3. `running`: progress bar with stage label and Cancel.
4. `result`: summary, expandable change log, Download Optimized EPUB, Convert Again.

Hard failure is a fifth visible state in the same screen: one clear message plus actions to choose another file or adjust options. A failed conversion never produces a download button.

Components:

| Component                | Responsibility                         |
| ------------------------ | -------------------------------------- |
| `DropZone.svelte`        | existing selection UI                  |
| `OptimizeOptions.svelte` | quality slider and rename toggle       |
| `ProgressPanel.svelte`   | progress bar, stage, cancel            |
| `ReportPanel.svelte`     | summary, expandable log, download      |
| `App.svelte`             | state machine and calls `optimizeEpub` |

Report entries are grouped by file and rendered from the same structured `entries` data the summary is computed from. No second ad hoc log format is maintained.

## 8. Error handling

Hard failures:

- not an EPUB or not a zip
- encrypted/DRM container
- missing or unreadable OPF
- no text spine resource
- cancellation before output assembly

Recoverable failures:

- image decode or encode failure: preserve original image, warning
- XHTML parse failure: preserve original document, warning
- missing cover item: proceed without cover repair
- missing author or title for rename: fall back to source filename

Progress is checked between stages and between resources. When an abort is requested, no Blob result is returned.

## 9. Testing

### 9.1 Node tests

Run under the existing `node` Vitest project:

- report summary arithmetic and text rendering
- filename sanitization, including title/author edge cases
- `@font-face` removal from CSS text
- OCF ordering: `mimetype` entry first and stored
- zip path map consistency after renames
- path and href rewrite helpers

### 9.2 Browser tests

Run under the existing browser project:

- ingest of fixture EPUB 2 and EPUB 3 containers
- reject encrypted/DRM fixture
- image downscale to at most 480x800
- image output is grayscale JPEG with manifest media type `image/jpeg`
- XHTML script/event-handler removal
- embedded font and `@font-face` removal
- SVG cover unwrapping to an `<img>`
- defensive CSS present after normalization
- OPF cover metadata repair
- pipeline progress reaches 100 and report matches processed resources
- cancellation returns no result
- Playwright download flow through the Svelte UI

### 9.3 Fixtures

`fixtures/epubs/` contains small committed EPUBs:

- `minimal-epub2/`
- `minimal-epub3/`
- `images/` with a raster larger than 480x800
- `fonts/` with an embedded font and `@font-face`
- `scripts-svg/` with scripts, event handlers, and an SVG cover
- `encrypted/` with `META-INF/encryption.xml`

Fixture builders are deterministic and produce no external network dependency.

## 10. Files touched

New:

- `packages/optimize/src/types.ts`
- `packages/optimize/src/options.ts`
- `packages/optimize/src/errors.ts`
- `packages/optimize/src/report.ts`
- `packages/optimize/src/css.ts`
- `packages/optimize/src/repack.ts`
- `packages/optimize/src/ingest.ts`
- `packages/optimize/src/images.ts`
- `packages/optimize/src/normalize.ts`
- `packages/optimize/src/pipeline.ts`
- package and component tests listed in Section 9
- `apps/web/src/lib/OptimizeOptions.svelte`
- `apps/web/src/lib/ProgressPanel.svelte`
- `apps/web/src/lib/ReportPanel.svelte`
- `fixtures/epubs/*`

Modified:

- `packages/optimize/package.json` to add `jszip`
- `packages/optimize/src/index.ts` to export `optimizeEpub` and public types
- `apps/web/src/App.svelte` and `apps/web/src/app.css` for the four-state flow
- root/workspace `package.json` and `package-lock.json` to install the real toolchain and dependencies
- root config files only where the toolchain install requires them
- `AGENTS.md` module map and verified commands where commands change

Removed after one-time implementation confirmation:

- accidental root PlatformIO placeholders `include/`, `lib/`, empty `src/`, and `test/` if they are still present when Phase 1 starts

## 11. Phase 1 exit criteria

1. `npm ci` installs from a clean checkout and all scripts run.
2. Node and browser test projects pass, including fixture and UI tests.
3. A real single-book EPUB flows: select file, convert, report, download.
4. The downloaded EPUB opens as an OCF-valid archive and contains normalized text/resources.
5. Image dimensions never exceed 480x800 after Phase 1 image handling.
6. No tracked `crosspoint-reader/**` file is modified and `npm run guard` passes.
