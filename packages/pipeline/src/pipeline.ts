import { prepareEpub } from '@xteink/optimize';
import { safeOutputFilename } from '@xteink/optimize/filename.ts';
import {
	writeXtcFromBitmaps,
	type XtcBitmapBook,
	type XtcChapter,
	type XtcMode
} from '@xteink/xtc';
import { bytesToDataUrl, mimeTypeForPath } from './css-inline.ts';
import {
	buildSelfContainedHtml,
	columnSource,
	disposePager,
	measureColumnCount
} from './layout.ts';
import { captureColumn } from './capture.ts';
import { blankPageBitmap } from './quantize.ts';
import type { PreRenderCallbacks, PreRenderReport, PreRenderResult } from './types.ts';

interface MeasureResult {
	fragment: string;
	title: string;
	pages: number;
	startPage: number;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new DOMException('Aborted', 'AbortError');
	}
}

function makeWorker(): Worker {
	return new Worker(new URL('./quantize.worker.ts', import.meta.url), { type: 'module' });
}

function isCoverDocument(
	source: {
		metadata: { coverItemId?: string };
		manifest: Map<string, { zipPath: string }>;
		spine: Array<{ idref: string }>;
	},
	zipPath: string
): boolean {
	const coverId = source.metadata.coverItemId;
	if (!coverId) return false;
	const coverItem = source.manifest.get(coverId);
	const inSpine = source.spine.some((item) => item.idref === coverId);
	return Boolean(coverItem && inSpine && coverItem.zipPath === zipPath);
}

function buildCoverHtml(bytes: Uint8Array, mime: string): string {
	const dataUrl = bytesToDataUrl(bytes, mime);
	return (
		'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cover</title>' +
		'<style>.xtc-body { margin: 0; display: flex; align-items: center; justify-content: center; height: 800px; background: #fff }</style>' +
		`</head><body><div class="xtc-body"><img src="${dataUrl}" style="max-width:480px;max-height:800px"/></div></body></html>`
	);
}

