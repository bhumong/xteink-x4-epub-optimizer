# Xteink X4 EPUB Optimizer: Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a browser-only single-book EPUB optimizer that ingests one `.epub`, normalizes it for CrossPoint/Xteink X4, repacks it as a valid OCF zip, reports every change, and downloads the result.

**Architecture:** `packages/optimize` owns the conversion pipeline behind one `optimizeEpub()` entry point. Pure modules (types, CSS helpers, report, filename, OCF repack) are tested in Node; DOM/image modules and the Svelte UI are tested in Chromium. `apps/server` remains a static host and is untouched by Phase 1 processing.

**Tech Stack:** Node 24, npm workspaces, TypeScript strict, JSZip, Vite, Svelte 5 runes, Vitest browser mode, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-06-xteink-x4-epub-optimizer-phase-1-design.md`. Read the parent design spec and this Phase 1 spec before starting.

## Global Constraints

- `crosspoint-reader/**` is read-only vendored reference. Never stage, commit, or push inside either submodule.
- No device writes. The app downloads only.
- All processing happens in Chromium. No Node-only conversion path is added.
- EPUB output must be OCF-valid: `mimetype` first and `STORE`.
- Target image viewport is 480x800.
- Phase 1 explicitly excludes CSS budget splitting, spine splitting, hyphenation, XTC, batch mode, and device upload.
- TypeScript is strict with `verbatimModuleSyntax`. Tests route by suffix: `*.node.test.ts` for the node project, `*.browser.test.ts` for browser.
- Dependencies are installed with `npm install`; do not hand-write version ranges.
- No `git add -A` or `git add .` from the repo root.

---

## File Structure

```text
packages/optimize/src/
  types.ts              shared contracts and constants
  options.ts            option defaults and validation
  errors.ts             OptimizeError and error-code helpers
  report.ts             report entry helpers and text rendering
  filename.ts           safe EPUB output filename generation
  css.ts                @font-face removal and defensive CSS
  repack.ts             OCF zip writer and structure assertions
  ingest.ts             JSZip/OPF/spine/metadata parser
  images.ts             raster downscale + grayscale JPEG conversion
  normalize.ts          XHTML and OPF DOM rewrites
  pipeline.ts           optimizeEpub() orchestration
  index.ts              package public exports

packages/optimize/test/
  types.node.test.ts
  css.node.test.ts
  report.node.test.ts
  filename.node.test.ts
  repack.node.test.ts
  ingest.browser.test.ts
  images.browser.test.ts
  normalize.browser.test.ts
  pipeline.browser.test.ts

fixtures/generate-epubs.mjs       deterministic fixture writer
fixtures/epubs/...                generated committed fixtures

apps/web/src/
  lib/OptimizeOptions.svelte
  lib/ProgressPanel.svelte
  lib/ReportPanel.svelte
  App.svelte                     state machine rewrite

apps/web/e2e/
  optimizer.spec.ts              real-browser UI flow

playwright.config.ts             e2e web server config
```

---

## Task 0: Finish the runnable scaffold

**Files:**

- Modify: `package.json`, `package-lock.json`, workspace package files as npm requires
- Delete after confirmation: accidental root PlatformIO placeholders `include/`, `lib/`, `src/`, `test/`

**Interfaces:**

- Consumes: the committed empty scaffold.
- Produces: a repo where `npm test`, `npm run check`, `npm run lint`, and `npm run format` work locally.

- [ ] **Step 1: Install the full toolchain**

Run from the repo root:

```bash
npm install -w packages/optimize jszip
npm install -D typescript vitest @vitest/browser-playwright playwright @playwright/test \
  svelte @sveltejs/vite-plugin-svelte svelte-check vite \
  eslint @eslint/js typescript-eslint eslint-config-prettier prettier \
  prettier-plugin-svelte globals @types/node
npx playwright install chromium
```

Expected: `npm ls --depth=0` shows the workspace links plus dev dependencies; `node_modules/.bin/vite`, `vitest`, `tsc`, and `svelte-check` exist.

- [ ] **Step 2: Confirm the scaffold gate is green**

Run: `npm run check && npm run lint && npm run format && npm run test:node`

Expected: all pass. If `npm run check` reports missing Svelte types, run `npm run check:web` instead for `apps/web`; the root `tsconfig.json` excludes `apps/web` by design.

- [ ] **Step 3: Remove the accidental PlatformIO placeholder directories**

Run only after the user confirms:

```bash
git rm -r --cached include lib test 2>/dev/null || true
rmdir include lib src test 2>/dev/null || true
git add -u include lib test 2>/dev/null || true
git commit -m "chore: remove accidental root PlatformIO placeholders"
```

If `src` contains user files, stop and keep `src`; the Phase 1 code does not depend on these root directories.

- [ ] **Step 4: Verify no submodule change**

Run: `npm run guard`

Expected: `guard: PASS` with both pinned submodule HEADs.

---

## Task 1: Shared contracts, options, and errors

**Files:**

- Create: `packages/optimize/src/types.ts`, `packages/optimize/src/options.ts`, `packages/optimize/src/errors.ts`
- Test: `packages/optimize/test/types.node.test.ts`

**Interfaces:**

- Produces: `OptimizeOptions`, `OptimizeResult`, `ReportEntry`, `OptimizeReport`, `EpubSource`, `ManifestItem`, `SpineItem`, `Metadata`, `ProgressEvent`, `ImageChange`, `OptimizeError`, `OptimizeErrorCode`.

- [ ] **Step 1: Write the failing contract test**

`packages/optimize/test/types.node.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS } from "../src/options.ts";

describe("options", () => {
	it("defaults to a device-safe JPEG quality and no rename", () => {
		expect(DEFAULT_OPTIONS).toEqual({ jpegQuality: 85, renameFromMetadata: false });
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project node`
Expected: FAIL, `options.ts` not found.

- [ ] **Step 3: Implement the contract files**

`packages/optimize/src/types.ts`:

```ts
export const VIEWPORT_WIDTH = 480;
export const VIEWPORT_HEIGHT = 800;

export interface OptimizeOptions {
	jpegQuality: number;
	renameFromMetadata: boolean;
}

export interface Metadata {
	title: string;
	author: string;
	language: string;
	coverItemId?: string;
}

export interface ManifestItem {
	id: string;
	href: string;
	mediaType: string;
	zipPath: string;
}

export interface SpineItem {
	idref: string;
	href: string;
	zipPath: string;
}

export interface EpubSource {
	opfPath: string;
	opfDir: string;
	resources: Map<string, Uint8Array>;
	manifest: Map<string, ManifestItem>;
	spine: SpineItem[];
	metadata: Metadata;
}

export type ReportLevel = "info" | "success" | "warning" | "error";

export interface ReportEntry {
	level: ReportLevel;
	code: string;
	message: string;
	file?: string;
	beforeBytes?: number;
	afterBytes?: number;
}

export interface OptimizeReport {
	entries: ReportEntry[];
	sourceBytes: number;
	outputBytes: number;
	imageCount: number;
	fontRemovedCount: number;
	scriptRemovedCount: number;
	warningCount: number;
	errorCount: number;
}

export interface OptimizeResult {
	blob: Blob;
	fileName: string;
	report: OptimizeReport;
}

export type ProgressStage = "read" | "images" | "normalize" | "pack" | "done";

export interface ProgressEvent {
	percent: number;
	stage: ProgressStage;
	message: string;
}

export interface OptimizeCallbacks {
	onProgress(event: ProgressEvent): void;
}

export interface ImageChange {
	sourcePath: string;
	targetPath: string;
	width: number;
	height: number;
	sourceBytes: number;
	targetBytes: number;
}
```

`packages/optimize/src/options.ts`:

```ts
import type { OptimizeOptions } from "./types.ts";

export const JPEG_QUALITY_MIN = 50;
export const JPEG_QUALITY_MAX = 95;

export const DEFAULT_OPTIONS: OptimizeOptions = {
	jpegQuality: 85,
	renameFromMetadata: false,
};

export function validateOptions(input: OptimizeOptions): OptimizeOptions {
	const quality = Math.round(Number(input.jpegQuality));
	if (!Number.isFinite(quality)) {
		throw new Error("jpegQuality must be a finite number");
	}
	return {
		jpegQuality: Math.min(JPEG_QUALITY_MAX, Math.max(JPEG_QUALITY_MIN, quality)),
		renameFromMetadata: Boolean(input.renameFromMetadata),
	};
}
```

`packages/optimize/src/errors.ts`:

```ts
export type OptimizeErrorCode =
	| "not-epub"
	| "not-zip"
	| "encrypted-book"
	| "missing-container"
	| "missing-opf"
	| "empty-spine"
	| "missing-spine-file"
	| "parse-error"
	| "aborted";

export class OptimizeError extends Error {
	readonly code: OptimizeErrorCode;

	constructor(code: OptimizeErrorCode, message: string) {
		super(message);
		this.name = "OptimizeError";
		this.code = code;
	}
}

export function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}
```

- [ ] **Step 4: Run the test and all existing gates**

Run: `npx vitest run --project node && npm run check && npm run lint && npm run format`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/optimize
git commit -m "feat(optimize): add Phase 1 contracts, options, and errors"
```

---

## Task 2: Pure helpers: CSS, report, filename

**Files:**

- Create: `packages/optimize/src/css.ts`, `packages/optimize/src/report.ts`, `packages/optimize/src/filename.ts`
- Test: `packages/optimize/test/css.node.test.ts`, `packages/optimize/test/report.node.test.ts`, `packages/optimize/test/filename.node.test.ts`

**Interfaces:**

- Produces: `DEFENSIVE_CSS`, `stripFontFaceRules(css: string): { css: string; count: number }`, `createReport(...)`, `renderTextReport(report: OptimizeReport): string`, `entry(...)`, `safeEpubFilename(title: string, author: string, sourceName: string): string`.

- [ ] **Step 1: Write failing pure tests**

`packages/optimize/test/css.node.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { stripFontFaceRules } from "../src/css.ts";

describe("stripFontFaceRules", () => {
	it("removes balanced @font-face blocks", () => {
		const css =
			"a { color: red; } @font-face { font-family: X; src: url(x.ttf); } b { color: blue; }";
		const result = stripFontFaceRules(css);
		expect(result.count).toBe(1);
		expect(result.css).not.toContain("@font-face");
		expect(result.css).toContain("a { color: red; }");
		expect(result.css).toContain("b { color: blue; }");
	});
});
```

`packages/optimize/test/report.node.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createReport, renderTextReport } from "../src/report.ts";

describe("report", () => {
	it("counts warnings and renders entries", () => {
		const report = createReport(
			[
				{ level: "success", code: "image-done", message: "done", file: "a.jpg" },
				{ level: "warning", code: "image-kept", message: "kept", file: "b.jpg" },
			],
			1000,
			700,
		);
		expect(report.warningCount).toBe(1);
		expect(report.sourceBytes).toBe(1000);
		expect(renderTextReport(report)).toContain("a.jpg");
	});
});
```

`packages/optimize/test/filename.node.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { safeEpubFilename } from "../src/filename.ts";

describe("safeEpubFilename", () => {
	it("uses title and author when rename is enabled", () => {
		expect(safeEpubFilename("A Book", "An Author", "old.epub", true)).toBe(
			"A Book - An Author.epub",
		);
	});
	it("keeps source name when rename is disabled", () => {
		expect(safeEpubFilename("A Book", "An Author", "old.epub", false)).toBe("old.epub");
	});
	it("removes filesystem-hostile characters", () => {
		expect(safeEpubFilename("A: B", "", "old.epub", true)).toBe("A B.epub");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project node`
Expected: three suites fail on missing modules.

- [ ] **Step 3: Implement pure helpers**

`packages/optimize/src/css.ts`:

```ts
export const DEFENSIVE_CSS =
	"img,svg{max-width:100%;height:auto}body{overflow-wrap:break-word}" +
	"table{max-width:100%;table-layout:fixed}pre,code{white-space:pre-wrap;word-wrap:break-word}" +
	"*{box-sizing:border-box}";

export function stripFontFaceRules(css: string): { css: string; count: number } {
	let out = "";
	let count = 0;
	let i = 0;

	while (i < css.length) {
		if (css.slice(i, i + 10).toLowerCase() === "@font-face") {
			let j = i + 10;
			while (j < css.length && /\s/.test(css[j])) j++;
			if (css[j] === "{") {
				let depth = 0;
				while (j < css.length) {
					const ch = css[j];
					if (ch === "{") depth++;
					else if (ch === "}") depth--;
					j++;
					if (depth === 0) break;
				}
				count++;
				i = j;
				continue;
			}
		}
		out += css[i];
		i++;
	}

	return { css: out.trim(), count };
}
```

`packages/optimize/src/report.ts`:

```ts
import type { OptimizeReport, ReportEntry } from "./types.ts";

export function entry(
	level: ReportEntry["level"],
	code: string,
	message: string,
	file?: string,
): ReportEntry {
	return { level, code, message, file };
}

export function createReport(
	entries: ReportEntry[],
	sourceBytes: number,
	outputBytes: number,
): OptimizeReport {
	const warnings = entries.filter((item) => item.level === "warning");
	const errors = entries.filter((item) => item.level === "error");
	const fontRemovedCount = entries.filter((item) => item.code === "font-removed").length;
	const scriptRemovedCount = entries.filter((item) => item.code === "script-removed").length;
	const imageCount = entries.filter((item) => item.code === "image-encoded").length;

	return {
		entries,
		sourceBytes,
		outputBytes,
		imageCount,
		fontRemovedCount,
		scriptRemovedCount,
		warningCount: warnings.length,
		errorCount: errors.length,
	};
}

export function renderTextReport(report: OptimizeReport): string {
	const lines = report.entries.map((item) => {
		const prefix = item.level.toUpperCase();
		const file = item.file ? ` [${item.file}]` : "";
		return `${prefix}${file}: ${item.message}`;
	});
	return lines.join("\n");
}
```

`packages/optimize/src/filename.ts`:

```ts
export function safeEpubFilename(
	title: string,
	author: string,
	sourceName: string,
	renameFromMetadata: boolean,
): string {
	if (!renameFromMetadata) return sourceName;

	const clean = (value: string) =>
		value
			.normalize("NFC")
			.replace(/[\u0000-\u001f<>:"/\\|?*]/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.replace(/^[. ]+/, "")
			.replace(/[. ]+$/, "");

	const safeTitle = clean(title);
	const safeAuthor = clean(author);
	let base = safeTitle;
	if (safeTitle && safeAuthor) base = `${safeTitle} - ${safeAuthor}`;
	if (!base) return sourceName;
	if (base.length > 180)
		base =
			base
				.slice(0, 180)
				.replace(/\s+\S*$/, "")
				.trim() || base.slice(0, 180);
	return `${base}.epub`;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run --project node`
Expected: all pure tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/optimize
git commit -m "feat(optimize): add CSS, report, and filename helpers"
```

---

## Task 3: OCF repack writer

**Files:**

- Create: `packages/optimize/src/repack.ts`
- Test: `packages/optimize/test/repack.node.test.ts`

**Interfaces:**

- Produces: `isTextPath(path: string): boolean`, `repackEpub(resources: Map<string, Uint8Array>, signal?: AbortSignal): Promise<Blob>`, `readEpubBuffer(blob: Blob): Promise<ArrayBuffer>`.

- [ ] **Step 1: Write the failing repack test**

`packages/optimize/test/repack.node.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isTextPath, repackEpub } from "../src/repack.ts";

describe("repackEpub", () => {
	it("writes mimetype first and stores text as deflate-compatible entries", async () => {
		const resources = new Map<string, Uint8Array>([
			["mimetype", new TextEncoder().encode("application/epub+zip")],
			["OEBPS/content.opf", new TextEncoder().encode("<package/>")],
			["OEBPS/Images/cover.jpg", new Uint8Array([1, 2, 3])],
		]);
		const blob = await repackEpub(resources);
		const bytes = new Uint8Array(await blob.arrayBuffer());
		const first = new TextDecoder().decode(bytes.subarray(0, 30));
		expect(first).toContain("mimetype");
		expect(isTextPath("OEBPS/content.opf")).toBe(true);
		expect(isTextPath("OEBPS/Images/cover.jpg")).toBe(false);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project node`
Expected: FAIL, `repack.ts` not found.

- [ ] **Step 3: Implement the writer**

`packages/optimize/src/repack.ts`:

```ts
import JSZip from "jszip";

const TEXT_EXTENSIONS = new Set([
	".xhtml",
	".html",
	".htm",
	".opf",
	".ncx",
	".css",
	".xml",
	".js",
	".txt",
	".svg",
]);

export function isTextPath(path: string): boolean {
	const lower = path.toLowerCase();
	const lastDot = lower.lastIndexOf(".");
	return lastDot > 0 && TEXT_EXTENSIONS.has(lower.slice(lastDot));
}

export async function repackEpub(
	resources: Map<string, Uint8Array>,
	signal?: AbortSignal,
): Promise<Blob> {
	const zip = new JSZip();
	const mimetype = resources.get("mimetype");
	if (!mimetype) throw new Error("mimetype resource missing");

	zip.file("mimetype", mimetype, { compression: "STORE", createFolders: false });

	const paths = [...resources.keys()].sort((a, b) => a.localeCompare(b));
	for (const path of paths) {
		if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
		if (path === "mimetype") continue;
		const data = resources.get(path);
		if (!data) continue;
		const compression = isTextPath(path) ? "DEFLATE" : "STORE";
		zip.file(path, data, { compression, createFolders: false });
	}

	return zip.generateAsync({
		type: "blob",
		mimeType: "application/epub+zip",
		compression: "DEFLATE",
		streamFiles: true,
	});
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run --project node`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/optimize
git commit -m "feat(optimize): add OCF repack writer"
```

## Task 4: Deterministic EPUB fixture generator

**Files:**

- Create: `fixtures/generate-epubs.mjs`, generated `fixtures/epubs/**`
- Test: none for this task; the script is the test fixture source.

**Interfaces:**

- Produces: physical EPUB files used by e2e tests and manual verification:
  `fixtures/epubs/minimal-epub2/book.epub`, `minimal-epub3/book.epub`, `images/book.epub`, `fonts/book.epub`, `scripts-svg/book.epub`, `encrypted/book.epub`.

- [ ] **Step 1: Write the generator**

`fixtures/generate-epubs.mjs`:

```js
import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const root = join(dirname(fileURLToPath(import.meta.url)), "epubs");

function crc32(bytes) {
	let table = crc32.table;
	if (!table) {
		table = crc32.table = new Int32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			table[n] = c;
		}
	}
	let crc = -1;
	for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
	const typeBytes = Buffer.from(type, "ascii");
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
	return Buffer.concat([length, typeBytes, data, crc]);
}

function solidPng(width, height, rgb) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;
	const scanlines = Buffer.alloc(height * (1 + width * 3));
	for (let y = 0; y < height; y++) {
		const row = y * (1 + width * 3);
		scanlines[row] = 0;
		for (let x = 0; x < width; x++) {
			const offset = row + 1 + x * 3;
			scanlines[offset] = rgb[0];
			scanlines[offset + 1] = rgb[1];
			scanlines[offset + 2] = rgb[2];
		}
	}
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

async function writeEpub(name, makeZip) {
	const zip = new JSZip();
	zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
	await makeZip(zip);
	const buffer = await zip.generateAsync({
		type: "nodebuffer",
		compression: "DEFLATE",
		streamFiles: true,
	});
	const dir = join(root, name);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "book.epub"), buffer);
	console.log("fixture:", join(dir, "book.epub"));
}

function containerXml(opfPath) {
	return `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/></rootfiles></container>`;
}

async function makeSimpleEpub(zip, { version, title, author, content }) {
	const isEpub3 = version === 3;
	zip.file("META-INF/container.xml", containerXml("OEBPS/content.opf"));
	zip.file(
		"OEBPS/content.opf",
		`<package xmlns="http://www.idpf.org/2007/opf" version="${version}" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">fixture</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>`,
	);
	zip.file(
		"OEBPS/ch1.xhtml",
		`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>${content}</body></html>`,
	);
	if (isEpub3) {
		zip.file(
			"OEBPS/nav.xhtml",
			`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Nav</title></head><body><nav epub:type="toc"><ol><li><a href="ch1.xhtml">${title}</a></li></ol></nav></body></html>`,
		);
	}
}

async function main() {
	await writeEpub("minimal-epub2", (zip) =>
		makeSimpleEpub(zip, {
			version: 2,
			title: "Minimal Two",
			author: "Fixture Author",
			content: "<p>Hello two.</p>",
		}),
	);
	await writeEpub("minimal-epub3", (zip) =>
		makeSimpleEpub(zip, {
			version: 3,
			title: "Minimal Three",
			author: "Fixture Author",
			content: "<p>Hello three.</p>",
		}),
	);

	const largePng = solidPng(960, 1600, [255, 255, 255]);
	await writeEpub("images", async (zip) => {
		zip.file("META-INF/container.xml", containerXml("OEBPS/content.opf"));
		zip.file(
			"OEBPS/content.opf",
			'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">fixture</dc:identifier><dc:title>Image Book</dc:title><dc:creator>Fixture Author</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="img" href="Images/large.png" media-type="image/png"/><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>',
		);
		zip.file(
			"OEBPS/ch1.xhtml",
			'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Image Book</title></head><body><p><img src="Images/large.png" alt="large"/></p></body></html>',
		);
		zip.file("OEBPS/Images/large.png", largePng);
	});

	await writeEpub("fonts", async (zip) => {
		await makeSimpleEpub(zip, {
			version: 3,
			title: "Font Book",
			author: "Fixture Author",
			content: '<p style="font-family:X">Styled</p>',
		});
		zip.file("OEBPS/font.ttf", Buffer.from("fake-font-bytes"));
	});

	const coverPng = solidPng(480, 800, [0, 0, 0]);
	await writeEpub("scripts-svg", async (zip) => {
		zip.file("META-INF/container.xml", containerXml("OEBPS/content.opf"));
		zip.file(
			"OEBPS/content.opf",
			`<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">fixture</dc:identifier><dc:title>SVG Book</dc:title><dc:creator>Fixture Author</dc:creator><dc:language>en</dc:language><meta name="cover" content="cover"/></metadata><manifest><item id="cover" href="Images/cover.png" media-type="image/png" properties="cover-image"/><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>`,
		);
		zip.file("OEBPS/Images/cover.png", coverPng);
		zip.file(
			"OEBPS/ch1.xhtml",
			`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink"><head><title>SVG Book</title><script>alert(1)</script></head><body onload="alert(2)"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="480" height="800"><image xlink:href="Images/cover.png" width="480" height="800"/></svg></body></html>`,
		);
	});

	await writeEpub("encrypted", async (zip) => {
		await makeSimpleEpub(zip, {
			version: 3,
			title: "Encrypted",
			author: "Fixture Author",
			content: "<p>Encrypted.</p>",
		});
		zip.file(
			"META-INF/encryption.xml",
			'<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData/></encryption>',
		);
	});
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
```

- [ ] **Step 2: Run the generator and commit fixtures**

Run: `node fixtures/generate-epubs.mjs`
Expected: six directories under `fixtures/epubs/`, each containing `book.epub`.

Run:

```bash
git add fixtures/generate-epubs.mjs fixtures/epubs
git commit -m "test(optimize): add deterministic EPUB fixtures"
```

Note: the generated `scripts-svg` fixture intentionally contains no real font resource in the font case; Phase 1 removes the fake font bytes and reports it, which is enough to exercise the removal path without shipping a large font.

---

## Task 5: EPUB ingest

**Files:**

- Create: `packages/optimize/src/ingest.ts`
- Test: `packages/optimize/test/ingest.browser.test.ts`

**Interfaces:**

- Consumes: `EpubSource`, `OptimizeError`, `joinZipPath`, `opfDirectoryPath` from existing modules.
- Produces: `ingestEpub(file: File): Promise<EpubSource>`, `parseXmlDocument(text: string): Document`, `readResourceText(bytes: Uint8Array): string`.

- [ ] **Step 1: Write the failing ingest test**

`packages/optimize/test/ingest.browser.test.ts`:

```ts
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { ingestEpub } from "../src/ingest.ts";

async function fileFromZip(zip: JSZip, name = "book.epub"): Promise<File> {
	const blob = await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
	return new File([blob], name, { type: "application/epub+zip" });
}

function baseZip() {
	const zip = new JSZip();
	zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
	zip.file(
		"META-INF/container.xml",
		'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
	);
	return zip;
}

describe("ingestEpub", () => {
	it("parses OPF spine and metadata", async () => {
		const zip = baseZip();
		zip.file(
			"OEBPS/content.opf",
			'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier><dc:title>Title</dc:title><dc:creator>Author</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
		);
		zip.file(
			"OEBPS/ch1.xhtml",
			'<html xmlns="http://www.w3.org/1999/xhtml"><body>Hi</body></html>',
		);
		const source = await ingestEpub(await fileFromZip(zip));
		expect(source.opfPath).toBe("OEBPS/content.opf");
		expect(source.metadata.title).toBe("Title");
		expect(source.metadata.author).toBe("Author");
		expect(source.spine).toHaveLength(1);
		expect(source.spine[0].zipPath).toBe("OEBPS/ch1.xhtml");
	});

	it("rejects encrypted books", async () => {
		const zip = baseZip();
		zip.file("META-INF/encryption.xml", "<encryption/>");
		await expect(ingestEpub(await fileFromZip(zip))).rejects.toMatchObject({
			code: "encrypted-book",
		});
	});
});
```

- [ ] **Step 2: Run the browser test to verify it fails**

Run: `npx vitest run --project browser`
Expected: FAIL, `ingest.ts` not found.

- [ ] **Step 3: Implement ingest**

`packages/optimize/src/ingest.ts`:

```ts
import JSZip from "jszip";
import { OptimizeError } from "./errors.ts";
import { joinZipPath, opfDirectoryPath } from "./paths.ts";
import type { EpubSource, ManifestItem, Metadata, SpineItem } from "./types.ts";

export function parseXmlDocument(text: string, mimeType = "application/xml"): Document {
	const doc = new DOMParser().parseFromString(text, mimeType);
	if (doc.getElementsByTagName("parsererror").length > 0) {
		throw new OptimizeError("parse-error", "XML parsing failed");
	}
	return doc;
}

export function readResourceText(bytes: Uint8Array): string {
	return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "");
}

function textOf(doc: Document, localName: string): string {
	return doc.getElementsByTagNameNS("*", localName)[0]?.textContent?.trim() ?? "";
}

export async function ingestEpub(file: File): Promise<EpubSource> {
	if (!file.name.toLowerCase().endsWith(".epub")) {
		throw new OptimizeError("not-epub", "Only .epub files are supported.");
	}

	const bytes = new Uint8Array(await file.arrayBuffer());
	if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
		throw new OptimizeError("not-zip", "The file is not a ZIP/EPUB container.");
	}

	const zip = await JSZip.loadAsync(bytes);
	if (Object.keys(zip.files).some((path) => path.toLowerCase() === "meta-inf/encryption.xml")) {
		throw new OptimizeError("encrypted-book", "Encrypted EPUBs are not supported.");
	}

	const containerPath = Object.keys(zip.files).find(
		(path) => path.toLowerCase() === "meta-inf/container.xml",
	);
	if (!containerPath)
		throw new OptimizeError("missing-container", "META-INF/container.xml is missing.");

	const containerXml = await zip.file(containerPath)?.async("string");
	if (!containerXml)
		throw new OptimizeError("missing-container", "META-INF/container.xml is unreadable.");

	const container = parseXmlDocument(containerXml);
	const rootfile = container.getElementsByTagNameNS("*", "rootfile")[0];
	const opfPath = rootfile?.getAttribute("full-path");
	if (!opfPath) throw new OptimizeError("missing-opf", "No OPF rootfile was declared.");

	const opfFile = zip.file(opfPath);
	if (!opfFile) throw new OptimizeError("missing-opf", `OPF not found: ${opfPath}`);
	const opfText = await opfFile.async("string");
	const opf = parseXmlDocument(opfText);

	const opfDir = opfDirectoryPath(opfPath);
	const resources = new Map<string, Uint8Array>();
	const manifest = new Map<string, ManifestItem>();

	for (const file of Object.values(zip.files)) {
		if (!file.dir) {
			const data = await file.async("uint8array");
			resources.set(file.name, data);
		}
	}

	const title = textOf(opf, "title");
	const authorCandidates = [...opf.getElementsByTagNameNS("*", "creator")];
	const author = authorCandidates[0]?.textContent?.trim() ?? "";
	const language = textOf(opf, "language");

	for (const item of [...opf.getElementsByTagNameNS("*", "item")]) {
		const id = item.getAttribute("id") ?? "";
		const href = item.getAttribute("href") ?? "";
		if (!id) continue;
		manifest.set(id, {
			id,
			href,
			mediaType: item.getAttribute("media-type") ?? "",
			zipPath: joinZipPath(opfDir, href),
		});
	}

	let coverItemId: string | undefined;
	for (const item of [...opf.getElementsByTagNameNS("*", "item")]) {
		const properties = item.getAttribute("properties")?.split(/\s+/).filter(Boolean) ?? [];
		if (properties.includes("cover-image")) {
			coverItemId = item.getAttribute("id") ?? undefined;
			break;
		}
	}
	if (!coverItemId) {
		const coverMeta = [...opf.getElementsByTagNameNS("*", "meta")].find(
			(meta) => meta.getAttribute("name")?.toLowerCase() === "cover",
		);
		coverItemId = coverMeta?.getAttribute("content") ?? undefined;
	}

	const metadata: Metadata = { title, author, language, coverItemId };
	const spine: SpineItem[] = [];
	for (const itemref of [...opf.getElementsByTagNameNS("*", "itemref")]) {
		const idref = itemref.getAttribute("idref") ?? "";
		const manifestItem = manifest.get(idref);
		if (!manifestItem) continue;
		spine.push({
			idref,
			href: manifestItem.href,
			zipPath: manifestItem.zipPath,
		});
		if (!resources.has(manifestItem.zipPath)) {
			throw new OptimizeError("missing-spine-file", `Spine file missing: ${manifestItem.zipPath}`);
		}
	}

	if (spine.length === 0) {
		throw new OptimizeError("empty-spine", "The OPF spine contains no readable text resources.");
	}

	return { opfPath, opfDir, resources, manifest, spine, metadata };
}
```

The cover scan above is intentionally simple and tested by the normalize/OPF task; if it proves fragile during implementation, replace it with a single helper that reads `properties="cover-image"` before checking the `cover` meta element.

- [ ] **Step 4: Run browser tests**

Run: `npx vitest run --project browser`
Expected: ingest tests pass. If `DOMParser` cannot resolve namespace-agnostic calls in Chromium, use `doc.getElementsByTagName('parsererror')` only as a fallback and keep the namespace form as primary.

- [ ] **Step 5: Commit**

```bash
git add packages/optimize
git commit -m "feat(optimize): parse EPUB containers through ingest"
```

---

## Task 6: Image conversion

**Files:**

- Create: `packages/optimize/src/images.ts`
- Test: `packages/optimize/test/images.browser.test.ts`

**Interfaces:**

- Produces: `optimizeRasterImage(data: Uint8Array, jpegQuality: number): Promise<{ data: Uint8Array; width: number; height: number }>`, `isRasterMediaType(mediaType: string): boolean`.

- [ ] **Step 1: Write the failing browser image test**

`packages/optimize/test/images.browser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isRasterMediaType, optimizeRasterImage } from "../src/images.ts";
import { VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from "../src/types.ts";

async function makePng(width: number, height: number): Promise<Uint8Array> {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d")!;
	ctx.fillStyle = "#777777";
	ctx.fillRect(0, 0, width, height);
	const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
	return new Uint8Array(await blob.arrayBuffer());
}

describe("image conversion", () => {
	it("downscales a large PNG to fit 480x800 and returns a JPEG", async () => {
		const result = await optimizeRasterImage(await makePng(960, 1600), 85);
		expect(result.width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
		expect(result.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
		const header = result.data.subarray(0, 2);
		expect([...header]).toEqual([0xff, 0xd8]);
	});

	it("classifies raster media types", () => {
		expect(isRasterMediaType("image/png")).toBe(true);
		expect(isRasterMediaType("image/svg+xml")).toBe(false);
	});
});
```

- [ ] **Step 2: Run the browser test to verify it fails**

Run: `npx vitest run --project browser`
Expected: FAIL, `images.ts` not found.

- [ ] **Step 3: Implement image conversion**

`packages/optimize/src/images.ts`:

```ts
import { VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from "./types.ts";

const RASTER_PREFIX = "image/";
const NON_RASTER = new Set(["image/svg+xml"]);

export function isRasterMediaType(mediaType: string): boolean {
	return mediaType.startsWith(RASTER_PREFIX) && !NON_RASTER.has(mediaType.toLowerCase());
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (!blob) {
					reject(new Error("JPEG encoding returned no blob"));
					return;
				}
				blob
					.arrayBuffer()
					.then((buffer) => resolve(new Uint8Array(buffer)))
					.catch(reject);
			},
			"image/jpeg",
			quality / 100,
		);
	});
}

export async function optimizeRasterImage(
	data: Uint8Array,
	jpegQuality: number,
): Promise<{ data: Uint8Array; width: number; height: number }> {
	const bitmap = await createImageBitmap(new Blob([data]));
	try {
		const scale = Math.min(1, VIEWPORT_WIDTH / bitmap.width, VIEWPORT_HEIGHT / bitmap.height);
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Canvas 2D context unavailable");

		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, width, height);
		ctx.filter = "grayscale(1)";
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";
		ctx.drawImage(bitmap, 0, 0, width, height);

		const jpeg = await canvasToJpeg(canvas, jpegQuality);
		return { data: jpeg, width, height };
	} finally {
		bitmap.close();
	}
}
```

- [ ] **Step 4: Run the browser test**

Run: `npx vitest run --project browser`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/optimize
git commit -m "feat(optimize): downscale raster images to grayscale JPEG"
```

---

## Task 7: XHTML and OPF normalization

**Files:**

- Create: `packages/optimize/src/normalize.ts`
- Test: `packages/optimize/test/normalize.browser.test.ts`

**Interfaces:**

- Produces:
  - `normalizeXhtmlDocument(html: string, sourceXhtmlPath: string, imageRenameMap: ReadonlyMap<string, string>): { html: string; removedScripts: number; removedHandlers: number; removedFontFaces: number; svgImages: number }`
  - `normalizeOpfDocument(opfXml: string, opfDir: string, imageRenameMap: ReadonlyMap<string, string>, fontZipPaths: ReadonlySet<string>): string`

- [ ] **Step 1: Write the failing normalize test**

`packages/optimize/test/normalize.browser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeOpfDocument, normalizeXhtmlDocument } from "../src/normalize.ts";
import { DEFENSIVE_CSS } from "../src/css.ts";

describe("normalizeXhtmlDocument", () => {
	it("removes scripts, handlers, @font-face, and rewrites renamed images", () => {
		const input = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink"><head><script>alert(1)</script><style>@font-face{font-family:X;src:url(font.ttf)}</style></head><body onclick="alert(2)"><img src="Images/old.png"/></body></html>`;
		const map = new Map([["OEBPS/Images/old.png", "OEBPS/Images/old.jpg"]]);
		const result = normalizeXhtmlDocument(input, "OEBPS/ch1.xhtml", map);
		expect(result.html).not.toContain("<script");
		expect(result.html).not.toContain("onclick");
		expect(result.html).not.toContain("@font-face");
		expect(result.html).toContain('src="Images/old.jpg"');
		expect(result.html).toContain(DEFENSIVE_CSS);
		expect(result.removedScripts).toBe(1);
		expect(result.removedFontFaces).toBe(1);
	});

	it("unwraps SVG image wrappers", () => {
		const input =
			'<html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink"><body><svg width="480" height="800"><image xlink:href="cover.png"/></svg></body></html>';
		const result = normalizeXhtmlDocument(input, "OEBPS/cover.xhtml", new Map());
		expect(result.html).not.toContain("<svg");
		expect(result.html).toContain("<img");
		expect(result.svgImages).toBe(1);
	});
});

describe("normalizeOpfDocument", () => {
	it("rewrites image hrefs and removes fonts", () => {
		const opf =
			'<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest><item id="i" href="Images/a.png" media-type="image/png"/><item id="f" href="font.ttf" media-type="application/vnd.ms-opentype"/></manifest><spine/></package>';
		const map = new Map([["OEBPS/Images/a.png", "OEBPS/Images/a.jpg"]]);
		const out = normalizeOpfDocument(opf, "OEBPS/", map, new Set(["OEBPS/font.ttf"]));
		expect(out).toContain("Images/a.jpg");
		expect(out).toContain("image/jpeg");
		expect(out).not.toContain("font.ttf");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project browser`
Expected: FAIL, `normalize.ts` not found.

- [ ] **Step 3: Implement normalize**

`packages/optimize/src/normalize.ts`:

```ts
import { DEFENSIVE_CSS, stripFontFaceRules } from "./css.ts";
import { parseXmlDocument } from "./ingest.ts";
import { joinZipPath, relativeZipPath } from "./paths.ts";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

function serialize(doc: Document): string {
	return new XMLSerializer().serializeToString(doc);
}

function rewriteAttribute(
	element: Element,
	attribute: string,
	sourceXhtmlPath: string,
	imageRenameMap: ReadonlyMap<string, string>,
) {
	const value = element.getAttribute(attribute);
	if (!value || value.startsWith("data:")) return;
	const sourceZipPath = joinZipPath(
		sourceXhtmlPath.slice(0, sourceXhtmlPath.lastIndexOf("/") + 1),
		value,
	);
	const target = imageRenameMap.get(sourceZipPath);
	if (!target) return;
	element.setAttribute(attribute, relativeZipPath(sourceXhtmlPath, target));
}

export function normalizeXhtmlDocument(
	html: string,
	sourceXhtmlPath: string,
	imageRenameMap: ReadonlyMap<string, string>,
): {
	html: string;
	removedScripts: number;
	removedHandlers: number;
	removedFontFaces: number;
	svgImages: number;
} {
	let doc: Document;
	try {
		doc = parseXmlDocument(html, "application/xhtml+xml");
	} catch {
		return {
			html,
			removedScripts: 0,
			removedHandlers: 0,
			removedFontFaces: 0,
			svgImages: 0,
		};
	}

	const scripts = [...doc.getElementsByTagNameNS("*", "script")];
	for (const script of scripts) script.parentNode?.removeChild(script);

	let removedHandlers = 0;
	for (const element of [...doc.getElementsByTagName("*")]) {
		for (const attribute of [...element.attributes]) {
			if (/^on/i.test(attribute.name)) {
				element.removeAttribute(attribute.name);
				removedHandlers++;
			}
		}
	}

	let removedFontFaces = 0;
	for (const style of [...doc.getElementsByTagNameNS(XHTML_NS, "style")]) {
		const original = style.textContent ?? "";
		const result = stripFontFaceRules(original);
		if (result.count > 0) {
			style.textContent = result.css;
			removedFontFaces += result.count;
		}
	}

	const svgs = [...doc.getElementsByTagName("svg"), ...doc.getElementsByTagNameNS(SVG_NS, "svg")];
	let svgImages = 0;
	for (const svg of new Set(svgs)) {
		const image =
			svg.getElementsByTagNameNS(SVG_NS, "image")[0] ?? svg.getElementsByTagName("image")[0];
		if (!image) continue;
		const href =
			image.getAttributeNS(XLINK_NS, "href") ??
			image.getAttribute("xlink:href") ??
			image.getAttribute("href");
		if (!href) continue;

		const img = doc.createElementNS(XHTML_NS, "img");
		img.setAttribute("src", href);
		img.setAttribute("alt", "");
		img.setAttribute("style", "max-width:100%;height:auto");
		rewriteAttribute(img, "src", sourceXhtmlPath, imageRenameMap);
		svg.replaceWith(img);
		svgImages++;
	}

	for (const element of [...doc.getElementsByTagNameNS(XHTML_NS, "img")]) {
		rewriteAttribute(element, "src", sourceXhtmlPath, imageRenameMap);
	}

	let head = doc.getElementsByTagNameNS(XHTML_NS, "head")[0];
	if (!head) {
		head = doc.createElementNS(XHTML_NS, "head");
		doc.documentElement.prepend(head);
	}
	const style = doc.createElementNS(XHTML_NS, "style");
	style.setAttribute("type", "text/css");
	style.textContent = DEFENSIVE_CSS;
	head.appendChild(style);

	return {
		html: serialize(doc),
		removedScripts: scripts.length,
		removedHandlers,
		removedFontFaces,
		svgImages,
	};
}

export function normalizeOpfDocument(
	opfXml: string,
	opfDir: string,
	imageRenameMap: ReadonlyMap<string, string>,
	fontZipPaths: ReadonlySet<string>,
): string {
	let doc: Document;
	try {
		doc = parseXmlDocument(opfXml, "application/xml");
	} catch {
		return opfXml;
	}

	for (const item of [...doc.getElementsByTagNameNS("*", "item")]) {
		const href = item.getAttribute("href") ?? "";
		const source = joinZipPath(opfDir, href);
		const target = imageRenameMap.get(source);
		if (target) {
			item.setAttribute("href", relativeZipPath(opfDir, target));
			item.setAttribute("media-type", "image/jpeg");
		} else if (fontZipPaths.has(source)) {
			item.parentNode?.removeChild(item);
		}
	}

	return serialize(doc);
}
```

The `joinZipPath` call in `rewriteAttribute` builds the base directory from the XHTML path; passing a directory string is intentional because `joinZipPath` expects `baseDir` plus `href`.

- [ ] **Step 4: Run browser tests**

Run: `npx vitest run --project browser`
Expected: normalize tests pass. If SVG serialization changes `xlink:href` casing, keep the assertion on the image source path rather than serialized attribute spelling.

- [ ] **Step 5: Commit**

```bash
git add packages/optimize
git commit -m "feat(optimize): normalize XHTML and OPF for the device"
```

---

## Task 8: Pipeline entry point

**Files:**

- Create: `packages/optimize/src/pipeline.ts`
- Modify: `packages/optimize/src/index.ts`
- Test: `packages/optimize/test/pipeline.browser.test.ts`

**Interfaces:**

- Consumes: all modules from Tasks 1 through 7.
- Produces: `optimizeEpub(file: File, options: OptimizeOptions, callbacks: OptimizeCallbacks, signal?: AbortSignal): Promise<OptimizeResult>`.

- [ ] **Step 1: Write the failing pipeline test**

`packages/optimize/test/pipeline.browser.test.ts`:

```ts
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { optimizeEpub } from "../src/pipeline.ts";

async function epubFile(): Promise<File> {
	const zip = new JSZip();
	zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
	zip.file(
		"META-INF/container.xml",
		'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
	);
	zip.file(
		"OEBPS/content.opf",
		'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier><dc:title>Pipeline Book</dc:title><dc:creator>Fixture</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>',
	);
	zip.file(
		"OEBPS/ch1.xhtml",
		'<html xmlns="http://www.w3.org/1999/xhtml"><head><script>alert(1)</script></head><body><p>Hello</p></body></html>',
	);
	const blob = await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
	return new File([blob], "Pipeline Book - Fixture.epub", { type: "application/epub+zip" });
}

describe("optimizeEpub", () => {
	it("returns a downloadable EPUB with normalized script removed", async () => {
		const progress: string[] = [];
		const result = await optimizeEpub(
			await epubFile(),
			{ jpegQuality: 85, renameFromMetadata: true },
			{
				onProgress(event) {
					progress.push(`${event.stage}:${event.percent}`);
				},
			},
		);
		expect(result.fileName).toBe("Pipeline Book - Fixture.epub");
		expect(result.report.scriptRemovedCount).toBe(1);
		expect(progress.at(-1)).toBe("done:100");

		const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
		const ch = await zip.file("OEBPS/ch1.xhtml")?.async("string");
		expect(ch).toBeDefined();
		expect(ch).not.toContain("<script");
	});

	it("honors an already-aborted signal", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			optimizeEpub(
				await epubFile(),
				{ jpegQuality: 85, renameFromMetadata: false },
				{
					onProgress() {},
				},
				controller.signal,
			),
		).rejects.toMatchObject({ name: "AbortError" });
	});
});
```

- [ ] **Step 2: Run the browser test to verify it fails**

Run: `npx vitest run --project browser`
Expected: FAIL, `pipeline.ts` not found.

- [ ] **Step 3: Implement the pipeline**

`packages/optimize/src/pipeline.ts`:

```ts
import { stripFontFaceRules } from "./css.ts";
import { entry, createReport } from "./report.ts";
import { safeEpubFilename } from "./filename.ts";
import { ingestEpub, readResourceText } from "./ingest.ts";
import { isRasterMediaType, optimizeRasterImage } from "./images.ts";
import { normalizeOpfDocument, normalizeXhtmlDocument } from "./normalize.ts";
import { repackEpub } from "./repack.ts";
import { DEFAULT_OPTIONS } from "./options.ts";
import type {
	EpubSource,
	OptimizeCallbacks,
	OptimizeOptions,
	OptimizeResult,
	ReportEntry,
} from "./types.ts";

const XHTML_EXTENSIONS = new Set([".xhtml", ".html", ".htm"]);
const FONT_EXTENSIONS = new Set([".ttf", ".otf", ".woff", ".woff2"]);

function ext(path: string): string {
	const dot = path.lastIndexOf(".");
	return dot >= 0 ? path.slice(dot).toLowerCase() : "";
}

function throwIfAborted(signal?: AbortSignal) {
	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

async function processImages(
	source: EpubSource,
	options: OptimizeOptions,
	callbacks: OptimizeCallbacks,
	signal: AbortSignal | undefined,
	entries: ReportEntry[],
): Promise<{ resources: Map<string, Uint8Array>; imageRenameMap: Map<string, string> }> {
	const resources = new Map(source.resources);
	const imageRenameMap = new Map<string, string>();
	const images = [...source.manifest.values()].filter(
		(item) => isRasterMediaType(item.mediaType) && resources.has(item.zipPath),
	);

	for (let index = 0; index < images.length; index++) {
		throwIfAborted(signal);
		const item = images[index];
		const bytes = resources.get(item.zipPath)!;
		const before = bytes.byteLength;
		try {
			const converted = await optimizeRasterImage(bytes, options.jpegQuality);
			const target = item.zipPath.replace(/\.[^.]+$/, "") + ".jpg";
			resources.set(target, converted.data);
			resources.delete(item.zipPath);
			imageRenameMap.set(item.zipPath, target);
			entries.push(entry("success", "image-encoded", `Encoded ${item.zipPath}`, item.zipPath));
			entries[entries.length - 1].beforeBytes = before;
			entries[entries.length - 1].afterBytes = converted.data.byteLength;
		} catch (error) {
			entries.push(
				entry("warning", "image-kept", `Kept ${item.zipPath}: ${String(error)}`, item.zipPath),
			);
		}
		callbacks.onProgress({
			percent: Math.round(10 + (index / Math.max(images.length, 1)) * 30),
			stage: "images",
			message: `Images ${index + 1}/${images.length}`,
		});
	}
	return { resources, imageRenameMap };
}

export async function optimizeEpub(
	file: File,
	optionsInput: OptimizeOptions,
	callbacks: OptimizeCallbacks,
	signal?: AbortSignal,
): Promise<OptimizeResult> {
	throwIfAborted(signal);
	const options = { ...DEFAULT_OPTIONS, ...optionsInput };
	callbacks.onProgress({ percent: 2, stage: "read", message: "Reading EPUB" });
	const source = await ingestEpub(file);
	throwIfAborted(signal);

	const entries: ReportEntry[] = [];
	const sourceBytes = [...source.resources.values()].reduce(
		(sum, bytes) => sum + bytes.byteLength,
		0,
	);
	const { resources, imageRenameMap } = await processImages(
		source,
		options,
		callbacks,
		signal,
		entries,
	);

	callbacks.onProgress({ percent: 45, stage: "normalize", message: "Normalizing documents" });
	throwIfAborted(signal);

	const fontPaths = new Set([...resources.keys()].filter((path) => FONT_EXTENSIONS.has(ext(path))));
	for (const path of fontPaths) {
		resources.delete(path);
		entries.push(entry("success", "font-removed", `Removed embedded font ${path}`, path));
	}

	for (const [path, bytes] of [...resources.entries()]) {
		throwIfAborted(signal);
		const fileExt = ext(path);
		if (fileExt === ".css") {
			const result = stripFontFaceRules(readResourceText(bytes));
			if (result.count > 0) {
				resources.set(path, new TextEncoder().encode(result.css));
				entries.push(
					entry("success", "fontface-removed", `Removed ${result.count} @font-face rule(s)`, path),
				);
			}
			continue;
		}
		if (!XHTML_EXTENSIONS.has(fileExt)) continue;

		const normalized = normalizeXhtmlDocument(readResourceText(bytes), path, imageRenameMap);
		if (normalized.html === readResourceText(bytes)) {
			entries.push(
				entry("warning", "xhtml-parse-warn", `Preserved unparseable document ${path}`, path),
			);
			continue;
		}
		resources.set(path, new TextEncoder().encode(normalized.html));
		if (normalized.removedScripts > 0) {
			entries.push(
				entry("success", "script-removed", `Removed ${normalized.removedScripts} script(s)`, path),
			);
		}
		if (normalized.removedHandlers > 0) {
			entries.push(
				entry(
					"success",
					"handler-removed",
					`Removed ${normalized.removedHandlers} handler(s)`,
					path,
				),
			);
		}
		if (normalized.removedFontFaces > 0) {
			entries.push(
				entry(
					"success",
					"fontface-removed",
					`Removed ${normalized.removedFontFaces} @font-face rule(s)`,
					path,
				),
			);
		}
		if (normalized.svgImages > 0) {
			entries.push(
				entry("success", "svg-unwrapped", `Unwrapped ${normalized.svgImages} SVG image(s)`, path),
			);
		}
	}

	const opfBytes = resources.get(source.opfPath);
	if (opfBytes) {
		const opfText = normalizeOpfDocument(
			readResourceText(opfBytes),
			source.opfDir,
			imageRenameMap,
			fontPaths,
		);
		resources.set(source.opfPath, new TextEncoder().encode(opfText));
	}

	callbacks.onProgress({ percent: 88, stage: "pack", message: "Packing EPUB" });
	const blob = await repackEpub(resources, signal);
	const outputBytes = blob.size;
	const report = createReport(entries, sourceBytes, outputBytes);
	const fileName = safeEpubFilename(
		source.metadata.title,
		source.metadata.author,
		file.name,
		options.renameFromMetadata,
	);
	callbacks.onProgress({ percent: 100, stage: "done", message: "Done" });
	return { blob, fileName, report };
}
```

- [ ] **Step 4: Export the public entry point**

`packages/optimize/src/index.ts`:

```ts
export * from "./paths.ts";
export * from "./types.ts";
export * from "./options.ts";
export * from "./errors.ts";
export * from "./report.ts";
export * from "./filename.ts";
export * from "./css.ts";
export * from "./repack.ts";
export { optimizeEpub } from "./pipeline.ts";
```

- [ ] **Step 5: Run pipeline tests**

Run: `npx vitest run --project browser`
Expected: pipeline tests pass.

- [ ] **Step 6: Run full gate**

Run: `npm run check && npm run lint && npm run format && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/optimize
git commit -m "feat(optimize): orchestrate EPUB optimize pipeline"
```

---

## Task 9: Svelte UI state machine and panels

**Files:**

- Create: `apps/web/src/lib/OptimizeOptions.svelte`, `apps/web/src/lib/ProgressPanel.svelte`, `apps/web/src/lib/ReportPanel.svelte`
- Modify: `apps/web/src/App.svelte`, `apps/web/src/app.css`
- Test: covered by Task 10 e2e plus manual browser verification.

**Interfaces:**

- Consumes: `optimizeEpub`, `DEFAULT_OPTIONS`, `OptimizeOptions`, `OptimizeResult`, `ProgressEvent` from `@xteink/optimize`.
- Produces: the four-state UI flow in `App.svelte`.

- [ ] **Step 1: Write `OptimizeOptions.svelte`**

```svelte
<script lang="ts">
	import type { OptimizeOptions } from '@xteink/optimize';

	let { options, onchange }: { options: OptimizeOptions; onchange: (options: OptimizeOptions) => void } = $props();
</script>

<fieldset>
	<label for="quality">JPEG quality {options.jpegQuality}</label>
	<input
		id="quality"
		type="range"
		min="50"
		max="95"
		step="1"
		value={options.jpegQuality}
		oninput={(e) => onchange({ ...options, jpegQuality: Number((e.target as HTMLInputElement).value) })}
	/>
	<label class="check" for="rename">
		<input
			id="rename"
			type="checkbox"
			checked={options.renameFromMetadata}
			onchange={(e) => onchange({ ...options, renameFromMetadata: (e.target as HTMLInputElement).checked })}
		/>
		Rename from metadata
	</label>
</fieldset>
```

- [ ] **Step 2: Write `ProgressPanel.svelte`**

```svelte
<script lang="ts">
	import type { ProgressEvent } from '@xteink/optimize';

	let { progress, oncancel }: { progress: ProgressEvent; oncancel: () => void } = $props();
	const labels: Record<string, string> = {
		read: 'Reading',
		images: 'Images',
		normalize: 'Normalizing',
		pack: 'Packing',
		done: 'Done'
	};
</script>

<div class="progress-panel" role="status">
	<p>{labels[progress.stage]} - {progress.percent}%</p>
	<div class="bar"><div class="fill" style:width="{progress.percent}%"></div></div>
	<button type="button" onclick={oncancel}>Cancel</button>
</div>
```

- [ ] **Step 3: Write `ReportPanel.svelte`**

```svelte
<script lang="ts">
	import type { OptimizeResult, ReportEntry } from '@xteink/optimize';
	import { baseName, formatBytes } from './format.ts';

	let { result, ondownload }: { result: OptimizeResult; ondownload: () => void } = $props();
	let expanded = $state(false);

	function groups(entries: ReportEntry[]): Map<string, ReportEntry[]> {
		const map = new Map<string, ReportEntry[]>();
		for (const item of entries) {
			const key = item.file ?? '(book)';
			const list = map.get(key) ?? [];
			list.push(item);
			map.set(key, list);
		}
		return map;
	}
</script>

<section class="report-panel">
	<div class="summary">
		<div>
			<strong>{formatBytes(result.report.sourceBytes)}</strong>
			<span>source</span>
		</div>
		<div>
			<strong>{formatBytes(result.report.outputBytes)}</strong>
			<span>optimized</span>
		</div>
		<div>
			<strong>{result.report.imageCount}</strong>
			<span>images</span>
		</div>
		<div>
			<strong>{result.report.warningCount}</strong>
			<span>warnings</span>
		</div>
	</div>

	<button type="button" class="primary" onclick={ondownload}>Download optimized EPUB</button>
	<button type="button" onclick={() => (expanded = !expanded)}>
		{expanded ? 'Hide change log' : 'Show change log'}
	</button>

	{#if expanded}
		<div class="log">
			{#each [...groups(result.report.entries)] as [file, fileEntries]}
				<h3>{baseName(file)}</h3>
				<ul>
					{#each fileEntries as item (item.code + item.message)}
						<li class:warning={item.level === 'warning'}>{item.message}</li>
					{/each}
				</ul>
			{/each}
		</div>
	{/if}
</section>
```

- [ ] **Step 4: Rewrite `App.svelte`**

```svelte
<script lang="ts">
	import { DEFAULT_OPTIONS, optimizeEpub, type OptimizeOptions, type OptimizeResult, type ProgressEvent } from '@xteink/optimize';
	import DropZone from './lib/DropZone.svelte';
	import OptimizeOptions from './lib/OptimizeOptions.svelte';
	import ProgressPanel from './lib/ProgressPanel.svelte';
	import ReportPanel from './lib/ReportPanel.svelte';
	import { baseName, formatBytes } from './lib/format.ts';

	let selected = $state<File | null>(null);
	let options = $state<OptimizeOptions>({ ...DEFAULT_OPTIONS });
	let progress = $state<ProgressEvent | null>(null);
	let running = $state(false);
	let result = $state<OptimizeResult | null>(null);
	let error = $state('');
	let abortController: AbortController | null = null;
	let downloadUrl = '';

	async function convert() {
		if (!selected || running) return;
		running = true;
		error = '';
		result = null;
		progress = { percent: 0, stage: 'read', message: 'Reading' };
		const controller = new AbortController();
		abortController = controller;
		try {
			result = await optimizeEpub(selected, options, {
				onProgress(event) {
					progress = event;
				}
			}, controller.signal);
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') return;
			error = err instanceof Error ? err.message : 'Conversion failed.';
		} finally {
			running = false;
			abortController = null;
		}
	}

	function cancel() {
		abortController?.abort();
	}

	function download() {
		if (!result) return;
		if (downloadUrl) URL.revokeObjectURL(downloadUrl);
		downloadUrl = URL.createObjectURL(result.blob);
		const link = document.createElement('a');
		link.href = downloadUrl;
		link.download = result.fileName;
		link.click();
	}
</script>

<header class="bar">
	<h1>Xteink X4 EPUB Optimizer</h1>
	<p>EPUB optimize</p>
</header>

<main>
	{#if !selected}
		<DropZone onpick={(file) => {
			selected = file;
			result = null;
			error = '';
		}} />
	{:else}
		<section class="panel">
			<h2>{baseName(selected.name)}</h2>
			<p>{formatBytes(selected.size)}</p>
			<OptimizeOptions {options} onchange={(next) => (options = next)} />
			<div class="actions">
				<button type="button" class="primary" disabled={running} onclick={convert}>Convert</button>
				<button type="button" disabled={running} onclick={() => {
					selected = null;
					result = null;
					error = '';
				}}>Choose another file</button>
			</div>
		</section>
	{/if}

	{#if running && progress}
		<ProgressPanel {progress} {oncancel} />
	{/if}

	{#if error}
		<section class="error" role="alert">
			<p>{error}</p>
			<button type="button" onclick={() => (error = '')}>Dismiss</button>
		</section>
	{/if}

	{#if result}
		<ReportPanel {result} ondownload={download} />
	{/if}
</main>
```

The App owns a single `downloadUrl` so repeated conversions do not leak object URLs.

- [ ] **Step 5: Add panel styles**

In `apps/web/src/app.css`, add:

```css
fieldset {
	border: 0;
	padding: 0;
	margin: 1rem 0;
	display: grid;
	gap: 0.5rem;
}

.actions {
	display: flex;
	gap: 0.75rem;
	margin-top: 1rem;
}

.primary {
	background: var(--accent);
	color: #fff;
	border: 1px solid var(--accent);
	border-radius: 6px;
	padding: 0.5rem 1rem;
}

.bar {
	height: 0.5rem;
	border: 1px solid var(--line);
	background: var(--panel);
	border-radius: 999px;
	overflow: hidden;
}

.fill {
	height: 100%;
	background: var(--accent);
	transition: width 120ms linear;
}

.report-panel,
.error,
.progress-panel {
	margin-top: 1.5rem;
	padding: 1rem;
	border: 1px solid var(--line);
	border-radius: 8px;
	background: var(--panel);
}

.summary {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 0.5rem;
	margin-bottom: 1rem;
}

.summary strong,
.summary span {
	display: block;
}

.warning {
	color: var(--warn);
}
```

- [ ] **Step 6: Build and verify manually**

Run: `npm run build -w apps/web && npm run dev -w apps/web`
Expected: the UI shows the drop zone; selecting a fixture shows options; Convert runs through progress; a report and download button appear.

- [ ] **Step 7: Commit**

```bash
git add apps/web package-lock.json
git commit -m "feat(web): wire single-book optimize flow into Svelte UI"
```

---

## Task 10: E2E browser verification

**Files:**

- Create: `playwright.config.ts`, `apps/web/e2e/optimizer.spec.ts`

**Interfaces:**

- Consumes: generated fixtures and the Svelte UI from Task 9.
- Produces: a repeatable Chromium flow that proves select, convert, report, and download.

- [ ] **Step 1: Write Playwright config**

`playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "apps/web/e2e",
	use: { baseURL: "http://127.0.0.1:5173" },
	webServer: {
		command: "npm run dev -w apps/web",
		url: "http://127.0.0.1:5173",
		reuseExistingServer: true,
		timeout: 30_000,
	},
});
```

- [ ] **Step 2: Write the e2e spec**

`apps/web/e2e/optimizer.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("optimizes and downloads an EPUB from metadata", async ({ page }) => {
	await page.goto("/");
	await page.locator('input[type="file"]').setInputFiles("fixtures/epubs/minimal-epub3/book.epub");
	await page.getByLabel("Rename from metadata").check();
	await page.getByRole("button", { name: "Convert" }).click();

	const downloadButton = page.getByRole("button", { name: "Download optimized EPUB" });
	await expect(downloadButton).toBeVisible({ timeout: 20_000 });
	const downloadPromise = page.waitForEvent("download");
	await downloadButton.click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe("Minimal Three - Fixture Author.epub");
});

test("rejects an encrypted fixture with an error", async ({ page }) => {
	await page.goto("/");
	await page.locator('input[type="file"]').setInputFiles("fixtures/epubs/encrypted/book.epub");
	await page.getByRole("button", { name: "Convert" }).click();
	await expect(page.getByRole("alert")).toContainText("Encrypted", { timeout: 20_000 });
});
```

- [ ] **Step 3: Run the e2e suite**

Run: `npx playwright test`
Expected: both tests pass. If the fixture name includes characters not matching the app, fix `safeEpubFilename`, not the fixture.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts apps/web/e2e
git commit -m "test(e2e): cover single-book optimize and download"
```

---

## Task 11: Update AGENTS.md and close out

**Files:**

- Modify: `AGENTS.md`, `.github/workflows/ci.yml`

- [ ] **Step 1: Add e2e command to AGENTS.md**

Add a row to the verified command table:

```text
| Browser e2e flow | `npm run test:e2e` |
```

Add root script:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 2: Add e2e to CI**

In `.github/workflows/ci.yml`, after `npm test`:

```yaml
- run: npx playwright test
```

- [ ] **Step 3: Update module map**

Replace the `packages/optimize` module map row with the Phase 1 responsibilities from the spec.

- [ ] **Step 4: Run final verification**

Run:

```bash
npm run format && npm run lint && npm run check && npm run check:web && npm test && npm run test:e2e && npm run guard
```

Expected: every command exits 0 and `guard: PASS`.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md package.json .github/workflows/ci.yml
git commit -m "docs(agents): document Phase 1 e2e workflow"
```

## Self-review notes

Checked against the Phase 1 spec after writing:

- Public entry point and contracts match Section 5 of the Phase 1 spec.
- Each Section 6 stage maps to a task: ingest Task 5, images Task 6, XHTML/OPF Task 7, repack Task 3, filename in Task 2.
- UI states from Section 7 map to Task 9 and e2e Task 10.
- Error handling from Section 8 maps to `OptimizeError` codes in Task 1 and per-resource warnings in Task 8.
- Browser/Node test projects from Section 9 are wired through the existing Vitest suffix convention.
- Phase 1 exit criteria are covered by Tasks 0 through 11.
- Phase 2 remains intentionally absent: no `packages/xtc`, no rasterizer.
