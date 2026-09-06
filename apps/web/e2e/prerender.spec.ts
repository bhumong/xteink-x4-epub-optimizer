import { expect, test } from '@playwright/test';

test('converts and downloads a pre-rendered XTC', async ({ page }) => {
	await page.goto('/');
	await page.locator('input[type="file"]').setInputFiles('fixtures/epubs/minimal-epub3/book.epub');
	await page.locator('input[value="xtc"]').check();
	await page.getByRole('button', { name: 'Convert' }).click();

	const downloadButton = page.getByRole('button', { name: 'Download pre-rendered XTC' });
	await expect(downloadButton).toBeVisible({ timeout: 30_000 });
	const downloadPromise = page.waitForEvent('download');
	await downloadButton.click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe('Minimal Three - Fixture Author.xtc');
	expect(await download.path()).toBeTruthy();
});

test('converts and downloads a pre-rendered XTCH', async ({ page }) => {
	await page.goto('/');
	await page.locator('input[type="file"]').setInputFiles('fixtures/epubs/minimal-epub3/book.epub');
	await page.locator('input[value="xtch"]').check();
	await page.getByRole('button', { name: 'Convert' }).click();

	const downloadButton = page.getByRole('button', { name: 'Download pre-rendered XTCH' });
	await expect(downloadButton).toBeVisible({ timeout: 30_000 });
	const downloadPromise = page.waitForEvent('download');
	await downloadButton.click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe('Minimal Three - Fixture Author.xtch');
});
