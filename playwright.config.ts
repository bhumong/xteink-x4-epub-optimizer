import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'apps/web/e2e',
	use: { baseURL: 'http://127.0.0.1:5173' },
	webServer: {
		command: 'npm run dev -w apps/web',
		url: 'http://127.0.0.1:5173',
		reuseExistingServer: true,
		timeout: 600_000
	}
});
