import { packXtg, packXth } from './planes.ts';
import {
	XTC_AUTHOR_OFFSET,
	XTC_AUTHOR_SIZE,
	XTC_CHAPTER_SIZE,
	XTC_FILE_MAGIC,
	XTC_MAX_PAGES,
	XTC_PAGE_HEADER_SIZE,
	XTC_PAGE_MAGIC,
	XTC_PAGE_TABLE_ENTRY_SIZE,
	XTC_PIXEL_MAX,
	XTC_TITLE_OFFSET,
	XTC_TITLE_SIZE,
	XTC_VIEWPORT_HEIGHT,
	XTC_VIEWPORT_WIDTH,
	XtcWriteError,
	type XtcBitmapBook,
	type XtcBook,
	type XtcChapter,
	type XtcMode
} from './types.ts';

function truncateUtf8(text: string | undefined, maxBytes: number): Uint8Array {
	const bytes = new TextEncoder().encode(text ?? '');
	if (bytes.length <= maxBytes) {
		return bytes;
	}
	let end = maxBytes;
	while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
		end--;
	}
	return bytes.slice(0, end);
}

function writeTextField(
	bytes: Uint8Array,
	offset: number,
	text: string | undefined,
	maxBytes: number
): void {
	const content = truncateUtf8(text, maxBytes);
	bytes.set(content, offset);
	bytes[offset + content.length] = 0;
}

function assertNoNul(text: string | undefined, field: string): void {
	if (text?.includes('\u0000')) {
		throw new XtcWriteError('invalid-text', `${field} must not contain U+0000`);
	}
}

interface ValidatedBook {
	mode: XtcMode;
	title?: string;
	author?: string;
	chapters: XtcChapter[];
	count: number;
}

function validateTextAndChapters(
	book: { title?: string; author?: string; chapters?: XtcChapter[] },
	count: number
): { title?: string; author?: string; chapters: XtcChapter[] } {
	const chapters = book.chapters ?? [];
	for (const chapter of chapters) {
		if (chapter.name.length === 0) {
			throw new XtcWriteError('empty-chapter-name', 'chapter names must not be empty');
		}
		if (
			chapter.startPage < 0 ||
			chapter.startPage >= count ||
			chapter.endPage < 0 ||
			chapter.endPage >= count
		) {
			throw new XtcWriteError(
				'chapter-out-of-bounds',
				`chapter "${chapter.name}" pages ${chapter.startPage}..${chapter.endPage} fall outside 0..${count - 1}`
			);
		}
		if (chapter.startPage > chapter.endPage) {
			throw new XtcWriteError('chapter-order', `chapter "${chapter.name}" starts after it ends`);
		}
	}
	assertNoNul(book.title, 'title');
	assertNoNul(book.author, 'author');
	for (const chapter of chapters) {
		assertNoNul(chapter.name, `chapter "${chapter.name}" name`);
	}
	return { title: book.title, author: book.author, chapters };
}

function validateCount(
	pages: unknown[],
	mode: XtcMode,
	book: { title?: string; author?: string; chapters?: XtcChapter[] }
): ValidatedBook {
	const count = pages.length;
	if (count === 0) {
		throw new XtcWriteError('empty-book', 'a book needs at least one page');
	}
	if (count > XTC_MAX_PAGES) {
		throw new XtcWriteError('page-count-overflow', `page count ${count} exceeds ${XTC_MAX_PAGES}`);
	}
	const metadata = validateTextAndChapters(book, count);
	return {
		mode,
		title: metadata.title,
		author: metadata.author,
		chapters: metadata.chapters,
		count
	};
}

function bitmapBytes(mode: XtcMode): number {
	if (mode === 'xtc') {
		return Math.ceil(XTC_VIEWPORT_WIDTH / 8) * XTC_VIEWPORT_HEIGHT;
	}
	return Math.ceil((XTC_VIEWPORT_WIDTH * XTC_VIEWPORT_HEIGHT) / 8) * 2;
}

