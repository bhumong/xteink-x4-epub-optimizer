# Xteink X4 EPUB Optimizer: Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship browser pre-rendering: a hidden 480x800 Chromium paginator, 2x page capture painted from the live DOM (no `foreignObject`), deterministic quantization to device codes in a Worker, and downloadable `.xtc`/`.xtch` containers through the XTC-mode UI.

**Architecture:** New `packages/pipeline` owns layout/capture/quantize/orchestration and depends on `@xteink/optimize` (shared `prepareEpub` front half, pure path/filename helpers) and `@xteink/xtc` (planes plus the new bitmap-book writer). EPUB-mode bytes stay identical; `packages/xtc` stays DOM-free and node-tested.

**Tech Stack:** Node 24, npm workspaces, TypeScript strict, Vitest node/browser projects, Playwright e2e, native DOM/canvas/Worker APIs only.

**Spec:** `docs/superpowers/specs/2026-09-06-xteink-x4-epub-optimizer-phase-3-design.md`. Read it and the Phase 2 xtc spec before starting.

## Global Constraints

- Node >= 24. Tabs, single quotes, no trailing commas, print width 100.
- No new runtime dependency. Zero additions to `package.json` dependency lists except workspace links (`"@xteink/optimize": "*"`, `"@xteink/xtc": "*"`, `"@xteink/pipeline": "*"`).
- `crosspoint-reader/**` read-only; never stage inside it. No `git add -A` or `git add .`.
- EPUB-mode output must stay byte-identical; its existing tests are the regression net.
- Device pixel codes everywhere: XTG `0` = black ink, `1` = white; XTH `0` = white, `1` = dark grey, `2` = light grey, `3` = black.
- Chapters are 0-based in API, stored 1-based by `packages/xtc`.
- Commands run from the repo root; every task ends with the specified verification green.

## File Structure

```text
packages/pipeline/
  package.json
  src/
    types.ts             PreRender contracts
    css-inline.ts        pure: url() rewriting, mime mapping, data URLs, body-selector remap
    quantize.ts          pure: luma, tiles, 1-bit/2-bit mapping, blank page bytes
    layout.ts            browser: self-contained documents + column measurement
    capture.ts           browser: page column -> 480x800 RGBA
    quantize.worker.ts   Worker: RGBA -> packed bitmap
    pipeline.ts          preRenderXtc() orchestration
    index.ts             exports
  test/
    css-inline.node.test.ts
    quantize.node.test.ts
    layout.browser.test.ts
    capture.browser.test.ts
    pipeline.browser.test.ts
apps/web/src/lib/ModePicker.svelte
apps/web/e2e/prerender.spec.ts
fixtures/epubs/long/book.epub
fixtures/epubs/cover/book.epub
```

Modified: `packages/optimize/src/{types.ts, pipeline.ts, filename.ts}`,
`packages/xtc/src/{types.ts, writer.ts}`, `apps/web/src/{App.svelte,
lib/ReportPanel.svelte}`, `apps/web/package.json`, `vitest.config.ts`,
`tsconfig.base.json`, `fixtures/generate-epubs.mjs`, `AGENTS.md`.

---

### Task 0: Scaffold `packages/pipeline`

**Files:**

- Create: `packages/pipeline/package.json`
- Modify: `apps/web/package.json`, `tsconfig.base.json`, `vitest.config.ts`, `package-lock.json`

**Interfaces:**

- Consumes: workspace config from Tasks 0-2 of Phase 2.
- Produces: `@xteink/pipeline` package and aliases so later tasks' imports resolve.

- [ ] **Step 1: Create the manifest**

Create `packages/pipeline/package.json`:

```json
{
	"name": "@xteink/pipeline",
	"private": true,
	"version": "0.0.0",
	"type": "module",
	"main": "./src/index.ts",
	"types": "./src/index.ts",
	"exports": {
		".": "./src/index.ts",
		"./*": "./src/*"
	},
	"dependencies": {
		"@xteink/optimize": "*",
		"@xteink/xtc": "*"
	}
}
```

- [ ] **Step 2: Add the web dependency**

In `apps/web/package.json`, replace the `dependencies` block with:

```json
	"dependencies": {
		"@xteink/optimize": "*",
		"@xteink/pipeline": "*"
	}
```

- [ ] **Step 3: Install**

Run: `npm install`
Expected: exits 0; `package-lock.json` gains `packages/pipeline`; root
`node_modules/@xteink/pipeline` symlink exists.

- [ ] **Step 4: Add type paths**

In `tsconfig.base.json` `paths`, add:

```json
		"@xteink/pipeline": ["./packages/pipeline/src/index.ts"],
		"@xteink/pipeline/*": ["./packages/pipeline/src/*"]
```

- [ ] **Step 5: Add Vitest aliases and project includes**

In `vitest.config.ts`, add `const pipeline = root + 'packages/pipeline/src';`
next to the other roots and these alias entries:

```ts
	{ find: /^@xteink\/pipeline$/, replacement: pipeline + '/index.ts' },
	{ find: /^@xteink\/pipeline\//, replacement: pipeline + '/' }
```

Add `'packages/pipeline/test/**/*.node.test.ts'` to the node project include
array and `'packages/pipeline/test/**/*.browser.test.ts'` to the browser project
include array.

- [ ] **Step 6: Verify**

Run: `npm run check && npm run lint && npm run test:node`
Expected: all exit 0 (no pipeline tests yet).

- [ ] **Step 7: Commit**

```bash
git add packages/pipeline/package.json apps/web/package.json package-lock.json tsconfig.base.json vitest.config.ts
git commit -m "chore(pipeline): scaffold packages/pipeline and wire aliases"
```

---

### Task 1: Generic output filename

**Files:**

- Modify: `packages/optimize/src/filename.ts`, `packages/optimize/test/filename.node.test.ts`

**Interfaces:**

- Consumes: current `safeEpubFilename` behavior.
- Produces: `safeOutputFilename(title, author, sourceName, renameFromMetadata, extension)` whose result always ends in `extension`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/optimize/test/filename.node.test.ts`:

```ts
describe('safeOutputFilename', () => {
	it('ends in the requested extension when renaming from metadata', () => {
		expect(safeOutputFilename('Title', 'Author', 'book.epub', true, '.xtc')).toBe(
			'Title - Author.xtc'
		);
		expect(safeOutputFilename('Title', 'Author', 'book.epub', true, '.xtch')).toBe(
			'Title - Author.xtch'
		);
	});

	it('swaps the source extension when not renaming', () => {
		expect(safeOutputFilename('Title', 'Author', 'book.epub', false, '.xtc')).toBe('book.xtc');
		expect(safeOutputFilename('', '', 'nested.name.epub', false, '.xtch')).toBe('nested.name.xtch');
	});

	it('falls back to the source stem when metadata is unusable', () => {
		expect(safeOutputFilename('', '', 'book.epub', true, '.xtc')).toBe('book.xtc');
		expect(safeOutputFilename('', 'AuthorOnly', 'book.epub', true, '.xtc')).toBe('book.xtc');
	});

	it('keeps EPUB delegation byte-identical to the old helper', () => {
		expect(safeEpubFilename('Title', 'Author', 'book.epub', true)).toBe('Title - Author.epub');
		expect(safeEpubFilename('', '', 'book.epub', false)).toBe('book.epub');
		expect(safeEpubFilename('', '', 'book.epub', true)).toBe('book.epub');
	});
});
```

Update the import line in that file to include `safeOutputFilename`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project node packages/optimize/test/filename.node.test.ts`
Expected: FAIL — `safeOutputFilename` is not exported.

- [ ] **Step 3: Refactor `filename.ts`**

Replace the body of `packages/optimize/src/filename.ts` with:

```ts
function clean(value: string): string {
	return (
		value
			.normalize('NFC')
			// eslint-disable-next-line no-control-regex -- stripping ASCII controls is the point
			.replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.replace(/^[. ]+/, '')
			.replace(/[. ]+$/, '')
	);
}

export function safeOutputFilename(
	title: string,
	author: string,
	sourceName: string,
	renameFromMetadata: boolean,
	extension: string
): string {
	const safeTitle = clean(title);
	const safeAuthor = clean(author);
	let base = '';
	if (safeTitle && safeAuthor) {
		base = `${safeTitle} - ${safeAuthor}`;
	} else if (safeTitle) {
		base = safeTitle;
	}
	if (renameFromMetadata && base) {
		if (base.length > 180) {
			base =
				base
					.slice(0, 180)
					.replace(/\s+\S*$/, '')
					.trim() || base.slice(0, 180);
		}
	} else {
		base = sourceName.replace(/\.[^./]+$/, '') || sourceName;
	}
	return `${base}${extension}`;
}

export function safeEpubFilename(
	title: string,
	author: string,
	sourceName: string,
	renameFromMetadata: boolean
): string {
	return safeOutputFilename(title, author, sourceName, renameFromMetadata, '.epub');
}
```

Note: for an EPUB source and `.epub` extension, `!renameFromMetadata` returns
the original name exactly, and rename-with-metadata is the old logic verbatim,
so EPUB output naming does not change.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run --project node packages/optimize/test/filename.node.test.ts`
Expected: PASS (old + new cases).

- [ ] **Step 5: Full verification and commit**

Run: `npm run check && npm run lint && npm run test:node`
Expected: green.

```bash
git add packages/optimize/src/filename.ts packages/optimize/test/filename.node.test.ts
git commit -m "feat(optimize): generalize output filename helper with extension"
```

---

### Task 2: Extract `prepareEpub` in `packages/optimize`

**Files:**

- Modify: `packages/optimize/src/types.ts`, `packages/optimize/src/pipeline.ts`
- Create: `packages/optimize/test/prepare.browser.test.ts`

**Interfaces:**

- Consumes: existing private pipeline internals.
- Produces:

```ts
// types.ts
export interface PreparedEpub {
	source: EpubSource;
	resources: Map<string, Uint8Array>;
	entries: ReportEntry[];
	sourceBytes: number;
	imageRenameMap: Map<string, string>;
}

// pipeline.ts
export async function prepareEpub(
	file: File,
	options: OptimizeOptions,
	callbacks: OptimizeCallbacks,
	signal?: AbortSignal
): Promise<PreparedEpub>;
```

- [ ] **Step 1: Move the normalization body into `prepareEpub`**

In `packages/optimize/src/pipeline.ts`, take everything in `optimizeEpub`
between the `sourceBytes` computation and the `repackEpub` call (image pass,
font removal, CSS/XHTML/OPF normalization) and move it into the new exported
`prepareEpub`. It returns `{ source, resources, entries, sourceBytes,
imageRenameMap }`. `optimizeEpub` then becomes:

```ts
export async function optimizeEpub(
	file: File,
	optionsInput: OptimizeOptions,
	callbacks: OptimizeCallbacks,
	signal?: AbortSignal
): Promise<OptimizeResult> {
	throwIfAborted(signal);
	const options = { ...DEFAULT_OPTIONS, ...optionsInput };
	const prepared = await prepareEpub(file, options, callbacks, signal);
	const { resources, entries, sourceBytes, source } = prepared;

	callbacks.onProgress({ percent: 88, stage: 'pack', message: 'Packing EPUB' });
	const blob = await repackEpub(resources, signal);
	const outputBytes = blob.size;
	const report = createReport(entries, sourceBytes, outputBytes);
	const fileName = safeEpubFilename(
		source.metadata.title,
		source.metadata.author,
		file.name,
		options.renameFromMetadata
	);
	callbacks.onProgress({ percent: 100, stage: 'done', message: 'Done' });
	return { blob, fileName, report };
}
```

Add the `PreparedEpub` interface to `types.ts`. Keep progress event values and
entry codes identical; `prepareEpub` ends with the OPF normalization it
absorbed, i.e. at the same 88% point the old code reached `repackEpub`. Also
change the package index to `export { optimizeEpub, prepareEpub }`.

- [ ] **Step 2: Add the direct browser test**

Create `packages/optimize/test/prepare.browser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { prepareEpub } from '../src/pipeline.ts';
import { readFixture } from '../../xtc/test/fixture-helpers.browser.ts';

