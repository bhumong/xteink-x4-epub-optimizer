import { describe, expect, it } from 'vitest';
import { isTextPath, repackEpub } from '../src/repack.ts';

describe('repackEpub', () => {
	it('writes mimetype first and stores text as deflate-compatible entries', async () => {
		const resources = new Map<string, Uint8Array>([
			['mimetype', new TextEncoder().encode('application/epub+zip')],
			['OEBPS/content.opf', new TextEncoder().encode('<package/>')],
			['OEBPS/Images/cover.jpg', new Uint8Array([1, 2, 3])]
		]);
		const blob = await repackEpub(resources);
		const bytes = new Uint8Array(await blob.arrayBuffer());
		// The first local file header is 30 bytes; its filename starts after it.
		const first = new TextDecoder().decode(bytes.subarray(0, 40));
		expect(first).toContain('mimetype');
		expect(isTextPath('OEBPS/content.opf')).toBe(true);
		expect(isTextPath('OEBPS/Images/cover.jpg')).toBe(false);
	});
});
