import { joinZipPath } from '@xteink/optimize/paths.ts';

const RASTER_MIME: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.bmp': 'image/bmp'
};

export function mimeTypeForPath(path: string): string | undefined {
	const dot = path.lastIndexOf('.');
	if (dot === -1) return undefined;
	return RASTER_MIME[path.slice(dot).toLowerCase()];
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
	let binary = '';
	const chunk = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunk) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
	}
	return `data:${mime};base64,${btoa(binary)}`;
}

const URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

export function rewriteCssUrls(
	css: string,
	cssZipPath: string,
	resources: Map<string, Uint8Array>
): { css: string; inlined: string[]; dropped: string[] } {
	const baseDir = cssZipPath.slice(0, cssZipPath.lastIndexOf('/') + 1);
	const inlined: string[] = [];
	const dropped: string[] = [];
	let result = '';
	let lastIndex = 0;
	for (const match of css.matchAll(URL_PATTERN)) {
		const index = match.index ?? 0;
		result += css.slice(lastIndex, index);
		const reference = match[2].trim();
		if (reference.startsWith('#') || reference.startsWith('data:')) {
			result += match[0];
		} else {
			const zipPath = joinZipPath(baseDir, reference);
			const bytes = resources.get(zipPath);
			const mime = mimeTypeForPath(zipPath);
			if (bytes && mime) {
				result += `url("${bytesToDataUrl(bytes, mime)}")`;
				inlined.push(reference);
			} else {
				result += match[0];
				dropped.push(reference);
			}
		}
		lastIndex = index + match[0].length;
	}
	result += css.slice(lastIndex);
	return { css: result, inlined, dropped };
}

export function remapBodySelectors(css: string): string {
	return css.replace(/(^|[,\s>+~])body(?=\s*[.:#[>+\s]|$)/g, '$1.xtc-body');
}
