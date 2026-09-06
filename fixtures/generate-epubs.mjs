import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const root = join(dirname(fileURLToPath(import.meta.url)), 'epubs');

function crc32(bytes) {
	let table = crc32.table;
	if (!table) {
		table = crc32.table = new Int32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			table[n] = c;
		}
	}
	let crc = -1;
	for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
	const typeBytes = Buffer.from(type, 'ascii');
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
	return Buffer.concat([length, typeBytes, data, crc]);
}

function solidPng(width, height, rgb) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;
	const scanlines = Buffer.alloc(height * (1 + width * 3));
	for (let y = 0; y < height; y++) {
		const row = y * (1 + width * 3);
		scanlines[row] = 0;
		for (let x = 0; x < width; x++) {
			const offset = row + 1 + x * 3;
			scanlines[offset] = rgb[0];
			scanlines[offset + 1] = rgb[1];
			scanlines[offset + 2] = rgb[2];
		}
	}
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk('IHDR', ihdr),
		pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
		pngChunk('IEND', Buffer.alloc(0))
	]);
}

async function writeEpub(name, makeZip) {
	const zip = new JSZip();
	const originalFile = zip.file.bind(zip);
	// JSZip defaults entry dates to "now", which makes every regeneration a
	// byte-level diff. Pin one date so fixtures are reproducible.
	zip.file = (entryName, data, options) =>
		originalFile(entryName, data, { date: new Date('2026-09-06T00:00:00Z'), ...options });
	zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
	await makeZip(zip);
	const buffer = await zip.generateAsync({
		type: 'nodebuffer',
		compression: 'DEFLATE',
		streamFiles: true
	});
	const dir = join(root, name);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'book.epub'), buffer);
	console.log('fixture:', join(dir, 'book.epub'));
}

function containerXml(opfPath) {
	return `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/></rootfiles></container>`;
}

async function makeSimpleEpub(zip, { version, title, author, content }) {
	const isEpub3 = version === 3;
	zip.file('META-INF/container.xml', containerXml('OEBPS/content.opf'));
	zip.file(
		'OEBPS/content.opf',
		`<package xmlns="http://www.idpf.org/2007/opf" version="${version}" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">fixture</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>`
	);
	zip.file(
		'OEBPS/ch1.xhtml',
		`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>${content}</body></html>`
	);
	if (isEpub3) {
		zip.file(
			'OEBPS/nav.xhtml',
			`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Nav</title></head><body><nav epub:type="toc"><ol><li><a href="ch1.xhtml">${title}</a></li></ol></nav></body></html>`
		);
	}
}

function paragraph(index) {
	const sentence = `Sentence ${index} of the deterministic long fixture. `.repeat(12);
	return `<p>${sentence}</p>`;
}

function longContent() {
	return Array.from({ length: 400 }, (_, i) => paragraph(i + 1)).join('');
}

async function main() {
	await writeEpub('minimal-epub2', (zip) =>
		makeSimpleEpub(zip, {
			version: 2,
			title: 'Minimal Two',
			author: 'Fixture Author',
			content: '<p>Hello two.</p>'
		})
	);
	await writeEpub('minimal-epub3', (zip) =>
		makeSimpleEpub(zip, {
			version: 3,
			title: 'Minimal Three',
			author: 'Fixture Author',
			content: '<p>Hello three.</p>'
		})
	);
	await writeEpub('long', (zip) =>
		makeSimpleEpub(zip, {
			version: 2,
			title: 'Long Book',
			author: 'Fixture Author',
			content: longContent()
		})
	);
	await writeEpub('cover', async (zip) => {
		zip.file('META-INF/container.xml', containerXml('OEBPS/content.opf'));
		zip.file(
			'OEBPS/content.opf',
			'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">' +
				'<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">fixture-cover</dc:identifier>' +
				'<dc:title>Cover Book</dc:title><dc:creator>Fixture Author</dc:creator><dc:language>en</dc:language>' +
				'<meta name="cover" content="cover"/></metadata>' +
				'<manifest><item id="cover" href="Images/cover.png" media-type="image/png"/>' +
				'<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>' +
				'<spine><itemref idref="ch1"/></spine></package>'
		);
		zip.file('OEBPS/Images/cover.png', solidPng(480, 800, [18, 52, 86]));
		zip.file(
			'OEBPS/ch1.xhtml',
			'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head>' +
				'<body><p>After the cover.</p></body></html>'
		);
	});

	const largePng = solidPng(960, 1600, [255, 255, 255]);
	await writeEpub('images', async (zip) => {
		zip.file('META-INF/container.xml', containerXml('OEBPS/content.opf'));
		zip.file(
			'OEBPS/content.opf',
			'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">fixture</dc:identifier><dc:title>Image Book</dc:title><dc:creator>Fixture Author</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="img" href="Images/large.png" media-type="image/png"/><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>'
		);
		zip.file(
			'OEBPS/ch1.xhtml',
			'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Image Book</title></head><body><p><img src="Images/large.png" alt="large"/></p></body></html>'
		);
		zip.file('OEBPS/Images/large.png', largePng);
	});

	await writeEpub('fonts', async (zip) => {
		await makeSimpleEpub(zip, {
			version: 3,
			title: 'Font Book',
			author: 'Fixture Author',
			content: '<p style="font-family:X">Styled</p>'
		});
		zip.file('OEBPS/font.ttf', Buffer.from('fake-font-bytes'));
	});

	const coverPng = solidPng(480, 800, [0, 0, 0]);
	await writeEpub('scripts-svg', async (zip) => {
		zip.file('META-INF/container.xml', containerXml('OEBPS/content.opf'));
		zip.file(
			'OEBPS/content.opf',
			`<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">fixture</dc:identifier><dc:title>SVG Book</dc:title><dc:creator>Fixture Author</dc:creator><dc:language>en</dc:language><meta name="cover" content="cover"/></metadata><manifest><item id="cover" href="Images/cover.png" media-type="image/png" properties="cover-image"/><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>`
		);
		zip.file('OEBPS/Images/cover.png', coverPng);
		zip.file(
			'OEBPS/ch1.xhtml',
			`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink"><head><title>SVG Book</title><script>alert(1)</script></head><body onload="alert(2)"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="480" height="800"><image xlink:href="Images/cover.png" width="480" height="800"/></svg></body></html>`
		);
	});

	await writeEpub('encrypted', async (zip) => {
		await makeSimpleEpub(zip, {
			version: 3,
			title: 'Encrypted',
			author: 'Fixture Author',
			content: '<p>Encrypted.</p>'
		});
		zip.file(
			'META-INF/encryption.xml',
			'<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData/></encryption>'
		);
	});
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
