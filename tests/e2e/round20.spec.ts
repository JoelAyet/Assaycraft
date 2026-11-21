/**
 * The design audit of 21 November, its clear defects: a new task closed without anything in it is
 * not kept; board cards work with the keyboard; the template picker says which template is picked
 * and the editor has a name; a pairing link that does not work is said, tied to its field; on a
 * phone, a way in is on the first screen.
 */
import { test, expect, type Page } from '@playwright/test';
import { listFiles, openFolderNotebook, skipTour, trackErrors } from './helpers';

const TASKS = 'Boards/Lab tasks';
const taskFiles = async (page: Page) => (await listFiles(page, TASKS)).filter((n) => n.endsWith('.md') && n !== '_board.md');
const peek = (page: Page) => page.locator('.gc-peek');

test('a new task closed without anything in it is not kept; one with a title, or opened as a page, is', async ({ page }) => {
  const errors = trackErrors(page);
  await openFolderNotebook(page);
  const before = await taskFiles(page);

  // Opened from Home and closed untouched (Escape, the close button, a click beside it): gone.
  await page.getByRole('button', { name: 'New task' }).click();
  await expect(peek(page)).toBeVisible();
  await expect.poll(async () => (await taskFiles(page)).length).toBe(before.length + 1);
  await page.keyboard.press('Escape');
  await expect(peek(page)).toHaveCount(0);
  await expect.poll(() => taskFiles(page)).toEqual(before);

  await page.getByRole('button', { name: 'New task' }).click();
  await peek(page).getByRole('button', { name: 'Close the side panel' }).click();
  await expect.poll(() => taskFiles(page)).toEqual(before);

  // On the board: the count does not change.
  await page.locator('.gc-nav-item', { hasText: 'Lab tasks' }).click();
  const cards = page.locator('.gc-card');
  const count = await cards.count();
  await page.locator('.gc-new-main').click();
  await expect(peek(page)).toBeVisible();
  await page.locator('.gc-peek-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(peek(page)).toHaveCount(0);
  await expect(cards).toHaveCount(count);
  await expect.poll(() => taskFiles(page)).toEqual(before);

  // With a title: kept.
  await page.locator('.gc-new-main').click();
  await peek(page).locator('.gc-title-input').fill('Order kanamycin');
  await page.keyboard.press('Enter');
  await peek(page).getByRole('button', { name: 'Close the side panel' }).click();
  await expect(cards).toHaveCount(count + 1);
  await expect(page.locator('.gc-card', { hasText: 'Order kanamycin' })).toBeVisible();

  // Opened as a page to be written there: kept, even before anything is in it.
  await page.locator('.gc-new-main').click();
  await peek(page).getByRole('button', { name: 'Open as page' }).click();
  await expect(page.locator('.gc-title-input')).toBeVisible();
  await page.locator('.gc-nav-item', { hasText: 'Lab tasks' }).click();
  await expect(cards).toHaveCount(count + 2);
  expect(errors).toEqual([]);
});

test('board cards work with the keyboard: open, menu, move to another column', async ({ page }) => {
  const errors = trackErrors(page);
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Lab tasks' }).click();
  const card = page.locator('.gc-card').first();
  const title = (await card.locator('.gc-card-title').textContent())!;
  const column = (c = page.locator('.gc-card', { hasText: title })) => c.evaluate((el) => el.closest('[data-col-id]')?.getAttribute('data-col-id'));
  const from = await column();

  // Reached with Tab like any control; Enter opens it.
  await card.focus();
  await expect(card).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(peek(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(peek(page)).toHaveCount(0);

  // Its menu from the keyboard.
  await card.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('.popover .menu-item', { hasText: 'Move to' }).first()).toBeVisible();
  await page.keyboard.press('Escape');

  // Alt+→ moves it to the next column, and it keeps the focus there.
  await card.focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(() => column()).not.toBe(from);
  await expect(page.locator('.gc-card', { hasText: title })).toBeFocused();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect.poll(() => column()).toBe(from);

  // The experiments board's cards too: Enter opens the entry.
  await page.locator('.gc-nav-item', { hasText: 'Experiments' }).click();
  const entry = page.locator('.gc-card').first();
  const name = (await entry.locator('.gc-card-title').textContent())!;
  await entry.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.gc-title-input')).toHaveValue(name);
  expect(errors).toEqual([]);
});

test('the template picker says which template is picked, and the editor has a name', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-new-btn').click();
  const picker = page.getByRole('group', { name: 'Template' });
  const blank = picker.getByRole('button', { name: /Blank entry/ });
  const other = picker.getByRole('button').nth(1);
  await expect(blank).toHaveAttribute('aria-pressed', 'true');
  await expect(other).toHaveAttribute('aria-pressed', 'false');
  await other.click();
  await expect(other).toHaveAttribute('aria-pressed', 'true');
  await expect(blank).toHaveAttribute('aria-pressed', 'false');
  await blank.click();
  await page.locator('#ne-title').fill('Named editor');
  await page.getByRole('button', { name: 'Create entry' }).click();
  await expect(page.getByRole('textbox', { name: 'Entry content' })).toBeVisible();
  await expect(page.locator('.ProseMirror')).toHaveAttribute('aria-multiline', 'true');
});

test('a pairing link that does not work is said, tied to its field', async ({ page }) => {
  await skipTour(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Paste the link/ }).click();
  const field = page.getByLabel('Link from the computer');
  await field.fill('https://example.org/not-a-pairing-link');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  const problem = page.getByRole('alert').filter({ hasText: /./ }).first();
  await expect(problem).toBeVisible();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAccessibleDescription(((await problem.textContent()) ?? '').trim());
});

for (const [name, device] of [
  ['a phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ['a narrow window', { viewport: { width: 390, height: 844 } }],
] as const) {
  test(`on ${name}, a way in is on the first screen`, async ({ browser }) => {
    const context = await browser.newContext(device);
    const page = await context.newPage();
    await page.goto('/');
    await page.locator('.gc-welcome-options').waitFor();
    const first = await page.locator('.gc-welcome-options button').first().boundingBox();
    expect(first!.y + first!.height).toBeLessThanOrEqual(844);
    if (name === 'a phone') await expect(page.locator('.gc-lede')).toContainText('On your phone, work on a copy');
    await context.close();
  });
}
