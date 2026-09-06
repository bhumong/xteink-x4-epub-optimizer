import { describe, expect, it } from 'vitest';
import { isRasterMediaType, optimizeRasterImage } from '../src/images.ts';
import { VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from '../src/types.ts';

async function makePng(width: number, height: number): Promise<Uint8Array> {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = '#777777';
	ctx.fillRect(0, 0, width, height);
	const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
	return new Uint8Array(await blob.arrayBuffer());
}

describe('image conversion', () => {
	it('downscales a large PNG to fit 480x800 and returns a JPEG', async () => {
		const result = await optimizeRasterImage(await makePng(960, 1600), 85);
		expect(result.width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
		expect(result.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
		const header = result.data.subarray(0, 2);
		expect([...header]).toEqual([0xff, 0xd8]);
	});

	it('classifies raster media types', () => {
		expect(isRasterMediaType('image/png')).toBe(true);
		expect(isRasterMediaType('image/svg+xml')).toBe(false);
	});
});
