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
