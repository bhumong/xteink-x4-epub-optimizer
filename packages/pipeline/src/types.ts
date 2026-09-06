import type { ReportEntry } from '@xteink/optimize';
import type { XtcMode } from '@xteink/xtc';

export interface PreRenderProgressEvent {
	percent: number;
	stage: string;
	message: string;
}

export interface PreRenderOptions {
	mode: XtcMode;
}

export interface PreRenderReport {
	sourceBytes: number;
	outputBytes: number;
	pageCount: number;
	chapterCount: number;
	warningCount: number;
	errorCount: number;
	entries: ReportEntry[];
}

export interface PreRenderResult {
	blob: Blob;
	fileName: string;
	report: PreRenderReport;
}

export interface PreRenderCallbacks {
	onProgress(event: PreRenderProgressEvent): void;
}
