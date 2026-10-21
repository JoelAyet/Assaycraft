import { skipTour } from './helpers';
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(import.meta.dirname, '../../dist-single/assaycraft.html');

test.describe('single-file build', () => {
  test.skip(!existsSync(file), 'run `npm run build:single` first');

  test('works when opened straight from disk', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await skipTour(page);
    await page.goto('file://' + file);
    await expect(page.getByRole('heading', { name: 'Assaycraft' })).toBeVisible();
    // Folder access is available from file:// (it is a secure context).
    expect(
      await page.evaluate(() => window.isSecureContext && typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'),
    ).toBe(true);
    await page.getByRole('button', { name: /Create browser notebook/ }).click();
    await page.getByRole('button', { name: 'Create notebook' }).click();
    await expect(page.locator('.gc-sidebar')).toBeVisible();
    await page.locator('.gc-new-btn').click();
    await page.locator('#ne-title').fill('Offline entry');
    await page.getByRole('button', { name: 'Create entry' }).click();
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('Works offline.');
    await expect(page.locator('.gc-save-saved')).toBeVisible();
    await page.reload();
    await expect(page.locator('.ProseMirror')).toContainText('Works offline.');

    // PDF import works from disk too (pdf.js and its worker are inside the file).
    await page.locator('.gc-nav-item', { hasText: 'Protocols' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import PDF' }).first().click();
    await (
      await chooser
    ).setFiles({ name: 'gibson.pdf', mimeType: 'application/pdf', buffer: readFileSync('tests/fixtures/pdf/gibson-chromium.pdf') });
    await expect(page.locator('.gc-pdf-card-sub')).toContainText('2 pages converted', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Create protocol' }).click();
    await expect(page.locator('.gc-title-input')).toHaveValue('Gibson assembly of three fragments');
    await expect(page.locator('.ProseMirror')).toContainText('Combine the fragments with the master mix');
    await expect(page.locator('.ProseMirror img')).toHaveCount(1);

    // TIFF previews too (the decoder and its deflate code are inside the file).
    await page.locator('.ProseMirror').click();
    const tiffChooser = page.waitForEvent('filechooser');
    await page.locator('.gc-toolbar').getByRole('button', { name: 'Attach files' }).click();
    await (await tiffChooser).setFiles({ name: 'stack.tif', mimeType: 'image/tiff', buffer: readFileSync('tests/fixtures/tiff/stack-3pages.tif') });
    await expect(page.locator('.gc-image-meta')).toContainText('Page 1 of 3');
    expect(errors).toEqual([]);
  });
});
