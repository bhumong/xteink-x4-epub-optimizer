import { describe, expect, it } from 'vitest';
import {
	bytesToDataUrl,
	mimeTypeForPath,
	remapBodySelectors,
	rewriteCssUrls
} from '../src/css-inline.ts';

describe('mimeTypeForPath', () => {
	it('maps raster extensions to media types', () => {
		expect(mimeTypeForPath('a.jpg')).toBe('image/jpeg');
		expect(mimeTypeForPath('a.png')).toBe('image/png');
		expect(mimeTypeForPath('a.webp')).toBe('image/webp');
		expect(mimeTypeForPath('a.gif')).toBe('image/gif');
		expect(mimeTypeForPath('a.bmp')).toBe('image/bmp');
	});

	it('returns undefined for non-raster resources', () => {
		expect(mimeTypeForPath('a.svg')).toBeUndefined();
		expect(mimeTypeForPath('a.ttf')).toBeUndefined();
	});
});

describe('bytesToDataUrl', () => {
	it('base64-encodes small buffers', () => {
		expect(bytesToDataUrl(new TextEncoder().encode('abc'), 'image/png')).toBe(
			'data:image/png;base64,YWJj'
		);
	});
});

describe('rewriteCssUrls', () => {
	it('inlines raster url() references relative to the stylesheet', () => {
		const css = "p { background: url('img/leaf.png') } q { background: url(leaf.jpg) }";
		const resources = new Map<string, Uint8Array>([
			['OEBPS/css/img/leaf.png', new Uint8Array([1, 2, 3])],
			['OEBPS/css/leaf.jpg', new Uint8Array([4, 5])]
		]);
		const result = rewriteCssUrls(css, 'OEBPS/css/book.css', resources);
		expect(result.css).toContain('data:image/png;base64,AQID');
		expect(result.css).toContain('data:image/jpeg;base64,BAU=');
		expect(result.inlined).toEqual(['img/leaf.png', 'leaf.jpg']);
		expect(result.dropped).toEqual([]);
	});

	it('leaves missing and non-raster references alone and records them', () => {
		const css = 'a { background: url(missing.png) } b { background: url(icon.svg) }';
		const result = rewriteCssUrls(css, 'OEBPS/css/book.css', new Map());
		expect(result.css).toBe(css);
		expect(result.dropped).toEqual(['missing.png', 'icon.svg']);
	});
});

describe('remapBodySelectors', () => {
	it('rewrites body selectors to .xtc-body', () => {
		expect(remapBodySelectors('body { font-size: 20px } p, body > p { color: red }')).toBe(
			'.xtc-body { font-size: 20px } p, .xtc-body > p { color: red }'
		);
	});

	it('does not touch body words inside strings or selectors like embedding', () => {
		expect(remapBodySelectors("body::after { content: 'body' }")).toBe(
			".xtc-body::after { content: 'body' }"
		);
	});
});
