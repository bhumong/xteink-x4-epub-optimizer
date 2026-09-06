# Xteink X4 EPUB Optimizer: Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/xtc`, a DOM-free TypeScript writer that emits byte-exact XTC (1-bit XTG) and XTCH (2-bit XTH) containers from quantized page frames, metadata, and chapters, proven by node-only byte-exact tests and committed golden fixtures.

**Architecture:** `packages/xtc` owns the whole writer in three source modules behind one `writeXtc(book)` entry: `planes.ts` packs and unpacks XTG rows and XTH planes over generic width/height, `writer.ts` validates a book, lays out offsets, and assembles the container, and `types.ts` holds the contracts, layout constants, and `XtcWriteError`. No DOM, no runtime dependencies.

**Tech Stack:** Node 24, npm workspaces, TypeScript strict with `verbatimModuleSyntax`, Vitest node project. Tests import relative source files with `.ts` extensions and run in the `node` project only (`*.node.test.ts` suffix).

**Spec:** `docs/superpowers/specs/2026-09-06-xteink-x4-epub-optimizer-phase-2-design.md`. Read the parent design spec and the Phase 2 spec before starting.

## Global Constraints

- Node >= 24 (enforced by `.npmrc`). Tabs, single quotes, no trailing commas, print width 100 (Prettier).
- TypeScript strict, `verbatimModuleSyntax`: import types with `import type`, never mixed value/type imports.
- `packages/xtc` has zero runtime dependencies. Do not add any.
- Every multi-byte value in written files is little-endian.
- Writer geometry is exactly 480x800 (`XTC_VIEWPORT_WIDTH`/`XTC_VIEWPORT_HEIGHT`).
- Pixel inputs are device codes, not luminance: `xtc` = 0 black ink / 1 white; `xtch` = 0 white / 1 dark grey / 2 light grey / 3 black.
- Chapter `startPage`/`endPage` are 0-based in the API and stored 1-based in the file.
- No `git add -A` or `git add .` from the repo root. Never stage, commit, or push inside `crosspoint-reader/**`.
- All commands below run from the repo root. Every task ends with `npm run check && npm run lint && npm run test:node` green.

## File Structure

```text
packages/xtc/
  package.json              workspace package manifest, no deps
  src/
    types.ts                contracts, layout constants, XtcWriteError
    planes.ts               packXtg/unpackXtg, packXth/unpackXth
    writer.ts               validate + assemble writeXtc(book): Uint8Array
    index.ts                public exports
  test/
    frame.ts                shared frame builders and byte helpers (not a test)
    book.ts                 shared fixture books (not a test)
    mirror.ts               test-only reader mirroring XtcParser arithmetic (not a test)
    planes.node.test.ts     hand-computed packing vectors
    writer.node.test.ts     structural byte asserts, rejection matrix, text boundaries
    mirror.node.test.ts     round trips through the mirror reader
    golden.node.test.ts     committed golden byte diffs
fixtures/golden/
  minimal.xtc               committed golden 1-bit container
  minimal.xtch              committed golden 2-bit container
```

Modified: `vitest.config.ts` (xtc alias + node include), `tsconfig.base.json`
(`@xteink/xtc` paths), `package-lock.json` (workspace registration), `AGENTS.md`
(module-map row). The placeholder plan
`docs/superpowers/plans/2026-09-06-xteink-x4-epub-optimizer-phase-2-placeholder.md`
is removed once this plan is committed.

---

### Task 0: Scaffold the package and wire it into typecheck and tests

**Files:**

- Create: `packages/xtc/package.json`
- Modify: `tsconfig.base.json`, `vitest.config.ts`, `package-lock.json`

**Interfaces:**

- Consumes: the existing workspace config from Phase 0.
- Produces: `@xteink/xtc` workspace package; `@xteink/xtc` and `@xteink/xtc/*` path aliases; `packages/xtc/test/**/*.node.test.ts` included in the node Vitest project.

- [ ] **Step 1: Create the package manifest**

Create `packages/xtc/package.json`:

```json
{
	"name": "@xteink/xtc",
	"private": true,
	"version": "0.0.0",
	"type": "module",
	"main": "./src/index.ts",
	"types": "./src/index.ts",
	"exports": {
		".": "./src/index.ts",
		"./*": "./src/*"
	}
}
```

- [ ] **Step 2: Register the package with npm**

Run: `npm install`
Expected: exits 0; `git status --short` shows `packages/xtc/package.json` and a modified `package-lock.json` (a `packages/xtc` entry with no dependencies).

- [ ] **Step 3: Add TypeScript path mappings**

Replace the `paths` block in `tsconfig.base.json` with:

```json
	"paths": {
		"@xteink/optimize": ["./packages/optimize/src/index.ts"],
		"@xteink/optimize/*": ["./packages/optimize/src/*"],
		"@xteink/xtc": ["./packages/xtc/src/index.ts"],
		"@xteink/xtc/*": ["./packages/xtc/src/*"]
	}
```

- [ ] **Step 4: Add the xtc alias and node-project include to Vitest**

Replace `vitest.config.ts` with:

```ts
import { playwright } from '@vitest/browser-playwright';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const optimize = root + 'packages/optimize/src';
const xtc = root + 'packages/xtc/src';
// Regex, not string keys: Vite treats a string alias key as a prefix match, so
// '@xteink/optimize/paths.ts' would otherwise rewrite to '.../src/index.ts/paths.ts'.
const alias = [
	{ find: /^@xteink\/optimize$/, replacement: optimize + '/index.ts' },
	{ find: /^@xteink\/optimize\//, replacement: optimize + '/' },
	{ find: /^@xteink\/xtc$/, replacement: xtc + '/index.ts' },
	{ find: /^@xteink\/xtc\//, replacement: xtc + '/' }
];

export default defineConfig({
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				resolve: { alias },
				test: {
					name: 'node',
					environment: 'node',
					include: [
						'packages/optimize/test/**/*.node.test.ts',
						'packages/xtc/test/**/*.node.test.ts',
						'apps/server/test/**/*.node.test.ts'
					]
				}
			},
			{
				resolve: { alias },
				test: {
					name: 'browser',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['packages/optimize/test/**/*.browser.test.ts']
				}
			},
			{
				resolve: { alias },
				plugins: [svelte({ compilerOptions: { runes: true } })],
				test: {
					name: 'web',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['apps/web/src/**/*.browser.test.ts']
				}
			}
		]
	}
});
```

- [ ] **Step 5: Verify the scaffold is still green**

Run: `npm run check && npm run lint && npm run test:node`
Expected: all three exit 0 (there are no xtc tests yet; the existing Phase 1 suites still pass).

- [ ] **Step 6: Commit**

```bash
git add packages/xtc/package.json package-lock.json tsconfig.base.json vitest.config.ts
git commit -m "chore(xtc): scaffold packages/xtc and wire aliases into typecheck and tests"
```

---

### Task 1: Contracts, XtcWriteError, and XTG plane packing

