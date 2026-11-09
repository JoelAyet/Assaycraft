/**
 * From the audit of 9 November: menus by keyboard (D01), the phone drawer and stock sheet as modal
 * overlays (D02), examples that look like examples (D03), the save status on a phone (D04), stocks
 * as a list on a phone (D05), an empty activity graph kept small (D06), and a new block that typing
 * does not replace.
 */
import { test, expect, type Page } from '@playwright/test';
import { listFiles, newBlankEntry, openFolderNotebook, readFile, trackErrors, waitForSave } from './helpers';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = trackErrors(page);
});
test.afterEach(() => {
  expect(errors, 'uncaught errors in the page').toEqual([]);
});

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;
const focused = (page: Page) => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');

test('a menu works from the keyboard, and gives focus back when it closes', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Stocks' }).click();
  await page.locator('.gc-viewtab', { hasText: 'Primers' }).click();
  const button = page.getByRole('button', { name: 'Primers options' });
  await expect(button).toHaveAttribute('aria-haspopup', 'menu');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  // The first choice has focus; the arrows, Home and End move through them.
  await expect(page.getByRole('menuitem', { name: 'Rename…' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'ID prefix…' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Delete collection' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Rename…' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('menuitem', { name: 'Delete collection' })).toBeFocused();
  // Escape closes it, and the button that opened it has focus again.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  // Enter on a choice does it.
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  expect(await focused(page)).toContain('Columns');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: /Columns/ })).toBeVisible();
});

test('a new block stays when you type straight after putting it in', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'Plan for the week');
  await page.locator('.ProseMirror').click();
  // A block with no field of its own: the cursor goes to the line after it, not on the block
  // (where a key would replace it).
  await page.keyboard.type('/calendar');
  await page.locator('.gc-slash-item').filter({ hasText: 'Calendar' }).first().click();
  await expect(page.locator('.ProseMirror .gc-weekblock')).toHaveCount(1);
  await page.keyboard.type('Gels on Thursday.');
  await expect(page.locator('.ProseMirror .gc-weekblock')).toHaveCount(1);
  await expect(page.locator('.ProseMirror > p').last()).toHaveText('Gels on Thursday.');
  // A plate puts the cursor in its own Add sample field: what is typed goes there, and it stays.
  await page.keyboard.press('Enter');
  await page.keyboard.type('/plate');
  await page.locator('.gc-slash-item').filter({ hasText: 'Plate' }).first().click();
  await page.keyboard.type('Control');
  await expect(page.locator('.ProseMirror .gc-plate')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'Add sample' })).toHaveValue('Control');
  await waitForSave(page);
});

