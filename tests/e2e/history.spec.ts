import { test, expect, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { listFiles, newBlankEntry, openFolderNotebook, readFile, trackErrors, waitForSave, skipTour } from './helpers';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = trackErrors(page);
});
test.afterEach(() => {
  expect(errors, 'uncaught errors in the page').toEqual([]);
});

const dialog = (page: Page) => page.locator('.gc-history-dialog');
const items = (page: Page) => dialog(page).locator('.gc-history-item');

async function openHistory(page: Page) {
  await page.getByTitle('More actions').click();
  await page.getByRole('menuitem', { name: 'Version history…' }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByText('Loading versions…')).toHaveCount(0);
}

/** A new editing session starts after a 10-minute break. */
async function takeABreak(page: Page) {
  await page.clock.fastForward('11:00');
}

test('entries keep a version per editing session, and an old one can be restored (and undone)', async ({ page }) => {
  await page.clock.install();
  await openFolderNotebook(page);
  await newBlankEntry(page, 'History test');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.type('First draft of the plan.');
  await waitForSave(page);

  // One session so far: nothing earlier to show.
  await openHistory(page);
  await expect(items(page)).toHaveCount(1);
  await expect(dialog(page).getByText('No earlier versions yet.')).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Restore this version' })).toBeDisabled();
  await dialog(page).locator('.dialog-footer').getByRole('button', { name: 'Close' }).click();

  // Edits within the same session don't add versions; after a break they do.
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Use 2 µg of DNA.');
  await waitForSave(page);
  await takeABreak(page);
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second session: transform into DH5α.');
  await waitForSave(page);

  await openHistory(page);
  await expect(items(page)).toHaveCount(2);
  await expect(items(page).first()).toContainText('Current');
  await expect(items(page).first()).toContainText('+5 words');
  await expect(items(page).nth(1)).toContainText('Oldest version kept');
  // The current version: what the second session added.
  await expect(dialog(page).locator('.gc-diff-line.is-ins', { hasText: 'Second session: transform into DH5α.' })).toHaveCount(1);

  // The older version, and how it differs from now.
  await items(page).nth(1).click();
  await expect(dialog(page).locator('.gc-history-title strong')).not.toHaveText('Current version');
  await expect(dialog(page).locator('.gc-diff')).toContainText('First draft of the plan. Use 2 µg of DNA.');
  await expect(dialog(page).locator('.gc-diff-line.is-ins, .gc-diff-line.is-del')).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Compare with current' }).click();
  await expect(dialog(page).locator('.gc-diff-line.is-del', { hasText: 'Second session' })).toHaveCount(1);

  // Keyboard: up and down move through the list.
  await items(page).nth(1).focus();
  await page.keyboard.press('ArrowUp');
  await expect(items(page).first()).toBeFocused();
  await expect(items(page).first()).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('ArrowDown');

  // Restore it.
  await dialog(page).getByRole('button', { name: 'Restore this version' }).click();
  await page.getByRole('dialog', { name: 'Restore this version?' }).getByRole('button', { name: 'Restore' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByText('Version restored')).toBeVisible();
  await expect(editor).toHaveText('First draft of the plan. Use 2 µg of DNA.');
  await expect(page.getByText('Reloaded changes made outside Assaycraft')).toHaveCount(0);
  const files = await listFiles(page, '.assaycraft/history');
  expect(files).toHaveLength(1);

  // The version it replaced is kept, marked.
  await openHistory(page);
  await expect(items(page)).toHaveCount(3);
  await expect(items(page).nth(1)).toContainText('Before restoring');
  await items(page).nth(1).click();
  await expect(dialog(page).locator('.gc-diff-line.is-ins', { hasText: 'Second session' })).toHaveCount(1);
  await dialog(page).locator('.dialog-footer').getByRole('button', { name: 'Close' }).click();

  // And the restore can be undone from the toast.
  await page.locator('.toast-action', { hasText: 'Undo' }).click();
  await expect(editor).toContainText('Second session: transform into DH5α.');
  await waitForSave(page);
});

test('stock collections have a version history too', async ({ page }) => {
  await page.clock.install();
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Stocks' }).click();
  await page.locator('.gc-viewtab', { hasText: 'Primers' }).click();
  const loc = page.locator('.gc-stock-table tr[data-stock="PR-0001"]').getByLabel(/^Location of /);
  await loc.fill('Freezer A · box 1');
  await waitForSave(page);
  await takeABreak(page);
  await loc.fill('Freezer B · box 7');
  await waitForSave(page);

  await page.getByTitle('Primers options').click();
  await page.getByRole('menuitem', { name: 'Version history…' }).click();
  await expect(items(page)).toHaveCount(3);
  // What the last session changed, word by word.
  await expect(dialog(page).locator('.gc-diff-line.is-mod del')).toHaveText(['A', '1']);
  await expect(dialog(page).locator('.gc-diff-line.is-mod ins')).toHaveText(['B', '7']);

  // Back to before any change.
  await items(page).last().click();
  await dialog(page).getByRole('button', { name: 'Restore this version' }).click();
  await page.getByRole('dialog', { name: 'Restore this version?' }).getByRole('button', { name: 'Restore' }).click();
  await expect(loc).not.toHaveValue(/Freezer/);
  await waitForSave(page);
  expect(await readFile(page, 'Stocks/Primers.md')).not.toContain('Freezer');
});

test('a renamed stock collection keeps its history (it is filed by path)', async ({ page }) => {
  await page.clock.install();
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Stocks' }).click();
  await page.locator('.gc-viewtab', { hasText: 'Primers' }).click();
  const loc = page.locator('.gc-stock-table tr[data-stock="PR-0001"]').getByLabel(/^Location of /);
  await loc.fill('Box A');
  await waitForSave(page);
  await takeABreak(page);
  await loc.fill('Box B');
  await waitForSave(page);
  await page.getByTitle('Primers options').click();
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Oligos');
  await page.keyboard.press('Enter');
  await expect(page.locator('.gc-viewtab', { hasText: 'Oligos' })).toBeVisible();
  await waitForSave(page);
  await expect.poll(() => listFiles(page, '.assaycraft/history')).toEqual([expect.stringMatching(/^Stocks ~ Oligos [0-9a-f]{8}\.json$/)]);
  await page.getByTitle('Oligos options').click();
  await page.getByRole('menuitem', { name: 'Version history…' }).click();
  await expect(items(page)).toHaveCount(3);
});

test('a browser-storage notebook keeps history and restores across reloads', async ({ page }) => {
  await page.clock.install();
  await skipTour(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Create browser notebook/ }).click();
  await page.getByRole('button', { name: 'Create notebook' }).click();
  await newBlankEntry(page, 'Browser history');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.type('Version one.');
  await waitForSave(page);
  await takeABreak(page);
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Version two.');
  await waitForSave(page);
  await openHistory(page);
  await expect(items(page)).toHaveCount(2);
  await items(page).nth(1).click();
  await dialog(page).getByRole('button', { name: 'Restore this version' }).click();
  await page.getByRole('dialog', { name: 'Restore this version?' }).getByRole('button', { name: 'Restore' }).click();
  await expect(editor).toHaveText('Version one.');
  await waitForSave(page);
  await page.reload();
  await expect(page.locator('.ProseMirror')).toHaveText('Version one.');
  await openHistory(page);
  await expect(items(page)).toHaveCount(3);
  await expect(items(page).nth(1)).toContainText('Before restoring');
});

test('a .zip export carries the history', async ({ page }) => {
  await page.clock.install();
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'Exported');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('One.');
  await waitForSave(page);
  await takeABreak(page);
  await page.keyboard.type(' Two.');
  await waitForSave(page);
  await page.locator('.gc-notebook-btn').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Export notebook (.zip)' }).click()]);
  const names = Object.keys(unzipSync(new Uint8Array(readFileSync(await download.path()))));
  expect(names).toContain('.assaycraft/history/EXP-0001.json');
});
