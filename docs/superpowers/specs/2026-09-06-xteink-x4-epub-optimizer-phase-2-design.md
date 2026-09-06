# Xteink X4 EPUB Optimizer: Phase 2 Design Spec

Status: ready for spec review (2026-09-06)
Parent spec: `docs/superpowers/specs/2026-09-03-xteink-x4-epub-optimizer-design.md`
Phase 2 plan placeholder: `docs/superpowers/plans/2026-09-06-xteink-x4-epub-optimizer-phase-2-placeholder.md`

## 1. Goal

Build `packages/xtc`, a DOM-free TypeScript package that writes byte-exact XTC
(1-bit, XTG pages) and XTCH (2-bit, XTH pages) containers from quantized page
frames, book metadata, and chapter boundaries, and prove the bytes with
node-only byte-exact tests. This is the writer half of pre-rendered output:
Phase 3 feeds it pages from the browser paginator and quantizer, and Phase 4
checks its output against the simulator. This phase ships no UI and no pipeline
integration; it proves we can emit bytes whose layout the device parser accepts.

## 2. Scope

In scope:

- New `packages/xtc` workspace package with no runtime dependencies.
- XTC and XTCH container assembly: 56-byte header, title/author metadata block,
  optional chapter records, page table, page data.
- XTG (1-bit) row-major and XTH (2-bit) plane packing from quantized pixel
  frames, including the byte-order rules the reader actually applies.
- Every writer rule in Section 8 of the parent spec, as construction or
  validation.
- Byte-exact node tests: hand-computed plane vectors, structural byte asserts,
  a test-only reader that mirrors the parser's arithmetic, committed golden
  fixtures, and a rejection matrix.
- Wire the package into typecheck and the node test project.
- Phase 2 design spec and a real implementation plan that replaces the
  placeholder plan.

Out of scope:

- Pagination, capture, quantization, Workers, and the XTC-mode UI (Phase 3).
- Simulator golden-image oracle and supersampling tuning (Phase 4).
- Any change to `apps/web`, `apps/server`, or `packages/optimize` behavior.
- EPUB, XTC, or BMP input formats, X3/X4 Pro/Classic geometry, landscape
  output, and anything the parent spec already rules out.
- A node build pipeline, device upload, or WebDAV delivery.

## 3. Hard project rules that apply

These come from the parent spec and stay in force:

1. `crosspoint-reader/**` is a read-only vendored reference; nothing is
   committed or pushed inside either submodule.
2. Output is download-only; the app never uploads to the device.
3. All book processing runs in the browser. `packages/xtc` is DOM-free so its
   byte-exact tests run in plain node, but it is still only ever called from
   browser code (a Worker) in the product.
4. Hono remains a static file host with no book-processing imports.

## 4. Device contract (verified)

Every byte-level rule below was re-read from the pinned firmware at
`badfa95f`, not copied from memory. Cite these when reviewing implementation:

