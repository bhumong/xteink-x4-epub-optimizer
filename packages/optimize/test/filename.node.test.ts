import { describe, expect, it } from 'vitest';
import { safeEpubFilename } from '../src/filename.ts';

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
