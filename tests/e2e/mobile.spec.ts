import { test, expect, type Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { openFolderNotebook, readFile, trackErrors, useWithoutComputer, waitForSave, ymd } from './helpers';

// A phone (iPhone 13 size), with touch.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = trackErrors(page);
});
test.afterEach(() => {
  expect(errors, 'uncaught errors in the page').toEqual([]);
});

/** Nothing sticks out sideways: the page and its top bar fit the screen. */
async function expectFits(page: Page, what: string) {
  const sizes = await page.evaluate(() =>
    ['.gc-page', '.gc-topbar', '.gc-doc'].flatMap((sel) =>
      [...document.querySelectorAll<HTMLElement>(sel)].map((el) => ({ sel, scroll: el.scrollWidth, client: el.clientWidth })),
    ),
  );
  for (const s of sizes) expect(s.scroll, `${what}: ${s.sel} is wider than the screen`).toBeLessThanOrEqual(s.client + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth), `${what}: page scrolls sideways`).toBeLessThanOrEqual(390);
}

async function openMenu(page: Page) {
  await page.locator('.gc-nav-toggle').first().click();
  await expect(page.locator('.gc-sidebar')).toBeVisible();
}

async function go(page: Page, item: string) {
  await openMenu(page);
  await page.locator('.gc-nav-item', { hasText: item }).click();
  await expect(page.locator('.gc-sidebar')).toBeHidden();
}

test('on a phone the sidebar is a drawer, and every page fits the screen', async ({ page }) => {
  await openFolderNotebook(page);
  await expect(page.locator('.gc-sidebar')).toBeHidden();
  await expectFits(page, 'Home');

  // Open and close the drawer: backdrop, close button, Escape.
  await openMenu(page);
  await page.locator('.gc-nav-backdrop').click({ position: { x: 370, y: 400 } });
  await expect(page.locator('.gc-sidebar')).toBeHidden();
  await openMenu(page);
  await page.getByRole('button', { name: 'Close the menu' }).click();
  await expect(page.locator('.gc-sidebar')).toBeHidden();
  await openMenu(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.gc-sidebar')).toBeHidden();

  await go(page, 'Protocols');
  await expect(page.locator('.gc-protocol-table tbody tr')).toHaveCount(3);
  await expectFits(page, 'Protocols');
  await page.locator('.gc-protocol-table tbody tr').first().click();
  await expect(page.locator('.gc-title-input')).toHaveValue('Bacterial glycerol stocks');
  await expectFits(page, 'Protocol');

  await go(page, 'Templates');
  await expectFits(page, 'Templates');
  await go(page, 'Experiments');
  await expectFits(page, 'Experiments board');
  await go(page, 'Lab tasks');
  await expectFits(page, 'Task board');

  // The calendar starts as an agenda, which suits a small screen.
  await go(page, 'Calendar');
  await expect(page.locator('.gc-segmented button.active')).toHaveText('Agenda');
  await expectFits(page, 'Calendar');

  await page.goto('/#/settings');
  await expect(page.locator('.gc-page-title')).toHaveText('Settings');
  await expectFits(page, 'Settings');
});

test('the month view on a phone lists the events of the day you tap', async ({ page }) => {
  await openFolderNotebook(page);
  await openMenu(page);
  await page.locator('.gc-new-btn').click();
  await page.locator('.gc-template-option', { hasText: 'Blank entry' }).click();
  await page.locator('#ne-title').fill('Colony PCR');
  await page.getByRole('button', { name: 'Create entry' }).click();
  await waitForSave(page);
  await go(page, 'Calendar');
  await page.locator('.gc-segmented button', { hasText: 'Month' }).click();

  // Events are bars in the grid; today's are listed below it.
  const today = ymd(new Date());
  await expect(page.locator(`.gc-day[data-day="${today}"]`)).toHaveClass(/is-picked/);
  const list = page.locator('.gc-month-day');
  await expect(list.locator('h3')).toHaveText(new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }));
  await expect(list.locator('.gc-agenda-item', { hasText: 'Colony PCR' })).toBeVisible();
  await expectFits(page, 'Month view');

  // A day with nothing on it.
  const earlier = (await page.locator('.gc-day').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.day!))).find((d) => d < today);
  if (earlier) {
    await page.locator(`.gc-day[data-day="${earlier}"]`).click();
    await expect(list).toContainText('Nothing planned for this day.');
  }
  await page.locator(`.gc-day[data-day="${today}"]`).click();
  await list.locator('.gc-agenda-item', { hasText: 'Colony PCR' }).click();
  await expect(page.locator('.gc-title-input')).toHaveValue('Colony PCR');
});

