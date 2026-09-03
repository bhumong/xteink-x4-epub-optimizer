<script lang="ts">
	import DropZone from './lib/DropZone.svelte';
	import { baseName, formatBytes } from './lib/format.ts';

	let selected = $state<File | null>(null);
</script>

<header class="bar">
	<h1>Xteink X4 EPUB Optimizer</h1>
	<p>CrossPoint firmware &middot; 480x800 &middot; everything runs in this tab</p>
</header>

<main>
	{#if selected}
		<section class="panel">
			<h2>{baseName(selected.name)}</h2>
			<p>{formatBytes(selected.size)}</p>
			<button type="button" onclick={() => (selected = null)}>Choose another file</button>
			<p class="note">Optimization is not implemented yet. Phase 1 adds it.</p>
		</section>
	{:else}
		<DropZone onpick={(file) => (selected = file)} />
	{/if}
</main>

<style>
	.bar {
		padding: 1.5rem;
		border-bottom: 1px solid var(--line);
	}
	.bar h1 {
		margin: 0;
		font-size: 1.25rem;
	}
	.bar p {
		margin: 0.25rem 0 0;
		color: var(--muted);
		font-size: 0.875rem;
	}
	main {
		max-width: 44rem;
		margin: 0 auto;
		padding: 1.5rem;
	}
	.panel h2 {
		margin: 0 0 0.25rem;
		font-size: 1rem;
	}
	.note {
		color: var(--muted);
		font-size: 0.875rem;
	}
</style>
