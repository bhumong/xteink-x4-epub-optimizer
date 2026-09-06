import { packXth, packXtg } from '@xteink/xtc';
import { quantize1bit, quantize2bit } from './quantize.ts';

export interface QuantizeRequest {
	id: number;
	rgba: ArrayBuffer;
	width: number;
	height: number;
	mode: 'xtc' | 'xtch';
}

export interface QuantizeResponse {
	id: number;
	bitmap: ArrayBuffer;
}

const ctx = self as unknown as {
	onmessage: ((event: MessageEvent<QuantizeRequest>) => void) | null;
	postMessage(message: QuantizeResponse, transfer: Transferable[]): void;
};

ctx.onmessage = (event) => {
	const { id, rgba, width, height, mode } = event.data;
	const pixels = new Uint8Array(rgba);
	const codes =
		mode === 'xtc' ? quantize1bit(pixels, width, height) : quantize2bit(pixels, width, height);
	const bitmap = mode === 'xtc' ? packXtg(codes, width, height) : packXth(codes, width, height);
	const response: QuantizeResponse = { id, bitmap: bitmap.buffer as ArrayBuffer };
	ctx.postMessage(response, [response.bitmap]);
};
