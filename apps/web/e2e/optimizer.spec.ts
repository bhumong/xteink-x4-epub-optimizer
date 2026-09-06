import { expect, test } from '@playwright/test';

test('optimizes and downloads an EPUB from metadata', async ({ page }) => {
	await page.goto('/');
	await page.locator('input[type="file"]').setInputFiles('fixtures/epubs/minimal-epub3/book.epub');
	await page.getByLabel('Rename from metadata').check();
	await page.getByRole('button', { name: 'Convert' }).click();

	const downloadButton = page.getByRole('button', { name: 'Download optimized EPUB' });
	await expect(downloadButton).toBeVisible({ timeout: 20_000 });
	const downloadPromise = page.waitForEvent('download');
	await downloadButton.click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe('Minimal Three - Fixture Author.epub');
});

test('rejects an encrypted fixture with an error', async ({ page }) => {
	await page.goto('/');
	await page.locator('input[type="file"]').setInputFiles('fixtures/epubs/encrypted/book.epub');
	await page.getByRole('button', { name: 'Convert' }).click();
	await expect(page.getByRole('alert')).toContainText('Encrypted', { timeout: 20_000 });
});
