import { test, expect, type Page } from '@playwright/test';
import { newBlankEntry, openFolderNotebook, readFile, trackErrors, waitForSave, writeFile } from './helpers';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = trackErrors(page);
});
test.afterEach(() => {
  expect(errors, 'uncaught errors in the page').toEqual([]);
});

const cell = (page: Page, r: number, field: 'name' | 'stock' | 'final') => page.locator(`.gc-buffer [data-cell="${r}:${field}"]`);
const row = (page: Page, r: number) => page.locator('.gc-buffer-grid tbody tr').nth(r);
const amount = (page: Page, r: number) => row(page, r).locator('.col-add');

test('make a buffer: what to add of each stock, and how much to weigh', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'Lysis buffer prep');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('/buffer');
  await expect(page.locator('.gc-slash-item, .menu-item').filter({ hasText: 'Buffer' }).first()).toBeVisible();
  await page.keyboard.press('Enter');

  // The new buffer starts with the cursor in its first component.
  await expect(cell(page, 0, 'name')).toBeFocused();
  await page.keyboard.type('Tris-HCl pH 8.0');
  await page.keyboard.press('Tab');
  await page.keyboard.type('1');
  await page.keyboard.press('Tab'); // stock unit: M
  await page.keyboard.press('Tab');
  await page.keyboard.type('50'); // final unit: mM
  await expect(amount(page, 0)).toHaveText('2.5 mL');

  // A powder: its molar mass gives the mass to weigh.
  await cell(page, 1, 'name').fill('NaCl');
  await cell(page, 1, 'stock').fill('58.44');
  await row(page, 1).getByLabel('Stock unit of NaCl').selectOption('g/mol');
  await cell(page, 1, 'final').fill('150');
  await expect(amount(page, 1)).toHaveText('438.3 mg');
  await expect(amount(page, 1).getByLabel('Weigh')).toBeVisible();

  await cell(page, 2, 'name').fill('Glycerol');
  await cell(page, 2, 'stock').fill('100');
  await row(page, 2).getByLabel('Stock unit of Glycerol').selectOption('%');
  await cell(page, 2, 'final').fill('10');
  await row(page, 2).getByLabel('Final unit of Glycerol').selectOption('%');
  await expect(amount(page, 2)).toHaveText('5 mL');
  // Water brings it up to the final volume (the powder does not count toward it).
  await expect(page.locator('.gc-buffer-fill .col-add')).toHaveText('42.5 mL');

  // A different final volume recalculates everything.
  await page.getByLabel('Final volume', { exact: true }).fill('1');
  await page.getByLabel('Unit of the final volume').selectOption('L');
  await expect(amount(page, 0)).toHaveText('50 mL');
  await expect(amount(page, 1)).toHaveText('8.766 g');
  await expect(amount(page, 2)).toHaveText('100 mL');
  await expect(page.locator('.gc-buffer-fill .col-add')).toHaveText('850 mL');

  // Enter on the last row adds a row, like a spreadsheet; mistakes are explained.
  await cell(page, 2, 'final').press('Enter');
  await expect(cell(page, 3, 'final')).toBeFocused();
  await cell(page, 3, 'name').fill('Too much');
  await cell(page, 3, 'stock').fill('1');
  await cell(page, 3, 'final').fill('2');
  await row(page, 3).getByLabel('Final unit of Too much').selectOption('M');
  await expect(amount(page, 3)).toHaveText('The final concentration is above the stock');
  await row(page, 3).getByRole('button', { name: 'Remove Too much' }).click();
  await expect(page.locator('.gc-buffer-grid tbody tr')).toHaveCount(4); // 3 components + water

  // Rows copied from Excel are pasted into the right columns.
  await page.locator('.gc-buffer-add').click();
  await expect(cell(page, 3, 'name')).toBeFocused();
  await cell(page, 3, 'name').evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'EDTA\t0.5\tM\t1\tmM\nDTT\t1 M\t1 mM\n');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(cell(page, 3, 'name')).toHaveValue('EDTA');
  await expect(amount(page, 3)).toHaveText('2 mL');
  await expect(cell(page, 4, 'name')).toHaveValue('DTT');
  await expect(amount(page, 4)).toHaveText('1 mL');

  await page.getByLabel('Buffer name').fill('Lysis buffer');
  await waitForSave(page);

  // Saved as a plain table that reads well anywhere.
  const md = await readFile(page, 'Projects/EXP-0001 Lysis buffer prep.md');
  expect(md).toContain(
    [
      '<!-- gc:buffer {"name":"Lysis buffer","volume":"1 L","solvent":"Water"} -->',
      '| Component | Stock | Final | Add |',
      '| --- | ---: | ---: | ---: |',
      '| Tris-HCl pH 8.0 | 1 M | 50 mM | 50 mL |',
      '| NaCl | 58.44 g/mol | 150 mM | 8.766 g |',
      '| Glycerol | 100 % | 10 % | 100 mL |',
      '| EDTA | 0.5 M | 1 mM | 2 mL |',
      '| DTT | 1 M | 1 mM | 1 mL |',
      '| Water |   |   | to 1 L (847 mL) |',
    ].join('\n'),
  );

  // And it opens again as a buffer.
  await page.reload();
  await expect(page.locator('.gc-buffer')).toBeVisible();
  await expect(page.getByLabel('Buffer name')).toHaveValue('Lysis buffer');
  await expect(amount(page, 1)).toHaveText('8.766 g');
  await expect(page.locator('.gc-buffer-fill .col-add')).toHaveText('847 mL');

  // A locked entry shows the buffer read-only.
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await page.getByRole('button', { name: 'Lock entry' }).click();
  await expect(cell(page, 0, 'name')).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('Stock unit of NaCl')).toBeDisabled();
  await expect(page.locator('.gc-buffer-add')).toHaveCount(0);
  await expect(page.locator('.gc-buffer .col-x .icon-btn')).toHaveCount(0);
  await expect(amount(page, 1)).toHaveText('8.766 g');
});

