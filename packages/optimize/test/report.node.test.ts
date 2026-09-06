import { describe, expect, it } from 'vitest';
import { createReport, renderTextReport } from '../src/report.ts';

describe('report', () => {
	it('counts warnings and renders entries', () => {
		const report = createReport(
			[
				{ level: 'success', code: 'image-done', message: 'done', file: 'a.jpg' },
				{ level: 'warning', code: 'image-kept', message: 'kept', file: 'b.jpg' }
			],
			1000,
			700
		);
		expect(report.warningCount).toBe(1);
		expect(report.sourceBytes).toBe(1000);
		expect(renderTextReport(report)).toContain('a.jpg');
	});
});
