export const VIEWPORT_WIDTH = 480;
export const VIEWPORT_HEIGHT = 800;

export interface OptimizeOptions {
	jpegQuality: number;
	renameFromMetadata: boolean;
}

export interface Metadata {
	title: string;
	author: string;
	language: string;
	coverItemId?: string;
}

export interface ManifestItem {
	id: string;
	href: string;
	mediaType: string;
	zipPath: string;
}

export interface SpineItem {
	idref: string;
	href: string;
	zipPath: string;
}

export interface EpubSource {
	opfPath: string;
	opfDir: string;
	resources: Map<string, Uint8Array>;
	manifest: Map<string, ManifestItem>;
	spine: SpineItem[];
	metadata: Metadata;
}

export interface PreparedEpub {
	source: EpubSource;
	resources: Map<string, Uint8Array>;
	entries: ReportEntry[];
	sourceBytes: number;
	imageRenameMap: Map<string, string>;
}

export type ReportLevel = 'info' | 'success' | 'warning' | 'error';

export interface ReportEntry {
	level: ReportLevel;
	code: string;
	message: string;
	file?: string;
	beforeBytes?: number;
	afterBytes?: number;
}

export interface OptimizeReport {
	entries: ReportEntry[];
	sourceBytes: number;
	outputBytes: number;
	imageCount: number;
	fontRemovedCount: number;
	scriptRemovedCount: number;
	warningCount: number;
	errorCount: number;
}

export interface OptimizeResult {
	blob: Blob;
	fileName: string;
	report: OptimizeReport;
}

export type ProgressStage = 'read' | 'images' | 'normalize' | 'pack' | 'done';

export interface ProgressEvent {
	percent: number;
	stage: ProgressStage;
	message: string;
}

export interface OptimizeCallbacks {
	onProgress(event: ProgressEvent): void;
}

export interface ImageChange {
	sourcePath: string;
	targetPath: string;
	width: number;
	height: number;
	sourceBytes: number;
	targetBytes: number;
}
