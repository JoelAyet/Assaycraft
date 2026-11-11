/**
 * A second swipe through the calendar while the first one's glide still goes on, and freezers and
 * boxes for the stocks of a notebook of one's own.
 */
import { test, expect, type Page } from '@playwright/test';
import { openFolderNotebook, readFile, trackErrors, waitForSave } from './helpers';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = trackErrors(page);
});
test.afterEach(() => {
  expect(errors, 'uncaught errors in the page').toEqual([]);
});

/** Wheel events as a trackpad sends them: one per frame, sideways. */
async function wheel(page: Page, deltas: number[]) {
  for (const dx of deltas) await page.mouse.wheel(dx, 0);
}

test('swipes straight after each other each move the calendar, while one swipe’s long glide moves it once', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await page.locator('.gc-nav-item', { hasText: 'Calendar' }).click();
  const title = page.locator('.gc-cal-month-title');
  const months = async () => {
    const t = (await title.textContent()) ?? '';
    const d = new Date(`1 ${t}`);
    return d.getFullYear() * 12 + d.getMonth();
  };
  const start = await months();
  const body = (await page.locator('.gc-calendar-body').boundingBox())!;
  await page.mouse.move(body.x + body.width / 2, body.y + 200);

  // One swipe, gliding on for a long time (a fast flick): one month.
  const glide = Array.from({ length: 50 }, (_, i) => Math.max(1, Math.round(34 * 0.92 ** i)));
  await wheel(page, [8, 20, 30, ...glide]);
  await expect.poll(months).toBe(start + 1);
  await page.waitForTimeout(400);
  // A swipe whose finger speeds up and slows down as it goes: still one.
  await wheel(page, [10, 24, 30, 22, 34, 26, 36, 28, 20, 14, 9, 5, 3, 2, 1]);
  await expect.poll(months).toBe(start + 2);
  await page.waitForTimeout(400);
  expect(await months()).toBe(start + 2);

  // Two swipes with no pause between them (the second starts while the first still glides): two months.
  await wheel(page, [8, 20, 30, 34, 30, 24, 18, 13, 9, 6, 4, 3, 2, 1, 1, 3, 9, 18, 28, 34, 30, 22, 14, 8, 4, 2, 1]);
  await expect.poll(months).toBe(start + 4);
  // Another one, and straight back the other way while it glides: there and back.
  await wheel(page, [30, 24, 16, 10, -6, -18, -30, -34, -24, -12, -4]);
  await expect.poll(months).toBe(start + 4);
  await page.waitForTimeout(400);
  expect(await months()).toBe(start + 4);
});

test('stocks of one’s own go in freezers: boxes on shelves, tubes put, moved and taken out, and their Location follows', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Stocks' }).click();
  await page.getByRole('tab', { name: 'Freezers' }).click();
  await expect(page.getByRole('heading', { name: 'No freezers yet' })).toBeVisible();

  // A freezer, and two boxes on its shelves.
  await page.locator('.empty-state').getByRole('button', { name: 'New freezer' }).click();
  await page.getByLabel('Name').fill('−80 °C freezer A');
  await page.getByRole('button', { name: 'Add freezer' }).click();
  for (const name of ['Glycerol box 1', 'Primer box 1']) {
    await page.locator('.gc-viewbar').getByRole('button', { name: 'New box' }).click();
    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Add box' }).click();
    await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
  }
  await expect(page.locator('.gc-box-cell')).toHaveCount(81);

  // The glycerol stock goes in A1 of the first box; its Location says so.
  await page.locator('.gc-freezer-box', { hasText: 'Glycerol box 1' }).click();
  await page.getByRole('button', { name: 'A1, free' }).click();
  await page.getByRole('button', { name: 'Put a stock here…' }).click();
  await page.getByRole('dialog').getByLabel('Search stocks').fill('GS-0001');
  await page.getByRole('dialog').locator('.gc-picker-item', { hasText: 'GS-0001' }).click();
  await expect(page.getByRole('button', { name: /^A1, GS-0001/ })).toBeVisible();
  await waitForSave(page);
  await expect.poll(() => readFile(page, 'Stocks/Glycerol stocks.md')).toMatch(/GS-0001 [^\n]*\| Glycerol box 1 · A1 \|/);
  expect(JSON.parse(await readFile(page, 'Stocks/freezers.json')).boxes[0].slots.A1).toEqual({ path: 'Stocks/Glycerol stocks.md', id: 'GS-0001' });

  // A primer, from its details: into the next free place of a box.
  await page.getByRole('tab', { name: 'Primers' }).click();
  await page.locator('.gc-stock-id', { hasText: 'PR-0001' }).click();
  await expect(page.locator('.gc-stock-detail')).toContainText('Not in a freezer box yet.');
  await page.getByRole('button', { name: 'Put in a box…' }).click();
  await page.getByRole('dialog').getByLabel('Box', { exact: true }).selectOption({ label: '−80 °C freezer A › Shelf 1 › Primer box 1 (81 free)' });
  await page.getByRole('dialog').getByRole('button', { name: 'Put in A1' }).click();
  await expect(page.locator('.gc-stock-place-text').first()).toContainText('Primer box 1 · A1');
  await expect.poll(() => readFile(page, 'Stocks/Primers.md')).toMatch(/PR-0001 [^\n]*\| Primer box 1 · A1 \|/);

  // The glycerol tube moves to C3; its Location follows.
  await page.getByRole('tab', { name: 'Freezers' }).click();
  await page.locator('.gc-freezer-box', { hasText: 'Glycerol box 1' }).click();
  await page.getByRole('button', { name: /^A1, GS-0001/ }).click();
  await page.locator('.gc-box-place').getByRole('button', { name: 'Move…' }).click();
  const move = page.getByRole('dialog', { name: 'Move GS-0001' });
  await move.getByRole('button', { name: 'C3, free' }).click();
  await move.getByRole('button', { name: 'Move to C3' }).click();
  await expect(page.getByRole('button', { name: /^C3, GS-0001/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'A1, free' })).toBeVisible();
  await expect.poll(() => readFile(page, 'Stocks/Glycerol stocks.md')).toMatch(/GS-0001 [^\n]*\| Glycerol box 1 · C3 \|/);

  // Renamed, the collection keeps its tubes.
  await page.getByRole('tab', { name: 'Glycerol stocks' }).click();
  await page.getByRole('button', { name: 'Glycerol stocks options' }).click();
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Strains');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Strains' })).toBeVisible();
  await expect
    .poll(async () => JSON.parse(await readFile(page, 'Stocks/freezers.json')).boxes[0].slots.C3)
    .toEqual({ path: 'Stocks/Strains.md', id: 'GS-0001' });
  await page.locator('.gc-stock-id', { hasText: 'GS-0001' }).click();
  await expect(page.locator('.gc-stock-place-text').first()).toContainText('Glycerol box 1 · C3');

  // Taken out: the place is free, and the Location it wrote is cleared.
  await page.locator('.gc-stock-place-text').first().click();
  await page.getByRole('button', { name: /^C3, GS-0001/ }).click();
  await page.locator('.gc-box-place').getByRole('button', { name: 'Take out' }).click();
  await expect(page.getByRole('button', { name: 'C3, free' })).toBeVisible();
  await expect
    .poll(() => readFile(page, 'Stocks/Strains.md'))
    .toMatch(/GS-0001 \| pUC19 in NEB 5-alpha \| NEB 5-alpha \| pUC19 \| Ampicillin \| +\| 20\d\d-/);
});
