import { describe, expect, it } from 'vitest';
import { captureColumn } from '../src/capture.ts';
import { columnSource } from '../src/layout.ts';

function countNear(
	buffer: Uint8Array,
	target: [number, number, number],
	tolerance: number
): number {
	let count = 0;
	for (let i = 0; i < 480 * 800; i++) {
		const offset = i * 4;
		const distance =
			Math.abs(buffer[offset] - target[0]) +
			Math.abs(buffer[offset + 1] - target[1]) +
			Math.abs(buffer[offset + 2] - target[2]);
		if (distance <= tolerance) count++;
	}
	return count;
}

function solidPngDataUrl(color: [number, number, number]): string {
	const canvas = document.createElement('canvas');
	canvas.width = 60;
	canvas.height = 60;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('no 2d canvas');
	context.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
	context.fillRect(0, 0, 60, 60);
	return canvas.toDataURL('image/png');
}

describe('captureColumn (DOM painter)', () => {
	it('returns a 480x800 RGBA buffer', async () => {
		const fragment = '<div class="xtc-body"><p>Hello</p></div>';
		const { rgba, width, height } = await captureColumn(columnSource(fragment, 0, 1));
		expect(width).toBe(480);
		expect(height).toBe(800);
		expect(rgba.length).toBe(480 * 800 * 4);
	});

	it('paints a large red glyph', async () => {
		const fragment =
			'<style>.xtc-body { margin: 0 } .xtc-body p { font: 160px/1 sans-serif; color: rgb(220, 0, 0); margin: 0 }</style>' +
			'<div class="xtc-body"><p>X</p></div>';
		const { rgba } = await captureColumn(columnSource(fragment, 0, 1));
		const red = countNear(rgba, [220, 0, 0], 45);
		expect(red).toBeGreaterThan(2000);
	});

	it('paints only the requested column', async () => {
		const fragment =
			'<div style="width:480px;height:800px;background-color:rgb(255,255,255)"></div>' +
			'<div style="width:480px;height:800px;background-color:rgb(220,0,0)"></div>';
		const first = await captureColumn(columnSource(fragment, 0, 2));
		expect(countNear(first.rgba, [220, 0, 0], 45)).toBe(0);
		const second = await captureColumn(columnSource(fragment, 1, 2));
		expect(countNear(second.rgba, [220, 0, 0], 45)).toBeGreaterThan(100000);
	});

	it('paints a solid-color image at its layout rectangle', async () => {
		const src = solidPngDataUrl([20, 80, 220]);
		const fragment =
			'<div class="xtc-body"><img src="' + src + '" style="width:60px;height:60px"/></div>';
		const { rgba } = await captureColumn(columnSource(fragment, 0, 1));
		const blue = countNear(rgba, [20, 80, 220], 30);
		expect(blue).toBeGreaterThan(2500);
	});

	it('keeps an empty column pure white', async () => {
		const fragment = '<div class="xtc-body"></div>';
		const { rgba } = await captureColumn(columnSource(fragment, 0, 1));
		expect(countNear(rgba, [255, 255, 255], 2)).toBe(480 * 800);
	});
});