describe('prepareEpub', () => {
	it('normalizes fonts, scripts, and images the same way optimizeEpub does', async () => {
		const bytes = await readFixture('fonts');
		const file = new File([bytes], 'book.epub');
		const prepared = await prepareEpub(
			file,
			{ jpegQuality: 85, renameFromMetadata: false },
			{
				onProgress() {}
			}
		);
		expect(prepared.sourceBytes).toBeGreaterThan(0);
		expect(prepared.entries.some((entry) => entry.code === 'font-removed')).toBe(true);
		for (const path of prepared.resources.keys()) {
			expect(path.endsWith('.ttf') || path.endsWith('.otf')).toBe(false);
		}
		expect(prepared.imageRenameMap.size).toBe(0); // fonts fixture has no raster images
	});
});
```

Create the shared fixture reader used here and in later browser tests:

`packages/xtc/test/fixture-helpers.browser.ts`:

```ts
export async function readFixture(name: string): Promise<Uint8Array> {
	const response = await fetch(`/fixtures/epubs/${name}/book.epub`);
	if (!response.ok) {
		throw new Error(`fixture ${name} missing: HTTP ${response.status}`);
	}
	return new Uint8Array(await response.arrayBuffer());
}
```

If the browser project does not serve `/fixtures/...` in your Vitest setup,
replace `readFixture(name)` calls with an inline JSZip-built `File` carrying
the same metadata and content (the existing optimize browser tests build zips
in-page) and drop `fixture-helpers.browser.ts` from the commit. The committed
fixture files stay covered by the Playwright e2e flows.

If the fonts fixture's own image rename map is non-empty in your run, replace
the `imageRenameMap.size` assertion with one that matches the fixture instead;
the map is a diagnostic, not the point of the test.

- [ ] **Step 3: Run the new and existing tests**

Run: `npx vitest run --project node packages/optimize/test/filename.node.test.ts`
then the browser project suite:

Run: `npx vitest run --project browser packages/optimize/test/`
Expected: all pass, including the pre-existing pipeline browser tests, proving
EPUB behavior did not change.

- [ ] **Step 4: Full verification and commit**

Run: `npm run check && npm run lint && npm run test:node`
Expected: green.

```bash
git add packages/optimize/src/types.ts packages/optimize/src/pipeline.ts packages/optimize/test/prepare.browser.test.ts packages/xtc/test/fixture-helpers.browser.ts
git commit -m "refactor(optimize): extract prepareEpub shared front half"
```

---

### Task 3: `writeXtcFromBitmaps` in `packages/xtc`

**Files:**

- Modify: `packages/xtc/src/types.ts`, `packages/xtc/src/writer.ts`, `packages/xtc/test/writer.node.test.ts`

**Interfaces:**

- Consumes: `writeXtc` internals and `packXtg`/`packXth`.
- Produces: `XtcBitmapPage`, `XtcBitmapBook`, `writeXtcFromBitmaps(book): Uint8Array`; byte-identical output to `writeXtc` for the same book.

- [ ] **Step 1: Add failing tests**

Append to `packages/xtc/test/writer.node.test.ts`:

```ts
import { writeXtcFromBitmaps } from '../src/writer.ts';

function packedPages(book: XtcBook): XtcBitmapPage[] {
	const width = 480;
	const height = 800;
	return book.pages.map((page) => ({
		bitmap:
			book.mode === 'xtc'
				? packXtg(page.pixels, width, height)
				: packXth(page.pixels, width, height)
	}));
}

describe('writeXtcFromBitmaps', () => {
	it('is byte-identical to writeXtc for the minimal XTC book', () => {
		const book = minimalXtcBook();
		const bitmapBook: XtcBitmapBook = {
			mode: book.mode,
			title: book.title,
			author: book.author,
			chapters: book.chapters,
			pages: packedPages(book)
		};
		expect(bytesEqual(writeXtcFromBitmaps(bitmapBook), writeXtc(book))).toBe(true);
	});

	it('is byte-identical for the minimal XTCH book', () => {
		const book = minimalXtchBook();
		const bitmapBook: XtcBitmapBook = {
			mode: book.mode,
			title: book.title,
			chapters: book.chapters,
			pages: packedPages(book)
		};
		expect(bytesEqual(writeXtcFromBitmaps(bitmapBook), writeXtc(book))).toBe(true);
	});

	it('rejects a bitmap of the wrong length', () => {
		expectCode(
			() =>
				writeXtcFromBitmaps({
					mode: 'xtc',
					pages: [{ bitmap: new Uint8Array(10) }]
				}),
			'pixels-length-mismatch'
		);
	});

	it('rejects invalid chapters and empty books like writeXtc', () => {
		expectCode(
			() =>
				writeXtcFromBitmaps({
					mode: 'xtc',
					chapters: [{ name: 'X', startPage: 2, endPage: 2 }],
					pages: [{ bitmap: new Uint8Array(48000) }, { bitmap: new Uint8Array(48000) }]
				}),
			'chapter-out-of-bounds'
		);
		expectCode(() => writeXtcFromBitmaps({ mode: 'xtc', pages: [] }), 'empty-book');
	});
});
```

Update imports in the test file: add `writeXtcFromBitmaps` from `'../src/index.ts'` (export it there), `packXth`, and `type XtcBitmapBook`/`type XtcBitmapPage`. `XtcBook` is already imported.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project node packages/xtc/test/writer.node.test.ts`
Expected: FAIL — `writeXtcFromBitmaps` missing.

- [ ] **Step 3: Add the types**

In `packages/xtc/src/types.ts`, append:

```ts
export interface XtcBitmapPage {
	bitmap: Uint8Array; // device-order packed bytes
}

export interface XtcBitmapBook {
	mode: XtcMode;
	title?: string;
	author?: string;
	chapters?: XtcChapter[];
	pages: XtcBitmapPage[];
}
```

- [ ] **Step 4: Refactor `writer.ts`**

Replace `packages/xtc/src/writer.ts` with:

```ts
import { packXtg, packXth } from './planes.ts';
import {
	XTC_AUTHOR_OFFSET,
	XTC_AUTHOR_SIZE,
	XTC_CHAPTER_SIZE,
	XTC_FILE_MAGIC,
	XTC_MAX_PAGES,
	XTC_PAGE_HEADER_SIZE,
	XTC_PAGE_MAGIC,
	XTC_PAGE_TABLE_ENTRY_SIZE,
	XTC_PIXEL_MAX,
	XTC_TITLE_OFFSET,
	XTC_TITLE_SIZE,
	XTC_VIEWPORT_HEIGHT,
	XTC_VIEWPORT_WIDTH,
	XtcWriteError,
	type XtcBook,
	type XtcChapter,
	type XtcMode
} from './types.ts';

function truncateUtf8(text: string | undefined, maxBytes: number): Uint8Array {
	const bytes = new TextEncoder().encode(text ?? '');
	if (bytes.length <= maxBytes) {
		return bytes;
	}
	let end = maxBytes;
	while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
		end--;
	}
	return bytes.slice(0, end);
}

function writeTextField(
	bytes: Uint8Array,
	offset: number,
	text: string | undefined,
	maxBytes: number
): void {
	const content = truncateUtf8(text, maxBytes);
	bytes.set(content, offset);
	bytes[offset + content.length] = 0;
}

function assertNoNul(text: string | undefined, field: string): void {
	if (text?.includes('\u0000')) {
		throw new XtcWriteError('invalid-text', `${field} must not contain U+0000`);
	}
}

interface ValidatedBook {
	mode: XtcMode;
	title?: string;
	author?: string;
	chapters: XtcChapter[];
	count: number;
}

function validateTextAndChapters(
	book: { title?: string; author?: string; chapters?: XtcChapter[] },
	count: number
): { title?: string; author?: string; chapters: XtcChapter[] } {
	const chapters = book.chapters ?? [];
	for (const chapter of chapters) {
		if (chapter.name.length === 0) {
			throw new XtcWriteError('empty-chapter-name', 'chapter names must not be empty');
		}
		if (
			chapter.startPage < 0 ||
			chapter.startPage >= count ||
			chapter.endPage < 0 ||
			chapter.endPage >= count
		) {
			throw new XtcWriteError(
				'chapter-out-of-bounds',
				`chapter "${chapter.name}" pages ${chapter.startPage}..${chapter.endPage} fall outside 0..${count - 1}`
			);
		}
		if (chapter.startPage > chapter.endPage) {
			throw new XtcWriteError('chapter-order', `chapter "${chapter.name}" starts after it ends`);
		}
	}
	assertNoNul(book.title, 'title');
	assertNoNul(book.author, 'author');
	for (const chapter of chapters) {
		assertNoNul(chapter.name, `chapter "${chapter.name}" name`);
	}
	return { title: book.title, author: book.author, chapters };
}

function validateCount(
	pages: unknown[],
	mode: XtcMode,
	text: XtcBook | { title?: string; author?: string; chapters?: XtcChapter[] }
): ValidatedBook {
	const count = pages.length;
	if (count === 0) {
		throw new XtcWriteError('empty-book', 'a book needs at least one page');
	}
	if (count > XTC_MAX_PAGES) {
		throw new XtcWriteError('page-count-overflow', `page count ${count} exceeds ${XTC_MAX_PAGES}`);
	}
	const metadata = validateTextAndChapters(text, count);
	return {
		mode,
		title: metadata.title,
		author: metadata.author,
		chapters: metadata.chapters,
		count
	};
}

function bitmapBytes(mode: XtcMode): number {
	if (mode === 'xtc') {
		return Math.ceil(XTC_VIEWPORT_WIDTH / 8) * XTC_VIEWPORT_HEIGHT;
	}
	return Math.ceil((XTC_VIEWPORT_WIDTH * XTC_VIEWPORT_HEIGHT) / 8) * 2;
}

function assemble(
	mode: XtcMode,
	metadata: { title?: string; author?: string; chapters: XtcChapter[] },
	bitmaps: Uint8Array[],
	count: number
): Uint8Array {
	const metadataEnd = XTC_AUTHOR_OFFSET + XTC_AUTHOR_SIZE; // 0xF8
	const hasChapters = metadata.chapters.length > 0;
	const chapterOffset = hasChapters ? metadataEnd : 0;
	const pageTableOffset =
		metadataEnd + (hasChapters ? metadata.chapters.length * XTC_CHAPTER_SIZE : 0);
	const bitmap = bitmapBytes(mode);
	const pageRecordBytes = XTC_PAGE_HEADER_SIZE + bitmap;
	const dataOffset = pageTableOffset + count * XTC_PAGE_TABLE_ENTRY_SIZE;
	const total = dataOffset + count * pageRecordBytes;

	const out = new Uint8Array(total);
	const view = new DataView(out.buffer);
	const putU16 = (offset: number, value: number) => view.setUint16(offset, value, true);
	const putU32 = (offset: number, value: number) => view.setUint32(offset, value, true);
	const putU64 = (offset: number, value: number) => view.setBigUint64(offset, BigInt(value), true);

	putU32(0, XTC_FILE_MAGIC[mode]);
	out[4] = 1;
	out[5] = 0;
	putU16(6, count);
	out[8] = 0;
	out[9] = 1;
	out[10] = 0;
	out[11] = hasChapters ? 1 : 0;
	putU32(0x0c, 0);
	putU64(0x10, XTC_TITLE_OFFSET);
	putU64(0x18, pageTableOffset);
	putU64(0x20, dataOffset);
	putU64(0x28, 0);
	putU32(0x30, chapterOffset);
	putU32(0x34, 0);

	writeTextField(out, XTC_TITLE_OFFSET, metadata.title, XTC_TITLE_SIZE - 1);
	writeTextField(out, XTC_AUTHOR_OFFSET, metadata.author, XTC_AUTHOR_SIZE - 1);

	for (let i = 0; i < metadata.chapters.length; i++) {
		const recordOffset = metadataEnd + i * XTC_CHAPTER_SIZE;
		out.set(truncateUtf8(metadata.chapters[i].name, 80), recordOffset);
		putU16(recordOffset + 0x50, metadata.chapters[i].startPage + 1);
		putU16(recordOffset + 0x52, metadata.chapters[i].endPage + 1);
	}

	for (let i = 0; i < count; i++) {
		const entryOffset = pageTableOffset + i * XTC_PAGE_TABLE_ENTRY_SIZE;
		const pageOffset = dataOffset + i * pageRecordBytes;
		putU64(entryOffset, pageOffset);
		putU32(entryOffset + 8, pageRecordBytes);
		putU16(entryOffset + 12, XTC_VIEWPORT_WIDTH);
		putU16(entryOffset + 14, XTC_VIEWPORT_HEIGHT);

		putU32(pageOffset, XTC_PAGE_MAGIC[mode]);
		putU16(pageOffset + 4, XTC_VIEWPORT_WIDTH);
		putU16(pageOffset + 6, XTC_VIEWPORT_HEIGHT);
		out[pageOffset + 8] = 0;
		out[pageOffset + 9] = 0;
		putU32(pageOffset + 10, bitmap);
		out.set(bitmaps[i], pageOffset + XTC_PAGE_HEADER_SIZE);
	}

	return out;
}

export function writeXtc(book: XtcBook): Uint8Array {
	const { mode, title, author, chapters, count } = validateCount(book.pages, book.mode, book);
	const frameLength = XTC_VIEWPORT_WIDTH * XTC_VIEWPORT_HEIGHT;
	const pixelMax = XTC_PIXEL_MAX[mode];
	const bitmaps = book.pages.map((page, index) => {
		if (page.pixels.length !== frameLength) {
			throw new XtcWriteError(
				'pixels-length-mismatch',
				`page ${index} pixels are ${page.pixels.length} bytes, expected ${frameLength}`
			);
		}
		for (let i = 0; i < page.pixels.length; i++) {
			if (page.pixels[i] > pixelMax) {
				throw new XtcWriteError(
					'pixel-out-of-range',
					`page ${index} pixel value ${page.pixels[i]} at index ${i} exceeds max ${pixelMax}`
				);
			}
		}
		return mode === 'xtc'
			? packXtg(page.pixels, XTC_VIEWPORT_WIDTH, XTC_VIEWPORT_HEIGHT)
			: packXth(page.pixels, XTC_VIEWPORT_WIDTH, XTC_VIEWPORT_HEIGHT);
	});
	return assemble(mode, { title, author, chapters }, bitmaps, count);
}

export function writeXtcFromBitmaps(book: XtcBitmapBook): Uint8Array {
	const { mode, title, author, chapters, count } = validateCount(book.pages, book.mode, book);
	const expected = bitmapBytes(mode);
	const bitmaps = book.pages.map((page, index) => {
		if (page.bitmap.length !== expected) {
			throw new XtcWriteError(
				'pixels-length-mismatch',
				`page ${index} bitmap is ${page.bitmap.length} bytes, expected ${expected}`
			);
		}
		return page.bitmap;
	});
	return assemble(mode, { title, author, chapters }, bitmaps, count);
}
```

