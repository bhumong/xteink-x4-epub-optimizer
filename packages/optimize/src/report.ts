import type { OptimizeReport, ReportEntry } from './types.ts';

export function entry(
	level: ReportEntry['level'],
	code: string,
	message: string,
	file?: string
): ReportEntry {
	return { level, code, message, file };
}

export function createReport(
	entries: ReportEntry[],
	sourceBytes: number,
	outputBytes: number
): OptimizeReport {
	const warnings = entries.filter((item) => item.level === 'warning');
	const errors = entries.filter((item) => item.level === 'error');
	const fontRemovedCount = entries.filter((item) => item.code === 'font-removed').length;
	const scriptRemovedCount = entries.filter((item) => item.code === 'script-removed').length;
	const imageCount = entries.filter((item) => item.code === 'image-encoded').length;

	return {
		entries,
		sourceBytes,
		outputBytes,
		imageCount,
		fontRemovedCount,
		scriptRemovedCount,
		warningCount: warnings.length,
		errorCount: errors.length
	};
}

export function renderTextReport(report: OptimizeReport): string {
	const lines = report.entries.map((item) => {
		const prefix = item.level.toUpperCase();
		const file = item.file ? ` [${item.file}]` : '';
		return `${prefix}${file}: ${item.message}`;
	});
	return lines.join('\n');
}
