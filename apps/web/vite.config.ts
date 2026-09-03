import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [svelte({ compilerOptions: { runes: true } })],
	build: { outDir: 'dist', emptyOutDir: true },
	server: { port: 5173 }
});
