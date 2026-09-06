import JSZip from 'jszip';

const TEXT_EXTENSIONS = new Set([
	'.xhtml',
	'.html',
	'.htm',
	'.opf',
	'.ncx',
	'.css',
	'.xml',
	'.js',
	'.txt',
	'.svg'
]);

export function isTextPath(path: string): boolean {
	const lower = path.toLowerCase();
	const lastDot = lower.lastIndexOf('.');
	return lastDot > 0 && TEXT_EXTENSIONS.has(lower.slice(lastDot));
}

export async function repackEpub(
	resources: Map<string, Uint8Array>,
	signal?: AbortSignal
): Promise<Blob> {
	const zip = new JSZip();
	const mimetype = resources.get('mimetype');
	if (!mimetype) throw new Error('mimetype resource missing');

	zip.file('mimetype', mimetype, { compression: 'STORE', createFolders: false });

	const paths = [...resources.keys()].sort((a, b) => a.localeCompare(b));
	for (const path of paths) {
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
		if (path === 'mimetype') continue;
		const data = resources.get(path);
		if (!data) continue;
		const compression = isTextPath(path) ? 'DEFLATE' : 'STORE';
		zip.file(path, data, { compression, createFolders: false });
	}

	return zip.generateAsync({
		type: 'blob',
		mimeType: 'application/epub+zip',
		compression: 'DEFLATE',
		streamFiles: true
	});
}
