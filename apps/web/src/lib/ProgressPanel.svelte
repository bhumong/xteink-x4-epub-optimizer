<script lang="ts">
	let {
		progress,
		oncancel
	}: {
		progress: { percent: number; stage: string; message: string };
		oncancel: () => void;
	} = $props();
	const labels: Record<string, string> = {
		read: 'Reading',
		images: 'Images',
		normalize: 'Normalizing',
		measure: 'Measuring pages',
		render: 'Rendering pages',
		pack: 'Packing',
		write: 'Writing',
		done: 'Done'
	};
</script>

<div class="progress-panel" role="status">
	<p>{labels[progress.stage]} - {progress.percent}%</p>
	<div class="bar"><div class="fill" style:width="{progress.percent}%"></div></div>
	<button type="button" onclick={oncancel}>Cancel</button>
</div>