| Fact                                                                                                                                                                                                                    | Source                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Header, page-table entry, and page-header structs are packed and little-endian                                                                                                                                          | `crosspoint-reader/crosspoint-firmware/lib/Xtc/Xtc/XtcTypes.h:36-82` (`#pragma pack(1)`) |
| `XTC_MAGIC = 0x00435458`, `XTCH_MAGIC = 0x48435458`, `XTG_MAGIC = 0x00475458`, `XTH_MAGIC = 0x00485458`                                                                                                                 | `XtcTypes.h:22-28`                                                                       |
| Display geometry is 480x800                                                                                                                                                                                             | `XtcTypes.h:31-32`                                                                       |
| Legacy header is 0x30; a `pageTableOffset >= 56` is required for chapters to be active                                                                                                                                  | `XtcTypes.h:34`, `lib/Xtc/Xtc/XtcParser.cpp:89`                                          |
| Bit depth comes from the file magic; 1.0 and 0.1 are both parsed, 1.0 is the only version we emit                                                                                                                       | `XtcParser.cpp:138-149`                                                                  |
| A zero `pageCount` is refused as a corrupted header                                                                                                                                                                     | `XtcParser.cpp:151-154`                                                                  |
| Title is read at absolute 0x38 (up to 127 bytes) and author at absolute 0xB8 (up to 63 bytes), not via `metadataOffset`                                                                                                 | `XtcParser.cpp:163-190`                                                                  |
| The page table must fit in the file; entry 0's width/height become the book's default dimensions                                                                                                                        | `XtcParser.cpp:192-231`                                                                  |
| Chapters: `chapterOffset` is read from header offset 0x30; count derives from the gap to `pageTableOffset` in 96-byte records; start/end are 1-based in the file and decremented; empty-name records with 0/0 terminate | `XtcParser.cpp:266-372` (count at 314-316, start/end at 340-351, sentinel at 343-345)    |
| Chapter name is stored in 80 bytes; start at record +0x50, end at +0x52                                                                                                                                                 | `XtcParser.cpp:333-341`                                                                  |
| `loadPage` seeks to the page-table entry's `dataOffset`, reads a 22-byte header, and sizes the bitmap from that header's own w/h; the entry `dataSize` is not consumed                                                  | `XtcParser.cpp:415-455`                                                                  |
| Page magic must match the file bit depth (XTG for 1-bit, XTH for 2-bit)                                                                                                                                                 | `XtcParser.cpp:431-438`                                                                  |
| 1-bit bitmap is `((width+7)/8) * height`; 2-bit is `((width*height+7)/8) * 2`                                                                                                                                           | `XtcParser.cpp:443-449`                                                                  |
| XTG decode is row-major, 8 px/byte, MSB first, bit 0 = black ink                                                                                                                                                        | `src/activities/reader/XtcReaderActivity.cpp:260-271`                                    |
| XTH decode is two planes, column-major right-to-left, 8 vertical px/byte, MSB first; plane1 stores the high bit of each two-bit value and plane2 the low bit                                                            | `XtcReaderActivity.cpp:181-191`                                                          |
| Gray codes: 0 = white, 1 = dark grey, 2 = light grey, 3 = black                                                                                                                                                         | `lib/Xtc/README` (XTH section); structure matches `XtcReaderActivity.cpp:197-247`        |
| Cover art and thumbnails are generated from page 0 at runtime                                                                                                                                                           | `lib/Xtc/Xtc.cpp:145-176`                                                                |

Consequences for the writer: `compression` is always 0, pages are 480x800
everywhere, every page-table entry carries the same geometry, and metadata
occupies exactly 0x38..0xF8 regardless of what `metadataOffset` claims.

## 5. Architecture

`packages/xtc` is one unit with four source files, no DOM, and no dependencies.
Dependency direction is inward: `index.ts` exports `types.ts`, `planes.ts`, and
`writer.ts`; `writer.ts` imports `types.ts` and `planes.ts`; `planes.ts` imports
only constants and its own validation helpers.

| File        | Responsibility                                                                |
| ----------- | ----------------------------------------------------------------------------- |
| `types.ts`  | mode, book/page/chapter contracts, geometry constants, error code union       |
| `planes.ts` | pack/unpack helpers: XTG rows and XTH planes over generic width/height        |
| `writer.ts` | validate a book, lay out offsets, assemble the full container as `Uint8Array` |
| `index.ts`  | public exports: `writeXtc`, types, constants, `XtcWriteError`                 |

`planes.ts` is exported from the package entry so Phase 3's Worker can test and
reuse the packing in isolation; `writer.ts` stays the only assembler. Tests may
also import subpaths through a `@xteink/xtc/*` alias, matching the existing
`packages/optimize` convention.

The separation is load-bearing for the whole project: bit packing and offset
arithmetic are the hardest correctness problem and must be testable in plain
node without a browser, which is what keeps them in this package and not in the
DOM modules.

## 6. Public contracts

```ts
export const XTC_VIEWPORT_WIDTH = 480;
export const XTC_VIEWPORT_HEIGHT = 800;

export type XtcMode = 'xtc' | 'xtch';

// Device pixel codes, not luminance: the caller quantizes.
// 'xtc'  pages: 0 = black ink, 1 = white
// 'xtch' pages: 0 = white, 1 = dark grey, 2 = light grey, 3 = black
export interface XtcPage {
	pixels: Uint8Array; // XTC_VIEWPORT_WIDTH * XTC_VIEWPORT_HEIGHT codes
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

export function writeXtc(book: XtcBook): Uint8Array;
```

Chapter `startPage`/`endPage` are 0-based in the API because every consumer in
the pipeline indexes pages from 0; the writer stores them 1-based because the
parser decrements file values (`XtcParser.cpp:347-352`). The package never
truncates or re-orders pages, chapters, or metadata on its own beyond the
bounded truncation rules in Section 7.3.

## 7. Byte layout and writer rules

