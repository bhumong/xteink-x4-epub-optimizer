import { parseXmlDocument, readResourceText } from '@xteink/optimize/ingest.ts';
import { joinZipPath } from '@xteink/optimize/paths.ts';
import {
	bytesToDataUrl,
	mimeTypeForPath,
	remapBodySelectors,
	rewriteCssUrls
} from './css-inline.ts';

export const PAGE_WIDTH = 480;
export const PAGE_HEIGHT = 800;

const BASELINE_CSS = `
.xtc-body { margin: 0; padding: 0; font: 16px/1.5 serif; color: #000; }
.xtc-body p { margin: 1em 0; }
.xtc-body h1 { font-size: 1.8em; font-weight: bold; margin: 0.67em 0; }
.xtc-body h2 { font-size: 1.5em; font-weight: bold; margin: 0.83em 0; }
.xtc-body ul, .xtc-body ol { margin: 1em 0; padding-left: 2em; }
.xtc-body table { border-collapse: collapse; }
img { max-width: 100%; }
svg { max-width: 100%; }
`;

let pagerHost: HTMLDivElement | null = null;

function getPagerHost(): HTMLDivElement {
	if (!pagerHost) {
		pagerHost = document.createElement('div');
		pagerHost.style.cssText = 'position:absolute;left:-20000px;top:0;width:0;height:0;z-index:-1';
		document.body.appendChild(pagerHost);
	}
	pagerHost.innerHTML = '';
	return pagerHost;
}

export function disposePager(): void {
	pagerHost?.remove();
	pagerHost = null;
}

function textOf(node: Element | null): string {
	return (node?.textContent ?? '').trim();
}

function fileStem(zipPath: string): string {
	const base = zipPath.slice(zipPath.lastIndexOf('/') + 1);
	return base.replace(/\.[^.]+$/, '');
}

export function buildSelfContainedHtml(
	htmlText: string,
	zipPath: string,
	resources: Map<string, Uint8Array>
): { fragment: string; title: string; warnings: string[] } {
	const warnings: string[] = [];
	let doc: Document | null = null;
	try {
		doc = parseXmlDocument(htmlText);
	} catch {
		// falls through to the empty-fragment path below
	}
	if (!doc) {
		warnings.push('document could not be parsed');
		return { fragment: '', title: fileStem(zipPath), warnings };
	}
	const baseDir = zipPath.slice(0, zipPath.lastIndexOf('/') + 1);
	const title = textOf(doc.getElementsByTagName('title')[0] ?? null) || fileStem(zipPath);

	for (const link of [...doc.getElementsByTagName('link')]) {
		const href = link.getAttribute('href');
		if (!href) {
			link.remove();
			continue;
		}
		const cssPath = joinZipPath(baseDir, href);
		const bytes = resources.get(cssPath);
		if (!bytes) {
			warnings.push(`missing stylesheet ${href}`);
			link.remove();
			continue;
		}
		const style = doc.createElement('style');
		style.textContent = remapBodySelectors(
			rewriteCssUrls(readResourceText(bytes), cssPath, resources).css
		);
		link.replaceWith(style);
	}

	for (const style of [...doc.getElementsByTagName('style')]) {
		style.textContent = remapBodySelectors(style.textContent ?? '');
	}

	for (const img of [...doc.getElementsByTagName('img')]) {
		const src = img.getAttribute('src');
		if (!src || src.startsWith('data:')) continue;
		const imagePath = joinZipPath(baseDir, src);
		const bytes = resources.get(imagePath);
		const mime = mimeTypeForPath(imagePath);
		if (bytes && mime) {
			img.setAttribute('src', bytesToDataUrl(bytes, mime));
		} else {
			warnings.push(`unrenderable image ${src}`);
			img.remove();
		}
	}

	const body = doc.getElementsByTagName('body')[0];
	const fragment = document.createElement('template');
	fragment.innerHTML = `<style>${BASELINE_CSS}</style>`;
	for (const style of [...doc.getElementsByTagName('style')]) {
		fragment.content
			.querySelector('style')
			?.insertAdjacentHTML('beforeend', style.textContent ?? '');
	}
	const contentRoot = document.createElement('div');
	contentRoot.className = 'xtc-body';
	if (body) {
		for (const child of [...body.childNodes]) {
			contentRoot.appendChild(child.cloneNode(true));
		}
	}
	fragment.content.appendChild(contentRoot);
	return { fragment: fragment.innerHTML, title, warnings };
}

function contentFits(col: HTMLElement): boolean {
	const range = document.createRange();
	range.selectNodeContents(col);
	const rects = [...range.getClientRects()];
	if (rects.length === 0) return true;
	const colTop = col.getBoundingClientRect().top;
	const maxBottom = Math.max(...rects.map((rect) => rect.bottom - colTop));
	// Probe result (pinned Chromium): with an 800px column height, every
	// insufficient width leaves clipped fragments bottoming at exactly 800;
	// a width where the last fragment bottom is below 800 means the content
	// fit (e.g. 480-1920px -> 800, 3840px -> 530 for the probe document).
	return maxBottom < PAGE_HEIGHT;
}

export function measureColumnCount(fragment: string, estimate: number): number {
	const host = getPagerHost();
	const col = document.createElement('div');
	col.id = 'xtc-columns';
	col.style.cssText = `height:${PAGE_HEIGHT}px;column-width:${PAGE_WIDTH}px;column-gap:0px;overflow:hidden;background:#fff`;
	col.innerHTML = fragment;
	host.appendChild(col);
	let columns = Math.max(1, Math.ceil(estimate / 2));
	while (true) {
		col.style.width = `${columns * PAGE_WIDTH}px`;
		if (contentFits(col) || columns >= 8192) break;
		columns *= 2;
	}
	let low = Math.max(1, Math.ceil(columns / 2));
	let high = columns;
	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		col.style.width = `${mid * PAGE_WIDTH}px`;
		if (contentFits(col)) {
			high = mid;
		} else {
			low = mid + 1;
		}
	}
	host.innerHTML = '';
	return low;
}

export function columnSource(fragment: string, column: number, totalColumns: number): string {
	const width = totalColumns * PAGE_WIDTH;
	return `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${PAGE_WIDTH}px;height:${PAGE_HEIGHT}px;overflow:hidden;background:#fff">
		<div style="width:${width}px;height:${PAGE_HEIGHT}px;transform:translateX(-${column * PAGE_WIDTH}px);transform-origin:0 0">
		${fragment}
		</div>
	</div>`;
}
