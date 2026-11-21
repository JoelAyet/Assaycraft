/**
 * The writing audit of 21 November: the "/" menu works like Notion's (the search marked in the
 * text, the typed shortcut beside each basic block, a foot to close it, and it closes by itself when
 * nothing matches); in tables, a click on the picked cell writes in it, Ctrl+V and Ctrl+C go to the
 * table that has the keyboard even with text selected in the page, and cells pasted into a new
 * table fill it; a click below the end of a page writes on a new last line.
 */
import { test, expect, type Page } from '@playwright/test';
import { newBlankEntry, openFolderNotebook, readFile, trackErrors, waitForSave, writeFile } from './helpers';

const prose = (page: Page) => page.locator('.ProseMirror');
const menu = (page: Page) => page.locator('.gc-slash');

async function entry(page: Page, title = 'Writing') {
  await openFolderNotebook(page);
  await newBlankEntry(page, title);
  await prose(page).click();
}

test('the "/" menu: the search marked in the text, shortcuts, a foot to close it', async ({ page }) => {
  const errors = trackErrors(page);
  await entry(page);
  await page.keyboard.type('/');
  await expect(menu(page)).toBeVisible();
  // Until something is typed, "Type to search" follows the "/".
  const query = prose(page).locator('.gc-slash-query');
  await expect(query).toHaveClass(/is-empty/);
  await expect(query).toHaveAttribute('data-decoration-content', 'Type to search');
  // The basic blocks show what to type for them; groups are named.
  await expect(menu(page).locator('.menu-label').first()).toHaveText('Basic blocks');
  await expect(menu(page).locator('.gc-slash-item', { hasText: 'Heading 2' }).locator('.gc-slash-hint')).toHaveText('##');
  await expect(menu(page).locator('.gc-slash-item', { hasText: 'Numbered list' }).locator('.gc-slash-hint')).toHaveText('1.');
  await expect(menu(page).locator('.gc-slash-foot')).toHaveText(/Close menu\s*esc/);

  // Searching: the blocks found, best first, without groups; letters inside words do not count.
  await page.keyboard.type('ta');
  await expect(query).not.toHaveClass(/is-empty/);
  await expect(menu(page).locator('.gc-slash-item').first()).toContainText('Table');
  await expect(menu(page).locator('.menu-label')).toHaveCount(0);
  await expect(menu(page).locator('.gc-slash-item', { hasText: 'Divider' })).toHaveCount(0);

  // The foot closes the menu and leaves what was typed.
  await menu(page).locator('.gc-slash-foot').click();
  await expect(menu(page)).toHaveCount(0);
  await expect(prose(page)).toContainText('/ta');
  // So does Escape.
  await page.keyboard.press('End');
  await page.keyboard.type(' /he');
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(prose(page)).toContainText('/ta /he');

  // Nothing matches: "No results", and at the third letter that matches nothing the menu is gone
  // (it was not meant for it).
  await page.keyboard.press('Enter');
  await page.keyboard.type('/zq');
  await expect(menu(page).locator('.gc-slash-empty')).toHaveText('No results');
  await page.keyboard.type('x');
  await expect(menu(page)).toHaveCount(0);
  await page.keyboard.type('y');
  await expect(menu(page)).toHaveCount(0);
  await expect(prose(page)).toContainText('/zqxy');
  // And Enter is a new line again.
  await page.keyboard.press('Enter');
  await page.keyboard.type('after');
  await expect(prose(page).locator('p', { hasText: /^after$/ })).toHaveCount(1);

  // Picked from the menu with the keyboard.
  await page.keyboard.press('Enter');
  await page.keyboard.type('/h2');
  await page.keyboard.press('Enter');
  await page.keyboard.type('A heading');
  await expect(prose(page).locator('h2')).toHaveText('A heading');
  expect(errors).toEqual([]);
});

test('every shortcut the "/" menu shows works when typed', async ({ page }) => {
  await entry(page);
  const typed: [string, string][] = [
    ['# ', 'h1'],
    ['## ', 'h2'],
    ['### ', 'h3'],
    ['- ', 'ul'],
    ['1. ', 'ol'],
    ['[] ', 'ul[data-type="taskList"]'],
    ['> ', 'blockquote'],
    ['``` ', 'pre'],
  ];
  for (const [keys, selector] of typed) {
    await page.keyboard.type(keys);
    await page.keyboard.type(`via ${keys.trim()}`);
    await expect(prose(page).locator(selector, { hasText: `via ${keys.trim()}` })).toHaveCount(1);
    // Out of the block for the next one.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    if (selector === 'pre') await page.keyboard.press('Enter');
    if (selector.startsWith('ul') || selector === 'ol' || selector === 'blockquote') await page.keyboard.press('Enter');
    await page.locator('.gc-editor-tail').click();
  }
  await page.keyboard.type('---');
  await expect(prose(page).locator('hr')).toHaveCount(1);
});

