/**
 * Suggestions of 5 November 2026: stocks cells, highlights, notes beside an entry, /calendar,
 * boards, pictures side by side, flows by drag and drop, pasting from Word and PowerPoint.
 */
import { test, expect, type Page } from '@playwright/test';
import { newBlankEntry, openFolderNotebook, readFile, trackErrors, waitForSave, KEYS } from './helpers';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = trackErrors(page);
});
test.afterEach(() => {
  expect(errors, 'uncaught errors in the page').toEqual([]);
});

/** Screenshots for a look by eye, when SHOTS names a folder. */
async function shot(page: Page, name: string) {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAQ0lEQVR42u3PQQkAAAgEsEtiTiMaywp+hcEKLNXzWgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQErhZRfWjxIIKtDwAAAABJRU5ErkJggg==',
  'base64',
);

const pathOf = (page: Page) => decodeURIComponent(new URL(page.url()).hash.replace('#/doc/', ''));

test('a stock cell copies whole, and long text wraps onto two lines', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Stocks' }).click();
  await page.locator('.gc-viewtab', { hasText: 'Primers' }).click();
  const row = page.locator('.gc-stock-table tr[data-stock="PR-0001"]');
  const location = row.getByLabel(/^Location of /);
  const short = (await location.boundingBox())!.height;
  await location.fill('Freezer B, shelf 2, primer box 1, row A, the one with the blue lid at the back');
  await page.locator('.gc-stock-table th').first().click();
  // Two lines, without being edited.
  await expect.poll(async () => (await location.boundingBox())!.height).toBeGreaterThan(short + 10);
  await shot(page, 'stocks-wrapped');

  // A click puts the caret in; copy, with nothing selected, takes all of it.
  await location.click();
  await page.keyboard.press('ControlOrMeta+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Freezer B, shelf 2, primer box 1, row A, the one with the blue lid at the back',
  );
  await waitForSave(page);
  expect(await readFile(page, 'Stocks/Primers.md')).toContain('the one with the blue lid at the back |');
});

test('a highlight over H₂O is one straight band, and a second click shows its colors', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'Buffers');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Dissolve in H');
  await page.keyboard.press('ControlOrMeta+,');
  await page.keyboard.type('2');
  await page.keyboard.press('ControlOrMeta+,');
  await page.keyboard.type('O at 37 °C');
  await page.keyboard.press(KEYS.selectToLineStart);
  // The browser moves the selection; the editor reads it a moment later.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  // One mark around the subscript, not three pieces.
  await expect(page.locator('.ProseMirror mark')).toHaveCount(1);
  await expect(page.locator('.ProseMirror mark sub')).toHaveText('2');
  // Clicked again on marked text: the colors (and No highlight), not the highlight taken away.
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Highlight green' })).toBeVisible();
  await page.getByRole('button', { name: 'Highlight green' }).click();
  await expect(page.locator('.ProseMirror mark[data-color="green"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await page.getByRole('button', { name: 'No highlight' }).click();
  await expect(page.locator('.ProseMirror mark')).toHaveCount(0);
});

test('text copied from Word or PowerPoint is pasted as text, not as a picture of it', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'From Word');
  await page.locator('.ProseMirror').click();
  await page.locator('.ProseMirror').evaluate((el, png) => {
    const dt = new DataTransfer();
    // What Word puts on the clipboard: the text, its HTML, and a picture of it.
    dt.setData('text/plain', 'Lysis buffer\r\n50 mM Tris pH 8\r\n');
    dt.setData(
      'text/html',
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"><body><!--StartFragment--><p class=MsoNormal><b>Lysis buffer</b><o:p></o:p></p>' +
        '<p class=MsoListParagraph style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">·<span>&nbsp;&nbsp;</span></span>50 mM Tris pH 8<o:p></o:p></p>' +
        '<img src="file:///C:/Users/x/AppData/Local/Temp/msohtmlclip1/01/clip_image001.png"><!--EndFragment--></body></html>',
    );
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, PNG.toString('base64'));
  await expect(page.locator('.ProseMirror strong')).toHaveText('Lysis buffer');
  await expect(page.locator('.ProseMirror')).toContainText('50 mM Tris pH 8');
  await expect(page.locator('.ProseMirror')).not.toContainText('·');
  await expect(page.locator('.ProseMirror img, .gc-image')).toHaveCount(0);

  // A picture alone is still pasted as a picture.
  await page.keyboard.press('ControlOrMeta+End');
  await page.locator('.ProseMirror').evaluate((el, png) => {
    const dt = new DataTransfer();
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, PNG.toString('base64'));
  await expect(page.locator('.gc-image')).toHaveCount(1);
});