test('the buffer is also in the toolbar’s Insert menu', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'PBS');
  await page.locator('.ProseMirror').click();
  await page.locator('.gc-toolbar').getByRole('button', { name: 'Insert…', exact: true }).click();
  await page.locator('.menu-item', { hasText: 'Buffer' }).click();
  await expect(page.locator('.gc-buffer')).toBeVisible();
  await cell(page, 0, 'name').fill('PBS');
  await cell(page, 0, 'stock').fill('10');
  await page.getByLabel('Stock unit of PBS').selectOption('X');
  await cell(page, 0, 'final').fill('1');
  await page.getByLabel('Final unit of PBS').selectOption('X');
  await expect(amount(page, 0)).toHaveText('5 mL');
});

test('a buffer in a template asks for its {{variables}} and calculates in the new entry', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await writeFile(
    page,
    'Templates/Lysis prep.md',
    '---\nid: lysis-prep\nkind: template\ntitle: Lysis prep\n---\n' +
      '<!-- gc:buffer {"name":"Lysis buffer","volume":"{{Volume|50}} mL","solvent":"Water"} -->\n' +
      '| Component | Stock | Final | Add |\n| --- | ---: | ---: | ---: |\n| NaCl | 5 M | {{Salt\\|150}} mM |   |\n| Water |   |   | to {{Volume\\|50}} mL |\n',
  );
  await page.reload();
  await expect(page.locator('.gc-main')).toBeVisible();
  // In the template the amounts wait for the values.
  await page.goto('/#/templates');
  await page.locator('.gc-tpl-card', { hasText: 'Lysis prep' }).click();
  await expect(amount(page, 0)).toHaveText('—');
  // A new entry asks for them, with the defaults filled in.
  await page.getByRole('button', { name: 'New entry from template' }).click();
  const field = (label: string) => page.locator('.gc-var', { hasText: label }).locator('input');
  await expect(field('Salt')).toHaveAttribute('placeholder', '150');
  await field('Volume').fill('20');
  await page.locator('#ne-title').fill('Lysis');
  await page.getByRole('button', { name: 'Create entry' }).click();
  await expect(page.getByLabel('Final volume', { exact: true })).toHaveValue('20');
  await expect(amount(page, 0)).toHaveText('600 µL');
  await expect(page.locator('.gc-buffer-fill .col-add')).toHaveText('19.4 mL');
});
