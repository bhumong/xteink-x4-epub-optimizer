import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { optimizeEpub } from '../src/pipeline.ts';

async function epubFile(): Promise<File> {
	const zip = new JSZip();
	zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
	zip.file(
		'META-INF/container.xml',
		'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
	);
	zip.file(
		'OEBPS/content.opf',
		'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier><dc:title>Pipeline Book</dc:title><dc:creator>Fixture</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>'
	);
	zip.file(
		'OEBPS/ch1.xhtml',
		'<html xmlns="http://www.w3.org/1999/xhtml"><head><script>alert(1)</script></head><body><p>Hello</p></body></html>'
	);
	const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
	return new File([blob], 'Pipeline Book - Fixture.epub', { type: 'application/epub+zip' });
}

describe('optimizeEpub', () => {
	it('returns a downloadable EPUB with normalized script removed', async () => {
		const progress: string[] = [];
		const result = await optimizeEpub(
			await epubFile(),
			{ jpegQuality: 85, renameFromMetadata: true },
			{
				onProgress(event) {
					progress.push(`${event.stage}:${event.percent}`);
				}
			}
		);
		expect(result.fileName).toBe('Pipeline Book - Fixture.epub');
		expect(result.report.scriptRemovedCount).toBe(1);
		expect(progress.at(-1)).toBe('done:100');

		const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
		const ch = await zip.file('OEBPS/ch1.xhtml')?.async('string');
		expect(ch).toBeDefined();
		expect(ch).not.toContain('<script');
	});

	it('honors an already-aborted signal', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			optimizeEpub(
				await epubFile(),
				{ jpegQuality: 85, renameFromMetadata: false },
				{
					onProgress() {}
				},
				controller.signal
			)
		).rejects.toMatchObject({ name: 'AbortError' });
	});
});