Add `XtcBitmapBook`/`XtcBitmapPage` imports to the writer and export
`writeXtcFromBitmaps` from `index.ts`.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run --project node packages/xtc/test/writer.node.test.ts`
Expected: PASS (all prior writer tests plus 4 new bitmap tests).

- [ ] **Step 6: Full verification and commit**

Run: `npm run check && npm run lint && npm run test:node`
Expected: green (goldens unchanged, mirror round trips still pass).

```bash
git add packages/xtc/src/types.ts packages/xtc/src/writer.ts packages/xtc/src/index.ts packages/xtc/test/writer.node.test.ts
git commit -m "feat(xtc): add writeXtcFromBitmaps with shared assembly"
```

---

### Task 4: CSS inlining helpers (node)

**Files:**

- Create: `packages/pipeline/src/css-inline.ts`, `packages/pipeline/test/css-inline.node.test.ts`

**Interfaces:**

- Consumes: `joinZipPath` from `@xteink/optimize/paths.ts`.
- Produces:

```ts
export function mimeTypeForPath(path: string): string | undefined;
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string;
export function rewriteCssUrls(
	css: string,
	cssZipPath: string,
	resources: Map<string, Uint8Array>
): { css: string; inlined: string[]; dropped: string[] };
export function remapBodySelectors(css: string): string;
```

- [ ] **Step 1: Write the failing tests**

Create `packages/pipeline/test/css-inline.node.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
	bytesToDataUrl,
	mimeTypeForPath,
	remapBodySelectors,
	rewriteCssUrls
} from '../src/css-inline.ts';

describe('mimeTypeForPath', () => {
	it('maps raster extensions to media types', () => {
		expect(mimeTypeForPath('a.jpg')).toBe('image/jpeg');
		expect(mimeTypeForPath('a.png')).toBe('image/png');
		expect(mimeTypeForPath('a.webp')).toBe('image/webp');
		expect(mimeTypeForPath('a.gif')).toBe('image/gif');
		expect(mimeTypeForPath('a.bmp')).toBe('image/bmp');
	});

	it('returns undefined for non-raster resources', () => {
		expect(mimeTypeForPath('a.svg')).toBeUndefined();
		expect(mimeTypeForPath('a.ttf')).toBeUndefined();
	});
});

describe('bytesToDataUrl', () => {
	it('base64-encodes small buffers', () => {
		expect(bytesToDataUrl(new TextEncoder().encode('abc'), 'image/png')).toBe(
			'data:image/png;base64,YWJj'
		);
	});
});

describe('rewriteCssUrls', () => {
	it('inlines raster url() references relative to the stylesheet', () => {
		const css = "p { background: url('img/leaf.png') } q { background: url(leaf.jpg) }";
		const resources = new Map<string, Uint8Array>([
			['OEBPS/css/img/leaf.png', new Uint8Array([1, 2, 3])],
			['OEBPS/css/leaf.jpg', new Uint8Array([4, 5])]
		]);
		const result = rewriteCssUrls(css, 'OEBPS/css/book.css', resources);
		expect(result.css).toContain('data:image/png;base64,AQID');
		expect(result.css).toContain('data:image/jpeg;base64,BAU=');
		expect(result.inlined).toEqual(['img/leaf.png', 'leaf.jpg']);
		expect(result.dropped).toEqual([]);
	});

	it('leaves missing and non-raster references alone and records them', () => {
		const css = 'a { background: url(missing.png) } b { background: url(icon.svg) }';
		const result = rewriteCssUrls(css, 'OEBPS/css/book.css', new Map());
		expect(result.css).toBe(css);
		expect(result.dropped).toEqual(['missing.png', 'icon.svg']);
	});
});

describe('remapBodySelectors', () => {
	it('rewrites body selectors to .xtc-body', () => {
		expect(remapBodySelectors('body { font-size: 20px } p, body > p { color: red }')).toBe(
			'.xtc-body { font-size: 20px } p, .xtc-body > p { color: red }'
		);
	});

	it('does not touch body words inside strings or selectors like embedding', () => {
		expect(remapBodySelectors("body::after { content: 'body' }")).toBe(
			".xtc-body::after { content: 'body' }"
		);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project node packages/pipeline/test/css-inline.node.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `css-inline.ts`**

Create `packages/pipeline/src/css-inline.ts`:

```ts
import { joinZipPath } from '@xteink/optimize/paths.ts';

const RASTER_MIME: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.bmp': 'image/bmp'
};

export function mimeTypeForPath(path: string): string | undefined {
	const dot = path.lastIndexOf('.');
	if (dot === -1) return undefined;
	return RASTER_MIME[path.slice(dot).toLowerCase()];
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
	let binary = '';
	const chunk = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunk) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
	}
	return `data:${mime};base64,${btoa(binary)}`;
}

const URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

export function rewriteCssUrls(
	css: string,
	cssZipPath: string,
	resources: Map<string, Uint8Array>
): { css: string; inlined: string[]; dropped: string[] } {
	const baseDir = cssZipPath.slice(0, cssZipPath.lastIndexOf('/') + 1);
	const inlined: string[] = [];
	const dropped: string[] = [];
	let result = '';
	let lastIndex = 0;
	for (const match of css.matchAll(URL_PATTERN)) {
		const index = match.index ?? 0;
		result += css.slice(lastIndex, index);
		const reference = match[2].trim();
		if (reference.startsWith('#') || reference.startsWith('data:')) {
			result += match[0];
		} else {
			const zipPath = joinZipPath(baseDir, reference);
			const bytes = resources.get(zipPath);
			const mime = mimeTypeForPath(zipPath);
			if (bytes && mime) {
				result += `url("${bytesToDataUrl(bytes, mime)}")`;
				inlined.push(reference);
			} else {
				result += match[0];
				dropped.push(reference);
			}
		}
		lastIndex = index + match[0].length;
	}
	result += css.slice(lastIndex);
	return { css: result, inlined, dropped };
}

export function remapBodySelectors(css: string): string {
	return css.replace(/(^|[,\s>+~])body(?=\s*[.:#[>+\s]|$)/g, '$1.xtc-body');
}
```

Note: `String.fromCharCode(...subarray)` uses a fixed 32 KB chunk, which is
within argument-count limits in every supported engine.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run --project node packages/pipeline/test/css-inline.node.test.ts`
Expected: PASS.

- [ ] **Step 5: Full verification and commit**

Run: `npm run check && npm run lint && npm run test:node`
Expected: green.

```bash
git add packages/pipeline/src/css-inline.ts packages/pipeline/test/css-inline.node.test.ts
git commit -m "feat(pipeline): add CSS url inlining and body-selector remap helpers"
```

---

### Task 5: Quantizer (node)

**Files:**

- Create: `packages/pipeline/src/quantize.ts`, `packages/pipeline/test/quantize.node.test.ts`

**Interfaces:**

- Consumes: `XtcMode` type from `@xteink/xtc`.
- Produces:

```ts
export const LUMA_R: number;
export const LUMA_G: number;
export const LUMA_B: number;
export const TILE_SIZE: number;
export const TEXT_VARIANCE: number;
export const TEXT_BLACK_LUMA: number;
export const DITHER_BLACK_LUMA: number;
export const TWO_BIT_BANDS: readonly [number, number, number];
export const BAYER_4: readonly number[];
export function lumaOf(r: number, g: number, b: number): number;
export function quantize1bit(rgba: Uint8Array, width: number, height: number): Uint8Array;
export function quantize2bit(rgba: Uint8Array, width: number, height: number): Uint8Array;
export function blankPageBitmap(mode: XtcMode): Uint8Array;
```

- [ ] **Step 1: Write the failing tests**

Create `packages/pipeline/test/quantize.node.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
	BAYER_4,
	TEXT_BLACK_LUMA,
	blankPageBitmap,
	lumaOf,
	quantize1bit,
	quantize2bit
} from '../src/quantize.ts';

function frame(
	width: number,
	height: number,
	rgba: (x: number, y: number) => [number, number, number, number]
): Uint8Array {
	const out = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const [r, g, b, a] = rgba(x, y);
			const offset = (y * width + x) * 4;
			out[offset] = r;
			out[offset + 1] = g;
			out[offset + 2] = b;
			out[offset + 3] = a;
		}
	}
	return out;
}

function countCodes(codes: Uint8Array, code: number): number {
	let count = 0;
	for (const value of codes) {
		if (value === code) count++;
	}
	return count;
}

describe('lumaOf', () => {
	it('maps black and white to 0 and 255', () => {
		expect(lumaOf(0, 0, 0)).toBe(0);
		expect(lumaOf(255, 255, 255)).toBe(255);
	});

	it('weights channels', () => {
		expect(lumaOf(255, 0, 0)).toBeLessThan(lumaOf(0, 255, 0));
	});
});

describe('quantize1bit', () => {
	it('keeps solid white and solid black uniform', () => {
		const white = frame(32, 32, () => [255, 255, 255, 255]);
		expect(countCodes(quantize1bit(white, 32, 32), 1)).toBe(32 * 32);
		const black = frame(32, 32, () => [0, 0, 0, 255]);
		expect(countCodes(quantize1bit(black, 32, 32), 0)).toBe(32 * 32);
	});

	it('classifies a checkerboard as text and thresholds it crisply', () => {
		const checker = frame(32, 32, (x, y) =>
			(x + y) % 2 === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]
		);
		const codes = quantize1bit(checker, 32, 32);
		expect(countCodes(codes, 0)).toBe(32 * 16);
		expect(countCodes(codes, 1)).toBe(32 * 16);
	});

	it('dithers a photo tile around the mid luma', () => {
		const mid = frame(32, 32, () => [128, 128, 128, 255]);
		const codes = quantize1bit(mid, 32, 32);
		const blackCount = countCodes(codes, 0);
		expect(blackCount).toBeGreaterThan(400);
		expect(blackCount).toBeLessThan(624);
	});
});

