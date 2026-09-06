import { XTC_VIEWPORT_HEIGHT, XTC_VIEWPORT_WIDTH } from '../src/types.ts';

export interface MirrorChapter {
	name: string;
	startPage: number; // 0-based after mirroring the parser's decrement
	endPage: number;
}

export interface MirrorPage {
	width: number;
	height: number;
	pixels: Uint8Array; // decoded device codes
}

export interface MirrorBook {
	pageCount: number;
	title: string;
	author: string;
	chapters: MirrorChapter[];
	pages: MirrorPage[];
}

function u16(bytes: Uint8Array, offset: number): number {
	return new DataView(bytes.buffer).getUint16(offset, true);
}

function u32(bytes: Uint8Array, offset: number): number {
	return new DataView(bytes.buffer).getUint32(offset, true);
}

function u64(bytes: Uint8Array, offset: number): number {
	return Number(new DataView(bytes.buffer).getBigUint64(offset, true));
}

function text(bytes: Uint8Array, offset: number, maxBytes: number): string {
	let end = offset;
	while (end < offset + maxBytes && bytes[end] !== 0) {
		end++;
	}
	return new TextDecoder().decode(bytes.subarray(offset, end));
}

// Mirrors XtcParser::readChapters: records live in the gap before the page table,
// count = (pageTableOffset - chapterOffset) / 96, and start/end are stored 1-based.
export function mirrorChapters(bytes: Uint8Array): MirrorChapter[] {
	if (bytes[11] !== 1) {
		return [];
	}
	const pageCount = u16(bytes, 6);
	const chapterOffset = u32(bytes, 0x30);
	if (chapterOffset === 0 || chapterOffset >= bytes.length || chapterOffset + 96 > bytes.length) {
		return [];
	}
	let maxOffset = bytes.length;
	const pageTableOffset = u64(bytes, 0x18);
	if (pageTableOffset > chapterOffset && pageTableOffset <= bytes.length) {
		maxOffset = pageTableOffset;
	} else if (u64(bytes, 0x20) > chapterOffset && u64(bytes, 0x20) <= bytes.length) {
		maxOffset = u64(bytes, 0x20);
	}
	const count = Math.floor((maxOffset - chapterOffset) / 96);
	const chapters: MirrorChapter[] = [];
	for (let i = 0; i < count; i++) {
		const record = chapterOffset + i * 96;
		const name = text(bytes, record, 80);
		let start = u16(bytes, record + 0x50);
		let end = u16(bytes, record + 0x52);
		if (name === '' && start === 0 && end === 0) {
			break;
		}
		if (start > 0) {
			start--;
		}
		if (end > 0) {
			end--;
		}
		if (start >= pageCount) {
			continue;
		}
		if (end >= pageCount) {
			end = pageCount - 1;
		}
		if (start > end) {
			continue;
		}
		chapters.push({ name, startPage: start, endPage: end });
	}
	return chapters;
}

function decodeXtg(bitmap: Uint8Array, width: number, height: number): Uint8Array {
	const rowBytes = (width + 7) >> 3;
	const out = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const byte = bitmap[y * rowBytes + (x >> 3)];
			out[y * width + x] = (byte >> (7 - (x & 7))) & 1;
		}
	}
	return out;
}

function decodeXth(bitmap: Uint8Array, width: number, height: number): Uint8Array {
	const colBytes = height / 8;
	const planeSize = width * colBytes;
	const out = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const column = width - 1 - x;
			const byteOffset = column * colBytes + (y >> 3);
			const bit = 7 - (y & 7);
			const bit1 = (bitmap[byteOffset] >> bit) & 1;
			const bit2 = (bitmap[planeSize + byteOffset] >> bit) & 1;
			out[y * width + x] = (bit1 << 1) | bit2;
		}
	}
	return out;
}

export function mirrorBook(bytes: Uint8Array): MirrorBook {
	const pageCount = u16(bytes, 6);
	const title = text(bytes, 0x38, 128);
	const author = text(bytes, 0xb8, 64);
	const pageTableOffset = u64(bytes, 0x18);
	// File magic is little-endian: XTCH bytes are 58 54 43 48, so byte 3 is 0x48
	// only for the 2-bit container (XTC has 0x00 there).
	const bitDepth = bytes[3] === 0x48 ? 2 : 1;
	const pages: MirrorPage[] = [];
	for (let i = 0; i < pageCount; i++) {
		const entry = pageTableOffset + i * 16;
		const pageOffset = u64(bytes, entry);
		const width = u16(bytes, pageOffset + 4);
		const height = u16(bytes, pageOffset + 6);
		const bitmap =
			bitDepth === 1
				? bytes.subarray(pageOffset + 22, pageOffset + 22 + Math.ceil(width / 8) * height)
				: bytes.subarray(pageOffset + 22, pageOffset + 22 + Math.ceil((width * height) / 8) * 2);
		const pixels =
			bitDepth === 1 ? decodeXtg(bitmap, width, height) : decodeXth(bitmap, width, height);
		pages.push({ width, height, pixels });
	}
	return {
		pageCount,
		title,
		author,
		chapters: mirrorChapters(bytes),
		pages
	};
}

export function expectMirrorGeometry(mirror: MirrorBook): void {
	for (const page of mirror.pages) {
		if (page.width !== XTC_VIEWPORT_WIDTH || page.height !== XTC_VIEWPORT_HEIGHT) {
			throw new Error(`unexpected page geometry ${page.width}x${page.height}`);
		}
	}
}
