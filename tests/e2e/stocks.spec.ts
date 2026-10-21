import { test, expect, type Page } from '@playwright/test';
import { listFiles, newBlankEntry, openFolderNotebook, readFile, trackErrors, waitForSave } from './helpers';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = trackErrors(page);
});
test.afterEach(() => {
  expect(errors, 'uncaught errors in the page').toEqual([]);
});

const row = (page: Page, id: string) => page.locator(`.gc-stock-table tr[data-stock="${id}"]`);
const computed = (page: Page, id: string) => row(page, id).locator('td.col-computed');

async function openPrimers(page: Page) {
  await page.locator('.gc-nav-item', { hasText: 'Stocks' }).click();
  await page.locator('.gc-stock-tab', { hasText: 'Primers' }).click();
  await expect(page.locator('.gc-stock-table')).toBeVisible();
}

test('primers: add one, and get its length, GC % and Tm', async ({ page }) => {
  await openFolderNotebook(page);
  expect(await listFiles(page, 'Stocks')).toEqual(['Glycerol stocks.md', 'Primers.md']);
  await openPrimers(page);
  await expect(computed(page, 'PR-0001')).toHaveText(['21', '61.9', '60.7']);

  await page.locator('.gc-stock-add').click();
  await expect(row(page, 'PR-0004').getByLabel('Name of PR-0004')).toBeFocused();
  await page.keyboard.type('T7 promoter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('taatacgactcactataggg');
  await expect(computed(page, 'PR-0004')).toHaveText(['20', '40.0', '46.8']);
  await row(page, 'PR-0004').getByLabel('Location of T7 promoter').fill('Primer box 1 · A4');

  // Enter moves down like a spreadsheet; on the last row it adds a primer.
  await row(page, 'PR-0004').getByLabel('Location of T7 promoter').press('Enter');
  await expect(row(page, 'PR-0005').getByLabel('Location of PR-0005')).toBeFocused();

  // Rows copied from Excel fill the columns from there on, skipping the computed ones.
  await row(page, 'PR-0005')
    .getByLabel('Name of PR-0005')
    .evaluate((el) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', 'SP6 promoter\tATTTAGGTGACACTATAG\tSP6\nBGH-rev\tTAGAAGGCACAGTCGAGG\tpcDNA3\n');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
  await expect(row(page, 'PR-0005').getByLabel('Name of SP6 promoter')).toHaveValue('SP6 promoter');
  await expect(row(page, 'PR-0006').getByLabel('Target of BGH-rev')).toHaveValue('pcDNA3');
  await expect(computed(page, 'PR-0006')).toHaveText(['18', '55.6', '52.4']);

  // Filter.
  await page.getByLabel('Filter Primers').fill('promoter');
  await expect(page.locator('.gc-stock-table tbody tr')).toHaveCount(2);
  await page.getByLabel('Filter Primers').fill('');
  await waitForSave(page);

  const md = await readFile(page, 'Stocks/Primers.md');
  expect(md).toMatch(/^---\nkind: stocks\ntitle: Primers\n/);
  expect(md).toContain('stock: primer');
  expect(md).toContain('| PR-0004 | T7 promoter | taatacgactcactataggg | 20 | 40.0 | 46.8 |   | Primer box 1 · A4 |');
  expect(md).toContain('| PR-0006 | BGH-rev | TAGAAGGCACAGTCGAGG | 18 | 55.6 | 52.4 | pcDNA3 |');

  // Delete, with undo.
  await row(page, 'PR-0006').getByRole('button', { name: 'PR-0006' }).click();
  await page.locator('.gc-stock-detail').getByRole('button', { name: 'Delete' }).click();
  await expect(row(page, 'PR-0006')).toHaveCount(0);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'PR-0006')).toHaveCount(1);
});

