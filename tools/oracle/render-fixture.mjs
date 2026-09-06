import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const [, , fixtureDir, caseName, mode, outDir] = process.argv;

if (!fixtureDir || !caseName || !mode || !outDir) {
	console.error('usage: render-fixture.mjs <fixture-dir> <case> <mode> <out-dir>');
	process.exit(2);
}

async function waitForServer(url, timeoutMs) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			// server not up yet
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`app server did not start at ${url}`);
}

const port = process.env.ORACLE_APP_PORT ?? '5180';
const server = spawn(
	'npm',
	['run', 'dev', '-w', 'apps/web', '--', '--port', port, '--strictPort'],
	{ stdio: 'ignore' }
);

let browser;
try {
	await waitForServer(`http://127.0.0.1:${port}`, 60_000);
	browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	await page.goto(`http://127.0.0.1:${port}`);
	await page.locator('input[type="file"]').setInputFiles(`${fixtureDir}/book.epub`);
	if (mode === 'xtch') {
		await page.locator('input[value="xtch"]').check();
	} else {
		await page.locator('input[value="xtc"]').check();
	}
	await page.getByRole('button', { name: 'Convert' }).click();
	const label = mode === 'xtch' ? 'Download pre-rendered XTCH' : 'Download pre-rendered XTC';
	const downloadButton = page.getByRole('button', { name: label });
	await downloadButton.waitFor({ timeout: 120_000 });
	const downloadPromise = page.waitForEvent('download');
	await downloadButton.click();
	const download = await downloadPromise;
	await mkdir(outDir, { recursive: true });
	await download.saveAs(`${outDir}/${caseName}.${mode}`);
	console.log(`saved ${caseName}.${mode}`);
} finally {
	await browser?.close();
	server.kill();
}