describe('quantize2bit bands', () => {
	it('maps high-variance text luma values to the device codes', () => {
		const cases: Array<[number, number]> = [
			[31, 3],
			[96, 1],
			[159, 2],
			[223, 0]
		];
		// Each frame alternates luma +/- 31 on a 2x2 checker so every 16px tile
		// classifies as text (variance 961 > TEXT_VARIANCE) and no dither runs;
		// +/- 31 keeps every pixel inside its band (64..192 edges hold).
		for (const [center, expected] of cases) {
			const frame = new Uint8Array(16 * 16 * 4);
			for (let y = 0; y < 16; y++) {
				for (let x = 0; x < 16; x++) {
					const luma = center + (((x >> 1) + (y >> 1)) % 2 === 0 ? 31 : -31);
					const offset = (y * 16 + x) * 4;
					frame[offset] = luma;
					frame[offset + 1] = luma;
					frame[offset + 2] = luma;
					frame[offset + 3] = 255;
				}
			}
			expect(countCodes(quantize2bit(frame, 16, 16), expected)).toBe(16 * 16);
		}
	});

	it('is deterministic across identical input', () => {
		const a = quantize2bit(
			frame(64, 64, (x, y) => [x * 4, y * 4, (x + y) % 256, 255]),
			64,
			64
		);
		const b = quantize2bit(
			frame(64, 64, (x, y) => [x * 4, y * 4, (x + y) % 256, 255]),
			64,
			64
		);
		expect(Array.from(a)).toEqual(Array.from(b));
	});
});

describe('BAYER_4 and blank pages', () => {
	it('has 16 unique values 0..15', () => {
		expect([...BAYER_4].sort((x, y) => x - y)).toEqual([...Array(16).keys()]);
	});

	it('blank 1-bit is all 0xFF and 2-bit is all 0x00', () => {
		const one = blankPageBitmap('xtc');
		expect(one.length).toBe(48000);
		expect(countCodes(one, 255)).toBe(48000);
		const two = blankPageBitmap('xtch');
		expect(two.length).toBe(96000);
		expect(countCodes(two, 0)).toBe(96000);
	});
});
```

Note the checkerboard expectation: an even checkerboard has 512 black pixels
per 1024 because 32x32 is even on both axes.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project node packages/pipeline/test/quantize.node.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `quantize.ts`**

Create `packages/pipeline/src/quantize.ts`:

```ts
import type { XtcMode } from '@xteink/xtc';

export const LUMA_R = 77;
export const LUMA_G = 150;
export const LUMA_B = 29;
export const TILE_SIZE = 16;
export const TEXT_VARIANCE = 900;
export const TEXT_BLACK_LUMA = 160;
export const DITHER_BLACK_LUMA = 128;
export const TWO_BIT_BANDS = [64, 128, 192] as const;
export const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

export function lumaOf(r: number, g: number, b: number): number {
	return (r * LUMA_R + g * LUMA_G + b * LUMA_B + 128) >> 8;
}

function lumaMap(rgba: Uint8Array, width: number, height: number): Uint8Array {
	const luma = new Uint8Array(width * height);
	for (let i = 0; i < width * height; i++) {
		const offset = i * 4;
		luma[i] = lumaOf(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
	}
	return luma;
}

function tileVariance(
	luma: Uint8Array,
	width: number,
	height: number,
	tileX: number,
	tileY: number
): number {
	const x0 = tileX * TILE_SIZE;
	const y0 = tileY * TILE_SIZE;
	let sum = 0;
	let sumSquares = 0;
	let count = 0;
	const xEnd = Math.min(x0 + TILE_SIZE, width);
	const yEnd = Math.min(y0 + TILE_SIZE, height);
	for (let y = y0; y < yEnd; y++) {
		for (let x = x0; x < xEnd; x++) {
			const value = luma[y * width + x];
			sum += value;
			sumSquares += value * value;
			count++;
		}
	}
	if (count === 0) return 0;
	const mean = sum / count;
	return sumSquares / count - mean * mean;
}

function classifyTextTiles(luma: Uint8Array, width: number, height: number): boolean[] {
	const tileColumns = Math.ceil(width / TILE_SIZE);
	const tileRows = Math.ceil(height / TILE_SIZE);
	const tiles = new Array<boolean>(tileColumns * tileRows);
	for (let ty = 0; ty < tileRows; ty++) {
		for (let tx = 0; tx < tileColumns; tx++) {
			tiles[ty * tileColumns + tx] = tileVariance(luma, width, height, tx, ty) > TEXT_VARIANCE;
		}
	}
	return tiles;
}

function bayerOffset(x: number, y: number): number {
	return (BAYER_4[(y & 3) * 4 + (x & 3)] - 8) * 16;
}

function bandCode(value: number): number {
	if (value < TWO_BIT_BANDS[0]) return 3;
	if (value < TWO_BIT_BANDS[1]) return 1;
	if (value < TWO_BIT_BANDS[2]) return 2;
	return 0;
}

export function quantize1bit(rgba: Uint8Array, width: number, height: number): Uint8Array {
	const luma = lumaMap(rgba, width, height);
	const tiles = classifyTextTiles(luma, width, height);
	const tileColumns = Math.ceil(width / TILE_SIZE);
	const codes = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const isText = tiles[Math.floor(y / TILE_SIZE) * tileColumns + Math.floor(x / TILE_SIZE)];
			const value = luma[y * width + x];
			let code: number;
			if (isText) {
				code = value < TEXT_BLACK_LUMA ? 0 : 1;
			} else {
				code = value + bayerOffset(x, y) < DITHER_BLACK_LUMA ? 0 : 1;
			}
			codes[y * width + x] = code;
		}
	}
	return codes;
}

export function quantize2bit(rgba: Uint8Array, width: number, height: number): Uint8Array {
	const luma = lumaMap(rgba, width, height);
	const tiles = classifyTextTiles(luma, width, height);
	const tileColumns = Math.ceil(width / TILE_SIZE);
	const codes = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const isText = tiles[Math.floor(y / TILE_SIZE) * tileColumns + Math.floor(x / TILE_SIZE)];
			const value = luma[y * width + x];
			const adjusted = isText ? value : Math.max(0, Math.min(255, value + bayerOffset(x, y)));
			codes[y * width + x] = bandCode(adjusted);
		}
	}
	return codes;
}

