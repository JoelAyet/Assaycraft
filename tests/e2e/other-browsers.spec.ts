import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { newBlankEntry, skipTour, trackErrors, waitForSave } from './helpers';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = trackErrors(page);
});
test.afterEach(() => {
  expect(errors, 'uncaught errors in the page').toEqual([]);
});

const FOLDERS = join('tests', 'fixtures', 'folder-notebook');
const PNG = join(FOLDERS, 'Gel photos', 'gel.png');

/** Like Safari and Firefox: no File System Access API, so a folder can be read but not saved into. */
async function withoutFolderAccess(page: Page) {
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true }));
}

async function openFolderCopy(page: Page, folder: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await (await chooser).setFiles(join(FOLDERS, folder));
}

async function createBrowserNotebook(page: Page) {
  await page.getByText('Start new notebooks with example templates').click();
  await page.getByRole('button', { name: /Create browser notebook/ }).click();
  await page.getByRole('button', { name: 'Create notebook' }).click();
  await expect(page.locator('.gc-sidebar')).toBeVisible();
}

const imageShown = (page: Page) =>
  expect
    .poll(() =>
      page
        .locator('.ProseMirror img')
        .evaluateAll((imgs) => imgs.map((i) => `${(i as HTMLImageElement).naturalWidth}x${(i as HTMLImageElement).naturalHeight}`)),
    )
    .toContain('32x24');

test('in Safari and Firefox, opening a notebook folder copies it into browser storage', async ({ page }) => {
  await skipTour(page);
  await withoutFolderAccess(page);
  await page.goto('/');
  await expect(page.locator('.gc-option-note')).toContainText('can read a folder but not save into it');
  await openFolderCopy(page, 'Smith lab');

  // Its Markdown, attachment and settings are copied; system files (Thumbs.db, ._ files) are not.
  await expect(page.locator('.toast')).toContainText('Copied the notebook (4 files) into this browser');
  await expect(page.locator('.gc-storage')).toContainText('Browser storage');
  await expect(page.locator('.gc-sidebar')).toContainText('Smith lab');
  await page.evaluate(
    () => (location.hash = '#/doc/' + ['Projects', 'IL-6 study', 'EXP-0007 IL-6 ELISA day 3.md'].map(encodeURIComponent).join('/')),
  );
  await expect(page.locator('.gc-title-input')).toHaveValue('IL-6 ELISA day 3');
  await expect(page.locator('.ProseMirror')).toContainText('Plate read at 450 nm.');
  await imageShown(page);

  // It is now a notebook of this browser, kept across reloads.
  await page.reload();
  await expect(page.locator('.gc-title-input')).toHaveValue('IL-6 ELISA day 3');
  await imageShown(page);
});

test('a folder without a notebook in it is not copied', async ({ page }) => {
  await skipTour(page);
  await withoutFolderAccess(page);
  await page.goto('/');
  await openFolderCopy(page, 'Gel photos');
  await expect(page.locator('.toast')).toContainText('“Gel photos” has no notebook in it');
  await expect(page.locator('.gc-welcome')).toBeVisible();
});

test('an image attached in a browser notebook is kept across reloads', async ({ page }) => {
  await skipTour(page);
  await page.goto('/');
  await createBrowserNotebook(page);
  await newBlankEntry(page, 'Gel of the PCR');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach files' }).click();
  await (await chooser).setFiles(PNG);
  await imageShown(page);
  await waitForSave(page);
  await page.reload();
  await expect(page.locator('.gc-title-input')).toHaveValue('Gel of the PCR');
  await imageShown(page);
});

test('a browser notebook saved by an earlier version, with its files stored as Blobs, still opens', async ({ page }) => {
  await skipTour(page);
  await page.goto('/');
  await createBrowserNotebook(page);
  await newBlankEntry(page, 'Old entry');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Written before the storage change.');
  await waitForSave(page);

  // Earlier versions stored every file as a Blob.
  const converted = await page.evaluate(async () => {
    const [info] = (await indexedDB.databases()).filter((d) => d.name?.startsWith('genecraft-notebook-'));
    const db = await new Promise<IDBDatabase>((done, fail) => {
      const req = indexedDB.open(info.name!);
      req.onsuccess = () => done(req.result);
      req.onerror = () => fail(req.error);
    });
    const store = db.transaction('files', 'readwrite').objectStore('files');
    const recs = await new Promise<{ path: string; kind: string; data?: unknown }[]>((done) => {
      const req = store.getAll();
      req.onsuccess = () => done(req.result);
    });
    let n = 0;
    for (const rec of recs)
      if (rec.kind === 'file' && typeof rec.data === 'string') {
        store.put({ ...rec, data: new Blob([rec.data], { type: 'text/markdown' }) });
        n++;
      }
    await new Promise((done) => (store.transaction.oncomplete = done));
    db.close();
    return n;
  });
  expect(converted).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator('.gc-title-input')).toHaveValue('Old entry');
  await expect(page.locator('.ProseMirror')).toContainText('Written before the storage change.');
});
