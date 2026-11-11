/**
 * A second swipe through the calendar while the first one's glide still goes on, and freezers and
 * boxes for the stocks of a notebook of one's own.
 */
import { test, expect, type Page } from '@playwright/test';
import { openFolderNotebook, trackErrors } from './helpers';

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
