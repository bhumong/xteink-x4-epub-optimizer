import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../src/options.ts';

describe('options', () => {
	it('defaults to a device-safe JPEG quality and no rename', () => {
		expect(DEFAULT_OPTIONS).toEqual({ jpegQuality: 85, renameFromMetadata: false });
	});
});