test('the index beside an entry: a new note opens beside it, and recent pages of every kind', async ({ page }) => {
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Western blot');
  const entry = pathOf(page);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Transfer 1 h at 100 V.');
  await waitForSave(page);
  const index = page.locator('.gc-doc-index');
  await index.hover();
  // Recent: experiments, notes and protocols (four at most).
  const recent = index.locator('.gc-doc-index-item.is-recent');
  await expect(recent).toHaveCount(4);
  await expect(index.locator('.gc-doc-index-label', { hasText: 'Recent' })).toBeVisible();
  await shot(page, 'index-recent');
  await index.getByRole('button', { name: 'New note' }).click();

  // Docked in the right half: the entry is still there, and can still be typed in.
  const side = page.locator('.gc-peek.is-split');
  await expect(side).toBeVisible();
  await expect(page.locator('.gc-peek-backdrop')).toHaveCount(0);
  await side.locator('.gc-title-input').fill('Blot ideas');
  await side.locator('.ProseMirror').click();
  await page.keyboard.type('Try 5% milk instead of BSA.');
  const mainBox = (await page.locator('.gc-main').boundingBox())!;
  const sideBox = (await side.boundingBox())!;
  expect(sideBox.x).toBeGreaterThanOrEqual(mainBox.x + mainBox.width - 1);
  await page.locator('.gc-main .ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Blocked overnight.');
  await expect(page.locator('.gc-main .ProseMirror')).toContainText('Blocked overnight.');
  await waitForSave(page);
  await shot(page, 'note-beside');
  expect(await readFile(page, entry)).toContain('Blocked overnight.');
  // A note like any other, in Notes.
  await page.locator('.gc-nav-item', { hasText: 'Notes' }).click();
  await expect(page.locator('.gc-main')).toContainText('Blot ideas');
  await side.getByRole('button', { name: 'Close the side panel' }).click();
  await expect(side).toHaveCount(0);
});

test('/calendar puts a week of the calendar in a page, and keeps the week shown', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'Plan of the week');
  const path = pathOf(page);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('/calendar');
  await page.locator('.gc-slash-item').filter({ hasText: 'Calendar' }).first().click();
  const week = page.locator('.gc-weekblock');
  await expect(week).toBeVisible();
  // This entry is on today's column.
  await expect(week.locator('.gc-weekblock-day.is-today')).toContainText('Plan of the week');
  await shot(page, 'calendar-block');
  await waitForSave(page);
  const before = await readFile(page, path);
  expect(before).toMatch(/<!-- gc:calendar \{"week":"\d{4}-\d{2}-\d{2}"\} -->/);

  await week.getByRole('button', { name: 'Next week' }).click();
  await expect(week.locator('.gc-weekblock-day.is-today')).toHaveCount(0);
  await expect(week.getByRole('button', { name: 'This week' })).toBeVisible();
  await waitForSave(page);
  const after = await readFile(page, path);
  expect(after).not.toBe(before);
  await page.reload();
  await expect(page.locator('.gc-weekblock')).toBeVisible();
  await expect(page.locator('.gc-weekblock').getByRole('button', { name: 'This week' })).toBeVisible();
});

