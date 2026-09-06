import JSZip from 'jszip';
import { OptimizeError } from './errors.ts';
import { joinZipPath, opfDirectoryPath } from './paths.ts';
import type { EpubSource, ManifestItem, Metadata, SpineItem } from './types.ts';

export function parseXmlDocument(
	text: string,
	mimeType: DOMParserSupportedType = 'application/xml'
): Document {
	const doc = new DOMParser().parseFromString(text, mimeType);
	if (doc.getElementsByTagName('parsererror').length > 0) {
		throw new OptimizeError('parse-error', 'XML parsing failed');
	}
	return doc;
}

export function readResourceText(bytes: Uint8Array): string {
	return new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^\uFEFF/, '');
}

function textOf(doc: Document, localName: string): string {
	return doc.getElementsByTagNameNS('*', localName)[0]?.textContent?.trim() ?? '';
}

export async function ingestEpub(file: File): Promise<EpubSource> {
	if (!file.name.toLowerCase().endsWith('.epub')) {
		throw new OptimizeError('not-epub', 'Only .epub files are supported.');
	}

	const bytes = new Uint8Array(await file.arrayBuffer());
	if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
		throw new OptimizeError('not-zip', 'The file is not a ZIP/EPUB container.');
	}

	const zip = await JSZip.loadAsync(bytes);
	if (Object.keys(zip.files).some((path) => path.toLowerCase() === 'meta-inf/encryption.xml')) {
		throw new OptimizeError('encrypted-book', 'Encrypted EPUBs are not supported.');
	}

	const containerPath = Object.keys(zip.files).find(
		(path) => path.toLowerCase() === 'meta-inf/container.xml'
	);
	if (!containerPath)
		throw new OptimizeError('missing-container', 'META-INF/container.xml is missing.');

	const containerXml = await zip.file(containerPath)?.async('string');
	if (!containerXml)
		throw new OptimizeError('missing-container', 'META-INF/container.xml is unreadable.');

	const container = parseXmlDocument(containerXml);
	const rootfile = container.getElementsByTagNameNS('*', 'rootfile')[0];
	const opfPath = rootfile?.getAttribute('full-path');
	if (!opfPath) throw new OptimizeError('missing-opf', 'No OPF rootfile was declared.');

	const opfFile = zip.file(opfPath);
	if (!opfFile) throw new OptimizeError('missing-opf', `OPF not found: ${opfPath}`);
	const opfText = await opfFile.async('string');
	const opf = parseXmlDocument(opfText);

	const opfDir = opfDirectoryPath(opfPath);
	const resources = new Map<string, Uint8Array>();
	const manifest = new Map<string, ManifestItem>();

	for (const file of Object.values(zip.files)) {
		if (!file.dir) {
			const data = await file.async('uint8array');
			resources.set(file.name, data);
		}
	}

	const title = textOf(opf, 'title');
	const authorCandidates = [...opf.getElementsByTagNameNS('*', 'creator')];
	const author = authorCandidates[0]?.textContent?.trim() ?? '';
	const language = textOf(opf, 'language');

	for (const item of [...opf.getElementsByTagNameNS('*', 'item')]) {
		const id = item.getAttribute('id') ?? '';
		const href = item.getAttribute('href') ?? '';
		if (!id) continue;
		manifest.set(id, {
			id,
			href,
			mediaType: item.getAttribute('media-type') ?? '',
			zipPath: joinZipPath(opfDir, href)
		});
	}

	let coverItemId: string | undefined;
	for (const item of [...opf.getElementsByTagNameNS('*', 'item')]) {
		const properties = item.getAttribute('properties')?.split(/\s+/).filter(Boolean) ?? [];
		if (properties.includes('cover-image')) {
			coverItemId = item.getAttribute('id') ?? undefined;
			break;
		}
	}
	if (!coverItemId) {
		const coverMeta = [...opf.getElementsByTagNameNS('*', 'meta')].find(
			(meta) => meta.getAttribute('name')?.toLowerCase() === 'cover'
		);
		coverItemId = coverMeta?.getAttribute('content') ?? undefined;
	}

	const metadata: Metadata = { title, author, language, coverItemId };
	const spine: SpineItem[] = [];
	for (const itemref of [...opf.getElementsByTagNameNS('*', 'itemref')]) {
		const idref = itemref.getAttribute('idref') ?? '';
		const manifestItem = manifest.get(idref);
		if (!manifestItem) continue;
		spine.push({
			idref,
			href: manifestItem.href,
			zipPath: manifestItem.zipPath
		});
		if (!resources.has(manifestItem.zipPath)) {
			throw new OptimizeError('missing-spine-file', `Spine file missing: ${manifestItem.zipPath}`);
		}
	}

	if (spine.length === 0) {
		throw new OptimizeError('empty-spine', 'The OPF spine contains no readable text resources.');
	}

	return { opfPath, opfDir, resources, manifest, spine, metadata };
}
