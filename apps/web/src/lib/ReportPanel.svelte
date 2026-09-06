<script lang="ts">
	import type { OptimizeResult, ReportEntry } from '@xteink/optimize';
	import { baseName, formatBytes } from './format.ts';

	let { result, ondownload }: { result: OptimizeResult; ondownload: () => void } = $props();
	let expanded = $state(false);

	function groups(entries: ReportEntry[]): Map<string, ReportEntry[]> {
		const map = new Map<string, ReportEntry[]>();
		for (const item of entries) {
			const key = item.file ?? '(book)';
			const list = map.get(key) ?? [];
			list.push(item);
			map.set(key, list);
		}
		return map;
	}
</script>

<section class="report-panel">
	<div class="summary">
		<div>
			<strong>{formatBytes(result.report.sourceBytes)}</strong>
			<span>source</span>
		</div>
		<div>
			<strong>{formatBytes(result.report.outputBytes)}</strong>
			<span>optimized</span>
		</div>
		<div>
			<strong>{result.report.imageCount}</strong>
			<span>images</span>
		</div>
		<div>
			<strong>{result.report.warningCount}</strong>
			<span>warnings</span>
		</div>
	</div>

	<button type="button" class="primary" onclick={ondownload}>Download optimized EPUB</button>
	<button type="button" onclick={() => (expanded = !expanded)}>
		{expanded ? 'Hide change log' : 'Show change log'}
	</button>

	{#if expanded}
		<div class="log">
			{#each [...groups(result.report.entries)] as [file, fileEntries]}
				<h3>{baseName(file)}</h3>
				<ul>
					{#each fileEntries as item (item.code + item.message)}
						<li class:warning={item.level === 'warning'}>{item.message}</li>
					{/each}
				</ul>
			{/each}
		</div>
	{/if}
</section>
