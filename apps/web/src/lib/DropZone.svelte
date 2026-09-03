<script lang="ts">
	import { fileExtension } from '@xteink/optimize';
	import FileButton from './FileButton.svelte';

	let { onpick }: { onpick: (file: File) => void } = $props();
	let dragging = $state(false);
	let rejection = $state('');

	function accept(files: FileList | null) {
		const file = files?.[0];
		if (!file) return;
		if (fileExtension(file.name) !== 'epub') {
			rejection = 'Only .epub files are supported.';
			return;
		}
		rejection = '';
		onpick(file);
	}
</script>

<div
	class="drop-zone"
	class:dragging
	role="presentation"
	ondragover={(e) => {
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={(e) => {
		e.preventDefault();
		dragging = false;
		accept(e.dataTransfer?.files ?? null);
	}}
>
	<p>Drop an EPUB here</p>
	<FileButton label="Choose file" {onpick} />
	{#if rejection}<p class="rejection" role="alert">{rejection}</p>{/if}
</div>

<style>
	.drop-zone {
		display: grid;
		gap: 0.75rem;
		justify-items: center;
		padding: 2.5rem 1.5rem;
		border: 1px dashed var(--line);
		border-radius: 8px;
		background: var(--panel);
		text-align: center;
	}
	.drop-zone.dragging {
		border-color: var(--accent);
		background: var(--panel-hover);
	}
	.drop-zone p {
		margin: 0;
	}
	.rejection {
		color: var(--warn);
	}
</style>
