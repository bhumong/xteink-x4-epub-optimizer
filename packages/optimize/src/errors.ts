export type OptimizeErrorCode =
	| 'not-epub'
	| 'not-zip'
	| 'encrypted-book'
	| 'missing-container'
	| 'missing-opf'
	| 'empty-spine'
	| 'missing-spine-file'
	| 'parse-error'
	| 'aborted';

export class OptimizeError extends Error {
	readonly code: OptimizeErrorCode;

	constructor(code: OptimizeErrorCode, message: string) {
		super(message);
		this.name = 'OptimizeError';
		this.code = code;
	}
}

export function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}
