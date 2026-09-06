export const DEFENSIVE_CSS =
	'img,svg{max-width:100%;height:auto}body{overflow-wrap:break-word}' +
	'table{max-width:100%;table-layout:fixed}pre,code{white-space:pre-wrap;word-wrap:break-word}' +
	'*{box-sizing:border-box}';

export function stripFontFaceRules(css: string): { css: string; count: number } {
	let out = '';
	let count = 0;
	let i = 0;

	while (i < css.length) {
		if (css.slice(i, i + 10).toLowerCase() === '@font-face') {
			let j = i + 10;
			while (j < css.length && /\s/.test(css[j])) j++;
			if (css[j] === '{') {
				let depth = 0;
				while (j < css.length) {
					const ch = css[j];
					if (ch === '{') depth++;
					else if (ch === '}') depth--;
					j++;
					if (depth === 0) break;
				}
				count++;
				i = j;
				continue;
			}
		}
		out += css[i];
		i++;
	}

	return { css: out.trim(), count };
}
