import { test, expect, type Page } from '@playwright/test';
import { newBlankEntry, openFolderNotebook, readFile, trackErrors, waitForSave } from './helpers';

const pathOf = (page: Page) => decodeURIComponent(new URL(page.url()).hash.replace('#/doc/', ''));

test('every page that lists things has one title, in one place and one size, and one New button', async ({ page }) => {
  const errors = trackErrors(page);
  await openFolderNotebook(page);
  const seen: { name: string; x: number; size: string }[] = [];
  for (const name of [
    'Calendar',
    'Protocols',
    'Stocks',
    'Literature',
    'Templates',
    'Notes',
    'Experiments',
    'Lab tasks',
    'Trash',
    'Getting started',
  ]) {
    if (name === 'Getting started') await page.goto('/#/folder/Projects/Getting%20started');
    else await page.locator('.gc-nav-item', { hasText: name }).first().click();
    const title = page.locator('.gc-main h1');
    await expect(title).toHaveCount(1);
    await expect(title).toBeVisible();
    const box = (await title.boundingBox())!;
    seen.push({ name, x: Math.round(box.x), size: await title.evaluate((h) => getComputedStyle(h).fontSize) });
    // No bar above the title saying it again.
    await expect(page.locator('.gc-main .gc-topbar:visible')).toHaveCount(0);
    // New, once, in the bar under the title (the trash has nothing to add).
    await expect(page.locator('.gc-main .gc-new')).toHaveCount(name === 'Trash' ? 0 : 1);
  }
  expect(new Set(seen.map((s) => s.x)).size, JSON.stringify(seen)).toBe(1);
  expect(new Set(seen.map((s) => s.size)).size, JSON.stringify(seen)).toBe(1);

  // Home: the sidebar's New entry is the only one.
  await page.locator('.gc-nav-item', { hasText: 'Home' }).click();
  await expect(page.locator('.gc-main').getByRole('button', { name: /^New entry/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('New makes what the page holds: a protocol on Protocols, a sub-template on the Sub-templates tab', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Protocols' }).click();
  await expect(page.locator('.gc-new-main')).toHaveText('New');
  await page.locator('.gc-new-main').click();
  await expect(page.getByRole('dialog', { name: 'New protocol' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.gc-nav-item', { hasText: 'Templates' }).click();
  await page.getByRole('group', { name: 'Kind' }).getByRole('button', { name: 'Sub-templates' }).click();
  await page.locator('.gc-new-main').click();
  await expect(page.getByRole('dialog', { name: 'New sub-template' })).toBeVisible();
});

test('the Experiments board says where its columns come from', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Experiments' }).click();
  // Each column adds at its foot; the column heads have no + of their own.
  await expect(page.locator('.gc-col-head').getByRole('button', { name: /^Add to/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Board options' }).click();
  await page.getByRole('menuitem', { name: 'Edit statuses…' }).click();
  await expect(page.locator('#settings-statuses')).toBeInViewport();
});

test('the week shows the hours: plan at an hour, move to another, or make it all-day', async ({ page }) => {
  const errors = trackErrors(page);
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Calendar' }).click();
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Week' }).click();
  const scroll = page.locator('.gc-tgrid-scroll');
  const col = page.locator('.gc-tgrid-col.is-today');
  const hourY = async (h: number) => (await col.boundingBox())!.y + h * 44 + 10;
  await scroll.evaluate((el) => el.scrollTo({ top: 13 * 44 }));

  // A click on an empty hour plans an entry then.
  const x = (await col.boundingBox())!.x + 20;
  await page.mouse.click(x, await hourY(14));
  await page.getByRole('button', { name: 'New entry at this time' }).click();
  await page.locator('.gc-template-option', { hasText: 'Blank entry' }).click();
  await page.locator('#ne-title').fill('Western blot transfer');
  await page.getByRole('button', { name: 'Create entry' }).click();
  await expect(page.locator('.gc-title-input')).toHaveValue('Western blot transfer');
  const path = pathOf(page);
  await waitForSave(page);
  expect(await readFile(page, path)).toMatch(/\ntime: ['"]?14:00/);

  // Dragged an hour down, it starts an hour later.
  await page.locator('.gc-nav-item', { hasText: 'Calendar' }).click();
  await scroll.evaluate((el) => el.scrollTo({ top: 13 * 44 }));
  const event = page.locator('.gc-tevent', { hasText: 'Western blot transfer' });
  await expect(event).toContainText(/2:00\sPM|14:00/);
  const box = (await event.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + 12, box.y + 30, { steps: 4 });
  await page.mouse.move(box.x + 12, box.y + 6 + 44, { steps: 6 });
  await page.mouse.up();
  await expect(event).toContainText(/3:00\sPM|15:00/);
  await expect.poll(() => readFile(page, path)).toMatch(/\ntime: ['"]?15:00/);

  // Dropped in the all-day row, it loses its time.
  const from = (await event.boundingBox())!;
  const to = (await page.locator('.gc-tgrid-allday .gc-day.is-today').boundingBox())!;
  await page.mouse.move(from.x + 10, from.y + 6);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y - 20, { steps: 4 });
  await page.mouse.move(to.x + 10, to.y + to.height - 6, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.gc-tgrid-allday .gc-cal-item', { hasText: 'Western blot transfer' })).toBeVisible();
  await expect.poll(() => readFile(page, path)).not.toMatch(/\ntime:/);
  expect(errors).toEqual([]);
});

test('in a note too, a drag from the text into another paragraph selects whole blocks', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Notes' }).click();
  await page.locator('.gc-new-main').click();
  await expect(page.locator('.gc-title-input')).toBeFocused();
  await page.keyboard.type('Group meeting');
  await page.keyboard.press('Enter');
  for (const w of ['one', 'two', 'three', 'four']) {
    await page.keyboard.type(w);
    await page.keyboard.press('Enter');
  }
  const ps = page.locator('.ProseMirror > p');
  const a = (await ps.nth(0).boundingBox())!;
  const c = (await ps.nth(2).boundingBox())!;
  await page.mouse.move(a.x + 10, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 20, a.y + a.height / 2, { steps: 2 });
  await page.mouse.move(c.x + 10, c.y + c.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.gc-block-selected')).toHaveCount(3);
  await page.keyboard.press('Delete');
  await expect(ps.first()).toHaveText('four');
});

test('the highlight button uses the last color picked', async ({ page }) => {
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Highlights');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('first band');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second band');
  await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: 'Highlight color' }).click();
  await page.getByRole('button', { name: 'Highlight blue' }).click();
  await page.locator('.ProseMirror > p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await expect(page.locator('.ProseMirror mark[data-color="blue"]')).toHaveCount(2);
});
