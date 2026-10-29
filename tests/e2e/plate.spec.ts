import { test, expect, type Page } from '@playwright/test';
import { newBlankEntry, openFolderNotebook, readFile, trackErrors, waitForSave } from './helpers';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = trackErrors(page);
});
test.afterEach(() => {
  expect(errors, 'uncaught errors in the page').toEqual([]);
});

const well = (page: Page, w: string) => page.locator(`[data-well="${w}"]`);
const sample = (page: Page, name: string) => page.locator('.gc-plate-sample', { hasText: name });

async function insertPlate(page: Page) {
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('/plate');
  await expect(page.locator('.gc-slash-item, .menu-item').filter({ hasText: 'Plate layout' }).first()).toBeVisible();
  await page.keyboard.press('Enter');
}

async function dragWells(page: Page, from: string, to: string) {
  const a = (await well(page, from).boundingBox())!;
  const b = (await well(page, to).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
}

test('a plate layout: samples go in wells by row, column, drag, click or keyboard', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'ELISA');
  await insertPlate(page);
  // It starts in its "Add sample" field.
  await expect(page.getByLabel('Add sample')).toBeFocused();
  for (const n of ['Blank', 'Std 1', 'WT']) {
    await page.keyboard.type(n);
    await page.keyboard.press('Enter');
  }
  // Blanks start gray; the sample just added is the one to fill with.
  await expect(sample(page, 'Blank').locator('.gc-plate-swatch')).toHaveClass(/c-gray/);
  await expect(sample(page, 'WT')).toHaveAttribute('aria-pressed', 'true');
  // Its color, from the row of swatches in its menu.
  await page.getByRole('button', { name: 'Options for WT', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Orange' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: 'Teal' }).click();
  await expect(sample(page, 'WT').locator('.gc-plate-swatch')).toHaveClass(/c-teal/);

  await sample(page, 'Blank').click();
  await page.getByRole('button', { name: 'Fill column 1', exact: true }).click();
  await sample(page, 'Std 1').click();
  await page.getByRole('button', { name: 'Fill row H', exact: true }).click();
  await sample(page, 'WT').click();
  await dragWells(page, 'D6', 'B2');
  await expect(page.locator('.gc-plate-used')).toHaveText('34 of 96 wells');
  await expect(sample(page, 'WT')).toContainText('15');
  await expect(well(page, 'C4')).toHaveAccessibleName('C4: WT');

  // A click on a well with the same sample empties it; the eraser empties too.
  await well(page, 'C4').click();
  await expect(well(page, 'C4')).toHaveAccessibleName('C4: empty');
  await page.getByRole('button', { name: 'Empty wells' }).click();
  await well(page, 'H12').click();
  await expect(well(page, 'H12')).toHaveAccessibleName('H12: empty');

  // Keyboard: arrows move, Space fills, Delete empties.
  await sample(page, 'Std 1').click();
  await well(page, 'A1').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(well(page, 'A3')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(well(page, 'A3')).toHaveAccessibleName('A3: Std 1');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Delete');
  await expect(well(page, 'A1')).toHaveAccessibleName('A1: empty');

  await page.getByLabel('Plate name').fill('ELISA plate 1');
  await waitForSave(page);
  const md = await readFile(page, 'Projects/EXP-0001 ELISA.md');
  expect(md).toContain(
    '<!-- gc:plate {"name":"ELISA plate 1","format":96,"samples":[{"name":"Blank","color":"gray"},{"name":"Std 1","color":"blue"},{"name":"WT","color":"teal"}]} -->',
  );
  expect(md).toContain('| A |   |   | Std 1 |   |   |   |   |   |   |   |   |   |');
  expect(md).toContain('| C | Blank | WT | WT |   | WT | WT |   |   |   |   |   |   |');
  expect(md).toContain('| H | Std 1 | Std 1 | Std 1 | Std 1 | Std 1 | Std 1 | Std 1 | Std 1 | Std 1 | Std 1 | Std 1 |   |');

  // Opens again as it was.
  await page.reload();
  await expect(page.getByLabel('Plate name')).toHaveValue('ELISA plate 1');
  await expect(well(page, 'B2')).toHaveAccessibleName('B2: WT');
  await expect(page.locator('.gc-plate-used')).toHaveText('32 of 96 wells');

  // A smaller plate asks before emptying wells that do not fit; a bigger one keeps them all.
  await page.getByLabel('Plate format').selectOption('24');
  await expect(page.getByRole('dialog')).toContainText('14 filled wells are outside a 24-well plate');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByLabel('Plate format')).toHaveValue('96');
  await page.getByLabel('Plate format').selectOption('384');
  await expect(well(page, 'P24')).toBeVisible();
  await expect(page.locator('.gc-plate-used')).toHaveText('32 of 384 wells');
});

test('plate samples link to stocks, which list the entry as using them', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Colony screen');
  await insertPlate(page);
  // A sample straight from Stocks: named after it and linked to it.
  await page.getByRole('button', { name: 'Add from Stocks…' }).click();
  await page.getByRole('dialog', { name: 'Link a stock' }).getByLabel('Search stocks').fill('GS-0001');
  await page.keyboard.press('Enter');
  const stockSample = page.locator('.gc-plate-sample-row').first();
  await expect(stockSample.locator('.gc-plate-link')).toHaveText('GS-0001');
  const name = (await stockSample.locator('.gc-plate-sample-name').textContent())!;
  await page.getByRole('button', { name: 'Fill row A', exact: true }).click();
  // Another, linked afterward from its menu.
  await page.getByLabel('Add sample').fill('Control');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Options for Control' }).click();
  await page.getByRole('menuitem', { name: 'Link to a stock…' }).click();
  await page.getByRole('dialog', { name: 'Link a stock' }).getByLabel('Search stocks').fill('PR-0003');
  await page.keyboard.press('Enter');
  await expect(page.locator('.gc-plate-sample-row', { hasText: 'Control' }).locator('.gc-plate-link')).toHaveText('PR-0003');
  await page.getByRole('button', { name: 'Fill row B', exact: true }).click();
  await waitForSave(page);
  const md = await readFile(page, 'Projects/General/EXP-0001 Colony screen.md');
  expect(md).toContain('"ref":"GS-0001"');
  expect(md).toContain('{"name":"Control","color":"orange","ref":"PR-0003"}');

  // The well list, for Excel or a plate reader.
  await page.getByRole('button', { name: 'Plate options' }).click();
  await page.getByRole('menuitem', { name: /Copy well list/ }).click();
  const list = await page.evaluate(() => navigator.clipboard.readText());
  const lines = list.split('\n');
  expect(lines[0]).toBe('Well\tSample\tLinked to');
  expect(lines[1]).toBe(`A1\t${name}\tGS-0001 ${name}`);
  expect(lines[13]).toBe('B1\tControl\tPR-0003 M13-fwd (-20)');
  expect(lines).toHaveLength(97);

  // The stock lists the entry that uses it; its chip opens it.
  await page.locator('.gc-plate-link', { hasText: 'GS-0001' }).click();
  await expect(page.locator('.gc-stock-detail')).toContainText('Colony screen');
});

