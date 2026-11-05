/**
 * Tasks at a time on the calendar (set, moved, lengthened, ticked done), and a sideways swipe to
 * the next or previous month or week.
 */
import { test, expect, type Page } from '@playwright/test';
import { listFiles, openFolderNotebook, readFile, trackErrors, waitForSave } from './helpers';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = trackErrors(page);
});
test.afterEach(() => {
  expect(errors, 'uncaught errors in the page').toEqual([]);
});

const BOARD = 'Boards/Lab tasks';
async function taskFile(page: Page, title: string): Promise<string> {
  const name = (await listFiles(page, BOARD)).find((f) => f.includes(title));
  expect(name, `a file for ${title}`).toBeTruthy();
  return readFile(page, `${BOARD}/${name}`);
}

test('a task gets a time: planned at an hour, moved, made longer, and ticked done from the calendar', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Calendar' }).click();
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Week' }).click();
  const scroll = page.locator('.gc-tgrid-scroll');
  const col = page.locator('.gc-tgrid-col.is-today');
  await scroll.evaluate((el) => el.scrollTo({ top: 13 * 44 }));
  const hourY = async (h: number) => (await col.boundingBox())!.y + h * 44 + 10;

  // A click on an empty hour plans a task then.
  await page.mouse.click((await col.boundingBox())!.x + 20, await hourY(14));
  await page.getByRole('button', { name: 'New task in Lab tasks' }).click();
  const peek = page.locator('.gc-peek');
  await peek.locator('.gc-title-input').fill('Autoclave media');
  await peek.locator('.gc-title-input').press('Enter');
  // The task's page has its time, as an entry's has.
  await expect(peek.getByRole('button', { name: /^2:00\sPM|^14:00/ })).toBeVisible();
  await waitForSave(page);
  expect(await taskFile(page, 'Autoclave media')).toMatch(/\ntime: ['"]?14:00/);
  await page.keyboard.press('Escape');

  // At its hours in the week; dragged an hour down, it starts an hour later.
  await scroll.evaluate((el) => el.scrollTo({ top: 13 * 44 }));
  const event = page.locator('.gc-tevent', { hasText: 'Autoclave media' });
  await expect(event).toContainText(/2:00\sPM|14:00/);
  const box = (await event.boundingBox())!;
  await page.mouse.move(box.x + box.width - 12, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 10, box.y + 30, { steps: 4 });
  await page.mouse.move(box.x + box.width - 10, box.y + 6 + 44, { steps: 6 });
  await page.mouse.up();
  await expect(event).toContainText(/3:00\sPM|15:00/);
  await expect.poll(() => taskFile(page, 'Autoclave media')).toMatch(/\ntime: ['"]?15:00/);

  // Its bottom edge makes it last longer.
  const edge = event.getByRole('slider', { name: 'End time of Autoclave media' });
  await edge.focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => taskFile(page, 'Autoclave media')).toMatch(/\nend-time: ['"]?16:15/);

  // Ticked done on the calendar: it moves to the board's last column, struck through. Unticked, it goes back.
  const done = event.getByRole('checkbox', { name: 'Done: Autoclave media' });
  await done.check();
  await expect.poll(() => taskFile(page, 'Autoclave media')).toMatch(/\nstatus: done/);
  await expect(event).toHaveClass(/is-done/);
  await done.uncheck();
  await expect.poll(() => taskFile(page, 'Autoclave media')).toMatch(/\nstatus: todo/);

  // In the month too, with its time and a box to tick.
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Month' }).click();
  const chip = page.locator('.gc-month .gc-cal-item', { hasText: 'Autoclave media' }).first();
  await expect(chip).toContainText(/3(:00)?\s?pm|15:00/i);
  await expect(chip.getByRole('checkbox', { name: 'Done: Autoclave media' })).toBeVisible();
  // And on its board card.
  await page.locator('.gc-nav-item', { hasText: 'Lab tasks' }).click();
  await expect(page.locator('.gc-card', { hasText: 'Autoclave media' }).locator('.gc-due')).toContainText(
    /3:00\sPM\s*[–-]\s*4:15\sPM|15:00\s*[–-]\s*16:15/,
  );
});

test('a sideways swipe on a trackpad moves the calendar a month or a week', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await page.locator('.gc-nav-item', { hasText: 'Calendar' }).click();
  const title = page.locator('.gc-cal-month-title');
  const first = await title.textContent();
  const body = (await page.locator('.gc-calendar-body').boundingBox())!;
  await page.mouse.move(body.x + body.width / 2, body.y + 200);

  // One swipe (many small wheel events, gliding on) moves one month, whatever its length.
  for (let i = 0; i < 8; i++) await page.mouse.wheel(30, 2);
  await expect(title).not.toHaveText(first!);
  const next = await title.textContent();
  await page.waitForTimeout(400);
  expect(await title.textContent()).toBe(next);
  // Back, with a swipe the other way.
  await page.waitForTimeout(300);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(-40, 0);
  await expect(title).toHaveText(first!);
  // Up and down still scrolls, and does not change the month.
  await page.waitForTimeout(300);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(300);
  await expect(title).toHaveText(first!);

  // The week view too.
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Week' }).click();
  const week = await title.textContent();
  const grid = (await page.locator('.gc-tgrid-scroll').boundingBox())!;
  await page.mouse.move(grid.x + grid.width / 2, grid.y + 100);
  await page.waitForTimeout(300);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(40, 0);
  await expect(page.locator('.gc-tgrid-col.is-today')).toHaveCount(0);
  await page.waitForTimeout(300);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(-40, 0);
  await expect(page.locator('.gc-tgrid-col.is-today')).toHaveCount(1);
  expect(await title.textContent()).toBe(week);
});
