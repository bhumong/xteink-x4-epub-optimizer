import { playwright } from '@vitest/browser-playwright';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const optimize = root + 'packages/optimize/src';
const xtc = root + 'packages/xtc/src';
const pipeline = root + 'packages/pipeline/src';
// Regex, not string keys: Vite treats a string alias key as a prefix match, so
// '@xteink/optimize/paths.ts' would otherwise rewrite to '.../src/index.ts/paths.ts'.
const alias = [
	{ find: /^@xteink\/optimize$/, replacement: optimize + '/index.ts' },
	{ find: /^@xteink\/optimize\//, replacement: optimize + '/' },
	{ find: /^@xteink\/xtc$/, replacement: xtc + '/index.ts' },
	{ find: /^@xteink\/xtc\//, replacement: xtc + '/' },
	{ find: /^@xteink\/pipeline$/, replacement: pipeline + '/index.ts' },
	{ find: /^@xteink\/pipeline\//, replacement: pipeline + '/' }
];

export default defineConfig({
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				resolve: { alias },
				test: {
					name: 'node',
					environment: 'node',
					include: [
						'packages/optimize/test/**/*.node.test.ts',
						'packages/xtc/test/**/*.node.test.ts',
						'packages/pipeline/test/**/*.node.test.ts',
						'apps/server/test/**/*.node.test.ts'
					]
				}
			},
			{
				resolve: { alias },
				test: {
					name: 'browser',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: [
						'packages/optimize/test/**/*.browser.test.ts',
						'packages/pipeline/test/**/*.browser.test.ts'
					]
				}
			},
			{
				resolve: { alias },
				plugins: [svelte({ compilerOptions: { runes: true } })],
				test: {
					name: 'web',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['apps/web/src/**/*.browser.test.ts']
				}
			}
		]
	}
});
