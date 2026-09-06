import { describe, expect, it } from 'vitest';
import { BAYER_4, blankPageBitmap, lumaOf, quantize1bit, quantize2bit } from '../src/quantize.ts';

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
		// +/- 31 on a 2x2 checker keeps every pixel inside its band and makes
		// every 16px tile classify as text (variance 961 > TEXT_VARIANCE).
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