export async function preRenderXtc(
	file: File,
	options: { mode: XtcMode },
	callbacks: PreRenderCallbacks,
	signal?: AbortSignal
): Promise<PreRenderResult> {
	throwIfAborted(signal);
	callbacks.onProgress({ percent: 2, stage: 'read', message: 'Reading EPUB' });
	const prepared = await prepareEpub(
		file,
		{ jpegQuality: 85, renameFromMetadata: false },
		callbacks,
		signal
	);
	const { source, resources, entries, sourceBytes } = prepared;
	const mode = options.mode;

	const xhtmlPaths = source.spine.map((item) => item.zipPath).filter((path) => resources.has(path));

	callbacks.onProgress({ percent: 46, stage: 'measure', message: 'Measuring pages' });
	const measured: MeasureResult[] = [];
	let runningPage = 0;
	for (let i = 0; i < xhtmlPaths.length; i++) {
		throwIfAborted(signal);
		const zipPath = xhtmlPaths[i];
		const text = new TextDecoder().decode(resources.get(zipPath));
		const built = buildSelfContainedHtml(text, zipPath, resources);
		for (const warning of built.warnings) {
			entries.push({
				level: 'warning',
				code: 'resource-dropped',
				file: zipPath,
				message: warning
			});
		}
		const pages =
			built.fragment === ''
				? 0
				: measureColumnCount(built.fragment, Math.max(1, Math.ceil(text.length / 2000)));
		measured.push({ fragment: built.fragment, title: built.title, pages, startPage: runningPage });
		runningPage += pages;
		callbacks.onProgress({
			percent: 46 + Math.round(((i + 1) / Math.max(xhtmlPaths.length, 1)) * 14),
			stage: 'measure',
			message: `Documents ${i + 1}/${xhtmlPaths.length}`
		});
	}

	let totalPages = runningPage;
	const coverItem = source.metadata.coverItemId
		? source.manifest.get(source.metadata.coverItemId)
		: undefined;
	const coverInSpine = coverItem
		? source.spine.some((item) => item.idref === source.metadata.coverItemId)
		: false;
	let synthesizedCover = false;
	const coverZipPath = coverItem
		? (prepared.imageRenameMap.get(coverItem.zipPath) ?? coverItem.zipPath)
		: undefined;
	if (coverItem && !coverInSpine && coverZipPath && resources.has(coverZipPath)) {
		const imageBytes = resources.get(coverZipPath)!;
		const coverHtml = buildCoverHtml(imageBytes, mimeTypeForPath(coverZipPath) ?? 'image/png');
		const built = buildSelfContainedHtml(
			coverHtml,
			coverZipPath,
			new Map([[coverZipPath, imageBytes]])
		);
		const pages = measureColumnCount(built.fragment, 1);
		if (pages > 0) {
			measured.unshift({
				fragment: built.fragment,
				title: 'Cover',
				pages,
				startPage: 0
			});
			for (const doc of measured.slice(1)) {
				doc.startPage += pages;
			}
			totalPages = runningPage + pages;
			synthesizedCover = true;
			entries.push({
				level: 'info',
				code: 'cover-synthesized',
				message: 'cover image rendered as page 0'
			});
		} else {
			entries.push({
				level: 'warning',
				code: 'cover-skipped',
				message: 'cover image produced no pages'
			});
		}
	}
	const coverDocIndex = synthesizedCover
		? -1
		: measured.findIndex(
				(doc, index) => index === 0 && doc.pages === 1 && isCoverDocument(source, xhtmlPaths[index])
			);

	const chapters: XtcChapter[] = [];
	for (let i = 0; i < measured.length; i++) {
		const doc = measured[i];
		if (doc.pages === 0) {
			entries.push({
				level: 'warning',
				code: 'document-skipped',
				file: xhtmlPaths[i],
				message: 'document produced no pages'
			});
			continue;
		}
		const skipCover = synthesizedCover ? i === 0 : i === coverDocIndex;
		if (skipCover) {
			continue; // page 0 is the cover document; not a chapter
		}
		const endPage = doc.startPage + doc.pages - 1;
		chapters.push({ name: doc.title, startPage: doc.startPage, endPage });
	}

	if (totalPages === 0) {
		throw new Error('pages-zero: no pages could be rendered');
	}
	if (totalPages > 65535) {
		throw new Error('pages-overflow: more than 65535 pages');
	}

	callbacks.onProgress({ percent: 60, stage: 'render', message: 'Rendering pages' });
	const worker = makeWorker();
	const bitmaps: Uint8Array[] = [];
	const pending = new Map<number, (bitmap: ArrayBuffer) => void>();
	let nextId = 0;
	worker.onmessage = (event: MessageEvent<{ id: number; bitmap: ArrayBuffer }>) => {
		const resolve = pending.get(event.data.id);
		if (resolve) {
			pending.delete(event.data.id);
			resolve(event.data.bitmap);
		}
	};
	worker.onerror = () => {
		for (const resolve of pending.values()) resolve(blankPageBitmap(mode).buffer as ArrayBuffer);
		pending.clear();
	};

	let done = 0;
	const queuePage = async (fragment: string, totalColumns: number, column: number) => {
		throwIfAborted(signal);
		try {
			const captured = await captureColumn(columnSource(fragment, column, totalColumns));
			const id = nextId++;
			const bitmap = await new Promise<ArrayBuffer>((resolve) => {
				pending.set(id, resolve);
				worker.postMessage(
					{
						id,
						rgba: captured.rgba.buffer as ArrayBuffer,
						width: captured.width,
						height: captured.height,
						mode
					},
					[captured.rgba.buffer]
				);
			});
			bitmaps.push(new Uint8Array(bitmap));
		} catch {
			entries.push({
				level: 'warning',
				code: 'page-blank',
				message: `page ${done + 1} rendered blank`
			});
			bitmaps.push(blankPageBitmap(mode));
		}
		done++;
		callbacks.onProgress({
			percent: 60 + Math.round((done / Math.max(totalPages, 1)) * 35),
			stage: 'render',
			message: `Pages ${done}/${totalPages}`
		});
	};

	for (const doc of measured) {
		if (doc.pages === 0) continue;
		for (let column = 0; column < doc.pages; column++) {
			await queuePage(doc.fragment, doc.pages, column);
		}
	}

	worker.terminate();
	disposePager();
	throwIfAborted(signal);

	callbacks.onProgress({ percent: 96, stage: 'write', message: 'Writing XTC' });
	const extension = mode === 'xtc' ? '.xtc' : '.xtch';
	const fileName = safeOutputFilename(
		source.metadata.title,
		source.metadata.author,
		file.name,
		true,
		extension
	);
	const book: XtcBitmapBook = {
		mode,
		title: source.metadata.title || undefined,
		author: source.metadata.author || undefined,
		chapters,
		pages: bitmaps.map((bitmap) => ({ bitmap }))
	};
	const bytes = writeXtcFromBitmaps(book);
	const blobBytes = new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
	const blob = new Blob([blobBytes], { type: 'application/octet-stream' });
	const warningCount = entries.filter((entry) => entry.level === 'warning').length;
	const errorCount = entries.filter((entry) => entry.level === 'error').length;
	const report: PreRenderReport = {
		sourceBytes,
		outputBytes: blob.size,
		pageCount: totalPages,
		chapterCount: chapters.length,
		warningCount,
		errorCount,
		entries
	};
	callbacks.onProgress({ percent: 100, stage: 'done', message: 'Done' });
	return { blob, fileName, report };
}
