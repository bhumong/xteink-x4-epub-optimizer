import { describe, expect, it } from 'vitest';
import { safeEpubFilename, safeOutputFilename } from '../src/filename.ts';

describe('safeEpubFilename', () => {
	it('uses title and author when rename is enabled', () => {
		expect(safeEpubFilename('A Book', 'An Author', 'old.epub', true)).toBe(
			'A Book - An Author.epub'
		);
	});
	it('keeps source name when rename is disabled', () => {
		expect(safeEpubFilename('A Book', 'An Author', 'old.epub', false)).toBe('old.epub');
	});
	it('removes filesystem-hostile characters', () => {
		expect(safeEpubFilename('A: B', '', 'old.epub', true)).toBe('A B.epub');
	});
});

describe('safeOutputFilename', () => {
	it('ends in the requested extension when renaming from metadata', () => {
		expect(safeOutputFilename('Title', 'Author', 'book.epub', true, '.xtc')).toBe(
			'Title - Author.xtc'
		);
		expect(safeOutputFilename('Title', 'Author', 'book.epub', true, '.xtch')).toBe(
			'Title - Author.xtch'
		);
	});

	it('swaps the source extension when not renaming', () => {
		expect(safeOutputFilename('Title', 'Author', 'book.epub', false, '.xtc')).toBe('book.xtc');
		expect(safeOutputFilename('', '', 'nested.name.epub', false, '.xtch')).toBe('nested.name.xtch');
	});

	it('falls back to the source stem when metadata is unusable', () => {
		expect(safeOutputFilename('', '', 'book.epub', true, '.xtc')).toBe('book.xtc');
		expect(safeOutputFilename('', 'AuthorOnly', 'book.epub', true, '.xtc')).toBe('book.xtc');
	});

	it('keeps EPUB delegation byte-identical to the old helper', () => {
		expect(safeEpubFilename('Title', 'Author', 'book.epub', true)).toBe('Title - Author.epub');
		expect(safeEpubFilename('', '', 'book.epub', false)).toBe('book.epub');
		expect(safeEpubFilename('', '', 'book.epub', true)).toBe('book.epub');
	});
});