**Files:**

- Create: `packages/xtc/src/types.ts`, `packages/xtc/src/planes.ts`, `packages/xtc/src/index.ts`, `packages/xtc/test/planes.node.test.ts`

**Interfaces:**

- Consumes: nothing yet (package scaffold from Task 0).
- Produces:
  - `XtcMode`, `XtcPage`, `XtcChapter`, `XtcBook`, `XtcWriteErrorCode`, `XtcWriteError`, layout constants in `types.ts`.
  - `packXtg(pixels: Uint8Array, width: number, height: number): Uint8Array` and `unpackXtg(bitmap: Uint8Array, width: number, height: number): Uint8Array` in `planes.ts`.

- [ ] **Step 1: Write the failing XTG tests**

Create `packages/xtc/test/planes.node.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { packXtg, unpackXtg } from '../src/planes.ts';
import { XtcWriteError, type XtcWriteErrorCode } from '../src/types.ts';

const BLACK = 0;
const WHITE = 1;

function expectCode(fn: () => unknown, code: XtcWriteErrorCode): void {
	let caught: unknown;
	try {
		fn();
	} catch (error) {
		caught = error;
	}
	expect(caught).toBeInstanceOf(XtcWriteError);
	if (caught instanceof XtcWriteError) {
		expect(caught.code).toBe(code);
	}
}

describe('packXtg', () => {
	it('packs the worked example row MSB first', () => {
		// B W B B W W B W -> 0b01001101
		const pixels = new Uint8Array([BLACK, WHITE, BLACK, BLACK, WHITE, WHITE, BLACK, WHITE]);
		expect(Array.from(packXtg(pixels, 8, 1))).toEqual([0x4d]);
	});

	it('pads rows wider than 8 pixels with zero trailing bits', () => {
		// 10 px/row, 2 rows. Row 0 all white -> [0xff, 0xc0], row 1 all black -> [0x00, 0x00].
		const pixels = new Uint8Array(20);
		for (let x = 0; x < 10; x++) {
			pixels[x] = WHITE;
		}
		expect(Array.from(packXtg(pixels, 10, 2))).toEqual([0xff, 0xc0, 0x00, 0x00]);
	});

	it('round-trips several widths and heights', () => {
		for (const width of [1, 7, 8, 9, 16]) {
			for (const height of [1, 2, 9]) {
				const pixels = new Uint8Array(width * height);
				for (let i = 0; i < pixels.length; i++) {
					pixels[i] = i % 2;
				}
				expect(Array.from(unpackXtg(packXtg(pixels, width, height), width, height))).toEqual(
					Array.from(pixels)
				);
			}
		}
	});

	it('rejects a pixel array of the wrong length', () => {
		expectCode(() => packXtg(new Uint8Array(7), 8, 1), 'pixels-length-mismatch');
	});

	it('rejects pixel values above 1', () => {
		const pixels = new Uint8Array([2, 0, 0, 0, 0, 0, 0, 0]);
		expectCode(() => packXtg(pixels, 8, 1), 'pixel-out-of-range');
	});
});

describe('unpackXtg', () => {
	it('unpacks the worked example back to codes', () => {
		expect(Array.from(unpackXtg(new Uint8Array([0x4d]), 8, 1))).toEqual([
			BLACK,
			WHITE,
			BLACK,
			BLACK,
			WHITE,
			WHITE,
			BLACK,
			WHITE
		]);
	});

	it('rejects a bitmap of the wrong length', () => {
		expect(() => unpackXtg(new Uint8Array(3), 8, 1)).toThrow(/bitmap length/);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project node packages/xtc/test/planes.node.test.ts`
Expected: FAIL — `planes.ts` and `types.ts` do not exist.

- [ ] **Step 3: Create `types.ts`**

Create `packages/xtc/src/types.ts`:

```ts
export const XTC_VIEWPORT_WIDTH = 480;
export const XTC_VIEWPORT_HEIGHT = 800;

export type XtcMode = 'xtc' | 'xtch';

export interface XtcPage {
	pixels: Uint8Array; // XTC_VIEWPORT_WIDTH * XTC_VIEWPORT_HEIGHT device codes
}

export interface XtcChapter {
	name: string; // non-empty, no U+0000; truncated to 80 UTF-8 bytes at a code-point boundary
	startPage: number; // 0-based, inclusive
	endPage: number; // 0-based, inclusive, >= startPage
}

export interface XtcBook {
	mode: XtcMode;
	title?: string; // no U+0000; truncated to 127 UTF-8 bytes at a code-point boundary
	author?: string; // no U+0000; truncated to 63 UTF-8 bytes at a code-point boundary
	chapters?: XtcChapter[]; // [] or undefined means no chapter block
	pages: XtcPage[]; // 1..65535 pages
}

export type XtcWriteErrorCode =
	| 'empty-book'
	| 'page-count-overflow'
	| 'pixels-length-mismatch'
	| 'pixel-out-of-range'
	| 'chapter-out-of-bounds'
	| 'chapter-order'
	| 'empty-chapter-name'
	| 'invalid-text'; // U+0000 in title, author, or chapter name

export class XtcWriteError extends Error {
	readonly code: XtcWriteErrorCode;

	constructor(code: XtcWriteErrorCode, message: string) {
		super(message);
		this.name = 'XtcWriteError';
		this.code = code;
	}
}

// Container layout constants (bytes), all little-endian in the file.
export const XTC_HEADER_SIZE = 56;
export const XTC_TITLE_OFFSET = 0x38;
export const XTC_TITLE_SIZE = 128;
export const XTC_AUTHOR_OFFSET = 0xb8;
export const XTC_AUTHOR_SIZE = 64;
export const XTC_CHAPTER_SIZE = 96;
export const XTC_PAGE_TABLE_ENTRY_SIZE = 16;
export const XTC_PAGE_HEADER_SIZE = 22;
export const XTC_MAX_PAGES = 0xffff;

export const XTC_FILE_MAGIC: Record<XtcMode, number> = {
	xtc: 0x00435458, // "XTC\0"
	xtch: 0x48435458 // "XTCH"
};

export const XTC_PAGE_MAGIC: Record<XtcMode, number> = {
	xtc: 0x00475458, // "XTG\0"
	xtch: 0x00485458 // "XTH\0"
};

export const XTC_PIXEL_MAX: Record<XtcMode, number> = {
	xtc: 1,
	xtch: 3
};
```

- [ ] **Step 4: Implement `planes.ts` with XTG packing**

Create `packages/xtc/src/planes.ts`:

