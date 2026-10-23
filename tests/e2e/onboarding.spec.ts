import { test, expect, type Page } from '@playwright/test';
import { openFolderNotebook, readFile, trackErrors } from './helpers';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = trackErrors(page);
});
test.afterEach(() => {
  expect(errors, 'uncaught errors in the page').toEqual([]);
});

const tour = (page: Page) => page.getByRole('dialog', { name: /./ }).filter({ has: page.locator('#gc-tour-title') });
const title = (page: Page) => page.locator('#gc-tour-title');

test('a new notebook starts a tour that asks your name and points at each part of the app', async ({ page }) => {
  await openFolderNotebook(page, { tour: true });
  await expect(title(page)).toHaveText('Welcome to your notebook');
  await expect(tour(page)).toContainText('in your notebook folder');
  // It asks for your name, which signs your entries (as in Settings).
  const name = tour(page).getByLabel('What’s your name?');
  await expect(name).toBeFocused();
  await name.fill('Rosalind Franklin');
  // Arrow keys move the cursor in the field, not the tour.
  await page.keyboard.press('ArrowLeft');
  await expect(title(page)).toHaveText('Welcome to your notebook');
  await page.getByRole('button', { name: 'Show me around' }).click();
  await expect.poll(() => readFile(page, 'assaycraft.json')).toContain('"author": "Rosalind Franklin"');

  // Each step highlights its part of the app.
  await expect(title(page)).toHaveText('Start an experiment');
  const spot = page.locator('.gc-tour-spot');
  // The highlight slides to each target: wait until it is around it.
  const near = (selector: string) =>
    expect
      .poll(async () => {
        const [a, b] = [(await spot.boundingBox())!, (await page.locator(selector).first().boundingBox())!];
        return Math.max(Math.abs(a.x + 6 - b.x), Math.abs(a.y + 6 - b.y), Math.abs(a.width - 12 - b.width));
      })
      .toBeLessThan(3);
  await near('.gc-new-btn');
  await page.keyboard.press('ArrowRight');
  await expect(title(page)).toHaveText('Your lab’s library');
  // Protocols, Stocks and Literature together.
  await expect
    .poll(async () => {
      const [a, top, bottom] = [
        (await spot.boundingBox())!,
        (await page.locator('.gc-nav-item', { hasText: 'Protocols' }).boundingBox())!,
        (await page.locator('.gc-nav-item', { hasText: 'Literature' }).boundingBox())!,
      ];
      return Math.max(Math.abs(a.y + 6 - top.y), Math.abs(a.y + a.height - 6 - (bottom.y + bottom.height)));
    })
    .toBeLessThan(3);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(title(page)).toHaveText('Start an experiment');

  const seen: string[] = [];
  for (let i = 0; i < 20 && (await title(page).textContent()) !== 'You’re ready'; i++) {
    const t = (await title(page).textContent())!;
    seen.push(t);
    if (t === 'A flow of experiments') {
      // The tour opens the example entry and shows its flow, then its buffer.
      await expect(page.locator('.gc-title-input')).toHaveValue('Example: knock out EGFP with Cas9');
      await near('.gc-flow');
      const card = (await tour(page).boundingBox())!;
      expect(card.x + card.width).toBeLessThanOrEqual(1440);
      expect(card.y + card.height).toBeLessThanOrEqual(900);
    }
    if (t === 'The buffer calculator') await near('.gc-buffer');
    if (t === 'Your phone at the bench') {
      // It points at the notebook menu, where Connect a phone is.
      await near('.gc-notebook-btn');
      await expect(tour(page)).toContainText('Connect a phone');
    }
    await tour(page).getByRole('button', { name: 'Next' }).click();
  }
  expect(seen).toEqual([
    'Start an experiment',
    'Your lab’s library',
    'Templates',
    'Notes',
    'Boards and calendar',
    'A flow of experiments',
    'The buffer calculator',
    'Type / for more',
    'Find anything',
    'Your phone at the bench',
    'Saved as you type',
  ]);
  await expect(title(page)).toHaveText('You’re ready');
  await near('.gc-notebook-btn');
  await tour(page).getByRole('button', { name: 'New entry' }).click();
  await expect(page.locator('.gc-tour')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'New entry' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Once seen, opening the notebook again does not start it.
  await page.reload();
  await expect(page.locator('.gc-main')).toBeVisible();
  await expect(page.locator('.gc-tour')).toHaveCount(0);
  // The name is in Settings.
  await page.goto('/#/settings');
  await expect(page.locator('#set-author')).toHaveValue('Rosalind Franklin');
});

test('without the example entry, the tour leaves out its steps', async ({ page }) => {
  await openFolderNotebook(page, { tour: true, seed: false });
  await page.getByRole('button', { name: 'Show me around' }).click();
  const seen: string[] = [];
  for (let i = 0; i < 20 && (await title(page).textContent()) !== 'You’re ready'; i++) {
    seen.push((await title(page).textContent())!);
    await tour(page).getByRole('button', { name: 'Next' }).click();
  }
  expect(seen).not.toContain('A flow of experiments');
  expect(seen).toContain('Type / for more');
  // Welcome, the steps seen and this last one.
  await expect(tour(page)).toContainText(`${seen.length + 2} of ${seen.length + 2}`);
  await expect(tour(page)).not.toContainText('example entry');
  // Nothing was typed: no name is saved.
  expect(await readFile(page, 'assaycraft.json')).toContain('"author": ""');
});

test('the tour can be skipped, and taken again from Settings, the menu or search', async ({ page }) => {
  await openFolderNotebook(page, { tour: true });
  await page.getByRole('button', { name: 'Skip tour' }).click();
  await expect(page.locator('.gc-tour')).toHaveCount(0);

  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Take the tour' }).click();
  await expect(title(page)).toHaveText('Welcome to your notebook');
  await page.keyboard.press('Escape');
  await expect(page.locator('.gc-tour')).toHaveCount(0);

  await page.locator('.gc-notebook-btn').click();
  await page.getByRole('menuitem', { name: 'Take the tour' }).click();
  await expect(title(page)).toHaveText('Welcome to your notebook');
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+k');
  await page.keyboard.type('tour');
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveText('Welcome to your notebook');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the tour opens the menu to show what is in it, and closes it after', async ({ page }) => {
    await openFolderNotebook(page, { tour: true });
    await page.getByRole('button', { name: 'Show me around' }).click();
    await expect(page.locator('.gc-sidebar')).toHaveClass(/is-open/);
    for (let i = 0; i < 6; i++) {
      const card = (await tour(page).boundingBox())!;
      expect(card.x).toBeGreaterThanOrEqual(0);
      expect(card.x + card.width).toBeLessThanOrEqual(390);
      expect(card.y + card.height).toBeLessThanOrEqual(844);
      await tour(page).getByRole('button', { name: 'Next' }).click();
    }
    await page.getByRole('button', { name: 'Skip tour' }).click();
    await expect(page.locator('.gc-sidebar')).not.toHaveClass(/is-open/);
  });
});

