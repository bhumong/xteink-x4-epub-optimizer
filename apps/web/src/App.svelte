<script lang="ts">
	import {
		DEFAULT_OPTIONS,
		optimizeEpub,
		type OptimizeOptions as OptimizeOptionsType,
		type OptimizeResult,
		type ProgressEvent
	} from '@xteink/optimize';
	import DropZone from './lib/DropZone.svelte';
	import OptimizeOptions from './lib/OptimizeOptions.svelte';
	import ProgressPanel from './lib/ProgressPanel.svelte';
	import ReportPanel from './lib/ReportPanel.svelte';
	import { baseName, formatBytes } from './lib/format.ts';

	let selected = $state<File | null>(null);
	let options = $state<OptimizeOptionsType>({ ...DEFAULT_OPTIONS });
	let progress = $state<ProgressEvent | null>(null);
	let running = $state(false);
	let result = $state<OptimizeResult | null>(null);
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
			result = await optimizeEpub(
				selected,
				options,
				{
					onProgress(event) {
						progress = event;
					}
				},
				controller.signal
			);
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
		link.click();
	}
</script>

<header class="topbar">
	<h1>Xteink X4 EPUB Optimizer</h1>
	<p>EPUB optimize</p>
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
			<OptimizeOptions {options} onchange={(next) => (options = next)} />
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
		<ReportPanel {result} ondownload={download} />
	{/if}
</main>