### 7.1 File layout

One book is laid out in this exact order, all integers little-endian:

```text
0x000  XtcHeader (56 B, see Section 7.2)
0x038  title   [128 B]  UTF-8, up to 127 bytes, NUL + zero padded
0x0B8  author  [ 64 B]  UTF-8, up to  63 bytes, NUL + zero padded
0x0F8  chapter records  (only when chapters present)  96 B each
       page table       (16 B per page)
       page data        (22 B page header + bitmap, per page)
```

Offsets when `c` chapters and `p` pages exist:

- `chapterOffset = 0xF8` when `c > 0`, else `0`.
- `pageTableOffset = 0xF8 + 96c`.
- `dataOffset = pageTableOffset + 16p`.
- Page `i` table entry: `dataOffset = firstPageDataOffset + i * (22 + B)`,
  where `firstPageDataOffset` is the header's `dataOffset` value, plus
  `dataSize = 22 + B`, `width = 480`, `height = 800`, and `B` is the bitmap byte
  length (48,000 for XTG, 96,000 for XTH).
- Total file length `= dataOffset + p * (22 + B)`.

No padding, alignment gaps, or sentinel records are written anywhere: the
chapter block ends exactly where the page table begins, so the parser's
`(pageTableOffset - chapterOffset) / 96` chapter count is exact and needs no
empty-name terminator.

### 7.2 Header fields

```text
0x00  magic           u32   XTC 0x00435458 | XTCH 0x48435458
0x04  versionMajor    u8    1
0x05  versionMinor    u8    0
0x06  pageCount       u16   p
0x08  readDirection   u8    0
0x09  hasMetadata     u8    1
0x0A  hasThumbnails   u8    0
0x0B  hasChapters     u8    0 | 1
0x0C  currentPage     u32   0
0x10  metadataOffset  u64   0x38
0x18  pageTableOffset u64   computed
0x20  dataOffset      u64   computed
0x28  thumbOffset     u64   0
0x30  chapterOffset   u32   0 | 0xF8
0x34  padding         u32   0
```

Page table entries (16 B): `dataOffset u64`, `dataSize u32`, `width u16`,
`height u16`.

Page data (22 B header, then bitmap): `magic u32` (XTG 0x00475458 | XTH
0x00485458), `width u16 480`, `height u16 800`, `colorMode u8 0`,
`compression u8 0`, `dataSize u32 B`, `md5 u64 0`.

### 7.3 Parent spec Section 8 rules, mapped to code

Each parent rule becomes construction (C) or validation (V) in `writer.ts`:

1. `compression` is always 0 (C). The parser ignores the field and never
   decompresses (`XtcParser.cpp:440-449`).
2. XTG bitmap: row-major, 8 px/byte, MSB first, bit 0 = black ink (C).
   Unused bits in a row's final byte are zero. Bitmap size 48,000 B.
3. XTH bitmap: two sequential planes, column-major right-to-left, 8 vertical
   px/byte, MSB first, `value = (bit1 << 1) | bit2`, plane1 = `value >> 1`,
   plane2 = `value & 1` (C). Bitmap size 96,000 B.
4. Page-table `dataOffset` points at the 22-byte page header, not the bitmap (C).
5. `pageTableOffset >= 56` always holds because the table follows the fixed
   metadata block and any chapters (C).
6. Chapters sit before the page table, exactly filling the gap in 96-byte
   multiples (C).
7. Title/author bytes are written only at 0x38 and 0xB8 (C).
8. `pageCount` fits u16; more than 65,535 pages is refused before any page
   content is inspected (V).
9. `versionMajor`/`versionMinor` are 1/0 (C).
10. `hasThumbnails = 0` and `thumbOffset = 0`; the device builds cover art from
    page 0 (`Xtc.cpp:145-176`) (C).
11. Every page-table entry carries 480x800. The writer accepts one geometry
    only, so uniformity cannot be violated (C, V on frame length).
12. Page-table `dataSize` is written as `22 + bitmapSize` even though `loadPage`
    derives the bitmap length from the page header's own w/h (C).

### 7.4 Pixel-code packing

`planes.ts` exposes generic `packXtg(pixels, width, height)` and
`packXth(pixels, width, height)` helpers plus matching `unpack*` functions used
by tests. Both require `pixels.length === width * height`, `width > 0`,
`height % 8 === 0`, and values within the mode's code range. The height
divisibility precondition matches the device buffer math exactly: the reader
sizes each XTH plane as `(width * height + 7) / 8` bytes and indexes it as
`width * ceil(height / 8)` column bytes, which agree only when 8 divides the
height (`XtcParser.cpp:446`, `XtcReaderActivity.cpp:181-191`). The writer itself
always packs 480x800, so the precondition is always satisfied in product code.

