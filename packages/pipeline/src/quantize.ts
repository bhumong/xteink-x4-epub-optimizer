import type { XtcMode } from '@xteink/xtc';

export const LUMA_R = 77;
export const LUMA_G = 150;
export const LUMA_B = 29;
export const TILE_SIZE = 16;
export const TEXT_VARIANCE = 900;
export const TEXT_BLACK_LUMA = 160;
export const DITHER_BLACK_LUMA = 128;
export const TWO_BIT_BANDS = [64, 128, 192] as const;
export const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

export function lumaOf(r: number, g: number, b: number): number {
	return (r * LUMA_R + g * LUMA_G + b * LUMA_B + 128) >> 8;
}

function lumaMap(rgba: Uint8Array, width: number, height: number): Uint8Array {
	const luma = new Uint8Array(width * height);
	for (let i = 0; i < width * height; i++) {
		const offset = i * 4;
		luma[i] = lumaOf(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
	}
	return luma;
}

function tileVariance(
	luma: Uint8Array,
	width: number,
	height: number,
	tileX: number,
	tileY: number
): number {
	const x0 = tileX * TILE_SIZE;
	const y0 = tileY * TILE_SIZE;
	let sum = 0;
	let sumSquares = 0;
	let count = 0;
	const xEnd = Math.min(x0 + TILE_SIZE, width);
	const yEnd = Math.min(y0 + TILE_SIZE, height);
	for (let y = y0; y < yEnd; y++) {
		for (let x = x0; x < xEnd; x++) {
			const value = luma[y * width + x];
			sum += value;
			sumSquares += value * value;
			count++;
		}
	}
	if (count === 0) return 0;
	const mean = sum / count;
	return sumSquares / count - mean * mean;
}

function classifyTextTiles(luma: Uint8Array, width: number, height: number): boolean[] {
	const tileColumns = Math.ceil(width / TILE_SIZE);
	const tileRows = Math.ceil(height / TILE_SIZE);
	const tiles = new Array<boolean>(tileColumns * tileRows);
	for (let ty = 0; ty < tileRows; ty++) {
		for (let tx = 0; tx < tileColumns; tx++) {
			tiles[ty * tileColumns + tx] = tileVariance(luma, width, height, tx, ty) > TEXT_VARIANCE;
		}
	}
	return tiles;
}

function bayerOffset(x: number, y: number): number {
	// Symmetric range -120..120: a full +/-128 swing would dither specks into
	// solid white (255-128 < 128) or drop ink from solid black (0+128 >= 128).
	return BAYER_4[(y & 3) * 4 + (x & 3)] * 16 - 120;
}

function bandCode(value: number): number {
	if (value < TWO_BIT_BANDS[0]) return 3;
	if (value < TWO_BIT_BANDS[1]) return 1;
	if (value < TWO_BIT_BANDS[2]) return 2;
	return 0;
}

export function quantize1bit(rgba: Uint8Array, width: number, height: number): Uint8Array {
	const luma = lumaMap(rgba, width, height);
	const tiles = classifyTextTiles(luma, width, height);
	const tileColumns = Math.ceil(width / TILE_SIZE);
	const codes = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const isText = tiles[Math.floor(y / TILE_SIZE) * tileColumns + Math.floor(x / TILE_SIZE)];
			const value = luma[y * width + x];
			let code: number;
			if (isText) {
				code = value < TEXT_BLACK_LUMA ? 0 : 1;
			} else {
				code = value + bayerOffset(x, y) < DITHER_BLACK_LUMA ? 0 : 1;
			}
			codes[y * width + x] = code;
		}
	}
	return codes;
}

export function quantize2bit(rgba: Uint8Array, width: number, height: number): Uint8Array {
	const luma = lumaMap(rgba, width, height);
	const tiles = classifyTextTiles(luma, width, height);
	const tileColumns = Math.ceil(width / TILE_SIZE);
	const codes = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const isText = tiles[Math.floor(y / TILE_SIZE) * tileColumns + Math.floor(x / TILE_SIZE)];
			const value = luma[y * width + x];
			const adjusted = isText ? value : Math.max(0, Math.min(255, value + bayerOffset(x, y)));
			codes[y * width + x] = bandCode(adjusted);
		}
	}
	return codes;
}

export function blankPageBitmap(mode: XtcMode): Uint8Array {
	if (mode === 'xtc') {
		return new Uint8Array(48000).fill(0xff);
	}
	return new Uint8Array(96000);
}