function assemble(
	mode: XtcMode,
	metadata: { title?: string; author?: string; chapters: XtcChapter[] },
	bitmaps: Uint8Array[],
	count: number
): Uint8Array {
	const metadataEnd = XTC_AUTHOR_OFFSET + XTC_AUTHOR_SIZE; // 0xF8
	const hasChapters = metadata.chapters.length > 0;
	const chapterOffset = hasChapters ? metadataEnd : 0;
	const pageTableOffset =
		metadataEnd + (hasChapters ? metadata.chapters.length * XTC_CHAPTER_SIZE : 0);
	const bitmap = bitmapBytes(mode);
	const pageRecordBytes = XTC_PAGE_HEADER_SIZE + bitmap;
	const dataOffset = pageTableOffset + count * XTC_PAGE_TABLE_ENTRY_SIZE;
	const total = dataOffset + count * pageRecordBytes;

	const out = new Uint8Array(total);
	const view = new DataView(out.buffer);
	const putU16 = (offset: number, value: number) => view.setUint16(offset, value, true);
	const putU32 = (offset: number, value: number) => view.setUint32(offset, value, true);
	const putU64 = (offset: number, value: number) => view.setBigUint64(offset, BigInt(value), true);

	putU32(0, XTC_FILE_MAGIC[mode]);
	out[4] = 1;
	out[5] = 0;
	putU16(6, count);
	out[8] = 0;
	out[9] = 1;
	out[10] = 0;
	out[11] = hasChapters ? 1 : 0;
	putU32(0x0c, 0);
	putU64(0x10, XTC_TITLE_OFFSET);
	putU64(0x18, pageTableOffset);
	putU64(0x20, dataOffset);
	putU64(0x28, 0);
	putU32(0x30, chapterOffset);
	putU32(0x34, 0);

	writeTextField(out, XTC_TITLE_OFFSET, metadata.title, XTC_TITLE_SIZE - 1);
	writeTextField(out, XTC_AUTHOR_OFFSET, metadata.author, XTC_AUTHOR_SIZE - 1);

	for (let i = 0; i < metadata.chapters.length; i++) {
		const recordOffset = metadataEnd + i * XTC_CHAPTER_SIZE;
		out.set(truncateUtf8(metadata.chapters[i].name, 80), recordOffset);
		putU16(recordOffset + 0x50, metadata.chapters[i].startPage + 1);
		putU16(recordOffset + 0x52, metadata.chapters[i].endPage + 1);
	}

	for (let i = 0; i < count; i++) {
		const entryOffset = pageTableOffset + i * XTC_PAGE_TABLE_ENTRY_SIZE;
		const pageOffset = dataOffset + i * pageRecordBytes;
		putU64(entryOffset, pageOffset);
		putU32(entryOffset + 8, pageRecordBytes);
		putU16(entryOffset + 12, XTC_VIEWPORT_WIDTH);
		putU16(entryOffset + 14, XTC_VIEWPORT_HEIGHT);

		putU32(pageOffset, XTC_PAGE_MAGIC[mode]);
		putU16(pageOffset + 4, XTC_VIEWPORT_WIDTH);
		putU16(pageOffset + 6, XTC_VIEWPORT_HEIGHT);
		out[pageOffset + 8] = 0;
		out[pageOffset + 9] = 0;
		putU32(pageOffset + 10, bitmap);
		out.set(bitmaps[i], pageOffset + XTC_PAGE_HEADER_SIZE);
	}

	return out;
}

export function writeXtc(book: XtcBook): Uint8Array {
	const { mode, title, author, chapters, count } = validateCount(book.pages, book.mode, book);
	const frameLength = XTC_VIEWPORT_WIDTH * XTC_VIEWPORT_HEIGHT;
	const pixelMax = XTC_PIXEL_MAX[mode];
	const bitmaps = book.pages.map((page, index) => {
		if (page.pixels.length !== frameLength) {
			throw new XtcWriteError(
				'pixels-length-mismatch',
				`page ${index} pixels are ${page.pixels.length} bytes, expected ${frameLength}`
			);
		}
		for (let i = 0; i < page.pixels.length; i++) {
			if (page.pixels[i] > pixelMax) {
				throw new XtcWriteError(
					'pixel-out-of-range',
					`page ${index} pixel value ${page.pixels[i]} at index ${i} exceeds max ${pixelMax}`
				);
			}
		}
		return mode === 'xtc'
			? packXtg(page.pixels, XTC_VIEWPORT_WIDTH, XTC_VIEWPORT_HEIGHT)
			: packXth(page.pixels, XTC_VIEWPORT_WIDTH, XTC_VIEWPORT_HEIGHT);
	});
	return assemble(mode, { title, author, chapters }, bitmaps, count);
}

export function writeXtcFromBitmaps(book: XtcBitmapBook): Uint8Array {
	const { mode, title, author, chapters, count } = validateCount(book.pages, book.mode, book);
	const expected = bitmapBytes(mode);
	const bitmaps = book.pages.map((page, index) => {
		if (page.bitmap.length !== expected) {
			throw new XtcWriteError(
				'pixels-length-mismatch',
				`page ${index} bitmap is ${page.bitmap.length} bytes, expected ${expected}`
			);
		}
		return page.bitmap;
	});
	return assemble(mode, { title, author, chapters }, bitmaps, count);
}
