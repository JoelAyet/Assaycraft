import { test, expect, type Page } from '@playwright/test';
import { openFolderNotebook, readFile, trackErrors, waitForSave, ymd } from './helpers';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = trackErrors(page);
});
test.afterEach(() => {
  expect(errors, 'uncaught errors in the page').toEqual([]);
});

async function newBoard(page: Page, name: string, opts: { tasks?: boolean; columns?: string } = {}) {
  await page.getByTitle('New board').click();
  const dialog = page.getByRole('dialog', { name: 'New board' });
  await dialog.getByLabel('Name').fill(name);
  if (opts.tasks) await dialog.getByLabel(/^Tasks/).check();
  if (opts.columns) await dialog.getByLabel('Columns', { exact: true }).fill(opts.columns);
  await dialog.getByRole('button', { name: 'Create board' }).click();
  await expect(page.locator('.gc-board-page h1')).toHaveText(name);
}

test('a new board tracks things by default: no due dates, off the calendar and Home', async ({ page }) => {
  await openFolderNotebook(page);
  const openTasks = page.locator('.gc-figures').getByText('Open tasks').locator('..');
  await expect(openTasks).toContainText('2');

  await page.getByTitle('New board').click();
  const dialog = page.getByRole('dialog', { name: 'New board' });
  await expect(dialog.getByLabel(/^Things to track/)).toBeChecked();
  await expect(dialog.getByLabel('Columns', { exact: true })).toHaveValue('Not started, In progress, Done');
  // The suggested columns follow the choice until they are edited.
  await dialog.getByLabel(/^Tasks/).check();
  await expect(dialog.getByLabel('Columns', { exact: true })).toHaveValue('To do, In progress, Done');
  await dialog.getByLabel(/^Things to track/).check();
  await dialog.getByLabel('Name').fill('Cloning status');
  await dialog.getByLabel('Columns', { exact: true }).fill('Designed, PCR, Assembled, Sequenced');
  await expect(dialog.locator('.gc-board-preview .pill')).toHaveText(['Designed', 'PCR', 'Assembled', 'Sequenced']);
  await dialog.getByRole('button', { name: 'Create board' }).click();

  await expect(page.locator('.gc-col-head')).toHaveText([/Designed/, /PCR/, /Assembled/, /Sequenced/]);
  await expect(page.getByRole('button', { name: 'New card' })).toBeVisible();
  const md = await readFile(page, 'Boards/Cloning status/_board.md');
  expect(md).toContain('cards: items');
  expect(md).toMatch(/id: designed[\s\S]*id: pcr[\s\S]*id: assembled[\s\S]*id: sequenced/);

  // Cards are cards, without a priority or dates.
  await page.locator('.gc-col', { hasText: 'Designed' }).locator('.gc-col-add').click();
  await expect(page.locator('.gc-quick-add textarea')).toHaveAttribute('placeholder', 'Card title… (Enter to add)');
  await page.keyboard.type('pUC19-EGFP');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.locator('.gc-card', { hasText: 'pUC19-EGFP' }).click();
  const peek = page.locator('.gc-peek');
  await expect(peek.locator('.gc-doc-kicker')).toContainText('Card');
  await expect(peek.locator('.gc-props')).not.toContainText('Priority');
  await expect(peek.locator('.gc-props')).not.toContainText('Dates');
  await page.keyboard.press('Escape');
  await waitForSave(page);

  // Not a task anywhere else.
  await page.locator('.gc-nav-item', { hasText: 'Home' }).click();
  await expect(openTasks).toContainText('2');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('new card');
  await expect(page.locator('.gc-pal-item', { hasText: 'New card in Cloning status' })).toBeVisible();
  await page.keyboard.press('Escape');

  // It can become a task list later: then its cards get a priority and dates.
  await page.locator('.gc-nav-item', { hasText: 'Cloning status' }).click();
  await page.getByTitle('Board options').click();
  await page.getByRole('menuitem', { name: 'Use for tasks with due dates' }).click();
  await expect(page.getByRole('button', { name: 'New task' })).toBeVisible();
  await page.locator('.gc-card', { hasText: 'pUC19-EGFP' }).click();
  await expect(peek.locator('.gc-props')).toContainText('Priority');
  await expect(peek.locator('.gc-doc-kicker')).toContainText('Task');
  await page.keyboard.press('Escape');
  await waitForSave(page);
  expect(await readFile(page, 'Boards/Cloning status/_board.md')).toContain('cards: tasks');
  await page.locator('.gc-nav-item', { hasText: 'Home' }).click();
  await expect(openTasks).toContainText('3');
});

