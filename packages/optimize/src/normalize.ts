import { DEFENSIVE_CSS, stripFontFaceRules } from './css.ts';
import { parseXmlDocument } from './ingest.ts';
import { joinZipPath, relativeZipPath } from './paths.ts';

const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

function serialize(doc: Document): string {
	return new XMLSerializer().serializeToString(doc);
}

function rewriteAttribute(
	element: Element,
	attribute: string,
	sourceXhtmlPath: string,
	imageRenameMap: ReadonlyMap<string, string>
) {
	const value = element.getAttribute(attribute);
	if (!value || value.startsWith('data:')) return;
	const sourceZipPath = joinZipPath(
		sourceXhtmlPath.slice(0, sourceXhtmlPath.lastIndexOf('/') + 1),
		value
	);
	const target = imageRenameMap.get(sourceZipPath);
	if (!target) return;
	element.setAttribute(attribute, relativeZipPath(sourceXhtmlPath, target));
}

export function normalizeXhtmlDocument(
	html: string,
	sourceXhtmlPath: string,
	imageRenameMap: ReadonlyMap<string, string>
): {
	html: string;
	removedScripts: number;
	removedHandlers: number;
	removedFontFaces: number;
	svgImages: number;
} {
	let doc: Document;
	try {
		doc = parseXmlDocument(html, 'application/xhtml+xml');
	} catch {
		return {
			html,
			removedScripts: 0,
			removedHandlers: 0,
			removedFontFaces: 0,
			svgImages: 0
		};
	}

	const scripts = [...doc.getElementsByTagNameNS('*', 'script')];
	for (const script of scripts) script.parentNode?.removeChild(script);

	let removedHandlers = 0;
	for (const element of [...doc.getElementsByTagName('*')]) {
		for (const attribute of [...element.attributes]) {
			if (/^on/i.test(attribute.name)) {
				element.removeAttribute(attribute.name);
				removedHandlers++;
			}
		}
	}

	let removedFontFaces = 0;
	for (const style of [...doc.getElementsByTagNameNS(XHTML_NS, 'style')]) {
		const original = style.textContent ?? '';
		const result = stripFontFaceRules(original);
		if (result.count > 0) {
			style.textContent = result.css;
			removedFontFaces += result.count;
		}
	}

	const svgs = [...doc.getElementsByTagName('svg'), ...doc.getElementsByTagNameNS(SVG_NS, 'svg')];
	let svgImages = 0;
	for (const svg of new Set(svgs)) {
		const image =
			svg.getElementsByTagNameNS(SVG_NS, 'image')[0] ?? svg.getElementsByTagName('image')[0];
		if (!image) continue;
		const href =
			image.getAttributeNS(XLINK_NS, 'href') ??
			image.getAttribute('xlink:href') ??
			image.getAttribute('href');
		if (!href) continue;

		const img = doc.createElementNS(XHTML_NS, 'img');
		img.setAttribute('src', href);
		img.setAttribute('alt', '');
		img.setAttribute('style', 'max-width:100%;height:auto');
		rewriteAttribute(img, 'src', sourceXhtmlPath, imageRenameMap);
		svg.replaceWith(img);
		svgImages++;
	}

	for (const element of [...doc.getElementsByTagNameNS(XHTML_NS, 'img')]) {
		rewriteAttribute(element, 'src', sourceXhtmlPath, imageRenameMap);
	}

	let head = doc.getElementsByTagNameNS(XHTML_NS, 'head')[0];
	if (!head) {
		head = doc.createElementNS(XHTML_NS, 'head');
		doc.documentElement.prepend(head);
	}
	const style = doc.createElementNS(XHTML_NS, 'style');
	style.setAttribute('type', 'text/css');
	style.textContent = DEFENSIVE_CSS;
	head.appendChild(style);

	return {
		html: serialize(doc),
		removedScripts: scripts.length,
		removedHandlers,
		removedFontFaces,
		svgImages
	};
}

export function normalizeOpfDocument(
	opfXml: string,
	opfDir: string,
	imageRenameMap: ReadonlyMap<string, string>,
	fontZipPaths: ReadonlySet<string>
): string {
	let doc: Document;
	try {
		doc = parseXmlDocument(opfXml, 'application/xml');
	} catch {
		return opfXml;
	}

	for (const item of [...doc.getElementsByTagNameNS('*', 'item')]) {
		const href = item.getAttribute('href') ?? '';
		const source = joinZipPath(opfDir, href);
		const target = imageRenameMap.get(source);
		if (target) {
			item.setAttribute('href', relativeZipPath(opfDir, target));
			item.setAttribute('media-type', 'image/jpeg');
		} else if (fontZipPaths.has(source)) {
			item.parentNode?.removeChild(item);
		}
	}

	return serialize(doc);
}
