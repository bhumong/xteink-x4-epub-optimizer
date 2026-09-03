<script lang="ts">
	let { label, onpick }: { label: string; onpick: (file: File) => void } = $props();
	let input: HTMLInputElement | undefined = $state();
</script>

<button type="button" class="file-button" onclick={() => input?.click()}>{label}</button>
<input
	id="epub-input"
	bind:this={input}
	type="file"
	accept=".epub,application/epub+zip"
	class="visually-hidden"
	onchange={(e) => {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (file) onpick(file);
	}}
/>

<style>
	.file-button {
		padding: 0.5rem 1rem;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--panel);
		font: inherit;
		cursor: pointer;
	}
	.file-button:hover {
		background: var(--panel-hover);
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
</style>
