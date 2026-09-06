import { PAGE_HEIGHT, PAGE_WIDTH } from './layout.ts';

interface FragmentLine {
	text: string;
	rect: DOMRect;
}

function isTransparent(color: string): boolean {
	return (
		color === 'transparent' || color === 'rgba(0, 0, 0, 0)' || color.startsWith('rgba(0, 0, 0, 0)')
	);
}

function colorAlpha(color: string): number {
	const match = /rgba\(([^)]+)\)/.exec(color);
	if (!match) return 1;
	const parts = match[1].split(',');
	const alpha = Number(parts[3]?.trim());
	return Number.isFinite(alpha) ? alpha : 1;
}

function hostOrigin(host: HTMLElement): { left: number; top: number } {
	const rect = host.getBoundingClientRect();
	return { left: rect.left, top: rect.top };
}

function fragmentLines(node: Text): FragmentLine[] {
	const text = node.data;
	if (text.length === 0) return [];
	const range = document.createRange();
	range.selectNodeContents(node);
	const rects = [...range.getClientRects()];
	if (rects.length === 0) return [];
	const lineCount = (end: number) => {
		range.setStart(node, 0);
		range.setEnd(node, end);
		return range.getClientRects().length;
	};
	const lines: FragmentLine[] = [];
	let previous = 0;
	for (let line = 1; line <= rects.length; line++) {
		let low = previous;
		let high = text.length;
		while (low < high) {
			const mid = Math.floor((low + high + 1) / 2);
			if (lineCount(mid) > line) {
				high = mid - 1;
			} else {
				low = mid;
			}
		}
		lines.push({ text: text.slice(previous, low), rect: rects[line - 1] });
		previous = low;
	}
	return lines;
}

function applyTextTransform(text: string, transform: string): string {
	if (transform === 'uppercase') return text.toUpperCase();
	if (transform === 'lowercase') return text.toLowerCase();
	if (transform === 'capitalize') {
		return text.replace(/(^|\s)(\S)/g, (match) => match.toUpperCase());
	}
	return text;
}

function paintTextNode(
	context: CanvasRenderingContext2D,
	node: Text,
	host: HTMLElement,
	scale: number,
	origin: { left: number; top: number }
): void {
	const element = node.parentElement;
	if (!element) return;
	const style = getComputedStyle(element);
	const fontSize = parseFloat(style.fontSize) * scale;
	const family = style.fontFamily;
	const italic = style.fontStyle !== 'normal' ? 'italic ' : '';
	const contextFont = `${italic}${style.fontWeight} ${fontSize}px ${family}`;
	context.font = contextFont;
	const metrics = context.measureText('Mg');
	const ascent = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent;
	const descent = metrics.fontBoundingBoxDescent || metrics.actualBoundingBoxDescent;
	const cssLineHeight =
		style.lineHeight === 'normal' ? 1.2 * parseFloat(style.fontSize) : parseFloat(style.lineHeight);
	const lineHeight =
		(Number.isFinite(cssLineHeight) ? cssLineHeight : 1.2 * parseFloat(style.fontSize)) * scale;
	const halfLeading = Math.max(0, (lineHeight - (ascent + descent)) / 2);
	const letterSpacing =
		style.letterSpacing === 'normal' ? 0 : parseFloat(style.letterSpacing) * scale;
	const transform = style.textTransform;
	const justify = style.textAlign === 'justify';
	const fill = style.color;
	const decorationLine = style.textDecorationLine;
	const decorationColor =
		style.textDecorationColor === 'currentcolor' ? style.color : style.textDecorationColor;

	for (const line of fragmentLines(node)) {
		const x = (line.rect.left - origin.left) * scale;
		if (x + line.rect.width * scale < 0 || x > PAGE_WIDTH * scale) continue;
		const yTop = (line.rect.top - origin.top) * scale;
		const baseline = yTop + halfLeading + ascent;
		const text = applyTextTransform(line.text, transform);
		context.textAlign = 'left';
		context.textBaseline = 'alphabetic';
		context.fillStyle = fill;
		context.letterSpacing = `${letterSpacing}px`;
		const naturalWidth = context.measureText(text).width;
		const targetWidth = line.rect.width * scale;
		const words = text.split(' ');
		const gaps = words.length - 1;
		const extraPerGap =
			justify && gaps > 0 && naturalWidth < targetWidth - 1
				? (targetWidth - naturalWidth) / gaps
				: 0;
		if (extraPerGap > 0) {
			let cursor = x;
			const naturalSpace = context.measureText(' ').width + extraPerGap;
			for (let w = 0; w < words.length; w++) {
				context.fillText(words[w], cursor, baseline);
				cursor += context.measureText(words[w]).width + (w < gaps ? naturalSpace : 0);
			}
		} else {
			context.fillText(text, x, baseline);
		}
		context.letterSpacing = '0px';
		context.lineWidth = Math.max(1, fontSize * 0.06);
		context.strokeStyle = decorationColor;
		context.beginPath();
		if (decorationLine.includes('line-through')) {
			context.moveTo(x, baseline - ascent * 0.3);
			context.lineTo(x + Math.max(targetWidth, naturalWidth), baseline - ascent * 0.3);
		}
		if (decorationLine.includes('underline')) {
			context.moveTo(x, baseline + descent * 0.25);
			context.lineTo(x + Math.max(targetWidth, naturalWidth), baseline + descent * 0.25);
		}
		context.stroke();
	}
}