```ts
import { XtcWriteError } from './types.ts';

function assertDimensions(width: number, height: number): void {
	if (width <= 0 || height <= 0) {
		throw new Error('width and height must be positive');
	}
}

function assertPixelValues(pixels: Uint8Array, max: number): void {
	for (let i = 0; i < pixels.length; i++) {
		if (pixels[i] > max) {
			throw new XtcWriteError(
				'pixel-out-of-range',
				`pixel value ${pixels[i]} at index ${i} exceeds max ${max}`
			);
		}
	}
}

// 1-bit: row-major, 8 px/byte, MSB first. Stored bit equals the pixel code:
// 0 = black ink, 1 = white. Unused trailing bits in each row are zero.
export function packXtg(pixels: Uint8Array, width: number, height: number): Uint8Array {
	assertDimensions(width, height);
	if (pixels.length !== width * height) {
		throw new XtcWriteError(
			'pixels-length-mismatch',
			`pixels array is ${pixels.length} bytes, expected ${width * height}`
		);
	}
	assertPixelValues(pixels, 1);
	const rowBytes = (width + 7) >> 3;
	const out = new Uint8Array(rowBytes * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (pixels[y * width + x] === 1) {
				out[y * rowBytes + (x >> 3)] |= 1 << (7 - (x & 7));
			}
		}
	}
	return out;
}

export function unpackXtg(bitmap: Uint8Array, width: number, height: number): Uint8Array {
	assertDimensions(width, height);
	const rowBytes = (width + 7) >> 3;
	if (bitmap.length !== rowBytes * height) {
		throw new Error(
			`bitmap length ${bitmap.length} does not match ${rowBytes} bytes x ${height} rows`
		);
	}
	const out = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			out[y * width + x] = (bitmap[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
		}
	}
	return out;
}
```

- [ ] **Step 5: Create `index.ts`**

Create `packages/xtc/src/index.ts`:

```ts
export * from './types.ts';
export * from './planes.ts';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run --project node packages/xtc/test/planes.node.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Verify the whole project stays green**

Run: `npm run check && npm run lint && npm run test:node`
Expected: all three exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/xtc/src packages/xtc/test/planes.node.test.ts
git commit -m "feat(xtc): add contracts and XTG 1-bit plane packing"
```

---

### Task 2: XTH two-plane packing

**Files:**

- Modify: `packages/xtc/src/planes.ts`, `packages/xtc/test/planes.node.test.ts`

**Interfaces:**

- Consumes: `assertDimensions`, `assertPixelValues`, `XtcWriteError` from Task 1.
- Produces: `packXth(pixels: Uint8Array, width: number, height: number): Uint8Array` and `unpackXth(bitmap: Uint8Array, width: number, height: number): Uint8Array`.

- [ ] **Step 1: Write the failing XTH tests**

Append to `packages/xtc/test/planes.node.test.ts`:

```ts
describe('packXth', () => {
	it('splits two-bit codes across plane1 (high bit) and plane2 (low bit)', () => {
		// Codes [3, 2, 1, 0, 3, 2, 1, 0] down one 8-pixel column.
		// plane1 = high bits -> 0b11001100, plane2 = low bits -> 0b10101010.
		const pixels = new Uint8Array([3, 2, 1, 0, 3, 2, 1, 0]);
		expect(Array.from(packXth(pixels, 1, 8))).toEqual([0xcc, 0xaa]);
	});

	it('stores the rightmost screen column first', () => {
		// 2 columns x 8 rows. Right column (x=1) is code 3, left column (x=0) is code 1.
		const pixels = new Uint8Array(16);
		for (let y = 0; y < 8; y++) {
			pixels[y * 2] = 1; // x = 0, left
			pixels[y * 2 + 1] = 3; // x = 1, right
		}
		// plane1: right column high bits set -> [0xff, 0x00]; plane2 both set -> [0xff, 0xff].
		expect(Array.from(packXth(pixels, 2, 8))).toEqual([0xff, 0x00, 0xff, 0xff]);
	});

	it('packs vertically with the topmost pixel in bit 7', () => {
		// 1 column x 16 rows; only y=0 is code 3, everything else code 0.
		const pixels = new Uint8Array(16);
		pixels[0] = 3;
		expect(Array.from(packXth(pixels, 1, 16))).toEqual([0x80, 0x00, 0x80, 0x00]);
	});

	it('round-trips a patterned frame', () => {
		const width = 6;
		const height = 16;
		const pixels = new Uint8Array(width * height);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				pixels[y * width + x] = (x * 2 + y) % 4;
			}
		}
		expect(Array.from(unpackXth(packXth(pixels, width, height), width, height))).toEqual(
			Array.from(pixels)
		);
	});

	it('rejects a pixel array of the wrong length', () => {
		expectCode(() => packXth(new Uint8Array(7), 8, 8), 'pixels-length-mismatch');
	});

	it('rejects pixel values above 3', () => {
		const pixels = new Uint8Array(64);
		pixels[0] = 4;
		expectCode(() => packXth(pixels, 8, 8), 'pixel-out-of-range');
	});

	it('rejects heights that are not a multiple of 8', () => {
		expect(() => packXth(new Uint8Array(8 * 15), 8, 15)).toThrow(/multiple of 8/);
	});
});

describe('unpackXth', () => {
	it('unpacks the bit-split example back to codes', () => {
		expect(Array.from(unpackXth(new Uint8Array([0xcc, 0xaa]), 1, 8))).toEqual([
			3, 2, 1, 0, 3, 2, 1, 0
		]);
	});

	it('rejects a bitmap of the wrong length', () => {
		expect(() => unpackXth(new Uint8Array(3), 1, 8)).toThrow(/bitmap length/);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project node packages/xtc/test/planes.node.test.ts`
Expected: FAIL — `packXth`/`unpackXth` are not defined.

- [ ] **Step 3: Implement XTH packing in `planes.ts`**

Append to `packages/xtc/src/planes.ts`:

```ts
function assertXthDimensions(width: number, height: number): void {
	assertDimensions(width, height);
	if (height % 8 !== 0) {
		throw new Error('packXth requires height to be a multiple of 8');
	}
}

// 2-bit: two planes, column-major right-to-left, 8 vertical px/byte, MSB first.
// Plane 1 stores the high bit (value >> 1); plane 2 stores the low bit (value & 1).
export function packXth(pixels: Uint8Array, width: number, height: number): Uint8Array {
	assertXthDimensions(width, height);
	if (pixels.length !== width * height) {
		throw new XtcWriteError(
			'pixels-length-mismatch',
			`pixels array is ${pixels.length} bytes, expected ${width * height}`
		);
	}
	assertPixelValues(pixels, 3);
	const colBytes = height / 8;
	const planeSize = width * colBytes;
	const out = new Uint8Array(2 * planeSize);
	for (let x = 0; x < width; x++) {
		const column = width - 1 - x; // rightmost screen column is stored first
		for (let y = 0; y < height; y++) {
			const value = pixels[y * width + x];
			const byteOffset = column * colBytes + (y >> 3);
			const bit = 1 << (7 - (y & 7));
			if (value & 2) {
				out[byteOffset] |= bit;
			}
			if (value & 1) {
				out[planeSize + byteOffset] |= bit;
			}
		}
	}
	return out;
}

export function unpackXth(bitmap: Uint8Array, width: number, height: number): Uint8Array {
	assertXthDimensions(width, height);
	const colBytes = height / 8;
	const planeSize = width * colBytes;
	if (bitmap.length !== 2 * planeSize) {
		throw new Error(
			`bitmap length ${bitmap.length} does not match two planes of ${planeSize} bytes`
		);
	}
	const out = new Uint8Array(width * height);
	for (let x = 0; x < width; x++) {
		const column = width - 1 - x;
		for (let y = 0; y < height; y++) {
			const byteOffset = column * colBytes + (y >> 3);
			const bit = 7 - (y & 7);
			const bit1 = (bitmap[byteOffset] >> bit) & 1;
			const bit2 = (bitmap[planeSize + byteOffset] >> bit) & 1;
			out[y * width + x] = (bit1 << 1) | bit2;
		}
	}
	return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project node packages/xtc/test/planes.node.test.ts`
