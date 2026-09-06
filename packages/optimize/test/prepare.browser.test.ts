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
