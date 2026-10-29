import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { newBlankEntry, openFolderNotebook, readFile, trackErrors, waitForSave, ymd } from './helpers';

const day = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
};
const pathOf = (page: Page) => decodeURIComponent(new URL(page.url()).hash.replace('#/doc/', ''));

async function slash(page: Page, command: string, item: string) {
  await page.keyboard.type(`/${command}`);
  await page.locator('.gc-slash-item').filter({ hasText: item }).first().click();
}

test('labels and counters that said nothing are gone, except the date on Home', async ({ page }) => {
  await openFolderNotebook(page);
  await expect(page.locator('.gc-home .gc-eyebrow')).toBeVisible();
  await expect(page.locator('.gc-figures')).toHaveCount(0);
  for (const item of ['Protocols', 'Stocks', 'Literature', 'Templates', 'Notes']) {
    await page.locator('.gc-nav-item', { hasText: item }).click();
    await expect(page.locator('.gc-page-title').first()).toBeVisible();
    await expect(page.locator('.gc-eyebrow')).toHaveCount(0);
  }
});

test('text gets a highlight color, a color and a size; tags get a color', async ({ page }) => {
  const errors = trackErrors(page);
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Colors');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Band at 1 kb');
  await page.keyboard.press('Shift+Home');
  // The highlight's colors are by its button; text color and size have a button of their own.
  await page.getByRole('button', { name: 'Highlight color' }).click();
  await page.getByRole('button', { name: 'Highlight green' }).click();
  await page.getByRole('button', { name: 'Text color and size' }).click();
  await page.getByRole('button', { name: 'Text red' }).click();
  await page.getByRole('group', { name: 'Text size' }).getByRole('button', { name: 'Large' }).click();
  await page.keyboard.press('Escape');
  await expect(
    page
      .locator('.ProseMirror mark[data-color="green"] .gc-ink[data-color="red"], .ProseMirror .gc-ink[data-color="red"] mark[data-color="green"]')
      .first(),
  ).toBeVisible();
  await expect(page.locator('.ProseMirror .gc-size[data-size="large"]')).toBeVisible();

  // A tag's color, chosen from the tag itself, for the whole notebook.
  await page.getByRole('button', { name: 'Add tag' }).click();
  await page.keyboard.type('gel');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Color of tag gel' }).click();
  await page.getByRole('button', { name: 'red', exact: true }).click();
  await expect(page.locator('.gc-tag', { hasText: 'gel' })).toHaveClass(/tone-red/);
  await waitForSave(page);
  const md = await readFile(page, pathOf(page));
  expect(md).toContain('data-color="green"');
  expect(md).toContain('<span class="gc-ink" data-color="red"');
  expect(md).toContain('<span class="gc-size" data-size="large"');
  expect(await readFile(page, 'assaycraft.json')).toContain('"gel": "red"');
  expect(errors).toEqual([]);
});

