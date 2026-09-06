import { describe, expect, it } from 'vitest';
import { normalizeOpfDocument, normalizeXhtmlDocument } from '../src/normalize.ts';
import { DEFENSIVE_CSS } from '../src/css.ts';

describe('normalizeXhtmlDocument', () => {
	it('removes scripts, handlers, @font-face, and rewrites renamed images', () => {
		const input = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink"><head><script>alert(1)</script><style>@font-face{font-family:X;src:url(font.ttf)}</style></head><body onclick="alert(2)"><img src="Images/old.png"/></body></html>`;
		const map = new Map([['OEBPS/Images/old.png', 'OEBPS/Images/old.jpg']]);
		const result = normalizeXhtmlDocument(input, 'OEBPS/ch1.xhtml', map);
		expect(result.html).not.toContain('<script');
		expect(result.html).not.toContain('onclick');
		expect(result.html).not.toContain('@font-face');
		expect(result.html).toContain('src="Images/old.jpg"');
		expect(result.html).toContain(DEFENSIVE_CSS);
		expect(result.removedScripts).toBe(1);
		expect(result.removedFontFaces).toBe(1);
	});

	it('unwraps SVG image wrappers', () => {
		const input =
			'<html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink"><body><svg width="480" height="800"><image xlink:href="cover.png"/></svg></body></html>';
		const result = normalizeXhtmlDocument(input, 'OEBPS/cover.xhtml', new Map());
		expect(result.html).not.toContain('<svg');
		expect(result.html).toContain('<img');
		expect(result.svgImages).toBe(1);
	});
});

describe('normalizeOpfDocument', () => {
	it('rewrites image hrefs and removes fonts', () => {
		const opf =
			'<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest><item id="i" href="Images/a.png" media-type="image/png"/><item id="f" href="font.ttf" media-type="application/vnd.ms-opentype"/></manifest><spine/></package>';
		const map = new Map([['OEBPS/Images/a.png', 'OEBPS/Images/a.jpg']]);
		const out = normalizeOpfDocument(opf, 'OEBPS/', map, new Set(['OEBPS/font.ttf']));
		expect(out).toContain('Images/a.jpg');
		expect(out).toContain('image/jpeg');
		expect(out).not.toContain('font.ttf');
	});
});
