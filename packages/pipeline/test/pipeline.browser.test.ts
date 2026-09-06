import { describe, expect, it } from 'vitest';
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
		expect(result.report.pageCount).toBe(1);
		expect(result.fileName.endsWith('.xtch')).toBe(true);
		expect(result.blob.size).toBeGreaterThan(96000);
	});

	it('paginates the long fixture to its measured page count', async () => {
		const result = await convert('long', 'xtc');
		expect(result.report.pageCount).toBe(107);
		expect(result.report.chapterCount).toBe(1);
	}, 120000);

	it('synthesizes a cover page 0 and starts chapters after it', async () => {
		const result = await convert('cover', 'xtc');
		expect(result.report.pageCount).toBe(2);
		expect(result.report.chapterCount).toBe(1);
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