Expected: PASS (16 tests total in the file).

- [ ] **Step 5: Verify the whole project stays green**

Run: `npm run check && npm run lint && npm run test:node`
Expected: all three exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/xtc/src/planes.ts packages/xtc/test/planes.node.test.ts
git commit -m "feat(xtc): add XTH two-plane column-major packing"
```

---

### Task 3: `writeXtc` container assembly

**Files:**

- Create: `packages/xtc/src/writer.ts`, `packages/xtc/test/frame.ts`, `packages/xtc/test/book.ts`, `packages/xtc/test/writer.node.test.ts`
- Modify: `packages/xtc/src/index.ts`

**Interfaces:**

- Consumes: `types.ts` constants and errors, `packXtg`/`packXth` from Task 2.
- Produces: `writeXtc(book: XtcBook): Uint8Array`; test helpers `whiteFrame()`, `borderFrame()`, `makeFrame(pixel)`, `bytesEqual(a, b)`, fixture books `minimalXtcBook()` and `minimalXtchBook()`.

- [ ] **Step 1: Write the failing writer tests**

Create `packages/xtc/test/frame.ts`:

```ts
import { XTC_VIEWPORT_HEIGHT, XTC_VIEWPORT_WIDTH } from '../src/types.ts';

export function makeFrame(pixel: (x: number, y: number) => number): Uint8Array {
	const out = new Uint8Array(XTC_VIEWPORT_WIDTH * XTC_VIEWPORT_HEIGHT);
	for (let y = 0; y < XTC_VIEWPORT_HEIGHT; y++) {
		for (let x = 0; x < XTC_VIEWPORT_WIDTH; x++) {
			out[y * XTC_VIEWPORT_WIDTH + x] = pixel(x, y);
		}
	}
	return out;
}

export function whiteFrame(): Uint8Array {
	return makeFrame(() => 1);
}

export function borderFrame(): Uint8Array {
	return makeFrame((x, y) =>
		x === 0 || x === XTC_VIEWPORT_WIDTH - 1 || y === 0 || y === XTC_VIEWPORT_HEIGHT - 1 ? 0 : 1
	);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) {
			return false;
		}
	}
	return true;
}
```

Create `packages/xtc/test/book.ts`:

```ts
import type { XtcBook } from '../src/types.ts';
import { borderFrame, makeFrame, whiteFrame } from './frame.ts';

export function minimalXtcBook(): XtcBook {
	return {
		mode: 'xtc',
		title: 'Minimal XTC',
		author: 'Xteink Test',
		chapters: [
			{ name: 'Chapter One', startPage: 0, endPage: 0 },
			{ name: 'Chapter Two', startPage: 1, endPage: 1 }
		],
		pages: [whiteFrame(), borderFrame()]
	};
}

export function minimalXtchBook(): XtcBook {
	return {
		mode: 'xtch',
		title: 'Minimal XTCH',
		pages: [makeFrame((x, y) => (Math.floor(x / 40) + Math.floor(y / 40)) % 4)]
	};
}

export function onePageXtcBook(): XtcBook {
	return {
		mode: 'xtc',
		title: 'A',
		author: 'B',
		pages: [whiteFrame()]
	};
}
```

Create `packages/xtc/test/writer.node.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { writeXtc } from '../src/index.ts';
import { packXtg, packXth } from '../src/planes.ts';
import { XtcWriteError, type XtcBook, type XtcWriteErrorCode } from '../src/types.ts';
import { minimalXtcBook, minimalXtchBook, onePageXtcBook } from './book.ts';
import { borderFrame, bytesEqual, makeFrame, whiteFrame } from './frame.ts';

function expectCode(fn: () => unknown, code: XtcWriteErrorCode): void {
	let caught: unknown;
	try {
		fn();
	} catch (error) {
		caught = error;
	}
	expect(caught).toBeInstanceOf(XtcWriteError);
	if (caught instanceof XtcWriteError) {
		expect(caught.code).toBe(code);
	}
}

function u16(bytes: Uint8Array, offset: number): number {
	return new DataView(bytes.buffer).getUint16(offset, true);
}

function u32(bytes: Uint8Array, offset: number): number {
	return new DataView(bytes.buffer).getUint32(offset, true);
}

function u64(bytes: Uint8Array, offset: number): number {
	return Number(new DataView(bytes.buffer).getBigUint64(offset, true));
}