test('a task board puts its cards on the calendar', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBoard(page, 'Lab chores', { tasks: true });
  await expect(page.locator('.gc-col-head')).toHaveText([/To do/, /In progress/, /Done/]);
  await page.getByRole('button', { name: 'New task' }).click();
  const peek = page.locator('.gc-peek');
  await peek.locator('.gc-title-input').fill('Defrost the −20 °C freezer');
  await peek.locator('.gc-date-native').nth(1).fill(ymd(new Date()));
  await page.keyboard.press('Escape');
  await waitForSave(page);
  await page.locator('.gc-nav-item', { hasText: 'Calendar' }).click();
  await page.locator('.gc-segmented button', { hasText: 'Week' }).click();
  await expect(page.locator('.gc-cal-item', { hasText: 'Defrost the −20 °C freezer' })).toBeVisible();
});

test('calendar: a week view, and controls that stay put', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Calendar' }).click();
  const title = page.locator('.gc-calendar-page h1');
  const next = page.getByTitle('Next month');

  // Month to month, the arrows and Today do not move, whatever the month is called.
  const xs = new Set<number>();
  for (let i = 0; i < 12; i++) {
    xs.add(Math.round((await next.boundingBox())!.x));
    await next.click();
  }
  expect([...xs]).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Today' })).toBeEnabled();
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(page.getByRole('button', { name: 'Today' })).toBeDisabled();

  // The week of today, a week at a time.
  await page.locator('.gc-segmented button', { hasText: 'Week' }).click();
  await expect(page.locator('.gc-weekview-head > div')).toHaveCount(7);
  await expect(page.locator('.gc-weekview-head .is-today')).toHaveCount(1);
  await expect(page.locator(`.gc-weekview .gc-day[data-day="${ymd(new Date())}"]`)).toHaveClass(/is-today/);
  const firstDay = () => page.locator('.gc-weekview .gc-day').first().getAttribute('data-day');
  const thisWeek = (await firstDay())!;
  const plusDays = (d: string, n: number) => ymd(new Date(new Date(d + 'T12:00:00').getTime() + n * 86400000));
  await page.getByTitle('Next week').click();
  await expect.poll(firstDay).toBe(plusDays(thisWeek, 7));
  await expect(page.locator('.gc-weekview-head .is-today')).toHaveCount(0);
  await page.getByTitle('Previous week').click();
  await page.getByTitle('Previous week').click();
  await expect.poll(firstDay).toBe(plusDays(thisWeek, -7));
  await page.getByRole('button', { name: 'Today' }).click();
  await expect.poll(firstDay).toBe(thisWeek);
  // The title names the week's month, or both months when it spans two.
  await expect(title).toHaveText(/\d{4}/);
  // The choice of view is remembered.
  await page.reload();
  await expect(page.locator('.gc-weekview')).toBeVisible();
});

test('the week starts on the day chosen in Settings', async ({ page }) => {
  await openFolderNotebook(page);
  const monthHead = page.locator('.gc-month-head > div').first();
  // 18 October 2026 is a Sunday.
  const weekday = (d: number) => new Date(2026, 9, 18 + d).toLocaleDateString(undefined, { weekday: 'short' });
  for (const [name, day] of [
    ['Monday', 1],
    ['Sunday', 0],
  ] as const) {
    await page.goto('/#/settings');
    await page.getByRole('radio', { name }).click();
    await expect(page.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'true');
    await page.goto('/#/calendar');
    await page.locator('.gc-segmented button', { hasText: 'Month' }).click();
    await expect(monthHead).toHaveText(weekday(day));
    await page.locator('.gc-segmented button', { hasText: 'Week' }).click();
    await expect(page.locator('.gc-weekview-dow').first()).toHaveText(weekday(day));
    // The activity graph on Home starts its columns on the same day.
    await page.goto('/#/');
    const firstRow = await page.locator('.gc-activity-cell').first().getAttribute('title');
    expect(firstRow ?? '').toContain(weekday(day));
  }
  // It is a preference of this browser: it survives a reload.
  await page.reload();
  await page.goto('/#/settings');
  await expect(page.getByRole('radio', { name: 'Sunday' })).toHaveAttribute('aria-checked', 'true');
});

