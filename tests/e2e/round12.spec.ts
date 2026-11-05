import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { newBlankEntry, openFolderNotebook, trackErrors, waitForSave } from './helpers';

const pathOf = (page: Page) => decodeURIComponent(new URL(page.url()).hash.replace('#/doc/', ''));

/** An SVG that, opened as a page, would run a script as this site. */
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#08f"/><script>window.top.__svgRan = true</script></svg>',
);

test('an export made while saves fail has the changes that could not be saved', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __failWrites?: boolean };
    const original = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = function (this: FileSystemFileHandle, ...args: Parameters<typeof original>) {
      if (w.__failWrites && this.name.endsWith('.md')) return Promise.reject(new DOMException('The disk is full', 'QuotaExceededError'));
      return original.apply(this, args);
    };
  });
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'Western blot');
  await waitForSave(page);
  const path = pathOf(page);
  await page.evaluate(() => ((window as unknown as { __failWrites?: boolean }).__failWrites = true));
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Transfer 1 h at 100 V.');
  await expect(page.locator('.gc-save-error')).toHaveText('Save failed');

  await page.locator('.gc-notebook-btn').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Export notebook (.zip)' }).click()]);
  await expect(page.locator('.toast').filter({ hasText: 'this export has them' })).toBeVisible();
  const files = unzipSync(new Uint8Array(readFileSync(await download.path())));
  expect(strFromU8(files[path])).toContain('Transfer 1 h at 100 V.');
});

test('an SVG attachment never opens as a page of this site', async ({ page, context }) => {
  const errors = trackErrors(page);
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'Figure');
  await page.locator('.ProseMirror').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.gc-toolbar').getByRole('button', { name: 'Attach files' }).click();
  await (await chooser).setFiles({ name: 'plot.svg', mimeType: 'image/svg+xml', buffer: SVG });
  const img = page.locator('.gc-image img');
  await expect(img).toBeVisible();
  await waitForSave(page);
  // Opened from the page: a picture of it, not the SVG document.
  const opened = context.waitForEvent('page');
  await img.dblclick();
  const tab = await opened;
  await tab.waitForLoadState();
  const shown = await tab.evaluate(() => document.contentType);
  expect(shown).toBe('image/png');
  expect(await page.evaluate(() => (window as unknown as { __svgRan?: boolean }).__svgRan)).toBeUndefined();
  await tab.close();
  expect(errors).toEqual([]);
});

test('a click right after selecting blocks puts the cursor where it was clicked', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'Blocks');
  await page.locator('.ProseMirror').click();
  for (const w of ['one', 'two', 'three']) {
    await page.keyboard.type(w);
    await page.keyboard.press('Enter');
  }
  const ps = page.locator('.ProseMirror > p');
  const a = (await ps.nth(0).boundingBox())!;
  const b = (await ps.nth(1).boundingBox())!;
  const last = (await ps.last().boundingBox())!;
  // Drag across two blocks and click the last line at once, before the app has finished with the drag.
  await page.evaluate(
    ({ a, b, last }) =>
      new Promise<void>((done) => {
        const at = (x: number, y: number) => document.elementFromPoint(x, y)!;
        const fire = (type: string, x: number, y: number) =>
          at(x, y).dispatchEvent(
            new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1 }),
          );
        fire('mousedown', a.x + 10, a.y + a.height / 2);
        fire('mousemove', a.x + 20, a.y + a.height / 2);
        fire('mousemove', b.x + 10, b.y + b.height / 2);
        fire('mouseup', b.x + 10, b.y + b.height / 2);
        fire('mousedown', last.x + 5, last.y + last.height / 2);
        fire('mouseup', last.x + 5, last.y + last.height / 2);
        setTimeout(done, 50);
      }),
    { a, b, last },
  );
  await expect(page.locator('.gc-block-selected')).toHaveCount(0);
  await page.keyboard.type('four');
  await expect(ps.last()).toHaveText('four');
});
