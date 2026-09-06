<script lang="ts">
	import type { OptimizeOptions } from '@xteink/optimize';

	let {
		options,
		onchange
	}: { options: OptimizeOptions; onchange: (options: OptimizeOptions) => void } = $props();
</script>

<fieldset>
	<label for="quality">JPEG quality {options.jpegQuality}</label>
	<input
		id="quality"
		type="range"
		min="50"
		max="95"
		step="1"
		value={options.jpegQuality}
		oninput={(e) =>
			onchange({ ...options, jpegQuality: Number((e.target as HTMLInputElement).value) })}
	/>
	<label class="check" for="rename">
		<input
			id="rename"
			type="checkbox"
			checked={options.renameFromMetadata}
			onchange={(e) =>
				onchange({ ...options, renameFromMetadata: (e.target as HTMLInputElement).checked })}
		/>
		Rename from metadata
	</label>
</fieldset>