test.describe('on a phone', () => {
  test.use(PHONE);

  test('the menu drawer and a stock’s details hold focus until they close', async ({ page }) => {
    await openFolderNotebook(page);
    const toggle = page.locator('.gc-nav-toggle').first();
    await toggle.click();
    await expect(page.locator('.gc-sidebar')).toHaveAttribute('role', 'dialog');
    await expect(page.locator('.gc-sidebar')).toHaveAttribute('aria-modal', 'true');
    // Focus is in the drawer, and the page behind it cannot be reached.
    expect(await page.evaluate(() => !!document.activeElement?.closest('.gc-sidebar'))).toBe(true);
    await expect(page.locator('main')).toHaveAttribute('inert', '');
    for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.gc-sidebar'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('.gc-sidebar')).toBeHidden();
    await expect(page.locator('main')).not.toHaveAttribute('inert', '');
    await expect(toggle).toBeFocused();

    // A stock's details, as a sheet: focus in it, Escape closes it.
    await toggle.click();
    await page.locator('.gc-nav-item', { hasText: 'Stocks' }).click();
    await page.locator('.gc-viewtab', { hasText: 'Primers' }).click();
    await page.locator('.gc-stock-card[data-stock="PR-0002"]').click();
    const sheet = page.getByRole('dialog', { name: 'PR-0002 EGFP-rev' });
    await expect(sheet).toBeVisible();
    expect(await page.evaluate(() => !!document.activeElement?.closest('.gc-stock-detail'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });

  test('stocks are a list: a name, its ID and where it is, and the row opens it', async ({ page }) => {
    await openFolderNotebook(page);
    await page.locator('.gc-nav-toggle').first().click();
    await page.locator('.gc-nav-item', { hasText: 'Stocks' }).click();
    await page.locator('.gc-viewtab', { hasText: 'Primers' }).click();
    const card = page.locator('.gc-stock-card[data-stock="PR-0001"]');
    await expect(card).toContainText('EGFP-fwd');
    await expect(card).toContainText('PR-0001');
    // The examples are marked, and are nowhere in a freezer.
    await expect(card).toContainText('No location');
    await expect(card).toContainText('Example');
    await expect(card).toContainText(/Tm \d+(\.\d)? °C/);
    // Nothing sticks out sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await card.click();
    await expect(page.getByRole('dialog', { name: 'PR-0001 EGFP-fwd' })).toBeVisible();
    await page.getByRole('button', { name: 'Close the details' }).click();

    // The table is one tap away, to edit; a new stock is typed there.
    await page.getByRole('button', { name: 'Show as a table' }).click();
    const loc = page.locator('.gc-stock-table tr[data-stock="PR-0001"]').getByLabel(/^Location of /);
    await loc.fill('Box 3 · A1');
    await page.getByRole('button', { name: 'Show as a list' }).click();
    await expect(card).toContainText('Box 3 · A1');
    await page.getByRole('button', { name: 'New primer' }).click();
    await expect(page.locator('.gc-stock-table')).toBeVisible();
    await expect(page.getByLabel('Name of PR-0004')).toBeFocused();
    await page.keyboard.type('T7 promoter');
    await waitForSave(page);
    expect(await readFile(page, 'Stocks/Primers.md')).toContain('| PR-0004 | T7 promoter |');
    // The choice is remembered in this browser.
    await page.reload();
    await expect(page.locator('.gc-stock-table')).toBeVisible();
  });

  test('a page shows whether it is saved, with the sidebar closed', async ({ page }) => {
    await openFolderNotebook(page, { seed: false });
    await page.locator('.gc-nav-toggle').first().click();
    await newBlankEntry(page, 'Bench notes');
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('Thawed the cells.');
    const status = page.locator('.gc-topbar-save .gc-save-compact');
    await expect(status).toHaveClass(/is-saved/, { timeout: 10_000 });
    await expect(status).toHaveAttribute('title', 'All changes saved');
    await expect(status).toBeVisible();
  });
});

test('the examples are marked, plan nothing, and go in one go', async ({ page }) => {
  await openFolderNotebook(page);
  // Nothing to do yet: the example tasks have no due date, and the example entry is not a plan.
  await expect(page.locator('.gc-home .gc-panel', { hasText: 'Next 7 days' })).toContainText('Nothing scheduled this week.');
  await expect(page.locator('.gc-home .gc-lede')).toHaveCount(0);
  // No work yet: one line where the activity graph will be.
  await expect(page.locator('.gc-activity')).toHaveClass(/is-empty/);
  await expect(page.locator('.gc-activity-grid')).toBeHidden();
  await expect(page.locator('.gc-activity-foot')).toContainText('No edits in the last 6 months yet');
  const task = await readFile(page, 'Boards/Lab tasks/T-0001 Order Q5 polymerase and dNTPs.md');
  expect(task).toContain('example: true');
  expect(task).not.toContain('due:');
  await page.locator('.gc-nav-item', { hasText: 'Lab tasks' }).click();
  await expect(page.locator('.gc-card').first()).toContainText('example');

  // Settings says what came with the notebook, and takes it all out.
  await page.goto('/#/settings');
  const card = page.locator('.gc-examples-card');
  await expect(card).toContainText('an entry');
  await expect(card).toContainText('3 tasks');
  await expect(card).toContainText('4 stocks');
  await card.getByRole('button', { name: 'Remove the examples' }).click();
  await page.getByRole('dialog', { name: 'Remove the examples?' }).getByRole('button', { name: 'Remove the examples' }).click();
  await expect(page.locator('.toast', { hasText: 'Examples removed: 6 pages in the trash, 4 stock rows taken out.' })).toBeVisible();
  await expect(card).toHaveCount(0);
  await waitForSave(page);

  expect(await listFiles(page, 'Boards/Lab tasks')).toEqual(['_board.md']);
  expect(await listFiles(page, 'Notes')).toEqual([]);
  expect(await readFile(page, 'Stocks/Primers.md')).not.toContain('PR-0001');
  // The templates and protocols stay: they are tools, not examples.
  await page.locator('.gc-nav-item', { hasText: 'Templates' }).click();
  await expect(page.locator('.gc-tpl-card', { hasText: 'Molecular cloning' })).toBeVisible();
  // In the trash, to bring back.
  await page.locator('.gc-nav-item', { hasText: 'Trash' }).click();
  await expect(page.locator('.gc-trash-row')).toHaveCount(6);
});