test('/day puts in today, and its date opens a calendar to pick another day, in English; Tab nests list items', async ({ page }) => {
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Diary');
  await page.locator('.ProseMirror').click();
  await slash(page, 'day', 'Day');
  const weekday = (ymd: string) => new Date(ymd + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' });
  const heading = page.locator('.ProseMirror h2');
  await expect(heading).toHaveText(`${day(0)} · ${weekday(day(0))}`);

  // Its date is a button: a small calendar changes the day, weekday included.
  await page.locator('.gc-date-chip').click();
  const cal = page.getByRole('group', { name: 'Day of this heading' });
  const yesterday = day(-1);
  if (yesterday.slice(0, 7) !== day(0).slice(0, 7)) await cal.getByRole('button', { name: 'Previous month' }).click();
  const label = new Date(yesterday + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  await cal.getByRole('button', { name: label }).click();
  await expect(heading).toHaveText(`${yesterday} · ${weekday(yesterday)}`);
  await page.locator('.ProseMirror > p').last().click();
  await expect(page.locator('.ProseMirror')).toBeFocused();

  // Tab nests the item it is in, in any list, and never leaves the page.
  await page.keyboard.type('- First');
  await page.keyboard.press('Tab');
  await expect(page.locator('.ProseMirror')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second');
  await page.keyboard.press('Tab');
  await expect(page.locator('.ProseMirror ul ul li')).toHaveText('Second');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.ProseMirror ul ul')).toHaveCount(0);
});

test('a reminder goes on the calendar, moves there and is checked off there', async ({ page }) => {
  const errors = trackErrors(page);
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Westerns');
  const path = pathOf(page);
  await page.locator('.ProseMirror').click();
  await slash(page, 'reminder', 'Reminder');
  // It goes in at once, for today, with its Date and Time open as on an entry; the cursor waits before it.
  const edit = page.getByRole('group', { name: 'Reminder' });
  await expect(edit).toBeVisible();
  await page.keyboard.type('Take the membrane out');
  await edit.locator('.gc-date-native').fill(day(1), { force: true });
  await edit.getByRole('button', { name: 'Add time' }).click();
  await page.getByLabel('Type a time').fill('14:30');
  await page.getByLabel('Type a time').press('Enter');
  await expect(page.locator('.gc-reminder-btn')).toContainText(/2:30\sPM|14:30/);
  await page.keyboard.press('Escape');
  await waitForSave(page);
  expect(await readFile(page, path)).toContain(`- [ ] Take the membrane out (@${day(1)} 14:30)`);

  await page.locator('.gc-nav-item', { hasText: 'Calendar' }).click();
  await page.locator('.gc-viewtab', { hasText: 'Agenda' }).click();
  const row = page.locator('.gc-agenda-reminder', { hasText: 'Take the membrane out' });
  await expect(row).toContainText(/2:30\sPM|14:30/);
  await row.getByRole('checkbox', { name: 'Done: Take the membrane out' }).click();
  await expect(row.getByRole('checkbox', { name: 'Done: Take the membrane out' })).toBeChecked();
  await expect.poll(() => readFile(page, path)).toContain(`- [x] Take the membrane out (@${day(1)} 14:30)`);

  // Dragged to another day in the month, it moves in the file (keeping its time).
  await page.locator('.gc-viewtab', { hasText: 'Month' }).click();
  const chip = page.locator('.gc-cal-item.is-reminder', { hasText: 'Take the membrane out' });
  const target = day(1) === day(2).slice(0, 8) + '01' ? day(0) : day(2);
  const cell = page.locator(`.gc-day[data-day="${target}"]`);
  if (await cell.count()) {
    await chip.dragTo(cell);
    await expect.poll(() => readFile(page, path)).toContain(`(@${target} 14:30)`);
  }
  expect(errors).toEqual([]);
});

test('calendar entries can be colored by project', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Calendar' }).click();
  await page.getByRole('button', { name: 'Color by project' }).click();
  const legend = page.getByLabel('Project colors');
  await expect(legend).toContainText('Getting started');
  await legend.getByRole('button', { name: /Getting started/ }).click();
  await page.getByRole('button', { name: 'purple', exact: true }).click();
  await expect(page.locator('.gc-cal-item.is-entry.tone-purple').first()).toBeVisible();
  expect(await readFile(page, 'assaycraft.json')).toContain('"Getting started": "purple"');
});

test('table cells get a color, and columns can be frozen', async ({ page }) => {
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Plate readings');
  await page.locator('.ProseMirror').click();
  await page.getByRole('button', { name: 'Insert a table' }).click();
  const cell = page.locator('.gc-sheet-grid td[data-r="1"][data-c="0"]');
  await cell.click({ button: 'right' });
  await page.getByRole('menuitemradio', { name: 'Fill yellow' }).click();
  await expect(cell).toHaveAttribute('data-bg', 'yellow');
  await cell.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Freeze column A' }).click();
  await expect(cell).toHaveClass(/is-frozen/);
  await waitForSave(page);
  expect(await readFile(page, pathOf(page))).toContain('"bg":{"A2":"yellow"},"freeze":1');
});

test('notes drawn on a gel photo are kept beside it; HEIC photos become JPEG', async ({ page }) => {
  const errors = trackErrors(page);
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Gel');
  await page.locator('.ProseMirror').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.gc-toolbar').getByRole('button', { name: 'Attach files' }).click();
  await (await chooser).setFiles({ name: 'IMG_0042.heic', mimeType: 'image/heic', buffer: readFileSync('tests/fixtures/heic/gel.heic') });
  const image = page.locator('.gc-image').first();
  await expect.poll(() => image.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 20_000 }).toBe(320);
  await waitForSave(page);
  expect(await readFile(page, pathOf(page))).toContain('![](attachments/EXP-0001/IMG_0042.jpg)');

  await image.hover();
  await image.getByRole('button', { name: 'Annotate' }).click();
  await page.getByRole('button', { name: 'Arrow' }).click();
  const box = (await image.locator('svg.gc-ann-layer').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.3);
  await page.getByLabel('Text on the image').fill('Ladder');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(image.locator('svg.gc-ann-layer line')).toHaveCount(1);
  await expect(image.locator('svg.gc-ann-layer text')).toHaveText('Ladder');
  await waitForSave(page);
  const md = await readFile(page, pathOf(page));
  expect(md).toMatch(/<!-- gc:image \{"marks":\[\{"t":"arrow".*"s":"Ladder"\}\]\} -->\n!\[\]\(attachments\/EXP-0001\/IMG_0042\.jpg\)/);
  expect(errors).toEqual([]);
});

test('papers have a reading status, and a board to move them along', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Literature' }).click();
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Board' }).click();
  const toRead = page.getByRole('region', { name: 'To read' });
  const reading = page.getByRole('region', { name: 'Reading' });
  const card = page.locator('.gc-reading-card').first();
  const title = (await card.locator('strong').textContent())!;
  await expect(toRead.locator('.gc-reading-card', { hasText: title })).toBeVisible();
  await card.dragTo(reading);
  await expect(reading.locator('.gc-reading-card', { hasText: title })).toBeVisible();
  await waitForSave(page);
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'List' }).click();
  await page.locator('.gc-paper-row').first().locator('.gc-note-open').click();
  await expect(page.locator('.gc-prop', { hasText: 'Reading' })).toContainText('Reading');
});

