import type { OptimizeOptions } from './types.ts';

export const JPEG_QUALITY_MIN = 50;
export const JPEG_QUALITY_MAX = 95;

export const DEFAULT_OPTIONS: OptimizeOptions = {
	jpegQuality: 85,
	renameFromMetadata: false
};

export function validateOptions(input: OptimizeOptions): OptimizeOptions {
	const quality = Math.round(Number(input.jpegQuality));
	if (!Number.isFinite(quality)) {
		throw new Error('jpegQuality must be a finite number');
	}
	return {
		jpegQuality: Math.min(JPEG_QUALITY_MAX, Math.max(JPEG_QUALITY_MIN, quality)),
		renameFromMetadata: Boolean(input.renameFromMetadata)
	};
}