test.describe('on a laptop', () => {
  test.use({ viewport: { width: 1100, height: 760 } });

  test('the calendar bar stays on one line, whatever the month', async ({ page }) => {
    await openFolderNotebook(page, { seed: false });
    await page.locator('.gc-nav-item', { hasText: 'Calendar' }).click();
    const today = page.getByRole('button', { name: 'Today' });
    const newEntry = page.locator('.gc-cal-tools .gc-cal-new');
    // Twelve months, then twelve weeks (one of them across the new year).
    for (const view of ['Month', 'Week']) {
      await page.locator('.gc-segmented button', { hasText: view }).click();
      for (let i = 0; i < 12; i++) {
        const [a, b] = [(await today.boundingBox())!, (await newEntry.boundingBox())!];
        expect(Math.abs(a.y - b.y), `${await page.locator('.gc-calendar-page h1').textContent()}`).toBeLessThan(4);
        await page.getByTitle(`Next ${view.toLowerCase()}`).click();
      }
    }
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the calendar bar takes two rows: title, then filters and views', async ({ page }) => {
    await openFolderNotebook(page, { seed: false });
    await page.goto('/#/calendar');
    const top = async (sel: string) => Math.round((await page.locator(sel).first().boundingBox())!.y);
    for (const view of ['Month', 'Week', 'Agenda']) {
      await page.locator('.gc-segmented button', { hasText: view }).click();
      expect(Math.abs((await top('.gc-cal-new-phone')) - (await top('.gc-calendar-page .gc-nav-toggle'))), view).toBeLessThan(6);
      expect(Math.abs((await top('.gc-cal-tools .checkbox')) - (await top('.gc-cal-tools .gc-segmented'))), view).toBeLessThan(8);
    }
    await page.locator('.gc-cal-new-phone').click();
    await expect(page.getByRole('dialog', { name: 'New entry' })).toBeVisible();
  });
});

test('the activity graph on Home is laid out from the chosen first day', async ({ page }) => {
  await openFolderNotebook(page);
  for (const [name, start] of [
    ['Monday', 1],
    ['Sunday', 0],
    ['Monday', 1],
  ] as const) {
    await page.goto('/#/settings');
    await page.getByRole('radio', { name }).click();
    await page.goto('/#/');
    const layout = await page.locator('.gc-activity-grid').evaluate((grid) => {
      const cells = [...grid.querySelectorAll<HTMLElement>('.gc-activity-cell[data-day]')].map((c) => ({
        day: c.dataset.day!,
        col: Number(c.style.gridColumnStart),
        row: Number(c.style.gridRowStart),
        today: c.classList.contains('is-today'),
      }));
      const labels = [...grid.querySelectorAll<HTMLElement>('.gc-activity-weekday')].map((l) => ({
        row: Number(l.style.gridRowStart),
        text: l.textContent,
      }));
      return { cells, labels };
    });
    const { cells, labels } = layout;
    const weekday = (d: string) => new Date(d + 'T12:00:00').getDay();
    // Every day sits in the row of its weekday, counted from the chosen first day.
    for (const c of cells) expect(c.row - 2, c.day).toBe((weekday(c.day) - start + 7) % 7);
    // A column is one week: it starts on the chosen day and the next column starts 7 days later.
    const firsts = cells.filter((c) => c.row === 2);
    for (const c of firsts) expect(weekday(c.day), c.day).toBe(start);
    for (let i = 1; i < firsts.length; i++) {
      expect((new Date(firsts[i].day).getTime() - new Date(firsts[i - 1].day).getTime()) / 86400000).toBe(7);
      expect(firsts[i].col).toBe(firsts[i - 1].col + 1);
    }
    // Today is in the last column, and nothing comes after it.
    const today = cells.find((c) => c.today)!;
    expect(today.col).toBe(Math.max(...cells.map((c) => c.col)));
    expect(cells[cells.length - 1].day).toBe(today.day);
    // Rows are labelled Monday, Wednesday and Friday, whichever day comes first.
    const mon = new Date(2026, 9, 19).toLocaleDateString(undefined, { weekday: 'short' });
    const wed = new Date(2026, 9, 21).toLocaleDateString(undefined, { weekday: 'short' });
    const fri = new Date(2026, 9, 23).toLocaleDateString(undefined, { weekday: 'short' });
    expect(labels.map((l) => l.text)).toEqual([mon, wed, fri]);
    for (const l of labels) expect([1, 3, 5]).toContain((l.row - 2 + start) % 7);
  }
});

test('the appearance settings fit on a laptop, a wide screen and a phone', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await page.goto('/#/settings');
  const section = page.locator('.gc-settings-section', { has: page.locator('.gc-appearance') });
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
    [1100, 760],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    const box = (await section.boundingBox())!;
    for (const option of await section.locator('button').all()) {
      const b = (await option.boundingBox())!;
      expect(b.x + b.width, `${await option.textContent()} at ${width}px`).toBeLessThanOrEqual(box.x + box.width + 1);
    }
  }
});
