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