test('write an entry on a phone', async ({ page }) => {
  await openFolderNotebook(page);
  await openMenu(page);
  await page.locator('.gc-new-btn').click();
  // Big dialogs fill the screen.
  await expect.poll(async () => (await page.locator('.dialog').boundingBox())?.width).toBe(390);
  await page.locator('.gc-template-option', { hasText: 'Blank entry' }).click();
  await page.locator('#ne-title').fill('Colony PCR on the bench');
  await page.getByRole('button', { name: 'Create entry' }).click();
  await expect(page.locator('.gc-title-input')).toHaveValue('Colony PCR on the bench');
  await expectFits(page, 'Entry');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Picked 8 colonies.');
  await waitForSave(page);
  expect(await readFile(page, 'Projects/General/EXP-0001 Colony PCR on the bench.md')).toContain('Picked 8 colonies.');
});

test('open a notebook exported from a computer (.zip) on a phone', async ({ page }) => {
  const zip = zipSync({
    'Lab notebook/genecraft.json': strToU8(JSON.stringify({ app: 'genecraft', version: 1, name: 'Smith lab', idPrefix: 'SL-', idDigits: 3 })),
    'Lab notebook/Projects/Cloning/SL-001 Gibson of pX330.md': strToU8(
      '---\nid: SL-001\ntitle: Gibson of pX330\nstatus: in-progress\n---\n\nThree fragments.\n',
    ),
    'Lab notebook/Protocols/P-0001 Miniprep.md': strToU8('---\nid: P-0001\nkind: protocol\ntitle: Miniprep\nversion: "1.0"\n---\n\n1. Pellet.\n'),
  });
  await page.goto('/');
  await useWithoutComputer(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open a .zip…' }).click();
  await (await chooser).setFiles({ name: 'Smith lab 2026-10-16.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  await expect(page.locator('.toast')).toContainText('as a notebook in this browser');
  await openMenu(page);
  await expect(page.locator('.gc-notebook-name')).toHaveText('Smith lab');
  await page.locator('.gc-tree-row', { hasText: 'Cloning' }).click();
  await expect(page.locator('.gc-table')).toContainText('Gibson of pX330');
  await go(page, 'Protocols');
  await expect(page.locator('.gc-protocol-table')).toContainText('Miniprep');
});

test('importing the same notebook again only adds what changed', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  const md = (body: string) => strToU8(`---\nid: EXP-0001\ntitle: Gibson\n---\n\n${body}\n`);
  const zip = (body: string) =>
    Buffer.from(
      zipSync({
        'Projects/General/EXP-0001 Gibson.md': md(body),
        'Projects/General/EXP-0002 Gel.md': strToU8('---\nid: EXP-0002\ntitle: Gel\n---\n\nRan it.\n'),
      }),
    );
  const importZip = async (data: Buffer) => {
    await page.locator('.gc-nav-toggle').first().click();
    await page.locator('.gc-notebook-btn').click();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.menu-item', { hasText: 'Import .zip into notebook' }).click();
    await (await chooser).setFiles({ name: 'export.zip', mimeType: 'application/zip', buffer: data });
  };
  await importZip(zip('Three fragments.'));
  await expect(page.locator('.toast').last()).toContainText('Imported: 2 new files.');
  await importZip(zip('Three fragments.'));
  await expect(page.locator('.toast').last()).toContainText('Imported: 0 new files, 2 unchanged.');
  await importZip(zip('Three fragments, 50 °C for 1 h.'));
  await expect(page.locator('.toast').last()).toContainText('1 changed (added as copies next to the existing files), 1 unchanged');
});
