import { describe, expect, it } from 'vitest';
import { packXth, packXtg, unpackXth, unpackXtg } from '../src/planes.ts';
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
