/** Strip a fragment or query suffix, then percent-decode an EPUB href. */
export function decodeHref(href: string): string {
	try {
		return decodeURIComponent(href);
	} catch {
		return href;
	}
}

/** Directory prefix of an OPF path, with trailing slash. '' when at container root. */
export function opfDirectoryPath(opfPath: string): string {
	const idx = opfPath.lastIndexOf('/');
	return idx === -1 ? '' : opfPath.slice(0, idx + 1);
}

/**
 * Resolve an href to a zip-internal path.
 *
 * A leading slash is container-root-relative per OPF rules, not filesystem
 * absolute, so it is stripped rather than trusted.
 */
export function joinZipPath(baseDir: string, href: string): string {
	const cleaned = decodeHref(href.split('#')[0].split('?')[0]);
	const raw = cleaned.startsWith('/') ? cleaned.slice(1) : baseDir + cleaned;
	const segments: string[] = [];
	for (const segment of raw.split('/')) {
		if (segment === '' || segment === '.') continue;
		if (segment === '..') {
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return segments.join('/');
}

/** Relative href from one zip-internal file path to another zip-internal path. */
export function relativeZipPath(fromPath: string, toPath: string): string {
	const fromDirs = fromPath.split('/').slice(0, -1);
	const toParts = toPath.split('/');
	let common = 0;
	while (
		common < fromDirs.length &&
		common < toParts.length &&
		fromDirs[common] === toParts[common]
	) {
		common++;
	}
	const up: string[] = [];
	for (let i = common; i < fromDirs.length; i++) up.push('..');
	const down = toParts.slice(common);
	return [...up, ...down].join('/');
}

/** Lowercased extension without the dot. '' when the basename has none. */
export function fileExtension(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}
