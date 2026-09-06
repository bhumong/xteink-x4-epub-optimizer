import { describe, expect, it } from 'vitest';
import { stripFontFaceRules } from '../src/css.ts';

describe('stripFontFaceRules', () => {
	it('removes balanced @font-face blocks', () => {
		const css =
			'a { color: red; } @font-face { font-family: X; src: url(x.ttf); } b { color: blue; }';
		const result = stripFontFaceRules(css);
		expect(result.count).toBe(1);
		expect(result.css).not.toContain('@font-face');
		expect(result.css).toContain('a { color: red; }');
		expect(result.css).toContain('b { color: blue; }');
	});
});