describe('writeXtc header and layout', () => {
	it('writes a complete single-page XTC container', () => {
		const bytes = writeXtc(onePageXtcBook());
		expect(bytes.length).toBe(264 + 22 + 48000);
		// Header: magic "XTC\0", version 1.0, pageCount 1.
		expect(Array.from(bytes.subarray(0, 6))).toEqual([0x58, 0x54, 0x43, 0x00, 0x01, 0x00]);
		expect(u16(bytes, 6)).toBe(1);
		// readDirection, hasMetadata, hasThumbnails, hasChapters.
		expect(bytes[8]).toBe(0);
		expect(bytes[9]).toBe(1);
		expect(bytes[10]).toBe(0);
		expect(bytes[11]).toBe(0);
		expect(u32(bytes, 0x0c)).toBe(0);
		expect(u64(bytes, 0x10)).toBe(0x38);
		expect(u64(bytes, 0x18)).toBe(248); // page table right after author block
		expect(u64(bytes, 0x20)).toBe(264); // 248 + one 16-byte entry
		expect(u64(bytes, 0x28)).toBe(0);
		expect(u32(bytes, 0x30)).toBe(0); // no chapters
		expect(u32(bytes, 0x34)).toBe(0);
	});

	it('writes XTCH magics and 2-bit sizes', () => {
		const bytes = writeXtc(minimalXtchBook());
		expect(bytes.length).toBe(264 + 22 + 96000);
		expect(Array.from(bytes.subarray(0, 4))).toEqual([0x58, 0x54, 0x43, 0x48]);
		expect(Array.from(bytes.subarray(264, 268))).toEqual([0x58, 0x54, 0x48, 0x00]);
	});

	it('places title and author at 0x38 and 0xB8 with zero padding', () => {
		const bytes = writeXtc(onePageXtcBook());
		expect(Array.from(bytes.subarray(0x38, 0x3b))).toEqual([0x41, 0x00, 0x00]); // "A"
		expect(bytes[0x38 + 127]).toBe(0);
		expect(Array.from(bytes.subarray(0xb8, 0xba))).toEqual([0x42, 0x00]); // "B"
		expect(bytes[0xb8 + 63]).toBe(0);
	});

	it('writes page-table entries and page headers for every page', () => {
		const pages = [whiteFrame(), borderFrame()];
		const book: XtcBook = { mode: 'xtc', pages };
		const bytes = writeXtc(book);
		const firstPage = 248 + 2 * 16; // no chapters: table at 248, 2 entries
		expect(u64(bytes, 0x18)).toBe(248);
		expect(u64(bytes, 0x20)).toBe(firstPage);
		for (let i = 0; i < 2; i++) {
			const entry = 248 + i * 16;
			expect(u64(bytes, entry)).toBe(firstPage + i * (22 + 48000));
			expect(u32(bytes, entry + 8)).toBe(22 + 48000);
			expect(u16(bytes, entry + 12)).toBe(480);
			expect(u16(bytes, entry + 14)).toBe(800);
			const pageOffset = firstPage + i * (22 + 48000);
			expect(u32(bytes, pageOffset)).toBe(0x00475458); // XTG
			expect(u16(bytes, pageOffset + 4)).toBe(480);
			expect(u16(bytes, pageOffset + 6)).toBe(800);
			expect(bytes[pageOffset + 8]).toBe(0); // colorMode
			expect(bytes[pageOffset + 9]).toBe(0); // compression
			expect(u32(bytes, pageOffset + 10)).toBe(48000);
			for (let b = pageOffset + 14; b < pageOffset + 22; b++) {
				expect(bytes[b]).toBe(0); // md5
			}
			expect(
				bytesEqual(
					bytes.subarray(pageOffset + 22, pageOffset + 22 + 48000),
					packXtg(pages[i], 480, 800)
				)
			).toBe(true);
		}
	});

	it('writes chapter records before the page table and stores 1-based pages', () => {
		const bytes = writeXtc(minimalXtcBook());
		expect(bytes[11]).toBe(1); // hasChapters
		expect(u32(bytes, 0x30)).toBe(248); // chapterOffset
		expect(u64(bytes, 0x18)).toBe(248 + 2 * 96); // table follows two records
		expect(u64(bytes, 0x20)).toBe(248 + 2 * 96 + 2 * 16);
		const record = (index: number) => 248 + index * 96;
		expect(new TextDecoder().decode(bytes.subarray(record(0), record(0) + 11))).toBe('Chapter One');
		expect(bytes[record(0) + 11]).toBe(0); // NUL padding after the name
		expect(u16(bytes, record(0) + 0x50)).toBe(1); // stored 1-based
		expect(u16(bytes, record(0) + 0x52)).toBe(1);
		expect(u16(bytes, record(1) + 0x50)).toBe(2);
		expect(u16(bytes, record(1) + 0x52)).toBe(2);
		for (let b = record(1) + 84; b < record(1) + 96; b++) {
			expect(bytes[b]).toBe(0);
		}
	});
});

describe('writeXtc metadata text handling', () => {
	it('truncates a multi-byte title at a code-point boundary', () => {
		// "é" is 2 UTF-8 bytes; 70 copies = 140 bytes -> stored 127, cut back to 126.
		const book: XtcBook = { mode: 'xtc', title: 'é'.repeat(70), pages: [whiteFrame()] };
		const bytes = writeXtc(book);
		const stored = bytes.subarray(0x38, 0x38 + 127);
		const expected = new TextEncoder().encode('é'.repeat(63));
		expect(bytesEqual(stored.subarray(0, 126), expected)).toBe(true);
		expect(stored[126]).toBe(0);
	});

	it('truncates an author at a code-point boundary', () => {
		const book: XtcBook = { mode: 'xtc', author: 'é'.repeat(32), pages: [whiteFrame()] };
		const bytes = writeXtc(book);
		const stored = bytes.subarray(0xb8, 0xb8 + 63);
		const expected = new TextEncoder().encode('é'.repeat(31));
		expect(bytesEqual(stored.subarray(0, 62), expected)).toBe(true);
		expect(stored[62]).toBe(0);
	});

	it('truncates a chapter name at 80 bytes and pads the record', () => {
		const book: XtcBook = {
			mode: 'xtc',
			chapters: [{ name: 'é'.repeat(41), startPage: 0, endPage: 0 }],
			pages: [whiteFrame()]
		};
		const bytes = writeXtc(book);
		const name = bytes.subarray(248, 248 + 80);
		expect(bytesEqual(name.subarray(0, 80), new TextEncoder().encode('é'.repeat(40)))).toBe(true);
	});

	it('zero-fills the metadata block when title and author are absent', () => {
		const bytes = writeXtc({ mode: 'xtc', pages: [whiteFrame()] });
		for (let b = 0x38; b < 0xf8; b++) {
			expect(bytes[b]).toBe(0);
		}
	});
});

