<script lang="ts">
	import {
		DEFAULT_OPTIONS,
		optimizeEpub,
		type OptimizeOptions as OptimizeOptionsType,
		type OptimizeResult,
		type ReportEntry
	} from '@xteink/optimize';
	import { preRenderXtc, type PreRenderResult } from '@xteink/pipeline';
	import DropZone from './lib/DropZone.svelte';
	import ModePicker, { type OutputMode } from './lib/ModePicker.svelte';
	import OptimizeOptions from './lib/OptimizeOptions.svelte';
	import ProgressPanel from './lib/ProgressPanel.svelte';
	import ReportPanel from './lib/ReportPanel.svelte';
	import { baseName, formatBytes } from './lib/format.ts';

	interface ViewModel {
		blob: Blob;
		fileName: string;
		downloadLabel: string;
		summary: Array<{ label: string; value: string }>;
		entries: ReportEntry[];
	}

	function epubViewModel(result: OptimizeResult): ViewModel {
		const report = result.report;
		return {
			blob: result.blob,
			fileName: result.fileName,
			downloadLabel: 'Download optimized EPUB',
			summary: [
				{ label: 'Source', value: formatBytes(report.sourceBytes) },
				{ label: 'Optimized', value: formatBytes(report.outputBytes) },
				{ label: 'Images', value: String(report.imageCount) },
				{ label: 'Warnings', value: String(report.warningCount) }
			],
			entries: report.entries
		};
	}

	function xtcViewModel(result: PreRenderResult, mode: 'xtc' | 'xtch'): ViewModel {
		const report = result.report;
		return {
			blob: result.blob,
			fileName: result.fileName,
			downloadLabel: `Download pre-rendered ${mode === 'xtc' ? 'XTC' : 'XTCH'}`,
			summary: [
				{ label: 'Source', value: formatBytes(report.sourceBytes) },
				{ label: 'Output', value: formatBytes(report.outputBytes) },
				{ label: 'Pages', value: String(report.pageCount) },
				{ label: 'Chapters', value: String(report.chapterCount) },
				{ label: 'Warnings', value: String(report.warningCount) }
			],
			entries: report.entries
		};
	}

	let selected = $state<File | null>(null);
	let outputMode = $state<OutputMode>('epub');
	let options = $state<OptimizeOptionsType>({ ...DEFAULT_OPTIONS });
	let progress = $state<{ percent: number; stage: string; message: string } | null>(null);
	let running = $state(false);
	let result = $state<ViewModel | null>(null);
	let error = $state('');
	let abortController: AbortController | null = null;
	let downloadUrl = '';

	async function convert() {
		if (!selected || running) return;
		running = true;
		error = '';
		result = null;
		progress = { percent: 0, stage: 'read', message: 'Reading' };
		const controller = new AbortController();
		abortController = controller;
		try {
			if (outputMode === 'epub') {
				result = epubViewModel(
					await optimizeEpub(
						selected,
						options,
						{
							onProgress(event) {
								progress = event;
							}
						},
						controller.signal
					)
				);
			} else {
				result = xtcViewModel(
					await preRenderXtc(
						selected,
						{ mode: outputMode },
						{
							onProgress(event) {
								progress = event;
							}
						},
						controller.signal
					),
					outputMode
				);
			}
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') return;
			error = err instanceof Error ? err.message : 'Conversion failed.';
		} finally {
			running = false;
			abortController = null;
		}
	}

	function cancel() {
		abortController?.abort();
	}

	function download() {
		if (!result) return;
		if (downloadUrl) URL.revokeObjectURL(downloadUrl);
		downloadUrl = URL.createObjectURL(result.blob);
		const link = document.createElement('a');
		link.href = downloadUrl;
		link.download = result.fileName;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	}
</script>

<header class="topbar">
	<h1>Xteink X4 EPUB Optimizer</h1>
	<p>EPUB optimize and pre-render</p>
</header>

<main>
	{#if !selected}
		<DropZone
			onpick={(file) => {
				selected = file;
				result = null;
				error = '';
			}}
		/>
	{:else}
		<section class="panel">
			<h2>{baseName(selected.name)}</h2>
			<p>{formatBytes(selected.size)}</p>
			<ModePicker
				mode={outputMode}
				onchange={(next) => {
					outputMode = next;
					result = null;
					error = '';
				}}
			/>
			{#if outputMode === 'epub'}
				<OptimizeOptions {options} onchange={(next) => (options = next)} />
			{:else if outputMode === 'xtch'}
				<p class="size-note">
					Pre-rendered 2-bit pages run about twice the file size of 1-bit XTC (roughly 9.6 MB per
					200 pages for XTC, 19.2 MB for XTCH). Trade size for instant page turns with no on-device
					layout.
				</p>
			{/if}
			<div class="actions">
				<button type="button" class="primary" disabled={running} onclick={convert}>Convert</button>
				<button
					type="button"
					disabled={running}
					onclick={() => {
						selected = null;
						result = null;
						error = '';
					}}>Choose another file</button
				>
			</div>
		</section>
	{/if}

	{#if running && progress}
		<ProgressPanel {progress} oncancel={cancel} />
	{/if}

	{#if error}
		<section class="error" role="alert">
			<p>{error}</p>
			<button type="button" onclick={() => (error = '')}>Dismiss</button>
		</section>
	{/if}

	{#if result}
		<ReportPanel
			downloadLabel={result.downloadLabel}
			summary={result.summary}
			entries={result.entries}
			ondownload={download}
		/>
	{/if}
</main>
