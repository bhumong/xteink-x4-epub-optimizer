function clean(value: string): string {
	return value
		.normalize('NFC')
		// eslint-disable-next-line no-control-regex -- stripping ASCII controls is the point
		.replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^[. ]+/, '')
		.replace(/[. ]+$/, '');
}

export function safeOutputFilename(
	title: string,
	author: string,
	sourceName: string,
	renameFromMetadata: boolean,
	extension: string
): string {
	const safeTitle = clean(title);
	const safeAuthor = clean(author);
	let base = '';
	if (safeTitle && safeAuthor) {
		base = `${safeTitle} - ${safeAuthor}`;
	} else if (safeTitle) {
		base = safeTitle;
	}
	if (renameFromMetadata && base) {
		if (base.length > 180) {
			base =
				base
					.slice(0, 180)
					.replace(/\s+\S*$/, '')
					.trim() || base.slice(0, 180);
		}
	} else {
		base = sourceName.replace(/\.[^./]+$/, '') || sourceName;
	}
	return `${base}${extension}`;
}

export function safeEpubFilename(
	title: string,
	author: string,
	sourceName: string,
	renameFromMetadata: boolean
): string {
	return safeOutputFilename(title, author, sourceName, renameFromMetadata, '.epub');
}
