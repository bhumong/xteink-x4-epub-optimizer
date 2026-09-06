export function safeEpubFilename(
	title: string,
	author: string,
	sourceName: string,
	renameFromMetadata: boolean
): string {
	if (!renameFromMetadata) return sourceName;

	const clean = (value: string) =>
		value
			.normalize('NFC')
			.replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.replace(/^[. ]+/, '')
			.replace(/[. ]+$/, '');

	const safeTitle = clean(title);
	const safeAuthor = clean(author);
	let base = safeTitle;
	if (safeTitle && safeAuthor) base = `${safeTitle} - ${safeAuthor}`;
	if (!base) return sourceName;
	if (base.length > 180)
		base =
			base
				.slice(0, 180)
				.replace(/\s+\S*$/, '')
				.trim() || base.slice(0, 180);
	return `${base}.epub`;
}
