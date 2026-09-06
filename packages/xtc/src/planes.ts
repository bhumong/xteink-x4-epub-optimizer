import { XtcWriteError } from './types.ts';

function assertDimensions(width: number, height: number): void {
	if (width <= 0 || height <= 0) {
		throw new Error('width and height must be positive');
	}
}

function assertPixelValues(pixels: Uint8Array, max: number): void {
	for (let i = 0; i < pixels.length; i++) {
		if (pixels[i] > max) {
			throw new XtcWriteError(
				'pixel-out-of-range',
				`pixel value ${pixels[i]} at index ${i} exceeds max ${max}`
			);
		}
	}
}

// 1-bit: row-major, 8 px/byte, MSB first. Stored bit equals the pixel code:
// 0 = black ink, 1 = white. Unused trailing bits in each row are zero.
export function packXtg(pixels: Uint8Array, width: number, height: number): Uint8Array {
	assertDimensions(width, height);
	if (pixels.length !== width * height) {
		throw new XtcWriteError(
			'pixels-length-mismatch',
			`pixels array is ${pixels.length} bytes, expected ${width * height}`
		);
	}
	assertPixelValues(pixels, 1);
	const rowBytes = (width + 7) >> 3;
	const out = new Uint8Array(rowBytes * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (pixels[y * width + x] === 1) {
				out[y * rowBytes + (x >> 3)] |= 1 << (7 - (x & 7));
			}
		}
	}
	return out;
}

export function unpackXtg(bitmap: Uint8Array, width: number, height: number): Uint8Array {
	assertDimensions(width, height);
	const rowBytes = (width + 7) >> 3;
	if (bitmap.length !== rowBytes * height) {
		throw new Error(
			`bitmap length ${bitmap.length} does not match ${rowBytes} bytes x ${height} rows`
		);
	}
	const out = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			out[y * width + x] = (bitmap[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
		}
	}
	return out;
}

function assertXthDimensions(width: number, height: number): void {
	assertDimensions(width, height);
	if (height % 8 !== 0) {
		throw new Error('packXth requires height to be a multiple of 8');
	}
}

// 2-bit: two planes, column-major right-to-left, 8 vertical px/byte, MSB first.
// Plane 1 stores the high bit (value >> 1); plane 2 stores the low bit (value & 1).
export function packXth(pixels: Uint8Array, width: number, height: number): Uint8Array {
	assertXthDimensions(width, height);
	if (pixels.length !== width * height) {
		throw new XtcWriteError(
			'pixels-length-mismatch',
			`pixels array is ${pixels.length} bytes, expected ${width * height}`
		);
	}
	assertPixelValues(pixels, 3);
	const colBytes = height / 8;
	const planeSize = width * colBytes;
	const out = new Uint8Array(2 * planeSize);
	for (let x = 0; x < width; x++) {
		const column = width - 1 - x; // rightmost screen column is stored first
		for (let y = 0; y < height; y++) {
			const value = pixels[y * width + x];
			const byteOffset = column * colBytes + (y >> 3);
			const bit = 1 << (7 - (y & 7));
			if (value & 2) {
				out[byteOffset] |= bit;
			}
			if (value & 1) {
				out[planeSize + byteOffset] |= bit;
			}
		}
	}
	return out;
}

export function unpackXth(bitmap: Uint8Array, width: number, height: number): Uint8Array {
	assertXthDimensions(width, height);
	const colBytes = height / 8;
	const planeSize = width * colBytes;
	if (bitmap.length !== 2 * planeSize) {
		throw new Error(`bitmap length ${bitmap.length} does not match two planes of ${planeSize} bytes`);
	}
	const out = new Uint8Array(width * height);
	for (let x = 0; x < width; x++) {
		const column = width - 1 - x;
		for (let y = 0; y < height; y++) {
			const byteOffset = column * colBytes + (y >> 3);
			const bit = 7 - (y & 7);
			const bit1 = (bitmap[byteOffset] >> bit) & 1;
			const bit2 = (bitmap[planeSize + byteOffset] >> bit) & 1;
			out[y * width + x] = (bit1 << 1) | bit2;
		}
	}
	return out;
}