XTG: pixels are stored bit 7 first within each byte; bit value equals the pixel
code (`0` black, `1` white), so the worked example `B W B B W W B W` packs to
`0b01001101` = `0x4D`.

XTH: for pixel `(x, y)` the stored column is `c = width - 1 - x` (rightmost
screen column is stored first); within column `c`, byte `c * (height / 8) +
y / 8`, bit `7 - (y % 8)`. Plane 1 stores `value >> 1`, plane 2 stores
`value & 1`, plane 1 bytes precede plane 2 bytes.

### 7.5 Metadata text handling

Title, author, and chapter names are encoded as UTF-8. Content is truncated to
the field maximum at a code-point boundary (never mid-character): title 127
bytes, author 63 bytes, chapter name 80 bytes. The writer pads with zeros. A
string containing U+0000 is refused with `invalid-text` rather than silently
stored, because the device treats the first NUL as the end of the string
(`XtcParser.cpp:163-190`, `333-336`) and a stored NUL would hide the remaining
bytes.

### 7.6 Validation order

`writeXtc` validates in this order so cheap, global failures surface before
expensive frame checks:

1. `pages.length` is between 1 and 65,535.
2. Every chapter is in bounds and ordered, and has a non-empty name.
3. Every page's `pixels` has length 384,000 and only in-range codes.
4. Title/author/chapter names contain no U+0000.

Only then are offsets computed and bytes assembled.

## 8. Error handling

The writer refuses to produce bytes for anything the device would refuse or
misread. It throws `XtcWriteError`, shaped like `OptimizeError`:

```ts
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
}
```

`writeXtc` never partially writes and never returns an invalid container: all
validation happens before assembly, so a thrown error cannot leave a caller
with bytes. There is no recovery path inside the writer; Phase 3 decides how a
failed book or page converts into report entries.

## 9. Testing

All tests are `packages/xtc/test/*.node.test.ts` and run in the existing node
Vitest project (the project include list and the `@xteink/xtc` aliases are
extended in `vitest.config.ts` and `tsconfig.base.json`). No browser is used.

### 9.1 Hand-computed plane vectors

- XTG: one 8-pixel row `B W B B W W B W` packs to one byte `0x4D`, MSB first.
- XTG row padding: a width that is not a multiple of 8, two rows, asserting
  unused trailing bits are zero and bytes land at `y * ceil(width / 8)`.
- XTH bit split: codes `[3, 2, 1, 0, 3, 2, 1, 0]` down one 8-pixel column pack
  plane 1 to `0xCC` and plane 2 to `0xAA`.
- XTH right-to-left order: two 8-pixel columns with distinct codes prove the
  rightmost screen column occupies the first plane bytes.
- XTH vertical order: 16-pixel columns prove bit 7 of each byte is the topmost
  pixel.
- Packer preconditions: wrong pixel length and `height % 8 !== 0` throw.

### 9.2 Structural byte asserts

Generated books are asserted field by field at their absolute offsets: leading
magic bytes (`58 54 43 00` for XTC, `58 54 43 48` for XTCH, `58 54 47 00` for
XTG, `58 54 48 00` for XTH), version bytes at 0x04-0x05, pageCount at 0x06,
flags at 0x09-0x0B, currentPage zero at 0x0C, offset fields at 0x10/0x18/0x20,
thumbOffset zero, chapterOffset at 0x30, padding zero; title/author NUL
padding; exact `pageTableOffset` and `dataOffset`; every page-table entry's
16 bytes; every page header's 22 bytes including `compression = 0`; and the
exact total file length. Both chapter and chapter-less layouts are covered.

### 9.3 Mirror-reader round trip

Tests include a small reader that copies the parser's arithmetic from the
source cited in Section 4 (chapter count from the gap, 1-based to 0-based
conversion, bounds clamping, per-page header sizing, XTG/XTH decode formulas).
Round-tripping a written book through it must reproduce the title, author,
chapters with original 0-based pages, page count, geometry, and every page's
original pixel codes. This is the non-tautological correctness net: the mirror
is written from the firmware, not from `writer.ts`.

### 9.4 Golden fixtures

