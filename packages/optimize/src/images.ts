import { VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from './types.ts';

const RASTER_PREFIX = 'image/';
const NON_RASTER = new Set(['image/svg+xml']);

export function isRasterMediaType(mediaType: string): boolean {
	return mediaType.startsWith(RASTER_PREFIX) && !NON_RASTER.has(mediaType.toLowerCase());
}

/**
 * BlobPart rejects `ArrayBufferLike` (it could be a SharedArrayBuffer). Bytes
 * reaching the image pipeline are always ArrayBuffer-backed: JSZip, File, and
 * canvas reads produce them. Copy only when the view does not cover the whole
 * buffer so a subarray never drags unrelated bytes into the decode.
 */
function blobFromBytes(data: Uint8Array): Blob {
	if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
		return new Blob([data.buffer as ArrayBuffer]);
	}
	const exact = new Uint8Array(data.byteLength);
	exact.set(data);
	return new Blob([exact]);
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (!blob) {
					reject(new Error('JPEG encoding returned no blob'));
					return;
				}
				blob
					.arrayBuffer()
					.then((buffer) => resolve(new Uint8Array(buffer)))
					.catch(reject);
			},
			'image/jpeg',
			quality / 100
		);
	});
}

export async function optimizeRasterImage(
	data: Uint8Array,
	jpegQuality: number
): Promise<{ data: Uint8Array; width: number; height: number }> {
	const bitmap = await createImageBitmap(blobFromBytes(data));
	try {
		const scale = Math.min(1, VIEWPORT_WIDTH / bitmap.width, VIEWPORT_HEIGHT / bitmap.height);
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Canvas 2D context unavailable');

		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, width, height);
		ctx.filter = 'grayscale(1)';
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(bitmap, 0, 0, width, height);

		const jpeg = await canvasToJpeg(canvas, jpegQuality);
		return { data: jpeg, width, height };
	} finally {
		bitmap.close();
	}
}