test('link a primer from an entry; clicking it shows the primer in its table', async ({ page }) => {
  await openFolderNotebook(page);
  await newBlankEntry(page, 'EGFP PCR');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Amplified EGFP with ');
  await page.keyboard.type('/stock');
  await page.locator('.gc-slash-item', { hasText: 'Stock' }).first().click();
  await page.getByLabel('Search stocks').fill('egfp rev');
  await expect(page.locator('.gc-picker-item')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('.ProseMirror a', { hasText: 'PR-0002 EGFP-rev' })).toBeVisible();
  await page.waitForTimeout(100);
  await page.keyboard.type('(Q5).');
  await waitForSave(page);
  expect(await readFile(page, 'Projects/General/EXP-0001 EGFP PCR.md')).toContain(
    'Amplified EGFP with [PR-0002 EGFP-rev](../../Stocks/Primers.md#PR-0002) (Q5).',
  );

  // One click opens the table with the primer picked out and everything about it.
  await page.locator('.ProseMirror a', { hasText: 'PR-0002' }).click();
  await expect(page).toHaveURL(/#\/stocks\/Stocks\/Primers\.md\?id=PR-0002$/);
  await expect(row(page, 'PR-0002')).toHaveClass(/is-selected/);
  const detail = page.locator('.gc-stock-detail');
  await expect(detail.locator('h2')).toHaveText('EGFP-rev');
  await expect(detail.locator('.gc-stock-seq')).toHaveText('TTACTTGTACAGCTCGTCCATGCC');
  await expect(detail.locator('.gc-stock-field.is-tm dd')).toHaveText('58.9');
  await expect(detail.locator('.gc-stock-used-item')).toHaveText(/EXP-0001\s*EGFP PCR/);

  // Renamed collections keep their links working (the ID is looked up).
  await page.locator('.gc-table-tools').getByTitle('Primers options').click();
  await page.locator('.menu-item', { hasText: 'Rename…' }).click();
  await page.locator('.dialog input').fill('Oligos');
  await page
    .locator('.dialog')
    .getByRole('button', { name: /Save|OK|Rename/ })
    .click();
  await expect(page.locator('.gc-stock-tab.active')).toContainText('Oligos');
  await expect.poll(() => listFiles(page, 'Stocks')).toEqual(['Glycerol stocks.md', 'Oligos.md']);

  await detail.locator('.gc-stock-used-item').click();
  await expect(page.locator('.gc-title-input')).toHaveValue('EGFP PCR');
  await page.locator('.ProseMirror a', { hasText: 'PR-0002' }).click();
  await expect(page.locator('.gc-stock-detail h2')).toHaveText('EGFP-rev');
});

test('search finds a single stock and opens it', async ({ page }) => {
  await openFolderNotebook(page);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('M13');
  const hit = page.locator('.gc-pal-item', { has: page.locator('.id-chip', { hasText: 'PR-0003' }) });
  await expect(hit).toContainText('M13-fwd (-20)');
  await hit.click();
  await expect(page.locator('.gc-stock-detail h2')).toHaveText('M13-fwd (-20)');
});

test('new collections: seeds, with their own columns and IDs', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await page.locator('.gc-nav-item', { hasText: 'Stocks' }).click();
  await expect(page.locator('.empty-state')).toContainText('No stock collections yet');
  await page.locator('.empty-state').getByRole('button', { name: 'New collection' }).click();
  await page.locator('.dialog .gc-template-option', { hasText: 'Seeds' }).click();
  await expect(page.locator('#sc-prefix')).toHaveValue('SD-');
  await page.locator('#sc-title').fill('Arabidopsis seeds');
  await page.locator('#sc-prefix').fill('at-');
  await page.getByRole('button', { name: 'Create collection' }).click();
  await expect(page.locator('.gc-stock-tab.active')).toContainText('Arabidopsis seeds');
  await expect(page.locator('.gc-stock-table th')).toHaveText([
    'ID',
    'Name',
    'Species',
    'Genotype',
    'Generation',
    'Harvest date',
    'Location',
    'Notes',
  ]);
  await page.locator('.gc-stock-add').click();
  await page.keyboard.type('Col-0');
  await expect(row(page, 'AT-0001')).toBeVisible();

  // Add a column.
  await page.locator('.gc-table-tools').getByRole('button', { name: 'Columns' }).click();
  await page.getByLabel('New column').fill('Mother plant');
  await page.getByRole('button', { name: 'Add column' }).click();
  await page.getByRole('button', { name: 'Save columns' }).click();
  await expect(page.locator('.gc-stock-table th').last()).toHaveText('Mother plant');
  await row(page, 'AT-0001').getByLabel('Mother plant of Col-0').fill('AT-0000');
  await waitForSave(page);
  const md = await readFile(page, 'Stocks/Arabidopsis seeds.md');
  expect(md).toContain('prefix: AT-');
  expect(md).toContain('| ID | Name | Species | Genotype | Generation | Harvest date | Location | Notes | Mother plant |');
  expect(md).toContain('| AT-0001 | Col-0 |');
});

test('settings: saving goes back to Home', async ({ page }) => {
  await openFolderNotebook(page);
  await page.goto('/#/settings');
  await page.getByLabel('Your name').fill('Joel Ayet');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.locator('.toast')).toContainText('Settings saved');
  await expect(page.locator('.gc-home-title')).toHaveText(/, Joel$/);
});
