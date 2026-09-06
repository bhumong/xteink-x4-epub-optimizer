<script lang="ts">
	import type { ProgressEvent } from '@xteink/optimize';

	let { progress, oncancel }: { progress: ProgressEvent; oncancel: () => void } = $props();
	const labels: Record<string, string> = {
		read: 'Reading',
		images: 'Images',
		normalize: 'Normalizing',
		pack: 'Packing',
		done: 'Done'
	};
</script>

<div class="progress-panel" role="status">
	<p>{labels[progress.stage]} - {progress.percent}%</p>
	<div class="bar"><div class="fill" style:width="{progress.percent}%"></div></div>
	<button type="button" onclick={oncancel}>Cancel</button>
</div>
