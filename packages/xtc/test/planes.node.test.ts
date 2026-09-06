import { describe, expect, it } from 'vitest';
import { packXtg, unpackXtg } from '../src/planes.ts';
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
