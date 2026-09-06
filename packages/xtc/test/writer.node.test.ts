import { describe, expect, it } from 'vitest';
import { writeXtc } from '../src/index.ts';
import { packXtg } from '../src/planes.ts';
import { XtcWriteError, type XtcBook, type XtcWriteErrorCode } from '../src/types.ts';
import { minimalXtcBook, minimalXtchBook, onePageXtcBook } from './book.ts';
import { borderFrame, bytesEqual, makeFrame, pageFrame, whiteFrame } from './frame.ts';

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
		const frames = [whiteFrame(), borderFrame()];
		const pages = frames.map(pageFrame);
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
					packXtg(frames[i], 480, 800)
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
		const book: XtcBook = { mode: 'xtc', title: 'é'.repeat(70), pages: [pageFrame(whiteFrame())] };
		const bytes = writeXtc(book);
		const stored = bytes.subarray(0x38, 0x38 + 127);
		const expected = new TextEncoder().encode('é'.repeat(63));
		expect(bytesEqual(stored.subarray(0, 126), expected)).toBe(true);
		expect(stored[126]).toBe(0);
	});

	it('truncates an author at a code-point boundary', () => {
		const book: XtcBook = { mode: 'xtc', author: 'é'.repeat(32), pages: [pageFrame(whiteFrame())] };
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
			pages: [pageFrame(whiteFrame())]
		};
		const bytes = writeXtc(book);
		const name = bytes.subarray(248, 248 + 80);
		expect(bytesEqual(name.subarray(0, 80), new TextEncoder().encode('é'.repeat(40)))).toBe(true);
	});

	it('zero-fills the metadata block when title and author are absent', () => {
		const bytes = writeXtc({ mode: 'xtc', pages: [pageFrame(whiteFrame())] });
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
		const xtc = pageFrame(whiteFrame());
		xtc.pixels[0] = 2;
		expectCode(() => writeXtc({ mode: 'xtc', pages: [xtc] }), 'pixel-out-of-range');
		const xtch = pageFrame(makeFrame((x, y) => (x + y) % 3));
		xtch.pixels[0] = 4;
		expectCode(() => writeXtc({ mode: 'xtch', pages: [xtch] }), 'pixel-out-of-range');
	});

	it('refuses chapters that are out of bounds or misordered', () => {
		expectCode(
			() =>
				writeXtc({
					mode: 'xtc',
					chapters: [{ name: 'X', startPage: 2, endPage: 2 }],
					pages: [pageFrame(whiteFrame()), pageFrame(whiteFrame())]
				}),
			'chapter-out-of-bounds'
		);
		expectCode(
			() =>
				writeXtc({
					mode: 'xtc',
					chapters: [{ name: 'X', startPage: 1, endPage: 0 }],
					pages: [pageFrame(whiteFrame()), pageFrame(whiteFrame())]
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
					pages: [pageFrame(whiteFrame())]
				}),
			'empty-chapter-name'
		);
	});

	it('refuses U+0000 in title, author, and chapter names', () => {
		const frame = pageFrame(whiteFrame());
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
