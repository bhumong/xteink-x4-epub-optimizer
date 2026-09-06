<script lang="ts">
	import { baseName } from './format.ts';
	import type { ReportEntry } from '@xteink/optimize';

	export interface SummaryRow {
		label: string;
		value: string;
	}

	let {
		downloadLabel,
		summary,
		entries,
		ondownload
	}: {
		downloadLabel: string;
		summary: SummaryRow[];
		entries: ReportEntry[];
		ondownload: () => void;
	} = $props();
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
		{#each summary as row (row.label)}
			<div>
				<strong>{row.value}</strong>
				<span>{row.label}</span>
			</div>
		{/each}
	</div>

	<button type="button" class="primary" onclick={ondownload}>{downloadLabel}</button>
	<button type="button" onclick={() => (expanded = !expanded)}>
		{expanded ? 'Hide change log' : 'Show change log'}
	</button>

	{#if expanded}
		<div class="log">
			{#each [...groups(entries)] as [file, fileEntries]}
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