test('experiments board: completed ones struck through, failed ones offer a repeat or troubleshooting', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'Western blot');
  await newBlankEntry(page, 'Gibson assembly');
  await page.locator('.gc-nav-item', { hasText: 'Experiments' }).click();
  const col = (name: string) => page.locator('.gc-col', { hasText: name }).locator('.gc-col-body');

  await page.locator('.gc-card', { hasText: 'Western blot' }).dragTo(col('Completed'));
  const done = page.locator('.gc-card', { hasText: 'Western blot' }).locator('.gc-card-title');
  await expect(done).toHaveCSS('text-decoration-line', 'line-through');

  await page.locator('.gc-card', { hasText: 'Gibson assembly' }).dragTo(col('Failed'));
  const dialog = page.getByRole('dialog', { name: /failed\. What next\?/ });
  await expect(dialog).toBeVisible();
  await shot(page, 'failed-dialog');
  await dialog.getByRole('button', { name: /Troubleshoot/ }).click();
  await expect(page.locator('.gc-main .ProseMirror h2', { hasText: 'Troubleshooting' })).toBeVisible();
  await waitForSave(page);
  expect(await readFile(page, 'Projects/EXP-0002 Gibson assembly.md')).toContain('**What could have caused it**');

  // From the board again: plan a repeat.
  await page.locator('.gc-nav-item', { hasText: 'Experiments' }).click();
  const failed = page.locator('.gc-card.is-failed', { hasText: 'Gibson assembly' });
  await expect(failed).toBeVisible();
  await shot(page, 'board-failed-done');
  await failed.getByRole('button', { name: 'Repeat' }).click();
  await expect(page.locator('.gc-title-input')).toHaveValue('Gibson assembly (repeat)');
  await expect(page.locator('.gc-main .ProseMirror p').first()).toContainText('Repeat of EXP-0002 Gibson assembly, which failed.');
  await waitForSave(page);
  const md = await readFile(page, pathOf(page));
  expect(md).toContain('status: planned');
  expect(md).toContain('Repeat of [EXP-0002 Gibson assembly](');
});

test('a task board shows the tasks of one priority', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Lab tasks' }).click();
  await expect(page.locator('.gc-card')).toHaveCount(3);
  await page.getByLabel('Priority').selectOption('high');
  await expect(page.locator('.gc-card')).toHaveText([/Order Q5 polymerase/]);
  await page.getByLabel('Priority').selectOption('none');
  await expect(page.locator('.gc-card')).toHaveText([/Autoclave pipette tips/]);
  await page.getByLabel('Priority').selectOption('');
  await expect(page.locator('.gc-card')).toHaveCount(3);
});

test('pictures added one after another sit side by side', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'Gels');
  await page.locator('.ProseMirror').click();
  for (const name of ['gel-1.png', 'gel-2.png']) {
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.gc-toolbar').getByRole('button', { name: 'Attach files' }).click();
    await (await chooser).setFiles({ name, mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('.gc-image img')).toHaveCount(name === 'gel-1.png' ? 1 : 2);
  }
  const [a, b] = await Promise.all([0, 1].map(async (i) => (await page.locator('.gc-prose > .node-image').nth(i).boundingBox())!));
  expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  expect(b.x).toBeGreaterThan(a.x + a.width - 1);
  await shot(page, 'images-side-by-side');
});

test('a flow step is dragged to another place', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'Cloning plan');
  const path = pathOf(page);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('/flow');
  await page.locator('.gc-slash-item').filter({ hasText: 'Flow' }).first().click();
  for (const step of ['PCR', 'Gibson', 'Transform']) {
    await page.keyboard.type(step);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.press('Escape');
  const titles = page.locator('.gc-flow-card:not(.is-add) .gc-flow-title');
  await expect(titles).toHaveText(['PCR', 'Gibson', 'Transform']);
  await page.locator('.gc-flow-card[data-step="3"]').dragTo(page.locator('.gc-flow-card[data-step="1"]'));
  await expect(titles).toHaveText(['Transform', 'PCR', 'Gibson']);
  await waitForSave(page);
  expect(await readFile(page, path)).toMatch(/1\. Transform\n2\. PCR\n3\. Gibson/);
});

test('version history is a button next to Lock', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'Western blot');
  const lock = (await page.getByRole('button', { name: 'Lock', exact: true }).boundingBox())!;
  const history = page.getByRole('button', { name: 'Version history' });
  expect((await history.boundingBox())!.x).toBeLessThan(lock.x);
  await history.click();
  await expect(page.getByRole('dialog', { name: /Version history/ })).toBeVisible();
});