`fixtures/golden/` holds committed binary output diffed byte-for-byte:

- `minimal.xtc`: two 1-bit pages (page 0 a solid cover pattern, page 1 a
  deterministic edge-frame pattern), title, author, and two chapters.
- `minimal.xtch`: one 2-bit page and no chapters.

Goldens lock regressions across the whole writer. Their correctness is anchored
by the hand-computed vectors (Section 9.1) and the mirror reader (Section 9.3),
which is what prevents golden diffs from becoming tautologies.

Concrete fixture content, so any test can recompute an expected frame: the
1-bit page 0 is all white (code 1); the 1-bit page 1 is code 0 only on the
one-pixel border `x == 0 || x == 479 || y == 0 || y == 799` and code 1
elsewhere; the 2-bit page is
`code = (Math.floor(x / 40) + Math.floor(y / 40)) % 4` at every pixel. The two
chapters in `minimal.xtc` are `Chapter One` spanning pages 0-0 (0-based) and
`Chapter Two` spanning page 1-1.

### 9.5 Rejection matrix

Each `XtcWriteErrorCode` has at least one test: zero pages, 65,536 pages via an
array of placeholder frames (validated before frame inspection), a pixel array
of the wrong length, out-of-range codes in both modes, a chapter whose
start/end exceeds the page count, a chapter with start after end, an empty
chapter name, and U+0000 in each text field.

### 9.6 Text-boundary vectors

Multi-byte UTF-8 truncation is asserted at every boundary: title exactly 127
bytes, title ending on a partial code point (truncated, not split), author at
63 bytes, chapter name at 80 bytes, and empty title/author producing a
fully zero metadata block.

## 10. Fixtures

`fixtures/golden/` is new and contains only the two committed files above. Page
content in fixtures is produced by tiny deterministic formulas (no RNG) so any
test can recompute an expected frame in a few lines. No fixture depends on
network access or on the simulator.

## 11. Files touched

New:

- `packages/xtc/package.json`
- `packages/xtc/src/types.ts`
- `packages/xtc/src/planes.ts`
- `packages/xtc/src/writer.ts`
- `packages/xtc/src/index.ts`
- `packages/xtc/test/planes.node.test.ts`
- `packages/xtc/test/writer.node.test.ts`
- `packages/xtc/test/mirror.node.test.ts`
- `packages/xtc/test/golden.node.test.ts`
- `fixtures/golden/minimal.xtc`
- `fixtures/golden/minimal.xtch`

Modified:

- `vitest.config.ts`: node-project include for `packages/xtc/test/**/*.node.test.ts`
  and `@xteink/xtc` regex aliases.
- `tsconfig.base.json`: `@xteink/xtc` and `@xteink/xtc/*` path mappings.
- `AGENTS.md`: module-map row for `packages/xtc`.
- The Phase 2 placeholder plan is replaced by the real implementation plan
  after this spec is approved (writing-plans step; not part of this file).

No dependency is added to `package.json`; `packages/xtc` has zero runtime
dependencies by design.

## 12. Phase 2 exit criteria

1. `npm run check`, `npm run lint`, `npm run format`, and `npm run test:node`
   pass from a clean checkout with `packages/xtc` present.
2. `npm test` still passes (the browser projects are untouched but green).
3. The node tests cover every rule in Section 7.3 and every error code in
   Section 8.
4. `writeXtc` output for the golden fixtures is byte-identical to the committed
   files.
5. The mirror reader reproduces every written book's semantics.
6. No tracked `crosspoint-reader/**` file changes and `npm run guard` passes.
7. Phase 3 can consume the package from a Worker with no API changes beyond
   filling `XtcBook` and reading the returned `Uint8Array`.

## 13. Decisions locked by this spec

- Phase 2 is writer plus tests only. UI, pagination, quantization, and
  simulator capture are later phases.
- Inputs are device pixel codes (`0`/`1` for XTC, `0`-`3` for XTCH), never
  luminance; quantization lives in Phase 3.
- The writer emits one geometry, 480x800, and no other.
- Chapter page indices are 0-based in the API and stored 1-based.
- Chapter blocks contain exactly the real records; no sentinel or padding
  record is written, and the block always ends where the page table begins.
- Metadata text truncates at code-point boundaries rather than failing the
  book; embedded U+0000 fails the book.
- The low-level packers require `height % 8 === 0` to stay byte-identical to
  the device's own buffer arithmetic.
