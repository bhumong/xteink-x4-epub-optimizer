import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { ingestEpub } from '../src/ingest.ts';

async function fileFromZip(zip: JSZip, name = 'book.epub'): Promise<File> {
	const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
	return new File([blob], name, { type: 'application/epub+zip' });
}

function baseZip() {
	const zip = new JSZip();
	zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
	zip.file(
		'META-INF/container.xml',
		'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
	);
	return zip;
}

describe('ingestEpub', () => {
	it('parses OPF spine and metadata', async () => {
		const zip = baseZip();
		zip.file(
			'OEBPS/content.opf',
			'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier><dc:title>Title</dc:title><dc:creator>Author</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>'
		);
		zip.file(
			'OEBPS/ch1.xhtml',
			'<html xmlns="http://www.w3.org/1999/xhtml"><body>Hi</body></html>'
		);
		const source = await ingestEpub(await fileFromZip(zip));
		expect(source.opfPath).toBe('OEBPS/content.opf');
		expect(source.metadata.title).toBe('Title');
		expect(source.metadata.author).toBe('Author');
		expect(source.spine).toHaveLength(1);
		expect(source.spine[0].zipPath).toBe('OEBPS/ch1.xhtml');
	});

	it('rejects encrypted books', async () => {
		const zip = baseZip();
		zip.file('META-INF/encryption.xml', '<encryption/>');
		await expect(ingestEpub(await fileFromZip(zip))).rejects.toMatchObject({
			code: 'encrypted-book'
		});
	});
});