test('tables: a second click writes in the cell, and the clipboard goes to the table', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = trackErrors(page);
  await entry(page, 'Table work');
  await page.keyboard.type('Plated on LB with kanamycin.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/table');
  await page.keyboard.press('Enter');
  const sheet = page.locator('.gc-sheet').first();
  const cell = (r: number, c: number) => sheet.locator(`td[data-r="${r}"][data-c="${c}"]`);
  // A new table starts writing in A1: cells pasted there (from Excel, say) fill the table.
  await page.evaluate(() => navigator.clipboard.writeText('Sample\tOD600\nA\t0.41\nB\t0.38'));
  await page.keyboard.press('ControlOrMeta+v');
  await expect(cell(0, 1)).toHaveText('OD600');
  await expect(cell(2, 1)).toHaveText('0.38');
  await expect(cell(0, 0)).toHaveText('Sample');

  // One click picks a cell (typing then replaces it); a second click writes in it.
  await cell(1, 0).click();
  await expect(cell(1, 0).locator('textarea')).toHaveCount(0);
  await cell(1, 0).click();
  await expect(cell(1, 0).locator('textarea')).toBeFocused();
  await page.keyboard.type('1');
  await page.keyboard.press('Enter');
  await expect(cell(1, 0)).toHaveText('A1');
  // Pressed on the picked cell and dragged, it picks cells as always.
  await cell(1, 0).click();
  await cell(1, 0).hover();
  await page.mouse.down();
  await cell(2, 1).hover();
  await page.mouse.up();
  await expect(sheet.locator('.gc-sheet-name')).toHaveText('A2:B3');
  await expect(sheet.locator('textarea')).toHaveCount(0);

  // Text selected in the page, then a cell picked: Ctrl+V fills the cell, the text stays.
  const line = prose(page).locator('p', { hasText: 'Plated on LB' });
  await line.click({ clickCount: 3 });
  await page.keyboard.press('ControlOrMeta+c');
  await cell(4, 0).click();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(cell(4, 0)).toHaveText('Plated on LB with kanamycin.');
  await expect(line).toHaveText('Plated on LB with kanamycin.');
  // And Ctrl+C copies the cell, not that text.
  await line.click({ clickCount: 3 });
  await cell(2, 1).click();
  await page.keyboard.press('ControlOrMeta+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('0.38');
  await waitForSave(page);
  expect(errors).toEqual([]);
});

test('a click below the end of a page writes on a new last line', async ({ page }) => {
  await openFolderNotebook(page);
  // A page that ends with a table (as saved, or made on another device): nowhere to click after it.
  await writeFile(
    page,
    'Projects/GC-0001 Ends with a table.md',
    '---\nid: GC-0001\ntitle: Ends with a table\n---\n\nResults:\n\n| Sample | OD |\n| --- | --- |\n| A | 0.4 |\n',
  );
  await page.reload();
  await page.locator('.gc-sidebar').getByText('Ends with a table').click();
  await expect(prose(page).locator('> *').last()).toHaveClass(/node-spreadsheet/);
  await page.locator('.gc-editor-tail').click();
  await page.keyboard.type('Written after the table.');
  await expect(prose(page).locator('> *').last()).toHaveText('Written after the table.');
  // Clicked again with an empty last line, that line is used rather than another made.
  await page.keyboard.press('Enter');
  const count = await prose(page).locator('> *').count();
  await page.locator('.gc-editor-tail').click();
  await page.keyboard.type('Next.');
  await expect(prose(page).locator('> *')).toHaveCount(count);
  await expect(prose(page).locator('> *').last()).toHaveText('Next.');
  await waitForSave(page);
  expect(await readFile(page, 'Projects/GC-0001 Ends with a table.md')).toMatch(/\| A +\| 0\.4 +\|\n\nWritten after the table\.\n\nNext\.\n$/);
});
