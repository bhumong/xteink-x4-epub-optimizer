import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { writeXtc, type XtcBook } from '../src/index.ts';
import { minimalXtcBook, minimalXtchBook } from './book.ts';
import { borderFrame, bytesEqual, makeFrame, whiteFrame } from './frame.ts';
import { mirrorBook } from './mirror.ts';

const goldenDir = new URL('../../../fixtures/golden/', import.meta.url);

function regenerate(name: string, book: XtcBook): void {
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
