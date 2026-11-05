import { test, expect, type Page } from '@playwright/test';
import { newBlankEntry, openFolderNotebook, readFile, trackErrors, waitForSave } from './helpers';

const pathOf = (page: Page) => decodeURIComponent(new URL(page.url()).hash.replace('#/doc/', ''));

/** A busy computer: animation frames come late (as on a loaded laptop), so anything left to "the next frame" lags typing. */
async function slowFrames(page: Page) {
  await page.evaluate(() => {
    window.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 120) as unknown as number;
  });
}

test('a save that fails says so, keeps the change, and saves it when storage works again', async ({ page }) => {
  await page.addInitScript(() => {
    // Writing to the notebook folder fails while this is set (a full disk, a lost permission).
    const w = window as unknown as { __failWrites?: boolean };
    const original = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = function (this: FileSystemFileHandle, ...args: Parameters<typeof original>) {
      if (w.__failWrites && this.name.endsWith('.md')) return Promise.reject(new DOMException('The disk is full', 'QuotaExceededError'));
      return original.apply(this, args);
    };
  });
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Western blot');
  await waitForSave(page);
  const path = pathOf(page);
  expect(await readFile(page, path)).toContain('status: in-progress');

  await page.evaluate(() => ((window as unknown as { __failWrites?: boolean }).__failWrites = true));
  await page.getByRole('button', { name: 'Add tag' }).click();
  await page.keyboard.type('transfer');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  const failed = page.locator('.gc-save-error');
  await expect(failed).toHaveText('Save failed');
  await expect(page.locator('.toast.error')).toContainText('Your changes are kept');
  expect(await readFile(page, path)).not.toContain('transfer');
  // Still failed, never "Saved", after another try.
  await failed.click();
  await expect(failed).toHaveText('Save failed');

  await page.evaluate(() => ((window as unknown as { __failWrites?: boolean }).__failWrites = false));
  await failed.click();
  await expect(page.locator('.gc-save-saved')).toHaveText('Saved');
  expect(await readFile(page, path)).toContain('tags: [transfer]');
});

test('the sidebar works from the keyboard', async ({ page }) => {
  await openFolderNotebook(page);
  const home = page.locator('.gc-nav-item', { hasText: 'Home' });
  await expect(home).toHaveAttribute('role', 'link');
  await expect(home).toHaveAttribute('aria-current', 'page');
  // Tab from New entry reaches the places in the sidebar.
  await page.locator('.gc-new-btn').focus();
  let found = false;
  for (let i = 0; i < 12 && !found; i++) {
    await page.keyboard.press('Tab');
    found = await page.evaluate(() => document.activeElement?.textContent?.trim() === 'Calendar');
  }
  expect(found).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.locator('.gc-page-title').first()).toHaveText('Calendar');
  await expect(page.locator('.gc-nav-item', { hasText: 'Calendar' })).toHaveAttribute('aria-current', 'page');
  await page.locator('.gc-nav-item', { hasText: 'Protocols' }).focus();
  await page.keyboard.press(' ');
  await expect(page.locator('.gc-page-title').first()).toHaveText('Protocols');
});

test('keyboard focus stays in an open dialog, and goes back to what opened it', async ({ page }) => {
  const errors = trackErrors(page);
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Focus check');
  const opener = page.locator('.gc-new-btn');
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const inDialog = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await inDialog()).toBe(true);
  }
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    expect(await inDialog()).toBe(true);
  }
  // The page behind cannot be reached meanwhile.
  expect(await page.locator('.gc-app').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await page.locator('.gc-app').evaluate((el) => (el as HTMLElement).inert)).toBe(false);
  expect(errors).toEqual([]);
});

test('a formula built by clicking cells quickly gets every reference, even when frames come late', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'OD');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('/table');
  await page.keyboard.press('Enter');
  const sheet = page.locator('.gc-sheet');
  const cell = (r: number, c: number) => sheet.locator(`td[data-r="${r}"][data-c="${c}"]`);
  await cell(1, 1).click();
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');
  await cell(2, 1).click();
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  await slowFrames(page);
  await cell(3, 1).click();
  await page.keyboard.type('=');
  await cell(1, 1).click();
  // "+" right away; the next click comes after the late frame.
  await page.keyboard.type('+');
  await page.waitForTimeout(250);
  await cell(2, 1).click();
  await page.keyboard.press('Enter');
  await expect(cell(3, 1)).toHaveText('5');
  await waitForSave(page);
  expect(await readFile(page, pathOf(page))).toContain('"B4":"=B2+B3"');
});

test('a new stock takes what is typed right away, even when frames come late', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await page.locator('.gc-nav-item', { hasText: 'Stocks' }).click();
  await page.getByRole('button', { name: 'New collection' }).click();
  await page.locator('.dialog .gc-template-option', { hasText: 'Seeds' }).click();
  await page.getByRole('button', { name: 'Create collection' }).click();
  await expect(page.locator('.gc-stock-table th').first()).toBeVisible();
  await slowFrames(page);
  await page.locator('.gc-new-main').click();
  await page.keyboard.type('Col-0');
  await expect(page.locator('.gc-stock-table .gc-cell-grow[data-value="Col-0"]')).toHaveCount(1);
});
