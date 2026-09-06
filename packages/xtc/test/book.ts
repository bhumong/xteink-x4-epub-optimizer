import type { XtcBook } from '../src/types.ts';
import { borderFrame, makeFrame, pageFrame, whiteFrame } from './frame.ts';

export function minimalXtcBook(): XtcBook {
	return {
		mode: 'xtc',
		title: 'Minimal XTC',
		author: 'Xteink Test',
		chapters: [
			{ name: 'Chapter One', startPage: 0, endPage: 0 },
			{ name: 'Chapter Two', startPage: 1, endPage: 1 }
		],
		pages: [pageFrame(whiteFrame()), pageFrame(borderFrame())]
	};
}

export function minimalXtchBook(): XtcBook {
	return {
		mode: 'xtch',
		title: 'Minimal XTCH',
		pages: [pageFrame(makeFrame((x, y) => (Math.floor(x / 40) + Math.floor(y / 40)) % 4))]
	};
}

export function onePageXtcBook(): XtcBook {
	return {
		mode: 'xtc',
		title: 'A',
		author: 'B',
		pages: [pageFrame(whiteFrame())]
	};
}