function elementRects(element: Element): DOMRect[] {
	return [...element.getClientRects()];
}

export async function captureColumn(
	sourceHtml: string,
	scale = 2
): Promise<{ rgba: Uint8Array; width: number; height: number }> {
	const cssWidth = PAGE_WIDTH;
	const cssHeight = PAGE_HEIGHT;
	const pixelWidth = cssWidth * scale;
	const pixelHeight = cssHeight * scale;

	const host = document.createElement('div');
	host.style.cssText = `position:absolute;left:-30000px;top:0;width:${cssWidth}px;height:${cssHeight}px;overflow:hidden`;
	host.innerHTML = sourceHtml;
	document.body.appendChild(host);
	const canvas = document.createElement('canvas');
	canvas.width = pixelWidth;
	canvas.height = pixelHeight;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable');
	try {
		await document.fonts.ready;
		void host.offsetHeight;
		const origin = hostOrigin(host);
		context.fillStyle = '#ffffff';
		context.fillRect(0, 0, pixelWidth, pixelHeight);
		context.save();
		context.beginPath();
		context.rect(0, 0, pixelWidth, pixelHeight);
		context.clip();

		const elements = [...host.querySelectorAll('*')];
		for (const element of elements) {
			const style = getComputedStyle(element);
			const background = style.backgroundColor;
			if (isTransparent(background)) continue;
			context.globalAlpha = colorAlpha(background);
			context.fillStyle = background;
			for (const rect of elementRects(element)) {
				if (rect.width === 0 || rect.height === 0) continue;
				const x = (rect.left - origin.left) * scale;
				const y = (rect.top - origin.top) * scale;
				context.fillRect(x, y, rect.width * scale, rect.height * scale);
			}
			context.globalAlpha = 1;
		}

		const images = [...host.querySelectorAll('img')];
		const decoded: Array<{ element: HTMLImageElement; image: HTMLImageElement }> = [];
		for (const element of images) {
			const src = element.getAttribute('src') ?? '';
			if (!src.startsWith('data:')) continue;
			const image = new Image();
			image.src = src;
			try {
				await image.decode();
				decoded.push({ element, image });
			} catch {
				// unrenderable image stays blank, mirroring layout warnings
			}
		}
		for (const { element, image } of decoded) {
			const rect = element.getBoundingClientRect();
			const x = (rect.left - origin.left) * scale;
			const y = (rect.top - origin.top) * scale;
			if (rect.width > 0 && rect.height > 0) {
				context.drawImage(image, x, y, rect.width * scale, rect.height * scale);
			}
		}

		const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
		const textNodes: Text[] = [];
		while (walker.nextNode()) {
			textNodes.push(walker.currentNode as Text);
		}
		for (const node of textNodes) {
			paintTextNode(context, node, host, scale, origin);
		}

		context.restore();
		const small = document.createElement('canvas');
		small.width = cssWidth;
		small.height = cssHeight;
		const smallContext = small.getContext('2d');
		if (!smallContext) throw new Error('2D canvas unavailable');
		smallContext.imageSmoothingEnabled = true;
		smallContext.imageSmoothingQuality = 'high';
		smallContext.drawImage(canvas, 0, 0, cssWidth, cssHeight);
		const imageData = smallContext.getImageData(0, 0, cssWidth, cssHeight);
		const rgba = new Uint8Array(
			imageData.data.buffer,
			imageData.data.byteOffset,
			imageData.data.byteLength
		);
		return { rgba, width: cssWidth, height: cssHeight };
	} finally {
		host.remove();
	}
}
