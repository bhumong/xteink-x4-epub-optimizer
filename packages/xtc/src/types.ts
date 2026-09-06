export const XTC_VIEWPORT_WIDTH = 480;
export const XTC_VIEWPORT_HEIGHT = 800;

export type XtcMode = 'xtc' | 'xtch';

export interface XtcPage {
	pixels: Uint8Array; // XTC_VIEWPORT_WIDTH * XTC_VIEWPORT_HEIGHT device codes
}

export interface XtcChapter {
	name: string; // non-empty, no U+0000; truncated to 80 UTF-8 bytes at a code-point boundary
	startPage: number; // 0-based, inclusive
	endPage: number; // 0-based, inclusive, >= startPage
}

export interface XtcBook {
	mode: XtcMode;
	title?: string; // no U+0000; truncated to 127 UTF-8 bytes at a code-point boundary
	author?: string; // no U+0000; truncated to 63 UTF-8 bytes at a code-point boundary
	chapters?: XtcChapter[]; // [] or undefined means no chapter block
	pages: XtcPage[]; // 1..65535 pages
}

export type XtcWriteErrorCode =
	| 'empty-book'
	| 'page-count-overflow'
	| 'pixels-length-mismatch'
	| 'pixel-out-of-range'
	| 'chapter-out-of-bounds'
	| 'chapter-order'
	| 'empty-chapter-name'
	| 'invalid-text'; // U+0000 in title, author, or chapter name

export class XtcWriteError extends Error {
	readonly code: XtcWriteErrorCode;

	constructor(code: XtcWriteErrorCode, message: string) {
		super(message);
		this.name = 'XtcWriteError';
		this.code = code;
	}
}

// Container layout constants (bytes), all little-endian in the file.
export const XTC_HEADER_SIZE = 56;
export const XTC_TITLE_OFFSET = 0x38;
export const XTC_TITLE_SIZE = 128;
export const XTC_AUTHOR_OFFSET = 0xb8;
export const XTC_AUTHOR_SIZE = 64;
export const XTC_CHAPTER_SIZE = 96;
export const XTC_PAGE_TABLE_ENTRY_SIZE = 16;
export const XTC_PAGE_HEADER_SIZE = 22;
export const XTC_MAX_PAGES = 0xffff;

export const XTC_FILE_MAGIC: Record<XtcMode, number> = {
	xtc: 0x00435458, // "XTC\0"
	xtch: 0x48435458 // "XTCH"
};

export const XTC_PAGE_MAGIC: Record<XtcMode, number> = {
	xtc: 0x00475458, // "XTG\0"
	xtch: 0x00485458 // "XTH\0"
};

export const XTC_PIXEL_MAX: Record<XtcMode, number> = {
	xtc: 1,
	xtch: 3
};

export interface XtcBitmapPage {
	bitmap: Uint8Array; // device-order packed bytes
}

export interface XtcBitmapBook {
	mode: XtcMode;
	title?: string;
	author?: string;
	chapters?: XtcChapter[];
	pages: XtcBitmapPage[];
}
