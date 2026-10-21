import { test, expect, type Page } from '@playwright/test';
import { listFiles, newBlankEntry, openFolderNotebook, readFile, trackErrors, waitForSave, writeFile } from './helpers';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = trackErrors(page);
});
test.afterEach(() => {
  expect(errors, 'uncaught errors in the page').toEqual([]);
});

async function trashOpenPage(page: Page) {
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  await page.getByRole('button', { name: 'Move to trash' }).click();
}

const openTrash = (page: Page) => page.locator('.gc-nav-item', { hasText: 'Trash' }).click();
const row = (page: Page, text: string) => page.locator('.gc-trash-row', { hasText: text });

test('the trash: restore a page where it was, with its attachments', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'Gel extraction');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Cut the 1.2 kb band.');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.gc-toolbar').getByRole('button', { name: 'Attach files' }).click();
  await (await chooser).setFiles({ name: 'gel.txt', mimeType: 'text/plain', buffer: Buffer.from('lane 2') });
  await expect(page.locator('.gc-file', { hasText: 'gel.txt' })).toBeVisible();
  await waitForSave(page);
  expect(await listFiles(page, 'Projects/attachments/EXP-0001')).toEqual(['gel.txt']);

  await trashOpenPage(page);
  await expect(page.locator('.toast').last()).toContainText('Moved “Gel extraction” to the trash');
  // Kept in .trash, with a note of where it came from.
  const inTrash = await listFiles(page, '.trash');
  expect(inTrash).toHaveLength(3);
  expect(inTrash.find((n) => n.endsWith(' EXP-0001 Gel extraction.md'))).toBeTruthy();
  expect(inTrash.find((n) => n.endsWith(' EXP-0001 attachments'))).toBeTruthy();
  const index = JSON.parse(await readFile(page, '.trash/trash.json'));
  expect(index.items[0]).toMatchObject({ kind: 'doc', from: 'Projects/EXP-0001 Gel extraction.md', title: 'Gel extraction', id: 'EXP-0001' });
  expect(await listFiles(page, 'Projects')).toEqual(['attachments']);

  // Its ID is not given to the next entry, so it can come back without a clash.
  await newBlankEntry(page, 'PCR');
  await expect(page.locator('.gc-doc-kicker .id-chip')).toHaveText('EXP-0002');

  await openTrash(page);
  await expect(page.locator('.gc-nav-item', { hasText: 'Trash' })).toContainText('1');
  await expect(page.locator('.gc-trash-page h1')).toHaveText('Trash');
  await expect(row(page, 'Gel extraction')).toContainText('EXP-0001');
  await expect(row(page, 'Gel extraction')).toContainText('Entry · from Projects · deleted just now');
  await row(page, 'Gel extraction').getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('.toast').last()).toContainText('Restored “Gel extraction” to Projects');
  await expect(page.locator('.gc-trash-page .empty-state')).toContainText('The trash is empty');
  await expect(page.locator('.gc-nav-item', { hasText: 'Trash' }).locator('.gc-nav-count')).toHaveCount(0);

  expect(await readFile(page, 'Projects/EXP-0001 Gel extraction.md')).toContain('Cut the 1.2 kb band.');
  expect(await listFiles(page, 'Projects/attachments/EXP-0001')).toEqual(['gel.txt']);
  expect(await listFiles(page, '.trash')).toEqual([]);
  await page.locator('.toast-action', { hasText: 'Open' }).last().click();
  await expect(page.locator('.gc-title-input')).toHaveValue('Gel extraction');
  await expect(page.locator('.gc-file', { hasText: 'gel.txt' })).toBeVisible();
});

test('the trash: boards and folders come back too; delete forever and empty the trash', async ({ page }) => {
  await openFolderNotebook(page);
  // A note, the Lab tasks board and the General project folder.
  await page.locator('.gc-nav-item', { hasText: 'Notes' }).click();
  await page.locator('.gc-note-open', { hasText: 'Lab meeting' }).click();
  await trashOpenPage(page);
  await page.locator('.gc-nav-item', { hasText: 'Lab tasks' }).click();
  await page.getByRole('button', { name: 'Board options' }).click();
  await page.getByRole('menuitem', { name: /Delete board/ }).click();
  await page
    .getByRole('button', { name: /Delete/ })
    .last()
    .click();
  await expect(page.locator('.gc-nav-item', { hasText: 'Lab tasks' })).toHaveCount(0);

  await openTrash(page);
  await expect(page.locator('.gc-trash-row')).toHaveCount(2);
  await expect(row(page, 'Lab tasks')).toContainText('Board · from Boards');
  await expect(row(page, 'Lab meeting')).toContainText('Note · from Notes');
  await page.getByLabel('Filter the trash').fill('meeting');
  await expect(page.locator('.gc-trash-row')).toHaveCount(1);
  await page.getByLabel('Filter the trash').fill('');

  await row(page, 'Lab tasks').getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('.gc-nav-item', { hasText: 'Lab tasks' })).toBeVisible();
  expect(await listFiles(page, 'Boards/Lab tasks')).toContain('_board.md');

  // Gone for good, after asking.
  await row(page, 'Lab meeting')
    .getByRole('button', { name: /More for/ })
    .click();
  await page.getByRole('menuitem', { name: 'Delete forever' }).click();
  await expect(page.getByRole('dialog')).toContainText('This cannot be undone');
  await page.getByRole('button', { name: 'Delete forever' }).click();
  await expect(page.locator('.gc-trash-row')).toHaveCount(0);
  expect(await listFiles(page, '.trash')).toEqual([]);
  expect(await listFiles(page, 'Notes')).toEqual([]);

  // Empty the trash.
  await page.locator('.gc-nav-item', { hasText: 'Literature' }).click();
  await page.locator('.gc-paper-row .gc-note-open').first().click();
  await trashOpenPage(page);
  await openTrash(page);
  await page.getByRole('button', { name: 'Empty trash' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Empty trash' }).click();
  await expect(page.locator('.gc-trash-page .empty-state')).toBeVisible();
  expect(await listFiles(page, '')).not.toContain('.trash');
});

test('pages trashed before the trash kept track go back to their usual folder', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await writeFile(page, '.trash/2026-10-01-09-30-00 P-0009 Old miniprep.md', '---\nid: P-0009\nkind: protocol\ntitle: Old miniprep\n---\n\nSpin.\n');
  await openTrash(page);
  await expect(row(page, 'Old miniprep')).toContainText('Protocol · goes back to Protocols');
  await row(page, 'Old miniprep').getByRole('button', { name: 'Restore' }).click();
  await expect.poll(() => listFiles(page, 'Protocols')).toContain('P-0009 Old miniprep.md');
  // Search finds it again.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('old miniprep');
  await expect(page.locator('.gc-pal-item').first()).toContainText('Old miniprep');
});

test('drop a page on Trash in the sidebar to delete it', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'Scratch');
  await waitForSave(page);
  await page.locator('.gc-tree-row', { hasText: 'Scratch' }).dragTo(page.locator('.gc-nav-item', { hasText: 'Trash' }));
  await expect(page.locator('.gc-tree-row', { hasText: 'Scratch' })).toHaveCount(0);
  await openTrash(page);
  await expect(row(page, 'Scratch')).toBeVisible();
});