test('a locked entry shows its plate read-only', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'qPCR');
  await insertPlate(page);
  await page.keyboard.type('NTC');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Fill row A', exact: true }).click();
  await page.getByLabel('Add sample').fill('Sample');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Fill row B', exact: true }).click();
  await waitForSave(page);
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await page.getByRole('button', { name: 'Lock entry' }).click();
  await expect(page.getByLabel('Add sample')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fill row C', exact: true })).toBeDisabled();
  await well(page, 'C1').click();
  await expect(well(page, 'C1')).toHaveAccessibleName('C1: empty');
  await expect(well(page, 'A1')).toHaveAccessibleName('A1: NTC');
  // Nothing is picked to fill with; picking a sample shows where it is.
  await expect(page.locator('.gc-plate-sample[aria-pressed="true"]')).toHaveCount(0);
  await sample(page, 'NTC').click();
  await page.mouse.move(0, 0);
  await expect(sample(page, 'NTC')).toHaveAttribute('aria-pressed', 'true');
  await expect(well(page, 'A1')).toHaveClass(/is-spot/);
  await expect(page.locator('.gc-plate-grid')).toHaveClass(/has-spot/);
  await expect(well(page, 'B1')).not.toHaveClass(/is-spot/);
  await expect(well(page, 'B1')).toHaveAccessibleName('B1: Sample');
});