test('a flow step gets a day on a small calendar, shows on the calendar, and its entry sits under the plan', async ({ page }) => {
  const errors = trackErrors(page);
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Protein plan');
  await page.locator('.ProseMirror').click();
  await slash(page, 'flow', 'Flow');
  await page.keyboard.type('Expression');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Set a day for step 1' }).click();
  const target = day(3);
  const label = new Date(target + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const cal = page.getByRole('group', { name: 'Day of step 1' });
  if (!(await cal.getByRole('button', { name: label }).count())) await cal.getByRole('button', { name: 'Next month' }).click();
  await cal.getByRole('button', { name: label }).click();
  await expect(page.locator('.gc-flow-card').first()).toContainText('Planned');
  await waitForSave(page);
  const plan = pathOf(page);
  expect(await readFile(page, plan)).toContain(`<!-- gc:flow {"dates":{"1":"${target}"}} -->`);

  await page.locator('.gc-nav-item', { hasText: 'Calendar' }).click();
  await page.locator('.gc-viewtab', { hasText: 'Agenda' }).click();
  await expect(page.locator('.gc-agenda-item.is-step', { hasText: 'Expression' })).toBeVisible();
  await page.locator('.gc-agenda-item.is-step', { hasText: 'Expression' }).click();

  // Started on its planned day; its entry is indented under the plan in the sidebar.
  await page.getByRole('button', { name: 'Start step 1: Expression' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start step 1' });
  await expect(dialog.locator('#ne-date')).toHaveValue(target);
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.gc-title-input')).toHaveValue('Expression');
  await expect(page.getByRole('group', { name: 'Steps of Protein plan' })).toContainText('Expression');
  expect(errors).toEqual([]);
});

test('on a computer: a box drawn from the margin selects blocks; the index jumps to a heading', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Long day');
  await page.locator('.ProseMirror').click();
  for (const h of ['Morning', 'Afternoon', 'Evening']) {
    await page.keyboard.type(`## ${h}`);
    await page.keyboard.press('Enter');
    await page.keyboard.type(`Notes for the ${h.toLowerCase()}.`);
    await page.keyboard.press('Enter');
  }
  // A box from the left margin over the first two blocks.
  const first = (await page.locator('.ProseMirror h2').first().boundingBox())!;
  const second = (await page.locator('.ProseMirror p').first().boundingBox())!;
  await page.mouse.move(first.x - 40, first.y - 4);
  await page.mouse.down();
  await page.mouse.move(first.x + 60, second.y + second.height - 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.ProseMirror .gc-block-selected')).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(page.locator('.ProseMirror h2')).toHaveText(['Afternoon', 'Evening']);

  // The index, at the page's right edge: recent entries, then the headings.
  const index = page.getByRole('navigation', { name: 'Index of this page' });
  await index.hover();
  await expect(index.getByRole('button', { name: 'Evening' })).toBeVisible();
  await index.getByRole('button', { name: 'Evening' }).click();
  await expect(page.locator('.ProseMirror h2').last()).toBeInViewport();
});
