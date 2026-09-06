<script module lang="ts">
	export type OutputMode = 'epub' | 'xtc' | 'xtch';
</script>

<script lang="ts">
	let {
		mode,
		onchange
	}: {
		mode: OutputMode;
		onchange: (mode: OutputMode) => void;
	} = $props();
	const options: Array<{ value: OutputMode; label: string; hint?: string }> = [
		{ value: 'epub', label: 'Optimized EPUB', hint: 'repacked for the device EPUB engine' },
		{ value: 'xtc', label: 'Pre-rendered XTC', hint: '1-bit pages, instant turns' },
		{
			value: 'xtch',
			label: 'Pre-rendered XTCH',
			hint: '2-bit grayscale, about twice the size (opt-in)'
		}
	];
</script>

<fieldset class="mode-picker">
	<legend>Output mode</legend>
	{#each options as option (option.value)}
		<label>
			<input
				type="radio"
				name="mode"
				value={option.value}
				checked={mode === option.value}
				onchange={() => onchange(option.value)}
			/>
			<span>{option.label}</span>
			{#if option.hint}<small>{option.hint}</small>{/if}
		</label>
	{/each}
</fieldset>
