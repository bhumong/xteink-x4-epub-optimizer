import { stripFontFaceRules } from './css.ts';
import { entry, createReport } from './report.ts';
import { safeEpubFilename } from './filename.ts';
import { ingestEpub, readResourceText } from './ingest.ts';
import { isRasterMediaType, optimizeRasterImage } from './images.ts';
import { normalizeOpfDocument, normalizeXhtmlDocument } from './normalize.ts';
import { repackEpub } from './repack.ts';
import { DEFAULT_OPTIONS } from './options.ts';
import type {
	EpubSource,
	OptimizeCallbacks,
	OptimizeOptions,
	OptimizeResult,
	ReportEntry
} from './types.ts';

const XHTML_EXTENSIONS = new Set(['.xhtml', '.html', '.htm']);
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2']);

function ext(path: string): string {
	const dot = path.lastIndexOf('.');
	return dot >= 0 ? path.slice(dot).toLowerCase() : '';
}

function throwIfAborted(signal?: AbortSignal) {
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

async function processImages(
	source: EpubSource,
	options: OptimizeOptions,
	callbacks: OptimizeCallbacks,
	signal: AbortSignal | undefined,
	entries: ReportEntry[]
): Promise<{ resources: Map<string, Uint8Array>; imageRenameMap: Map<string, string> }> {
	const resources = new Map(source.resources);
	const imageRenameMap = new Map<string, string>();
	const images = [...source.manifest.values()].filter(
		(item) => isRasterMediaType(item.mediaType) && resources.has(item.zipPath)
	);

	for (let index = 0; index < images.length; index++) {
		throwIfAborted(signal);
		const item = images[index];
		const bytes = resources.get(item.zipPath)!;
		const before = bytes.byteLength;
		try {
			const converted = await optimizeRasterImage(bytes, options.jpegQuality);
			const target = item.zipPath.replace(/\.[^.]+$/, '') + '.jpg';
			resources.set(target, converted.data);
			resources.delete(item.zipPath);
			imageRenameMap.set(item.zipPath, target);
			entries.push(entry('success', 'image-encoded', `Encoded ${item.zipPath}`, item.zipPath));
			entries[entries.length - 1].beforeBytes = before;
			entries[entries.length - 1].afterBytes = converted.data.byteLength;
		} catch (error) {
			entries.push(
				entry('warning', 'image-kept', `Kept ${item.zipPath}: ${String(error)}`, item.zipPath)
			);
		}
		callbacks.onProgress({
			percent: Math.round(10 + (index / Math.max(images.length, 1)) * 30),
			stage: 'images',
			message: `Images ${index + 1}/${images.length}`
		});
	}
	return { resources, imageRenameMap };
}

export async function optimizeEpub(
	file: File,
	optionsInput: OptimizeOptions,
	callbacks: OptimizeCallbacks,
	signal?: AbortSignal
): Promise<OptimizeResult> {
	throwIfAborted(signal);
	const options = { ...DEFAULT_OPTIONS, ...optionsInput };
	callbacks.onProgress({ percent: 2, stage: 'read', message: 'Reading EPUB' });
	const source = await ingestEpub(file);
	throwIfAborted(signal);

	const entries: ReportEntry[] = [];
	const sourceBytes = [...source.resources.values()].reduce(
		(sum, bytes) => sum + bytes.byteLength,
		0
	);
	const { resources, imageRenameMap } = await processImages(
		source,
		options,
		callbacks,
		signal,
		entries
	);

	callbacks.onProgress({ percent: 45, stage: 'normalize', message: 'Normalizing documents' });
	throwIfAborted(signal);

	const fontPaths = new Set([...resources.keys()].filter((path) => FONT_EXTENSIONS.has(ext(path))));
	for (const path of fontPaths) {
		resources.delete(path);
		entries.push(entry('success', 'font-removed', `Removed embedded font ${path}`, path));
	}

	for (const [path, bytes] of [...resources.entries()]) {
		throwIfAborted(signal);
		const fileExt = ext(path);
		if (fileExt === '.css') {
			const result = stripFontFaceRules(readResourceText(bytes));
			if (result.count > 0) {
				resources.set(path, new TextEncoder().encode(result.css));
				entries.push(
					entry('success', 'fontface-removed', `Removed ${result.count} @font-face rule(s)`, path)
				);
			}
			continue;
		}
		if (!XHTML_EXTENSIONS.has(fileExt)) continue;

		const text = readResourceText(bytes);
		const normalized = normalizeXhtmlDocument(text, path, imageRenameMap);
		if (normalized.html === text) {
			entries.push(
				entry('warning', 'xhtml-parse-warn', `Preserved unparseable document ${path}`, path)
			);
			continue;
		}
		resources.set(path, new TextEncoder().encode(normalized.html));
		if (normalized.removedScripts > 0) {
			entries.push(
				entry('success', 'script-removed', `Removed ${normalized.removedScripts} script(s)`, path)
			);
		}
		if (normalized.removedHandlers > 0) {
			entries.push(
				entry(
					'success',
					'handler-removed',
					`Removed ${normalized.removedHandlers} handler(s)`,
					path
				)
			);
		}
		if (normalized.removedFontFaces > 0) {
			entries.push(
				entry(
					'success',
					'fontface-removed',
					`Removed ${normalized.removedFontFaces} @font-face rule(s)`,
					path
				)
			);
		}
		if (normalized.svgImages > 0) {
			entries.push(
				entry('success', 'svg-unwrapped', `Unwrapped ${normalized.svgImages} SVG image(s)`, path)
			);
		}
	}

	const opfBytes = resources.get(source.opfPath);
	if (opfBytes) {
		const opfText = normalizeOpfDocument(
			readResourceText(opfBytes),
			source.opfDir,
			imageRenameMap,
			fontPaths
		);
		resources.set(source.opfPath, new TextEncoder().encode(opfText));
	}

	callbacks.onProgress({ percent: 88, stage: 'pack', message: 'Packing EPUB' });
	const blob = await repackEpub(resources, signal);
	const outputBytes = blob.size;
	const report = createReport(entries, sourceBytes, outputBytes);
	const fileName = safeEpubFilename(
		source.metadata.title,
		source.metadata.author,
		file.name,
		options.renameFromMetadata
	);
	callbacks.onProgress({ percent: 100, stage: 'done', message: 'Done' });
	return { blob, fileName, report };
}