describe('writeXtc validation', () => {
	it('refuses an empty book', () => {
		expectCode(() => writeXtc({ mode: 'xtc', pages: [] }), 'empty-book');
	});

	it('refuses more than 65535 pages before inspecting frames', () => {
		const pages = new Array<{ pixels: Uint8Array }>(65536).fill({ pixels: new Uint8Array(0) });
		expectCode(() => writeXtc({ mode: 'xtc', pages }), 'page-count-overflow');
	});

	it('refuses a page whose pixel array has the wrong length', () => {
		const page = { pixels: new Uint8Array(10) };
		expectCode(() => writeXtc({ mode: 'xtc', pages: [page] }), 'pixels-length-mismatch');
	});

	it('refuses out-of-range pixels in both modes', () => {
		const xtc = whiteFrame();
		xtc[0] = 2;
		expectCode(() => writeXtc({ mode: 'xtc', pages: [xtc] }), 'pixel-out-of-range');
		const xtch = makeFrame((x, y) => (x + y) % 3);
		xtch[0] = 4;
		expectCode(() => writeXtc({ mode: 'xtch', pages: [xtch] }), 'pixel-out-of-range');
	});

	it('refuses chapters that are out of bounds or misordered', () => {
		expectCode(
			() =>
				writeXtc({
					mode: 'xtc',
					chapters: [{ name: 'X', startPage: 2, endPage: 2 }],
					pages: [whiteFrame(), whiteFrame()]
				}),
			'chapter-out-of-bounds'
		);
		expectCode(
			() =>
				writeXtc({
					mode: 'xtc',
					chapters: [{ name: 'X', startPage: 1, endPage: 0 }],
					pages: [whiteFrame(), whiteFrame()]
				}),
			'chapter-order'
		);
	});

	it('refuses an empty chapter name', () => {
		expectCode(
			() =>
				writeXtc({
					mode: 'xtc',
					chapters: [{ name: '', startPage: 0, endPage: 0 }],
					pages: [whiteFrame()]
				}),
			'empty-chapter-name'
		);
	});

	it('refuses U+0000 in title, author, and chapter names', () => {
		const frame = whiteFrame();
		expectCode(() => writeXtc({ mode: 'xtc', title: 'a\u0000b', pages: [frame] }), 'invalid-text');
		expectCode(() => writeXtc({ mode: 'xtc', author: 'a\u0000b', pages: [frame] }), 'invalid-text');
		expectCode(
			() =>
				writeXtc({
					mode: 'xtc',
					chapters: [{ name: 'a\u0000b', startPage: 0, endPage: 0 }],
					pages: [frame]
				}),
			'invalid-text'
		);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project node packages/xtc/test/writer.node.test.ts`
Expected: FAIL — `writeXtc` is not exported.

- [ ] **Step 3: Implement `writer.ts`**

Create `packages/xtc/src/writer.ts`:

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
	// The rest of the field is already zero; one explicit NUL terminates short text.
	bytes[offset + content.length] = 0;
}

function assertNoNul(text: string | undefined, field: string): void {
	if (text?.includes('\u0000')) {
		throw new XtcWriteError('invalid-text', `${field} must not contain U+0000`);
	}
}

function validate(book: XtcBook): {
	mode: XtcMode;
	pages: Uint8Array[];
	chapters: XtcChapter[];
	count: number;
} {
	const count = book.pages.length;
	if (count === 0) {
		throw new XtcWriteError('empty-book', 'a book needs at least one page');
	}
	if (count > XTC_MAX_PAGES) {
		throw new XtcWriteError('page-count-overflow', `page count ${count} exceeds ${XTC_MAX_PAGES}`);
	}
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
	const frameLength = XTC_VIEWPORT_WIDTH * XTC_VIEWPORT_HEIGHT;
	const pixelMax = XTC_PIXEL_MAX[book.mode];
	for (const page of book.pages) {
		if (page.pixels.length !== frameLength) {
			throw new XtcWriteError(
				'pixels-length-mismatch',
				`page pixels are ${page.pixels.length} bytes, expected ${frameLength}`
			);
		}
		for (let i = 0; i < page.pixels.length; i++) {
			if (page.pixels[i] > pixelMax) {
				throw new XtcWriteError(
					'pixel-out-of-range',
					`pixel value ${page.pixels[i]} at index ${i} exceeds max ${pixelMax}`
				);
			}
		}
	}
	assertNoNul(book.title, 'title');
	assertNoNul(book.author, 'author');
	for (const chapter of chapters) {
		assertNoNul(chapter.name, `chapter "${chapter.name}" name`);
	}
	return { mode: book.mode, pages: book.pages.map((page) => page.pixels), chapters, count };
}

function bitmapBytes(mode: XtcMode): number {
	if (mode === 'xtc') {
		return Math.ceil(XTC_VIEWPORT_WIDTH / 8) * XTC_VIEWPORT_HEIGHT;
	}
	return Math.ceil((XTC_VIEWPORT_WIDTH * XTC_VIEWPORT_HEIGHT) / 8) * 2;
}

export function writeXtc(book: XtcBook): Uint8Array {
	const { mode, pages, chapters, count } = validate(book);
	const metadataEnd = XTC_AUTHOR_OFFSET + XTC_AUTHOR_SIZE; // 0xF8
	const hasChapters = chapters.length > 0;
	const chapterOffset = hasChapters ? metadataEnd : 0;
	const pageTableOffset = metadataEnd + (hasChapters ? chapters.length * XTC_CHAPTER_SIZE : 0);
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
	out[4] = 1; // versionMajor
	out[5] = 0; // versionMinor
	putU16(6, count);
	out[8] = 0; // readDirection
	out[9] = 1; // hasMetadata
	out[10] = 0; // hasThumbnails
	out[11] = hasChapters ? 1 : 0;
	putU32(0x0c, 0); // currentPage
	putU64(0x10, XTC_TITLE_OFFSET); // metadataOffset
	putU64(0x18, pageTableOffset);
	putU64(0x20, dataOffset);
	putU64(0x28, 0); // thumbOffset
	putU32(0x30, chapterOffset);
	putU32(0x34, 0); // padding

	writeTextField(out, XTC_TITLE_OFFSET, book.title, XTC_TITLE_SIZE - 1);
	writeTextField(out, XTC_AUTHOR_OFFSET, book.author, XTC_AUTHOR_SIZE - 1);

	for (let i = 0; i < chapters.length; i++) {
		const recordOffset = metadataEnd + i * XTC_CHAPTER_SIZE;
		out.set(truncateUtf8(chapters[i].name, 80), recordOffset);
		putU16(recordOffset + 0x50, chapters[i].startPage + 1);
		putU16(recordOffset + 0x52, chapters[i].endPage + 1);
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
		out[pageOffset + 8] = 0; // colorMode
		out[pageOffset + 9] = 0; // compression
		putU32(pageOffset + 10, bitmap);
		// md5 (8 bytes at pageOffset + 0x0e) stays zero.
		const packed =
			mode === 'xtc'
				? packXtg(pages[i], XTC_VIEWPORT_WIDTH, XTC_VIEWPORT_HEIGHT)
				: packXth(pages[i], XTC_VIEWPORT_WIDTH, XTC_VIEWPORT_HEIGHT);
		out.set(packed, pageOffset + XTC_PAGE_HEADER_SIZE);
	}

	return out;
}
```

Then add the writer export to `packages/xtc/src/index.ts`:

```ts
export * from './types.ts';
export * from './planes.ts';
export { writeXtc } from './writer.ts';
```

- [ ] **Step 4: Run the writer tests**

Run: `npx vitest run --project node packages/xtc/test/writer.node.test.ts`
Expected: PASS (16 tests). If any structural expectation is off, re-check the spec's byte offsets before touching the test.

- [ ] **Step 5: Run the full node suite**

Run: `npm run check && npm run lint && npm run test:node`
Expected: all three exit 0 (planes, writer, and Phase 1 tests all pass).

- [ ] **Step 6: Commit**

```bash
git add packages/xtc/src/writer.ts packages/xtc/src/index.ts packages/xtc/test
git commit -m "feat(xtc): assemble XTC/XTCH containers with metadata, chapters, and page data"
```

---

### Task 4: Mirror-reader round trips

**Files:**

- Create: `packages/xtc/test/mirror.ts`, `packages/xtc/test/mirror.node.test.ts`

**Interfaces:**

- Consumes: `writeXtc`, `minimalXtcBook()`, `minimalXtchBook()`, `onePageXtcBook()`, `bytesEqual`.
- Produces: test-only `mirrorBook(bytes)` returning `{ pageCount, title, author, chapters, pages }` with decoded pixel frames, mirroring the parser's arithmetic.

- [ ] **Step 1: Write the failing round-trip tests**

Create `packages/xtc/test/mirror.node.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { writeXtc } from '../src/index.ts';
import { minimalXtcBook, minimalXtchBook, onePageXtcBook } from './book.ts';
import { borderFrame, bytesEqual, makeFrame, whiteFrame } from './frame.ts';
import { expectMirrorGeometry, mirrorBook } from './mirror.ts';

describe('mirror round trip', () => {
	it('reproduces the minimal XTC book', () => {
		const book = minimalXtcBook();
		const mirror = mirrorBook(writeXtc(book));
		expect(mirror.pageCount).toBe(2);
		expect(mirror.title).toBe('Minimal XTC');
		expect(mirror.author).toBe('Xteink Test');
		expect(mirror.chapters).toEqual([
			{ name: 'Chapter One', startPage: 0, endPage: 0 },
			{ name: 'Chapter Two', startPage: 1, endPage: 1 }
		]);
		expectMirrorGeometry(mirror);
		expect(bytesEqual(mirror.pages[0].pixels, whiteFrame())).toBe(true);
		expect(bytesEqual(mirror.pages[1].pixels, borderFrame())).toBe(true);
	});

	it('reproduces the minimal XTCH book', () => {
		const book = minimalXtchBook();
		const mirror = mirrorBook(writeXtc(book));
		expect(mirror.pageCount).toBe(1);
		expect(mirror.chapters).toEqual([]);
		expectMirrorGeometry(mirror);
		const expected = makeFrame((x, y) => (Math.floor(x / 40) + Math.floor(y / 40)) % 4);
		expect(bytesEqual(mirror.pages[0].pixels, expected)).toBe(true);
	});

	it('round-trips a chapter-less book with empty metadata', () => {
		const book = onePageXtcBook();
		book.title = undefined;
		book.author = undefined;
		book.chapters = undefined;
		const mirror = mirrorBook(writeXtc(book));
		expect(mirror.title).toBe('');
		expect(mirror.author).toBe('');
		expect(mirror.chapters).toEqual([]);
		expect(bytesEqual(mirror.pages[0].pixels, whiteFrame())).toBe(true);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project node packages/xtc/test/mirror.node.test.ts`
Expected: FAIL — `mirrorBook` is not exported from `../mirror.ts` (module not found).

- [ ] **Step 3: Create the mirror reader**

Create `packages/xtc/test/mirror.ts`:

```ts
import { XTC_VIEWPORT_HEIGHT, XTC_VIEWPORT_WIDTH } from '../src/types.ts';

export interface MirrorChapter {
	name: string;
	startPage: number; // 0-based after mirroring the parser's decrement
	endPage: number;
}

export interface MirrorPage {
	width: number;
	height: number;
	pixels: Uint8Array; // decoded device codes
}

export interface MirrorBook {
	pageCount: number;
	title: string;
	author: string;
	chapters: MirrorChapter[];
	pages: MirrorPage[];
}

function u16(bytes: Uint8Array, offset: number): number {
	return new DataView(bytes.buffer).getUint16(offset, true);
}

function u32(bytes: Uint8Array, offset: number): number {
	return new DataView(bytes.buffer).getUint32(offset, true);
}

function u64(bytes: Uint8Array, offset: number): number {
	return Number(new DataView(bytes.buffer).getBigUint64(offset, true));
}

function text(bytes: Uint8Array, offset: number, maxBytes: number): string {
	let end = offset;
	while (end < offset + maxBytes && bytes[end] !== 0) {
		end++;
	}
	return new TextDecoder().decode(bytes.subarray(offset, end));
}

// Mirrors XtcParser::readChapters: records live in the gap before the page table,
// count = (pageTableOffset - chapterOffset) / 96, and start/end are stored 1-based.
export function mirrorChapters(bytes: Uint8Array): MirrorChapter[] {
	if (bytes[11] !== 1) {
		return [];
	}
	const pageCount = u16(bytes, 6);
	const chapterOffset = u32(bytes, 0x30);
	if (chapterOffset === 0 || chapterOffset >= bytes.length || chapterOffset + 96 > bytes.length) {
		return [];
	}
	let maxOffset = bytes.length;
	const pageTableOffset = u64(bytes, 0x18);
	if (pageTableOffset > chapterOffset && pageTableOffset <= bytes.length) {
		maxOffset = pageTableOffset;
	} else if (u64(bytes, 0x20) > chapterOffset && u64(bytes, 0x20) <= bytes.length) {
		maxOffset = u64(bytes, 0x20);
	}
	const count = Math.floor((maxOffset - chapterOffset) / 96);
	const chapters: MirrorChapter[] = [];
	for (let i = 0; i < count; i++) {
		const record = chapterOffset + i * 96;
		const name = text(bytes, record, 80);
		let start = u16(bytes, record + 0x50);
		let end = u16(bytes, record + 0x52);
		if (name === '' && start === 0 && end === 0) {
			break;
		}
		if (start > 0) {
			start--;
		}
		if (end > 0) {
			end--;
		}
		if (start >= pageCount) {
			continue;
		}
		if (end >= pageCount) {
			end = pageCount - 1;
		}
		if (start > end) {
			continue;
		}
		chapters.push({ name, startPage: start, endPage: end });
	}
	return chapters;
}

function decodeXtg(bitmap: Uint8Array, width: number, height: number): Uint8Array {
	const rowBytes = (width + 7) >> 3;
	const out = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const byte = bitmap[y * rowBytes + (x >> 3)];
			out[y * width + x] = (byte >> (7 - (x & 7))) & 1;
		}
	}
	return out;
}

function decodeXth(bitmap: Uint8Array, width: number, height: number): Uint8Array {
	const colBytes = height / 8;
	const planeSize = width * colBytes;
	const out = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const column = width - 1 - x;
			const byteOffset = column * colBytes + (y >> 3);
			const bit = 7 - (y & 7);
			const bit1 = (bitmap[byteOffset] >> bit) & 1;
			const bit2 = (bitmap[planeSize + byteOffset] >> bit) & 1;
			out[y * width + x] = (bit1 << 1) | bit2;
		}
	}
	return out;
}

export function mirrorBook(bytes: Uint8Array): MirrorBook {
	const pageCount = u16(bytes, 6);
	const title = text(bytes, 0x38, 128);
	const author = text(bytes, 0xb8, 64);
	const pageTableOffset = u64(bytes, 0x18);
	// File magic is little-endian: XTCH bytes are 58 54 43 48, so byte 3 is 0x48
	// only for the 2-bit container (XTC has 0x00 there).
	const bitDepth = bytes[3] === 0x48 ? 2 : 1;
	const pages: MirrorPage[] = [];
	for (let i = 0; i < pageCount; i++) {
		const entry = pageTableOffset + i * 16;
		const pageOffset = u64(bytes, entry);
		const width = u16(bytes, pageOffset + 4);
		const height = u16(bytes, pageOffset + 6);
		const bitmap =
			bitDepth === 1
				? bytes.subarray(pageOffset + 22, pageOffset + 22 + Math.ceil(width / 8) * height)
				: bytes.subarray(pageOffset + 22, pageOffset + 22 + Math.ceil((width * height) / 8) * 2);
		const pixels =
			bitDepth === 1 ? decodeXtg(bitmap, width, height) : decodeXth(bitmap, width, height);
		pages.push({ width, height, pixels });
	}
	return {
		pageCount,
		title,
		author,
		chapters: mirrorChapters(bytes),
		pages
	};
}

export function expectMirrorGeometry(mirror: MirrorBook): void {
	for (const page of mirror.pages) {
		if (page.width !== XTC_VIEWPORT_WIDTH || page.height !== XTC_VIEWPORT_HEIGHT) {
			throw new Error(`unexpected page geometry ${page.width}x${page.height}`);
		}
	}
}
```

- [ ] **Step 4: Verify the round trips pass**

Run: `npx vitest run --project node packages/xtc/test/mirror.node.test.ts`
Expected: PASS (3 tests). The mirror decodes pages with its own loops copied from the firmware's arithmetic, so a writer/planes bug cannot hide behind itself.

- [ ] **Step 5: Verify the whole project stays green**

Run: `npm run check && npm run lint && npm run test:node`
Expected: all three exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/xtc/test/mirror.ts packages/xtc/test/mirror.node.test.ts
git commit -m "test(xtc): round-trip writer output through a mirror of the device parser"
```

---

### Task 5: Golden fixtures

**Files:**

- Create: `packages/xtc/test/golden.node.test.ts`, `fixtures/golden/minimal.xtc`, `fixtures/golden/minimal.xtch`

**Interfaces:**

- Consumes: `writeXtc`, `minimalXtcBook()`, `minimalXtchBook()`, `mirrorBook`, `bytesEqual`.
- Produces: committed golden files under `fixtures/golden/` and a byte-diff test with an env-gated regenerator.

- [ ] **Step 1: Write the golden test**

Create `packages/xtc/test/golden.node.test.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { writeXtc } from '../src/index.ts';
import { minimalXtcBook, minimalXtchBook } from './book.ts';
import { borderFrame, bytesEqual, makeFrame, whiteFrame } from './frame.ts';
import { mirrorBook } from './mirror.ts';

const goldenDir = new URL('../../../fixtures/golden/', import.meta.url);

function regenerate(name: string, book: Parameters<typeof writeXtc>[0]): void {
	if (process.env.XTC_REGENERATE_GOLDENS === '1') {
		writeFileSync(new URL(name, goldenDir), writeXtc(book));
	}
}

describe('golden fixtures', () => {
	it('matches minimal.xtc byte for byte', () => {
		regenerate('minimal.xtc', minimalXtcBook());
		const expected = readFileSync(new URL('minimal.xtc', goldenDir));
		const actual = writeXtc(minimalXtcBook());
		expect(bytesEqual(actual, new Uint8Array(expected))).toBe(true);
		const mirror = mirrorBook(actual);
		expect(mirror.title).toBe('Minimal XTC');
		expect(mirror.author).toBe('Xteink Test');
		expect(mirror.chapters.length).toBe(2);
		expect(bytesEqual(mirror.pages[0].pixels, whiteFrame())).toBe(true);
		expect(bytesEqual(mirror.pages[1].pixels, borderFrame())).toBe(true);
	});

	it('matches minimal.xtch byte for byte', () => {
		regenerate('minimal.xtch', minimalXtchBook());
		const expected = readFileSync(new URL('minimal.xtch', goldenDir));
		const actual = writeXtc(minimalXtchBook());
		expect(bytesEqual(actual, new Uint8Array(expected))).toBe(true);
		const mirror = mirrorBook(actual);
		expect(mirror.pageCount).toBe(1);
		const expectedPixels = makeFrame((x, y) => (Math.floor(x / 40) + Math.floor(y / 40)) % 4);
		expect(bytesEqual(mirror.pages[0].pixels, expectedPixels)).toBe(true);
	});
});
```

- [ ] **Step 2: Generate the goldens for the first time**

Run: `XTC_REGENERATE_GOLDENS=1 npx vitest run --project node packages/xtc/test/golden.node.test.ts`
Expected: PASS; `git status --short` shows the new `fixtures/golden/minimal.xtc` (~96 KB) and `fixtures/golden/minimal.xtch` (~96 KB).

- [ ] **Step 3: Verify goldens without regeneration**

Run: `npx vitest run --project node packages/xtc/test/golden.node.test.ts`
Expected: PASS with no `XTC_REGENERATE_GOLDENS` set.

- [ ] **Step 4: Verify the whole project stays green**

Run: `npm run check && npm run lint && npm run test:node`
Expected: all three exit 0.

- [ ] **Step 5: Commit**

```bash
git add fixtures/golden packages/xtc/test/golden.node.test.ts
git commit -m "test(xtc): commit golden XTC and XTCH fixtures"
```

---

### Task 6: Update AGENTS.md and close out

**Files:**

- Modify: `AGENTS.md`

- [ ] **Step 1: Update the module map**

In `AGENTS.md`, replace the row:

```text
| `packages/xtc/src/` | XTC/XTCH writer (Phase 2; does not exist yet) | no |
```

with:

```text
| `packages/xtc/` | XTC/XTCH writer: header, metadata, chapters, page table, XTG/XTH bit packing | no |
```

- [ ] **Step 2: Run final verification**

Run: `npm run format && npm run lint && npm run check && npm run check:web && npm test && npm run test:e2e && npm run guard`
Expected: every command exits 0 and `guard: PASS` appears. Browser/e2e runs bind localhost ports; if the sandbox blocks them, rerun the affected commands with approval, as in Phase 1.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): add packages/xtc to the module map"
```

---

## Self-review notes

Checked against the Phase 2 spec after writing:

- Spec Section 5 architecture maps to Tasks 1-3: `types.ts` (Task 1), `planes.ts` (Tasks 1-2), `writer.ts` (Task 3), `index.ts` (Tasks 1-3).
- Spec Section 6 contracts: types in Task 1, `writeXtc` signature in Task 3.
- Spec Section 7.1-7.3 layout and parent rules: writer assembly and structural tests in Task 3.
- Spec Section 7.4 packing: XTG vectors in Task 1, XTH vectors in Task 2.
- Spec Section 7.5-7.6 metadata truncation and validation order: writer tests in Task 3.
- Spec Section 8 error codes: rejection matrix in Task 3 covers all eight codes.
- Spec Section 9.1-9.3 vectors and mirror: Tasks 1, 2, and 4.
- Spec Section 9.4-9.6 and Section 10 goldens and text boundaries: Tasks 3 and 5.
- Spec Section 11 config wiring: Task 0; AGENTS.md in Task 6.
- Spec Section 12 exit criteria: final verification in Task 6.
- Type and name consistency: `writeXtc`, `packXtg`/`packXth`/`unpackXtg`/`unpackXth`, `XtcWriteError`, and all eight error codes are defined once in Task 1 and used unchanged afterwards.
