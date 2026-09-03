import { describe, expect, it } from 'vitest';
import {
	decodeHref,
	fileExtension,
	joinZipPath,
	opfDirectoryPath,
	relativeZipPath
} from '@xteink/optimize/paths.ts';

describe('opfDirectoryPath', () => {
	it('returns the trailing-slash directory of a nested OPF', () => {
		expect(opfDirectoryPath('OEBPS/content.opf')).toBe('OEBPS/');
	});
	it('returns empty string for a root-level OPF', () => {
		expect(opfDirectoryPath('content.opf')).toBe('');
	});
});

describe('joinZipPath', () => {
	it('resolves a relative href against the OPF directory', () => {
		expect(joinZipPath('OEBPS/', 'Text/ch1.xhtml')).toBe('OEBPS/Text/ch1.xhtml');
	});
	it('collapses dot-dot segments', () => {
		expect(joinZipPath('OEBPS/Text/', '../Images/cover.jpg')).toBe('OEBPS/Images/cover.jpg');
	});
	it('strips fragments and query strings', () => {
		expect(joinZipPath('OEBPS/', 'Text/ch1.xhtml#sec2')).toBe('OEBPS/Text/ch1.xhtml');
	});
	it('treats a leading slash as container-root-relative, not absolute-on-disk', () => {
		expect(joinZipPath('OEBPS/', '/Images/cover.jpg')).toBe('Images/cover.jpg');
	});
	it('percent-decodes before resolving', () => {
		expect(joinZipPath('OEBPS/', 'Text/my%20ch.xhtml')).toBe('OEBPS/Text/my ch.xhtml');
	});
});

describe('relativeZipPath', () => {
	it('walks up out of a nested directory', () => {
		expect(relativeZipPath('OEBPS/Text/ch1.xhtml', 'OEBPS/Images/cover.jpg')).toBe(
			'../Images/cover.jpg'
		);
	});
	it('stays in place for a sibling', () => {
		expect(relativeZipPath('OEBPS/Text/ch1.xhtml', 'OEBPS/Text/style.css')).toBe('style.css');
	});
	it('handles a root target from a nested source', () => {
		expect(relativeZipPath('OEBPS/Text/ch1.xhtml', 'Images/cover.jpg')).toBe(
			'../../Images/cover.jpg'
		);
	});
});

describe('decodeHref', () => {
	it('decodes a valid escape', () => {
		expect(decodeHref('my%20ch.xhtml')).toBe('my ch.xhtml');
	});
	it('returns the input unchanged for a malformed escape', () => {
		expect(decodeHref('100%zz.xhtml')).toBe('100%zz.xhtml');
	});
});

describe('fileExtension', () => {
	it('lowercases the extension', () => {
		expect(fileExtension('OEBPS/Images/Cover.JPEG')).toBe('jpeg');
	});
	it('returns empty string when there is no extension', () => {
		expect(fileExtension('OEBPS/Text/noext')).toBe('');
	});
});
