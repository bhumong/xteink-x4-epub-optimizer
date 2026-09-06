import { XTC_VIEWPORT_HEIGHT, XTC_VIEWPORT_WIDTH, type XtcPage } from '../src/types.ts';

export function makeFrame(pixel: (x: number, y: number) => number): Uint8Array {
	const out = new Uint8Array(XTC_VIEWPORT_WIDTH * XTC_VIEWPORT_HEIGHT);
	for (let y = 0; y < XTC_VIEWPORT_HEIGHT; y++) {
		for (let x = 0; x < XTC_VIEWPORT_WIDTH; x++) {
			out[y * XTC_VIEWPORT_WIDTH + x] = pixel(x, y);
		}
	}
	return out;
}

export function whiteFrame(): Uint8Array {
	return makeFrame(() => 1);
}

export function borderFrame(): Uint8Array {
	return makeFrame((x, y) =>
		x === 0 || x === XTC_VIEWPORT_WIDTH - 1 || y === 0 || y === XTC_VIEWPORT_HEIGHT - 1 ? 0 : 1
	);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) {
			return false;
		}
	}
	return true;
}

export function pageFrame(frame: Uint8Array): XtcPage {
	return { pixels: frame };
}