test('the editor toolbar says what each button does', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await page.locator('.gc-new-btn').click();
  await page.getByRole('button', { name: 'Create entry' }).click();
  const tip = page.getByRole('tooltip');
  await page.getByRole('button', { name: 'Subscript' }).hover();
  await expect(tip).toContainText('Subscript');
  await expect(tip).toContainText('Lowered text, as in H₂O');
  await expect(tip.locator('kbd')).toHaveText('Ctrl+,');
  await page.getByRole('button', { name: 'Insert…' }).hover();
  await expect(tip).toContainText('Buffer, flow, stock');
  // Gone once you click.
  await page.mouse.down();
  await expect(tip).toHaveCount(0);
  await page.mouse.up();
  await page.keyboard.press('Escape');
  // The Insert menu offers the flow and the buffer, with the lab blocks first (it scrolls after a dozen items).
  await page.getByRole('button', { name: 'Insert…' }).click();
  await expect(page.locator('.menu-item', { hasText: 'Flow' })).toBeVisible();
  await expect(page.locator('.menu-item', { hasText: 'Buffer' })).toBeVisible();
  await expect(page.locator('.popover .menu-item').nth(0)).toHaveText('Table');
  await expect(page.locator('.popover .menu-item').nth(2)).toHaveText('Plate layout');
  await expect(page.locator('.popover .menu-item').nth(6)).toHaveText('Cite a paper');
});

test.describe('on a laptop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the tour card does not cover the flow or the buffer it explains', async ({ page }) => {
    await openFolderNotebook(page, { tour: true });
    await page.getByRole('button', { name: 'Show me around' }).click();
    const spot = page.locator('.gc-tour-spot');
    for (let i = 0; i < 12; i++) {
      const t = await title(page).textContent();
      if (t === 'A flow of experiments' || t === 'The buffer calculator') {
        await page.locator(t.startsWith('A flow') ? '.gc-flow' : '.gc-buffer').waitFor();
        // Once the page has scrolled and the highlight has settled, the two do not overlap.
        await expect
          .poll(async () => {
            const [a, b] = [(await spot.boundingBox())!, (await tour(page).boundingBox())!];
            return (
              Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)) *
              Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
            );
          })
          .toBe(0);
      }
      if (t === 'The buffer calculator') break;
      await tour(page).getByRole('button', { name: 'Next' }).click();
    }
  });
});