export function blankPageBitmap(mode: XtcMode): Uint8Array {
	if (mode === 'xtc') {
		return new Uint8Array(48000).fill(0xff);
	}
	return new Uint8Array(96000);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run --project node packages/pipeline/test/quantize.node.test.ts`
Expected: PASS. If the checkerboard or mid-gray dither counts differ by a few
pixels from the assertions, verify the math by hand before adjusting the test:
the implementation must stay integer-deterministic.

- [ ] **Step 5: Full verification and commit**

Run: `npm run check && npm run lint && npm run test:node`
Expected: green.

```bash
git add packages/pipeline/src/quantize.ts packages/pipeline/test/quantize.node.test.ts
git commit -m "feat(pipeline): add deterministic 1-bit and 2-bit quantizer"
```

---

### Task 6: Self-contained documents and pagination (browser)

**Files:**

- Create: `packages/pipeline/src/layout.ts`, `packages/pipeline/test/layout.browser.test.ts`

**Interfaces:**

- Consumes: `parseXmlDocument`, `readResourceText` from `@xteink/optimize/ingest.ts`; `joinZipPath` from `@xteink/optimize/paths.ts`; `mimeTypeForPath`, `bytesToDataUrl`, `rewriteCssUrls`, `remapBodySelectors` from `./css-inline.ts`.
- Produces:

```ts
export const PAGE_WIDTH = 480;
export const PAGE_HEIGHT = 800;
export function buildSelfContainedHtml(
	htmlText: string,
	zipPath: string,
	resources: Map<string, Uint8Array>
): { fragment: string; title: string; warnings: string[] };
export function measureColumnCount(fragment: string, estimate: number): number;
export function columnSource(fragment: string, column: number, totalColumns: number): string;
export function disposePager(): void;
```

The fragment returned by `buildSelfContainedHtml` has this shape:

```html
<style>
	/* baseline defaults, then author CSS with body -> .xtc-body */
</style>
<div class="xtc-body">...serialized body children with data: URLs...</div>
```

`measureColumnCount` mounts `fragment` into an off-screen pager and returns the
number of 480px columns the fixed-height (800px) multi-column layout used.
`columnSource` returns the fragment wrapped in a clip window translated to
column `column`, ready for capture.

**Empirical note for the implementer:** CSS multi-column geometry in Chromium
is the only part of this task whose exact measurement API is not pinned in
advance. Do the probe first (Step 1), record what Chromium does in a code
comment, and implement `measureColumnCount` against the probe result. The
public contract and tests below do not change with the probe outcome.

- [ ] **Step 1: Probe multicol geometry**

Create `packages/pipeline/test/layout.browser.test.ts` with one initially
skipped probe test:

```ts
import { describe, expect, it } from 'vitest';

it.skip('probes how Chromium reports multicol usage', () => {
	const host = document.createElement('div');
	host.style.cssText = 'position:absolute;left:-20000px;top:0;width:0;height:0';
	document.body.appendChild(host);

	const content = Array.from(
		{ length: 40 },
		(_, i) => `<p>Paragraph ${i} ` + 'word '.repeat(60) + '</p>'
	).join('');
	host.innerHTML = `
		<div id="col" style="height:800px;column-width:480px;column-gap:0px;overflow:hidden;background:#fff">
			${content}
		</div>`;
	const col = host.querySelector('#col') as HTMLDivElement;
	// Probe 1: expand width until content stops overflowing the 800px height.
	for (const width of [480, 960, 1920, 3840]) {
		col.style.width = `${width}px`;
		const range = document.createRange();
		range.selectNodeContents(col);
		const rects = [...range.getClientRects()];
		const maxBottom = Math.max(
			...rects.map((rect) => rect.bottom - col.getBoundingClientRect().top)
		);
		const maxLeft = Math.max(...rects.map((rect) => rect.left - col.getBoundingClientRect().left));
		console.log('probe', { width, maxBottom, maxLeft, rectCount: rects.length });
	}
	host.remove();
	expect(true).toBe(true);
});
```

Run it with the probe visible and record in the task's commit message which
width makes `maxBottom <= 800`, and how `maxLeft` relates to used columns.
Then delete the probe test (keep the file for Step 2's real tests).

- [ ] **Step 2: Write the real tests**

Replace the file with:

```ts
import { describe, expect, it } from 'vitest';
import {
	buildSelfContainedHtml,
	columnSource,
	disposePager,
	measureColumnCount
} from '../src/layout.ts';

function textDocument(paragraphs: number): string {
	const body = Array.from(
		{ length: paragraphs },
		(_, i) => `<p>Paragraph ${i + 1}: ${'content '.repeat(80)}</p>`
	).join('');
	return `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Probe Book</title></head><body>${body}</body></html>`;
}

describe('buildSelfContainedHtml', () => {
	it('embeds stylesheets and raster images as data URLs', () => {
		const resources = new Map<string, Uint8Array>([
			['OEBPS/css/book.css', new TextEncoder().encode('body { color: #123456 }')],
			['OEBPS/images/pic.png', new Uint8Array([1, 2, 3])]
		]);
		const html =
			'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head>' +
			'<title>Styled</title><link rel="stylesheet" href="css/book.css"/></head>' +
			'<body><p>Hello <img src="images/pic.png" alt="p"/></p></body></html>';
		const built = buildSelfContainedHtml(html, 'OEBPS/ch1.xhtml', resources);
		expect(built.title).toBe('Styled');
		expect(built.fragment).toContain('.xtc-body { color: #123456 }');
		expect(built.fragment).toContain('data:image/png;base64,AQID');
		expect(built.fragment).not.toContain('href=');
		expect(built.fragment).not.toContain('src="images/');
		disposePager();
	});
});

describe('measureColumnCount', () => {
	it('returns 1 for a short document', () => {
		const built = buildSelfContainedHtml(textDocument(1), 'OEBPS/ch1.xhtml', new Map());
		expect(measureColumnCount(built.fragment, 1)).toBe(1);
		disposePager();
	});

	it('returns more than 1 for a long document', () => {
		const built = buildSelfContainedHtml(textDocument(80), 'OEBPS/ch1.xhtml', new Map());
		const pages = measureColumnCount(built.fragment, 8);
		expect(pages).toBeGreaterThan(1);
		expect(Number.isInteger(pages)).toBe(true);
		disposePager();
	});
});

describe('columnSource', () => {
	it('wraps a fragment in a clip window for a given column', () => {
		const built = buildSelfContainedHtml(textDocument(2), 'OEBPS/ch1.xhtml', new Map());
		const source = columnSource(built.fragment, 2, 5);
		expect(source).toContain('overflow:hidden');
		expect(source).toContain('translate');
		disposePager();
	});
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run --project browser packages/pipeline/test/layout.browser.test.ts`
Expected: FAIL — `layout.ts` missing. (The browser project binds a localhost
port; run with approval if the sandbox blocks it, as in earlier phases.)

- [ ] **Step 4: Implement `layout.ts`**

Create `packages/pipeline/src/layout.ts`:

```ts
import { parseXmlDocument, readResourceText } from '@xteink/optimize/ingest.ts';
import { joinZipPath } from '@xteink/optimize/paths.ts';
import {
	bytesToDataUrl,
	mimeTypeForPath,
	remapBodySelectors,
	rewriteCssUrls
} from './css-inline.ts';

export const PAGE_WIDTH = 480;
export const PAGE_HEIGHT = 800;

const BASELINE_CSS = `
.xtc-body { margin: 0; padding: 0; font: 16px/1.5 serif; color: #000; }
.xtc-body p { margin: 1em 0; }
.xtc-body h1 { font-size: 1.8em; font-weight: bold; margin: 0.67em 0; }
.xtc-body h2 { font-size: 1.5em; font-weight: bold; margin: 0.83em 0; }
.xtc-body ul, .xtc-body ol { margin: 1em 0; padding-left: 2em; }
.xtc-body table { border-collapse: collapse; }
img { max-width: 100%; }
svg { max-width: 100%; }
`;

let pagerHost: HTMLDivElement | null = null;

function getPagerHost(): HTMLDivElement {
	if (!pagerHost) {
		pagerHost = document.createElement('div');
		pagerHost.style.cssText = 'position:absolute;left:-20000px;top:0;width:0;height:0;z-index:-1';
		document.body.appendChild(pagerHost);
	}
	pagerHost.innerHTML = '';
	return pagerHost;
}

export function disposePager(): void {
	pagerHost?.remove();
	pagerHost = null;
}

function textOf(node: Element | null): string {
	return (node?.textContent ?? '').trim();
}

function fileStem(zipPath: string): string {
	const base = zipPath.slice(zipPath.lastIndexOf('/') + 1);
	return base.replace(/\.[^.]+$/, '');
}

export function buildSelfContainedHtml(
	htmlText: string,
	zipPath: string,
	resources: Map<string, Uint8Array>
): { fragment: string; title: string; warnings: string[] } {
	const doc = parseXmlDocument(htmlText);
	const warnings: string[] = [];
	if (!doc) {
		warnings.push('document could not be parsed');
		return { fragment: '', title: fileStem(zipPath), warnings };
	}
	const baseDir = zipPath.slice(0, zipPath.lastIndexOf('/') + 1);
	const title = textOf(doc.getElementsByTagName('title')[0] ?? null) || fileStem(zipPath);

	for (const link of [...doc.getElementsByTagName('link')]) {
		const href = link.getAttribute('href');
		if (!href) {
			link.remove();
			continue;
		}
		const cssPath = joinZipPath(baseDir, href);
		const bytes = resources.get(cssPath);
		if (!bytes) {
			warnings.push(`missing stylesheet ${href}`);
			link.remove();
			continue;
		}
		const style = doc.createElement('style');
		style.textContent = remapBodySelectors(
			rewriteCssUrls(readResourceText(bytes), cssPath, resources).css
		);
		link.replaceWith(style);
	}

	for (const style of [...doc.getElementsByTagName('style')]) {
		style.textContent = remapBodySelectors(style.textContent ?? '');
	}

	for (const img of [...doc.getElementsByTagName('img')]) {
		const src = img.getAttribute('src');
		if (!src || src.startsWith('data:')) continue;
		const imagePath = joinZipPath(baseDir, src);
		const bytes = resources.get(imagePath);
		const mime = mimeTypeForPath(imagePath);
		if (bytes && mime) {
			img.setAttribute('src', bytesToDataUrl(bytes, mime));
		} else {
			warnings.push(`unrenderable image ${src}`);
			img.remove();
		}
	}

	const body = doc.getElementsByTagName('body')[0];
	const fragment = document.createElement('template');
	fragment.innerHTML = `<style>${BASELINE_CSS}</style>`;
	for (const style of [...doc.getElementsByTagName('style')]) {
		fragment.content
			.querySelector('style')
			?.insertAdjacentHTML('beforeend', style.textContent ?? '');
	}
	const contentRoot = document.createElement('div');
	contentRoot.className = 'xtc-body';
	if (body) {
		for (const child of [...body.childNodes]) {
			contentRoot.appendChild(child.cloneNode(true));
		}
	}
	fragment.content.appendChild(contentRoot);
	return { fragment: fragment.innerHTML, title, warnings };
}

export function measureColumnCount(fragment: string, estimate: number): number {
	const host = getPagerHost();
	const col = document.createElement('div');
	col.id = 'xtc-columns';
	col.style.cssText = `height:${PAGE_HEIGHT}px;column-width:${PAGE_WIDTH}px;column-gap:0px;overflow:hidden;background:#fff`;
	col.innerHTML = fragment;
	host.appendChild(col);
	// Column usage probe result (see Task 6 Step 1): expand width until the
	// content's lowest line stays inside the 800px column height.
	let columns = Math.max(1, Math.ceil(estimate / 2));
	while (true) {
		col.style.width = `${columns * PAGE_WIDTH}px`;
		const range = document.createRange();
		range.selectNodeContents(col);
		const rects = [...range.getClientRects()];
		const colTop = col.getBoundingClientRect().top;
		const maxBottom = Math.max(...rects.map((rect) => rect.bottom - colTop));
		if (maxBottom <= PAGE_HEIGHT + 1 || columns >= 8192) break;
		columns *= 2;
	}
	// Binary-search the smallest usable column count between half and current.
	let low = Math.max(1, Math.ceil(columns / 2));
	let high = columns;
	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		col.style.width = `${mid * PAGE_WIDTH}px`;
		const range = document.createRange();
		range.selectNodeContents(col);
		const colTop = col.getBoundingClientRect().top;
		const maxBottom = Math.max(...[...range.getClientRects()].map((rect) => rect.bottom - colTop));
		if (maxBottom <= PAGE_HEIGHT + 1) {
			high = mid;
		} else {
			low = mid + 1;
		}
	}
	host.innerHTML = '';
	return low;
}

export function columnSource(fragment: string, column: number, totalColumns: number): string {
	const width = totalColumns * PAGE_WIDTH;
	return `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${PAGE_WIDTH}px;height:${PAGE_HEIGHT}px;overflow:hidden;background:#fff">
		<div style="width:${width}px;height:${PAGE_HEIGHT}px;transform:translateX(-${column * PAGE_WIDTH}px);transform-origin:0 0">
		${fragment}
		</div>
	</div>`;
}
```

If the Step 1 probe shows Chromium reports column usage differently (for
example via `scrollWidth`, or via fragment rects that bottom out at the column
height), adjust the measurement loops while keeping the tests above green.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run --project browser packages/pipeline/test/layout.browser.test.ts`
Expected: PASS. If the long-document count is 1 (meaning text did not flow into
columns), re-run the probe and fix the CSS/layout before touching the test.

- [ ] **Step 6: Full verification and commit**

Run: `npm run check && npm run lint && npm run test:node`
Expected: green.

```bash
git add packages/pipeline/src/layout.ts packages/pipeline/test/layout.browser.test.ts
git commit -m "feat(pipeline): build self-contained documents and measure page columns"
```

---

### Task 7: Page capture by live-DOM painting (browser)

**Files:**

- Create: `packages/pipeline/src/capture.ts`, `packages/pipeline/test/capture.browser.test.ts`

**Interfaces:**

- Consumes: `columnSource` and `PAGE_WIDTH`/`PAGE_HEIGHT` from `./layout.ts`.
- Produces (contract unchanged by the design revision):

```ts
export async function captureColumn(
	sourceHtml: string,
	scale = 2
): Promise<{ rgba: Uint8Array; width: number; height: number }>;
```

The implementation paints the mounted live DOM (see the revised spec Section
7.3); `sourceHtml` is the clip window `columnSource(fragment, k, totalColumns)`
already returns. No `foreignObject` or SVG image is involved.

- [ ] **Step 1: Write the failing painter tests**

Replace `packages/pipeline/test/capture.browser.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { captureColumn } from '../src/capture.ts';
import { columnSource } from '../src/layout.ts';

function countNear(
	buffer: Uint8Array,
	target: [number, number, number],
	tolerance: number
): number {
	let count = 0;
	for (let i = 0; i < 480 * 800; i++) {
		const offset = i * 4;
		const distance =
			Math.abs(buffer[offset] - target[0]) +
			Math.abs(buffer[offset + 1] - target[1]) +
			Math.abs(buffer[offset + 2] - target[2]);
		if (distance <= tolerance) count++;
	}
	return count;
}

function solidPngDataUrl(color: [number, number, number]): string {
	const canvas = document.createElement('canvas');
	canvas.width = 60;
	canvas.height = 60;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('no 2d canvas');
	context.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
	context.fillRect(0, 0, 60, 60);
	return canvas.toDataURL('image/png');
}

describe('captureColumn (DOM painter)', () => {
	it('returns a 480x800 RGBA buffer', async () => {
		const fragment = '<div class="xtc-body"><p>Hello</p></div>';
		const { rgba, width, height } = await captureColumn(columnSource(fragment, 0, 1));
		expect(width).toBe(480);
		expect(height).toBe(800);
		expect(rgba.length).toBe(480 * 800 * 4);
	});

	it('paints a large red glyph', async () => {
		const fragment =
			'<style>.xtc-body { margin: 0 } .xtc-body p { font: 160px/1 sans-serif; color: rgb(220, 0, 0); margin: 0 }</style>' +
			'<div class="xtc-body"><p>X</p></div>';
		const { rgba } = await captureColumn(columnSource(fragment, 0, 1));
		const red = countNear(rgba, [220, 0, 0], 45);
		expect(red).toBeGreaterThan(2000);
	});

	it('paints only the requested column', async () => {
		const fragment =
			'<div style="width:480px;height:800px;background-color:rgb(255,255,255)"></div>' +
			'<div style="width:480px;height:800px;background-color:rgb(220,0,0)"></div>';
		const first = await captureColumn(columnSource(fragment, 0, 2));
		expect(countNear(first.rgba, [220, 0, 0], 45)).toBe(0);
		const second = await captureColumn(columnSource(fragment, 1, 2));
		expect(countNear(second.rgba, [220, 0, 0], 45)).toBeGreaterThan(100000);
	});

	it('paints a solid-color image at its layout rectangle', async () => {
		const src = solidPngDataUrl([20, 80, 220]);
		const fragment =
			'<div class="xtc-body"><img src="' + src + '" style="width:60px;height:60px"/></div>';
		const { rgba } = await captureColumn(columnSource(fragment, 0, 1));
		const blue = countNear(rgba, [20, 80, 220], 30);
		expect(blue).toBeGreaterThan(2500);
	});

	it('keeps an empty column pure white', async () => {
		const fragment = '<div class="xtc-body"></div>';
		const { rgba } = await captureColumn(columnSource(fragment, 0, 1));
		expect(countNear(rgba, [255, 255, 255], 2)).toBe(480 * 800);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project browser packages/pipeline/test/capture.browser.test.ts`
Expected: FAIL — the current experimental capture throws or returns blank
pixels (pixel assertions fail).

- [ ] **Step 3: Implement the painter**

Replace `packages/pipeline/src/capture.ts` with:

```ts
import { PAGE_HEIGHT, PAGE_WIDTH } from './layout.ts';

interface FragmentLine {
	text: string;
	rect: DOMRect;
}

function isTransparent(color: string): boolean {
	return (
		color === 'transparent' || color === 'rgba(0, 0, 0, 0)' || color.startsWith('rgba(0, 0, 0, 0)')
	);
}

function colorAlpha(color: string): number {
	const match = /rgba\(([^)]+)\)/.exec(color);
	if (!match) return 1;
	const parts = match[1].split(',');
	const alpha = Number(parts[3]?.trim());
	return Number.isFinite(alpha) ? alpha : 1;
}

function hostOrigin(host: HTMLElement): { left: number; top: number } {
	const rect = host.getBoundingClientRect();
	return { left: rect.left, top: rect.top };
}

function fragmentLines(node: Text): FragmentLine[] {
	const text = node.data;
	if (text.length === 0) return [];
	const range = document.createRange();
	range.selectNodeContents(node);
	const rects = [...range.getClientRects()];
	if (rects.length === 0) return [];
	const lineCount = (end: number) => {
		range.setStart(node, 0);
		range.setEnd(node, end);
		return range.getClientRects().length;
	};
	const lines: FragmentLine[] = [];
	let previous = 0;
	for (let line = 1; line <= rects.length; line++) {
		let low = previous;
		let high = text.length;
		while (low < high) {
			const mid = Math.floor((low + high + 1) / 2);
			if (lineCount(mid) > line) {
				high = mid - 1;
			} else {
				low = mid;
			}
		}
		lines.push({ text: text.slice(previous, low), rect: rects[line - 1] });
		previous = low;
	}
	return lines;
}

function applyTextTransform(text: string, transform: string): string {
	if (transform === 'uppercase') return text.toUpperCase();
	if (transform === 'lowercase') return text.toLowerCase();
	if (transform === 'capitalize') {
		return text.replace(/(^|\s)(\S)/g, (match) => match.toUpperCase());
	}
	return text;
}

function paintTextNode(
	context: CanvasRenderingContext2D,
	node: Text,
	host: HTMLElement,
	scale: number,
	origin: { left: number; top: number }
): void {
	const element = node.parentElement;
	if (!element) return;
	const style = getComputedStyle(element);
	const fontSize = parseFloat(style.fontSize) * scale;
	const family = style.fontFamily;
	const italic = style.fontStyle !== 'normal' ? 'italic ' : '';
	const contextFont = `${italic}${style.fontWeight} ${fontSize}px ${family}`;
	context.font = contextFont;
	const metrics = context.measureText('Mg');
	const ascent = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent;
	const descent = metrics.fontBoundingBoxDescent || metrics.actualBoundingBoxDescent;
	const cssLineHeight =
		style.lineHeight === 'normal' ? 1.2 * parseFloat(style.fontSize) : parseFloat(style.lineHeight);
	const lineHeight =
		(Number.isFinite(cssLineHeight) ? cssLineHeight : 1.2 * parseFloat(style.fontSize)) * scale;
	const halfLeading = Math.max(0, (lineHeight - (ascent + descent)) / 2);
	const letterSpacing =
		style.letterSpacing === 'normal' ? 0 : parseFloat(style.letterSpacing) * scale;
	const transform = style.textTransform;
	const justify = style.textAlign === 'justify';
	const fill = style.color;
	const decorationLine = style.textDecorationLine;
	const decorationColor =
		style.textDecorationColor === 'currentcolor' ? style.color : style.textDecorationColor;

	for (const line of fragmentLines(node)) {
		const x = (line.rect.left - origin.left) * scale;
		if (x + line.rect.width * scale < 0 || x > PAGE_WIDTH * scale) continue;
		const yTop = (line.rect.top - origin.top) * scale;
		const baseline = yTop + halfLeading + ascent;
		const text = applyTextTransform(line.text, transform);
		context.textAlign = 'left';
		context.textBaseline = 'alphabetic';
		context.fillStyle = fill;
		context.letterSpacing = `${letterSpacing}px`;
		const naturalWidth = context.measureText(text).width;
		const targetWidth = line.rect.width * scale;
		const words = text.split(' ');
		const gaps = words.length - 1;
		const extraPerGap =
			justify && gaps > 0 && naturalWidth < targetWidth - 1
				? (targetWidth - naturalWidth) / gaps
				: 0;
		if (extraPerGap > 0) {
			let cursor = x;
			const naturalSpace = context.measureText(' ').width + extraPerGap;
			for (let w = 0; w < words.length; w++) {
				context.fillText(words[w], cursor, baseline);
				cursor += context.measureText(words[w]).width + (w < gaps ? naturalSpace : 0);
			}
		} else {
			context.fillText(text, x, baseline);
		}
		context.letterSpacing = '0px';
		context.lineWidth = Math.max(1, fontSize * 0.06);
		context.strokeStyle = decorationColor;
		context.beginPath();
		if (decorationLine.includes('line-through')) {
			context.moveTo(x, baseline - ascent * 0.3);
			context.lineTo(x + Math.max(targetWidth, naturalWidth), baseline - ascent * 0.3);
		}
		if (decorationLine.includes('underline')) {
			context.moveTo(x, baseline + descent * 0.25);
			context.lineTo(x + Math.max(targetWidth, naturalWidth), baseline + descent * 0.25);
		}
		context.stroke();
	}
}

function elementRects(element: Element, origin: { left: number; top: number }): DOMRect[] {
	const rects = [...element.getClientRects()];
	return rects.map((rect) => rect);
}

export async function captureColumn(
	sourceHtml: string,
	scale = 2
): Promise<{ rgba: Uint8Array; width: number; height: number }> {
	const cssWidth = PAGE_WIDTH;
	const cssHeight = PAGE_HEIGHT;
	const pixelWidth = cssWidth * scale;
	const pixelHeight = cssHeight * scale;

	const host = document.createElement('div');
	host.style.cssText = `position:absolute;left:-30000px;top:0;width:${cssWidth}px;height:${cssHeight}px;overflow:hidden`;
	host.innerHTML = sourceHtml;
	document.body.appendChild(host);
	const canvas = document.createElement('canvas');
	canvas.width = pixelWidth;
	canvas.height = pixelHeight;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable');
	try {
		await document.fonts.ready;
		void host.offsetHeight;
		const origin = hostOrigin(host);
		context.fillStyle = '#ffffff';
		context.fillRect(0, 0, pixelWidth, pixelHeight);
		context.save();
		context.beginPath();
		context.rect(0, 0, pixelWidth, pixelHeight);
		context.clip();

		const elements = [...host.querySelectorAll('*')];
		for (const element of elements) {
			const style = getComputedStyle(element);
			const background = style.backgroundColor;
			if (isTransparent(background)) continue;
			context.globalAlpha = colorAlpha(background);
			context.fillStyle = background;
			for (const rect of elementRects(element, origin)) {
				if (rect.width === 0 || rect.height === 0) continue;
				const x = (rect.left - origin.left) * scale;
				const y = (rect.top - origin.top) * scale;
				context.fillRect(x, y, rect.width * scale, rect.height * scale);
			}
			context.globalAlpha = 1;
		}

		const images = [...host.querySelectorAll('img')];
		const decoded: Array<{ element: HTMLImageElement; image: HTMLImageElement }> = [];
		for (const element of images) {
			const src = element.getAttribute('src') ?? '';
			if (!src.startsWith('data:')) continue;
			const image = new Image();
			image.src = src;
			try {
				await image.decode();
				decoded.push({ element, image });
			} catch {
				// unrenderable image stays blank, mirroring layout warnings
			}
		}
		for (const { element, image } of decoded) {
			const rect = element.getBoundingClientRect();
			const x = (rect.left - origin.left) * scale;
			const y = (rect.top - origin.top) * scale;
			if (rect.width > 0 && rect.height > 0) {
				context.drawImage(image, x, y, rect.width * scale, rect.height * scale);
			}
		}

		const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
		const textNodes: Text[] = [];
		while (walker.nextNode()) {
			textNodes.push(walker.currentNode as Text);
		}
		for (const node of textNodes) {
			paintTextNode(context, node, host, scale, origin);
		}

		context.restore();
		const small = document.createElement('canvas');
		small.width = cssWidth;
		small.height = cssHeight;
		const smallContext = small.getContext('2d');
		if (!smallContext) throw new Error('2D canvas unavailable');
		smallContext.imageSmoothingEnabled = true;
		smallContext.imageSmoothingQuality = 'high';
		smallContext.drawImage(canvas, 0, 0, cssWidth, cssHeight);
		const imageData = smallContext.getImageData(0, 0, cssWidth, cssHeight);
		return { rgba: imageData.data, width: cssWidth, height: cssHeight };
	} finally {
		host.remove();
	}
}
```

Notes for the implementer:

- `ctx.letterSpacing` exists on Chromium's canvas; if a version lacks it,
  setting it throws nothing (it is a plain property assignment) and spacing
  falls back to the font's natural tracking.
- If the red-glyph count is below the floor, print the painted glyph's top
  rows once and adjust the baseline formula, not the threshold.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run --project browser packages/pipeline/test/capture.browser.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Full verification and commit**

Run: `npx prettier --write packages/pipeline/src/capture.ts packages/pipeline/test/capture.browser.test.ts && npm run check && npm run lint && npm run test:node`
Expected: green.

```bash
git add packages/pipeline/src/capture.ts packages/pipeline/test/capture.browser.test.ts
git commit -m "feat(pipeline): paint page columns from the live DOM at 2x"
```

---

### Task 8: `preRenderXtc` orchestration

**Files:**

- Create: `packages/pipeline/src/types.ts`, `packages/pipeline/src/quantize.worker.ts`, `packages/pipeline/src/pipeline.ts`, `packages/pipeline/src/index.ts`, `packages/pipeline/test/pipeline.browser.test.ts`
- Modify: `fixtures/generate-epubs.mjs`; create `fixtures/epubs/long/book.epub`, `fixtures/epubs/cover/book.epub`

**Interfaces:**

- Consumes: `prepareEpub`; `safeOutputFilename`; `writeXtcFromBitmaps`; quantize, layout, and capture modules; `blankPageBitmap`.
- Produces:

```ts
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

export async function preRenderXtc(
	file: File,
	options: { mode: XtcMode },
	callbacks: { onProgress(event: ProgressEvent): void },
	signal?: AbortSignal
): Promise<PreRenderResult>;
```

- [ ] **Step 1: Extend the fixture generator**

In `fixtures/generate-epubs.mjs`, add the two fixtures to `main()` and helpers.
First add a paragraph helper near the other helpers:

```js
function paragraph(index) {
	const sentence = `Sentence ${index} of the deterministic long fixture. `.repeat(12);
	return `<p>${sentence}</p>`;
}

function longContent() {
	return Array.from({ length: 400 }, (_, i) => paragraph(i + 1)).join('');
}
```

Then append to `main()`:

```js
await writeEpub('long', (zip) =>
	makeSimpleEpub(zip, {
		version: 2,
		title: 'Long Book',
		author: 'Fixture Author',
		content: longContent()
	})
);
await writeEpub('cover', async (zip) => {
	zip.file('META-INF/container.xml', containerXml('OEBPS/content.opf'));
	zip.file(
		'OEBPS/content.opf',
		'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">' +
			'<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">fixture-cover</dc:identifier>' +
			'<dc:title>Cover Book</dc:title><dc:creator>Fixture Author</dc:creator><dc:language>en</dc:language>' +
			'<meta name="cover" content="cover"/></metadata>' +
			'<manifest><item id="cover" href="Images/cover.png" media-type="image/png"/>' +
			'<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>' +
			'<spine><itemref idref="ch1"/></spine></package>'
	);
	zip.file('OEBPS/Images/cover.png', solidPng(480, 800, [18, 52, 86]));
	zip.file(
		'OEBPS/ch1.xhtml',
		'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head>' +
			'<body><p>After the cover.</p></body></html>'
	);
});
```

Run: `node fixtures/generate-epubs.mjs`
Expected: prints both new fixture paths; `git status --short` shows exactly
`fixtures/epubs/long/book.epub` and `fixtures/epubs/cover/book.epub` as new
(existing fixtures are regenerated byte-identically; if any other fixture
differs, stop and investigate before committing).

- [ ] **Step 2: Add contracts and types**

Create `packages/pipeline/src/types.ts`:

```ts
import type { ProgressEvent, ReportEntry } from '@xteink/optimize';
import type { XtcMode } from '@xteink/xtc';

export interface PreRenderOptions {
	mode: XtcMode;
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

export interface PreRenderCallbacks {
	onProgress(event: ProgressEvent): void;
}

export type { ProgressEvent };
```

Create `packages/pipeline/src/quantize.worker.ts`:

```ts
import { packXth, packXtg } from '@xteink/xtc';
import { quantize1bit, quantize2bit } from './quantize.ts';

export interface QuantizeRequest {
	id: number;
	rgba: ArrayBuffer;
	width: number;
	height: number;
	mode: 'xtc' | 'xtch';
}

export interface QuantizeResponse {
	id: number;
	bitmap: ArrayBuffer;
}

const ctx = self as unknown as {
	onmessage: ((event: MessageEvent<QuantizeRequest>) => void) | null;
	postMessage(message: QuantizeResponse, transfer: Transferable[]): void;
};

ctx.onmessage = (event) => {
	const { id, rgba, width, height, mode } = event.data;
	const pixels = new Uint8Array(rgba);
	const codes =
		mode === 'xtc' ? quantize1bit(pixels, width, height) : quantize2bit(pixels, width, height);
	const bitmap = mode === 'xtc' ? packXtg(codes, width, height) : packXth(codes, width, height);
	const response: QuantizeResponse = { id, bitmap: bitmap.buffer };
	ctx.postMessage(response, [response.bitmap]);
};
```

Note: `packXtg`/`packXth` are exported from `@xteink/xtc`'s index and the
worker imports them by package name, so Vite bundles the pure module into the
worker. The `self` cast keeps the file type-checking under the DOM lib without
pulling in the webworker lib.

Create `packages/pipeline/src/index.ts`:

```ts
export * from './types.ts';
export { preRenderXtc } from './pipeline.ts';
```

- [ ] **Step 3: Write the failing browser test**

Create `packages/pipeline/test/pipeline.browser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { writeXtcFromBitmaps, type XtcBitmapBook } from '@xteink/xtc';
import { preRenderXtc } from '../src/index.ts';
import { readFixture } from '../../xtc/test/fixture-helpers.browser.ts';

async function convert(name: string, mode: 'xtc' | 'xtch') {
	const bytes = await readFixture(name);
	return preRenderXtc(new File([bytes], `${name}.epub`), { mode }, { onProgress() {} });
}

describe('preRenderXtc', () => {
	it('converts the minimal EPUB to an XTC container', async () => {
		const result = await convert('minimal-epub3', 'xtc');
		expect(result.report.pageCount).toBeGreaterThanOrEqual(1);
		expect(result.report.chapterCount).toBeGreaterThanOrEqual(1);
		expect(result.report.warningCount).toBe(0);
		expect(result.fileName.endsWith('.xtc')).toBe(true);
		expect(result.blob.size).toBeGreaterThan(48000);
	});

	it('converts the minimal EPUB to XTCH', async () => {
		const result = await convert('minimal-epub3', 'xtch');
		expect(result.report.pageCount).toBeGreaterThan(0);
		expect(result.fileName.endsWith('.xtch')).toBe(true);
		expect(result.blob.size).toBeGreaterThan(96000);
	});

	it('refuses an encrypted fixture like the EPUB path', async () => {
		await expect(convert('encrypted', 'xtc')).rejects.toThrow(/Encrypted|encrypted/i);
	});

	it('cancellation returns nothing', async () => {
		const controller = new AbortController();
		const promise = preRenderXtc(
			new File([await readFixture('long')], 'long.epub'),
			{ mode: 'xtc' },
			{ onProgress() {} },
			controller.signal
		);
		controller.abort();
		let caught: unknown;
		try {
			await promise;
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(DOMException);
		if (caught instanceof DOMException) {
			expect(caught.name).toBe('AbortError');
		}
	});
});
```

The XTCH test asserts its page count loosely now (`> 0`); Step 5 replaces it
with the measured exact number once the pipeline is implemented.

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run --project browser packages/pipeline/test/pipeline.browser.test.ts`
Expected: FAIL — `preRenderXtc` missing.

- [ ] **Step 5: Record measured page counts, then tighten the tests**

Implement the worker and pipeline, then record the measured page counts for
the fixtures:

1. Run the pipeline test with a temporary `console.log` of
   `result.report.pageCount` for `minimal-epub3`, `long`, and `cover`.
2. Replace the loose `toBeGreaterThan(0)` assertion in the XTCH test with
   `expect(result.report.pageCount).toBe(<measured>)`.
3. Add one test for `long`:

```ts
	it('paginates the long fixture to its measured page count', async () => {
		const result = await convert('long', 'xtc');
		expect(result.report.pageCount).toBe(<measured>);
		expect(result.report.chapterCount).toBe(1);
	});
```

4. Add one test for `cover`:

```ts
	it('synthesizes a cover page 0 and starts chapters after it', async () => {
		const result = await convert('cover', 'xtc');
		expect(result.report.pageCount).toBe(<measured>);
		expect(result.report.chapterCount).toBe(1);
	});
```

Record the exact measured numbers in the commit message so a future Chromium
upgrade that changes metrics fails loudly instead of silently.

- [ ] **Step 6: Implement the pipeline**

Create `packages/pipeline/src/pipeline.ts`:

```ts
import { prepareEpub } from '@xteink/optimize';
import { safeOutputFilename } from '@xteink/optimize/filename.ts';
import {
	writeXtcFromBitmaps,
	type XtcBitmapBook,
	type XtcChapter,
	type XtcMode
} from '@xteink/xtc';
import { bytesToDataUrl, mimeTypeForPath } from './css-inline.ts';
import {
	buildSelfContainedHtml,
	columnSource,
	disposePager,
	measureColumnCount
} from './layout.ts';
import { captureColumn } from './capture.ts';
import { blankPageBitmap } from './quantize.ts';
import type { PreRenderCallbacks, PreRenderReport, PreRenderResult } from './types.ts';

interface MeasureResult {
	fragment: string;
	title: string;
	pages: number;
	startPage: number;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new DOMException('Aborted', 'AbortError');
	}
}

function makeWorker(): Worker {
	return new Worker(new URL('./quantize.worker.ts', import.meta.url), { type: 'module' });
}

export async function preRenderXtc(
	file: File,
	options: { mode: XtcMode },
	callbacks: PreRenderCallbacks,
	signal?: AbortSignal
): Promise<PreRenderResult> {
	throwIfAborted(signal);
	callbacks.onProgress({ percent: 2, stage: 'read', message: 'Reading EPUB' });
	const prepared = await prepareEpub(
		file,
		{ jpegQuality: 85, renameFromMetadata: false },
		callbacks,
		signal
	);
	const { source, resources, entries, sourceBytes } = prepared;
	const mode = options.mode;

	const xhtmlPaths = source.spine.map((item) => item.zipPath).filter((path) => resources.has(path));

	callbacks.onProgress({ percent: 46, stage: 'measure', message: 'Measuring pages' });
	const measured: MeasureResult[] = [];
	let runningPage = 0;
	for (let i = 0; i < xhtmlPaths.length; i++) {
		throwIfAborted(signal);
		const zipPath = xhtmlPaths[i];
		const text = new TextDecoder().decode(resources.get(zipPath));
		const built = buildSelfContainedHtml(text, zipPath, resources);
		for (const warning of built.warnings) {
			entries.push({
				level: 'warning',
				code: 'resource-dropped',
				file: zipPath,
				message: warning
			});
		}
		const pages =
			built.fragment === ''
				? 0
				: measureColumnCount(built.fragment, Math.max(1, Math.ceil(text.length / 2000)));
		measured.push({
			fragment: built.fragment,
			title: built.title,
			pages,
			startPage: runningPage
		});
		runningPage += pages;
		callbacks.onProgress({
			percent: 46 + Math.round(((i + 1) / Math.max(xhtmlPaths.length, 1)) * 14),
			stage: 'measure',
			message: `Documents ${i + 1}/${xhtmlPaths.length}`
		});
	}

	let totalPages = runningPage;
	const coverItem = source.metadata.coverItemId
		? source.manifest.get(source.metadata.coverItemId)
		: undefined;
	const coverInSpine = coverItem
		? source.spine.some((item) => item.idref === source.metadata.coverItemId)
		: false;
	let synthesizedCover = false;
	const coverZipPath = coverItem
		? (prepared.imageRenameMap.get(coverItem.zipPath) ?? coverItem.zipPath)
		: undefined;
	if (coverItem && !coverInSpine && coverZipPath && resources.has(coverZipPath)) {
		const imageBytes = resources.get(coverZipPath)!;
		const coverHtml = buildCoverHtml(imageBytes, mimeTypeForPath(coverZipPath) ?? 'image/png');
		const built = buildSelfContainedHtml(
			coverHtml,
			coverZipPath,
			new Map([[coverZipPath, imageBytes]])
		);
		const pages = measureColumnCount(built.fragment, 1);
		if (pages > 0) {
			measured.unshift({
				fragment: built.fragment,
				title: 'Cover',
				pages,
				startPage: 0
			});
			for (const doc of measured.slice(1)) {
				doc.startPage += pages;
			}
			totalPages = runningPage + pages;
			synthesizedCover = true;
			entries.push({
				level: 'info',
				code: 'cover-synthesized',
				message: 'cover image rendered as page 0'
			});
		} else {
			entries.push({
				level: 'warning',
				code: 'cover-skipped',
				message: 'cover image produced no pages'
			});
		}
	}
	const coverDocIndex = synthesizedCover
		? -1
		: measured.findIndex(
				(doc, index) => index === 0 && doc.pages === 1 && isCoverDocument(source, xhtmlPaths[index])
			);

	const chapters: XtcChapter[] = [];
	for (let i = 0; i < measured.length; i++) {
		const doc = measured[i];
		if (doc.pages === 0) {
			entries.push({
				level: 'warning',
				code: 'document-skipped',
				file: xhtmlPaths[i],
				message: 'document produced no pages'
			});
			continue;
		}
		const skipCover = synthesizedCover ? i === 0 : i === coverDocIndex;
		if (skipCover) {
			continue; // page 0 is the cover document; not a chapter
		}
		const endPage = doc.startPage + doc.pages - 1;
		chapters.push({ name: doc.title, startPage: doc.startPage, endPage });
	}

	if (totalPages === 0) {
		throw new Error('pages-zero: no pages could be rendered');
	}
	if (totalPages > 65535) {
		throw new Error('pages-overflow: more than 65535 pages');
	}

	callbacks.onProgress({ percent: 60, stage: 'render', message: 'Rendering pages' });
	const worker = makeWorker();
	const bitmaps: Uint8Array[] = [];
	const pending = new Map<number, (bitmap: ArrayBuffer) => void>();
	let nextId = 0;
	worker.onmessage = (event: MessageEvent<{ id: number; bitmap: ArrayBuffer }>) => {
		const resolve = pending.get(event.data.id);
		if (resolve) {
			pending.delete(event.data.id);
			resolve(event.data.bitmap);
		}
	};
	worker.onerror = () => {
		for (const resolve of pending.values()) resolve(blankPageBitmap(mode).buffer);
		pending.clear();
	};

	let done = 0;
	const queuePage = async (fragment: string, totalColumns: number, column: number) => {
		throwIfAborted(signal);
		try {
			const captured = await captureColumn(columnSource(fragment, column, totalColumns));
			const id = nextId++;
			const bitmap = await new Promise<ArrayBuffer>((resolve) => {
				pending.set(id, resolve);
				worker.postMessage(
					{
						id,
						rgba: captured.rgba.buffer,
						width: captured.width,
						height: captured.height,
						mode
					},
					[captured.rgba.buffer]
				);
			});
			bitmaps.push(new Uint8Array(bitmap));
		} catch {
			entries.push({
				level: 'warning',
				code: 'page-blank',
				message: `page ${done + 1} rendered blank`
			});
			bitmaps.push(blankPageBitmap(mode));
		}
		done++;
		callbacks.onProgress({
			percent: 60 + Math.round((done / Math.max(totalPages, 1)) * 35),
			stage: 'render',
			message: `Pages ${done}/${totalPages}`
		});
	};

	for (const doc of measured) {
		if (doc.pages === 0) continue;
		for (let column = 0; column < doc.pages; column++) {
			await queuePage(doc.fragment, doc.pages, column);
		}
	}

	worker.terminate();
	disposePager();
	throwIfAborted(signal);

	callbacks.onProgress({ percent: 96, stage: 'write', message: 'Writing XTC' });
	const extension = mode === 'xtc' ? '.xtc' : '.xtch';
	const fileName = safeOutputFilename(
		source.metadata.title,
		source.metadata.author,
		file.name,
		true,
		extension
	);
	const book: XtcBitmapBook = {
		mode,
		title: source.metadata.title || undefined,
		author: source.metadata.author || undefined,
		chapters,
		pages: bitmaps.map((bitmap) => ({ bitmap }))
	};
	const bytes = writeXtcFromBitmaps(book);
	const blob = new Blob([bytes], { type: 'application/octet-stream' });
	const warningCount = entries.filter((entry) => entry.level === 'warning').length;
	const errorCount = entries.filter((entry) => entry.level === 'error').length;
	const report: PreRenderReport = {
		sourceBytes,
		outputBytes: blob.size,
		pageCount: totalPages,
		chapterCount: chapters.length,
		warningCount,
		errorCount,
		entries
	};
	callbacks.onProgress({ percent: 100, stage: 'done', message: 'Done' });
	return { blob, fileName, report };
}

function isCoverDocument(
	source: {
		metadata: { coverItemId?: string };
		manifest: Map<string, { zipPath: string }>;
		spine: Array<{ idref: string }>;
	},
	zipPath: string
): boolean {
	const coverId = source.metadata.coverItemId;
	if (!coverId) return false;
	const coverItem = source.manifest.get(coverId);
	const inSpine = source.spine.some((item) => item.idref === coverId);
	return Boolean(coverItem && inSpine && coverItem.zipPath === zipPath);
}
```

The cover policy above (synthesize when the cover item is manifest-only,
dedupe when it is a one-page first spine document) is the complete logic; the
`cover` fixture exercises the synthesized branch. Add the helper the policy
needs, next to `isCoverDocument` in the same file:

```ts
function buildCoverHtml(bytes: Uint8Array, mime: string): string {
	const dataUrl = bytesToDataUrl(bytes, mime);
	return (
		'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cover</title>' +
		'<style>.xtc-body { margin: 0; display: flex; align-items: center; justify-content: center; height: 800px; background: #fff }</style>' +
		`</head><body><div class="xtc-body"><img src="${dataUrl}" style="max-width:480px;max-height:800px"/></div></body></html>`
	);
}
```

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run --project browser packages/pipeline/test/pipeline.browser.test.ts`
Expected: PASS.

- [ ] **Step 8: Full verification and commit**

Run: `npm run check && npm run lint && npm run test:node`
Expected: green. The worker file avoids the webworker lib entirely via the
`self` cast shown in Step 2, so it type-checks under the root DOM tsconfig
without extra projects.

```bash
git add packages/pipeline/src packages/pipeline/test/pipeline.browser.test.ts fixtures/generate-epubs.mjs fixtures/epubs/long fixtures/epubs/cover
git commit -m "feat(pipeline): orchestrate pre-rendered XTC/XTCH conversion"
```

---

### Task 9: XTC mode in the Svelte UI

**Files:**

- Create: `apps/web/src/lib/ModePicker.svelte`, `apps/web/e2e/prerender.spec.ts`
- Modify: `apps/web/src/App.svelte`, `apps/web/src/lib/ReportPanel.svelte`

**Interfaces:**

- Consumes: `preRenderXtc` from `@xteink/pipeline`, `optimizeEpub`/`OptimizeResult` from `@xteink/optimize`.
- Produces: a mode-aware UI whose download labels match the EPUB e2e today and the new XTC e2e.

- [ ] **Step 1: Generalize the report panel**

Replace `apps/web/src/lib/ReportPanel.svelte`'s script props with a view model
that both results map into:

```ts
export interface SummaryRow {
	label: string;
	value: string;
}

let {
	downloadLabel,
	summary,
	entries,
	ondownload
}: {
	downloadLabel: string;
	summary: SummaryRow[];
	entries: Array<{ level: string; code: string; file?: string; message: string }>;
	ondownload: () => void;
} = $props();
```

Render `downloadLabel` on the primary button, `summary` as label/value rows
instead of the hard-coded four tiles, and keep the grouped change log
unchanged. If a test or import elsewhere uses `result` prop names, update those
call sites in the same task.

- [ ] **Step 2: Add the mode picker**

Create `apps/web/src/lib/ModePicker.svelte`:

```svelte
<script module lang="ts">
	export type OutputMode = 'epub' | 'xtc' | 'xtch';
</script>

<script lang="ts">
	let { mode, onchange }: { mode: OutputMode; onchange: (mode: OutputMode) => void } = $props();
	const options: Array<{ value: OutputMode; label: string; hint?: string }> = [
		{ value: 'epub', label: 'Optimized EPUB', hint: 'repacked for the device EPUB engine' },
		{ value: 'xtc', label: 'Pre-rendered XTC', hint: '1-bit pages, instant turns' },
		{
			value: 'xtch',
			label: 'Pre-rendered XTCH',
			hint: '2-bit grayscale, about twice the size (opt-in)'
		}
	];
</script>

<fieldset class="mode-picker">
	<legend>Output mode</legend>
	{#each options as option (option.value)}
		<label>
			<input
				type="radio"
				name="mode"
				value={option.value}
				checked={mode === option.value}
				onchange={() => onchange(option.value)}
			/>
			<span>{option.label}</span>
			{#if option.hint}<small>{option.hint}</small>{/if}
		</label>
	{/each}
</fieldset>
```

- [ ] **Step 3: Wire the mode into `App.svelte`**

In `App.svelte`:

1. Import `ModePicker`, `type OutputMode`, and `preRenderXtc`.
2. Add `let outputMode = $state<OutputMode>('epub');`.
3. Render `<ModePicker {mode: outputMode} onchange={(next) => (outputMode = next)} />`
   above `OptimizeOptions`.
4. Hide `OptimizeOptions` when `outputMode !== 'epub'`.
5. Branch `convert()`: for `'epub'`, run `optimizeEpub` as today and map the
   result into the generic view model; for `'xtc'`/`'xtch'`, run
   `preRenderXtc(selected, { mode: outputMode }, callbacks, signal)` and map
   `PreRenderResult` (summary rows: Source, Output, Pages, Chapters,
   Warnings; downloadLabel
   `Download pre-rendered ${outputMode === 'xtc' ? 'XTC' : 'XTCH'}`).
6. When `outputMode` changes, clear `result` and `error`.

EPUB summary mapping keeps today's labels and the
`Download optimized EPUB` button text, so the existing e2e stays green.

Add one view model to `App.svelte` and map both result types into it before
`download()` and `ReportPanel` use it:

```ts
interface ViewModel {
	blob: Blob;
	fileName: string;
	downloadLabel: string;
	summary: Array<{ label: string; value: string }>;
	entries: ReportEntry[];
}

function epubViewModel(result: OptimizeResult): ViewModel {
	const report = result.report;
	return {
		blob: result.blob,
		fileName: result.fileName,
		downloadLabel: 'Download optimized EPUB',
		summary: [
			{ label: 'Source', value: formatBytes(report.sourceBytes) },
			{ label: 'Optimized', value: formatBytes(report.outputBytes) },
			{ label: 'Images', value: String(report.imageCount) },
			{ label: 'Warnings', value: String(report.warningCount) }
		],
		entries: report.entries
	};
}

function xtcViewModel(result: PreRenderResult, mode: 'xtc' | 'xtch'): ViewModel {
	const report = result.report;
	return {
		blob: result.blob,
		fileName: result.fileName,
		downloadLabel: `Download pre-rendered ${mode === 'xtc' ? 'XTC' : 'XTCH'}`,
		summary: [
			{ label: 'Source', value: formatBytes(report.sourceBytes) },
			{ label: 'Output', value: formatBytes(report.outputBytes) },
			{ label: 'Pages', value: String(report.pageCount) },
			{ label: 'Chapters', value: String(report.chapterCount) },
			{ label: 'Warnings', value: String(report.warningCount) }
		],
		entries: report.entries
	};
}
```

`result` state becomes `ViewModel | null`; `ReportPanel` receives
`downloadLabel`, `summary`, `entries`, and `ondownload`, and the XTC branches
assign `xtcViewModel(await preRenderXtc(...), outputMode)`.

- [ ] **Step 4: Add the XTC e2e flow**

Create `apps/web/e2e/prerender.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('converts and downloads a pre-rendered XTC', async ({ page }) => {
	await page.goto('/');
	await page.locator('input[type="file"]').setInputFiles('fixtures/epubs/minimal-epub3/book.epub');
	await page.getByLabel('Pre-rendered XTC').check();
	await page.getByRole('button', { name: 'Convert' }).click();

	const downloadButton = page.getByRole('button', { name: 'Download pre-rendered XTC' });
	await expect(downloadButton).toBeVisible({ timeout: 30_000 });
	const downloadPromise = page.waitForEvent('download');
	await downloadButton.click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe('Minimal Three - Fixture Author.xtc');
	expect(await download.path()).toBeTruthy();
});

test('converts and downloads a pre-rendered XTCH', async ({ page }) => {
	await page.goto('/');
	await page.locator('input[type="file"]').setInputFiles('fixtures/epubs/minimal-epub3/book.epub');
	await page.getByLabel('Pre-rendered XTCH').check();
	await page.getByRole('button', { name: 'Convert' }).click();

	const downloadButton = page.getByRole('button', { name: 'Download pre-rendered XTCH' });
	await expect(downloadButton).toBeVisible({ timeout: 30_000 });
	const downloadPromise = page.waitForEvent('download');
	await downloadButton.click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe('Minimal Three - Fixture Author.xtch');
});
```

The EPUB fixture's metadata title/author pair gives `Minimal Three - Fixture
Author` (same sanitization as the EPUB e2e). If the `getByLabel` selector needs
adjusting for the actual Svelte output, fix the selector, not the naming
expectation.

- [ ] **Step 5: Run the suites**

Run: `npm run check && npm run lint && npm run check:web`
Expected: green.

Run the browser and e2e suites (localhost binding needs approval if sandboxed):

Run: `npx vitest run --project browser` and `npx playwright test`
Expected: all pass, including the untouched EPUB e2e.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/ModePicker.svelte apps/web/src/lib/ReportPanel.svelte apps/web/src/App.svelte apps/web/e2e/prerender.spec.ts
git commit -m "feat(web): add pre-rendered XTC/XTCH modes with download"
```

---

### Task 10: AGENTS.md and final close-out

**Files:**

- Modify: `AGENTS.md`

- [ ] **Step 1: Update the module map**

In `AGENTS.md`, replace the `packages/pipeline` absence with a row after the
`packages/xtc/` row:

```text
| `packages/pipeline/`                 | pre-render pipeline: paginate, capture, quantize, Worker pack, orchestration | yes  |
```

If the table's column widths drift, run prettier on AGENTS.md and commit the
formatting with the same change.

- [ ] **Step 2: Final verification**

Run: `npm run format && npm run lint && npm run check && npm run check:web && npm test && npm run test:e2e && npm run guard`
Expected: every command exits 0; `guard: PASS`.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): add packages/pipeline to the module map"
```

---

## Self-review notes

Checked against the Phase 3 spec after writing:

- Spec Sections 5.1-5.3 (shared front half, generic filename, bitmap writer):
  Tasks 1-3.
- Spec Section 6 (pipeline contracts/modules): types in Task 8, css-inline
  Task 4, quantize Task 5, layout Task 6, capture Task 7, worker + pipeline
  Task 8, index Task 8.
- Spec Section 7 (self-contained docs, pagination, capture): Tasks 6-7 with
  empirical probes for Chromium multicol behavior.
- Spec Section 8 (quantization constants and rules): Task 5.
- Spec Section 9 (chapters/cover policy): Task 8, cover fixture and
  synthesized-cover extension included.
- Spec Section 10 (memory/progress/lifecycle): pipeline implementation in Task
  8 (packed-bitmap accumulation, progress percentages, disposal, cancellation).
- Spec Section 11 (errors): refusals and per-page blank recovery in Task 8.
- Spec Section 12 (UI): Task 9.
- Spec Section 13 (tests): node tests Tasks 1, 4, 5; browser tests Tasks 2, 6,
  7, 8; e2e Task 9.
- Spec Section 14 (fixtures long/cover): Task 8 Step 1.
- Spec Section 16 exit criteria: final verification in Task 10.

Two deliberate, recorded deviations from the letter of the spec, both covered
by tests elsewhere: CSS stylesheet _embedding_ assertions live in the browser
layout tests rather than the node css-inline tests (the node module is pure
text), and capture is a live-DOM painter instead of `foreignObject`
serialization because Chromium probes proved HTML never paints inside
foreignObject in an SVG image on the pinned engine builds (revised spec
Section 7.3). The public contracts do not change with either deviation.
