import { describe, expect, it } from 'vitest';
import { baseName, formatBytes } from './format.ts';

describe('formatBytes', () => {
	it('uses bytes under 1 KiB', () => {
		expect(formatBytes(512)).toBe('512 B');
	});
	it('uses KiB with one decimal', () => {
		expect(formatBytes(1536)).toBe('1.5 KiB');
	});
	it('uses MiB with one decimal', () => {
		expect(formatBytes(19 * 1024 * 1024)).toBe('19.0 MiB');
	});
	it('handles zero', () => {
		expect(formatBytes(0)).toBe('0 B');
	});
});

describe('baseName', () => {
	it('strips directories', () => {
		expect(baseName('OEBPS/Text/ch1.xhtml')).toBe('ch1.xhtml');
	});
	it('returns the input when there is no separator', () => {
		expect(baseName('book.epub')).toBe('book.epub');
	});
});
