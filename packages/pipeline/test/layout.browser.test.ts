import { describe, expect, it } from 'vitest';
import {
	buildSelfContainedHtml,
	columnSource,
	disposePager,
	measureColumnCount
} from '../src/layout.ts';

function textDocument(paragraphs: number): string {
	const body = Array.from(
		{ length: paragraphs },
		(_, i) => `<p>Paragraph ${i + 1}: ${'content '.repeat(80)}</p>`
	).join('');
	return `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Probe Book</title></head><body>${body}</body></html>`;
}

describe('buildSelfContainedHtml', () => {
	it('embeds stylesheets and raster images as data URLs', () => {
		const resources = new Map<string, Uint8Array>([
			['OEBPS/css/book.css', new TextEncoder().encode('body { color: #123456 }')],
			['OEBPS/images/pic.png', new Uint8Array([1, 2, 3])]
		]);
		const html =
			'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head>' +
			'<title>Styled</title><link rel="stylesheet" href="css/book.css"/></head>' +
			'<body><p>Hello <img src="images/pic.png" alt="p"/></p></body></html>';
		const built = buildSelfContainedHtml(html, 'OEBPS/ch1.xhtml', resources);
		expect(built.title).toBe('Styled');
		expect(built.fragment).toContain('.xtc-body { color: #123456 }');
		expect(built.fragment).toContain('data:image/png;base64,AQID');
		expect(built.fragment).not.toContain('href=');
		expect(built.fragment).not.toContain('src="images/');
		disposePager();
	});

	it('returns an empty fragment and a stem title when parsing fails', () => {
		const built = buildSelfContainedHtml('not xml at all', 'OEBPS/ch9.xhtml', new Map());
		expect(built.fragment).toBe('');
		expect(built.title).toBe('ch9');
		expect(built.warnings.length).toBeGreaterThan(0);
	});
});

describe('measureColumnCount', () => {
	it('returns 1 for a short document', () => {
		const built = buildSelfContainedHtml(textDocument(1), 'OEBPS/ch1.xhtml', new Map());
		expect(measureColumnCount(built.fragment, 1)).toBe(1);
		disposePager();
	});

	it('returns more than 1 for a long document', () => {
		const built = buildSelfContainedHtml(textDocument(80), 'OEBPS/ch1.xhtml', new Map());
		const pages = measureColumnCount(built.fragment, 8);
		expect(pages).toBeGreaterThan(1);
		expect(Number.isInteger(pages)).toBe(true);
		disposePager();
	});
});

describe('columnSource', () => {
	it('wraps a fragment in a clip window for a given column', () => {
		const built = buildSelfContainedHtml(textDocument(2), 'OEBPS/ch1.xhtml', new Map());
		const source = columnSource(built.fragment, 2, 5);
		expect(source).toContain('overflow:hidden');
		expect(source).toContain('translate');
		disposePager();
	});
});
