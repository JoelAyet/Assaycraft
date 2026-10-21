import { test, expect, type Page } from '@playwright/test';
import { NOTEBOOK, listFiles, newBlankEntry, openFolderNotebook, readFile, skipTour, trackErrors, waitForSave, writeFile } from './helpers';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = trackErrors(page);
});
test.afterEach(() => {
  expect(errors, 'uncaught errors in the page').toEqual([]);
});

test('notes: a page for meetings and ideas, kept apart from experiments', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Notes' }).click();
  await expect(page.locator('.gc-notes-page h1')).toHaveText('Notes');
  // The example note of a new notebook.
  await expect(page.locator('.gc-note-row', { hasText: 'Lab meeting' })).toContainText('Try a lower annealing temperature');

  await page.getByRole('button', { name: 'New note' }).first().click();
  // The title of a new note is selected: typing replaces it.
  const title = page.locator('.gc-title-input');
  await expect(title).toBeFocused();
  await page.keyboard.type('Journal club: base editing');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Discussed prime editing efficiency.');
  await waitForSave(page);
  await expect(page.locator('.gc-doc-kicker')).toHaveText('Note');
  await expect(page.locator('.gc-doc-kicker .id-chip')).toHaveCount(0);
  await expect(page.locator('.gc-crumbs')).toContainText('Notes');
  // No status, project or protocols: only a date and tags.
  await expect(page.locator('.gc-props .gc-prop-label')).toHaveText(['Date', 'Tags', 'Modified']);

  await expect.poll(() => listFiles(page, 'Notes')).toContain('Journal club base editing.md');
  const md = await readFile(page, 'Notes/Journal club base editing.md');
  expect(md).toMatch(/^---\nid: note-untitled-note\nkind: note\ntitle: "Journal club: base editing"\n/);
  expect(md).toContain('Discussed prime editing efficiency.');

  // Listed under Notes, found by search, and kept off the calendar and the experiments board.
  await page.locator('.gc-nav-item', { hasText: 'Notes' }).click();
  await expect(page.locator('.gc-note-row').first()).toContainText('Journal club: base editing');
  await page.getByLabel('Filter notes').fill('prime editing');
  await expect(page.locator('.gc-note-row')).toHaveCount(1);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('journal club');
  await expect(page.locator('.gc-pal-item').first()).toContainText('Journal club: base editing');
  await page.keyboard.press('Escape');
  await page.goto('/#/board');
  await expect(page.locator('.gc-board-page')).not.toContainText('Journal club');
});

const flowCard = (page: Page, n: number) => page.locator(`.gc-flow-card[data-step="${n}"]`);

test('a flow plans a series of experiments: each step starts as its own entry and reports back', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-new-btn').click();
  await page.locator('.gc-template-option', { hasText: 'Protein production' }).click();
  const field = (label: string) => page.locator('.gc-var', { hasText: label }).locator('input');
  await field('Protein').fill('GFP');
  await field('Construct').fill('pET28-GFP');
  await expect(page.locator('#ne-title')).toHaveValue('Production of GFP');
  await page.getByRole('button', { name: 'Create entry' }).click();
  await expect(page.locator('.gc-title-input')).toHaveValue('Production of GFP');

  // The plan, with the template's values filled in; nothing started yet.
  const titles = page.locator('.gc-flow-card:not(.is-add) .gc-flow-title');
  await expect(titles).toHaveText([
    'Cloning of pET28-GFP',
    'Transformation into BL21(DE3)',
    'Expression test',
    'Lab-scale production',
    'Purification of GFP',
  ]);
  await expect(page.locator('.gc-flow-card.is-planned')).toHaveCount(5);
  await expect(page.locator('.gc-flow-progress')).toContainText('0 of 5 done');
  await expect(flowCard(page, 1)).toContainText('Molecular cloning');

  // Rows snake: four steps across a wide page, then the fifth under the fourth.
  const box = async (n: number) => (await flowCard(page, n).boundingBox())!;
  const [b1, b2, b3, b4, b5] = [await box(1), await box(2), await box(3), await box(4), await box(5)];
  expect(b2.x).toBeGreaterThan(b1.x);
  expect(b3.x).toBeGreaterThan(b2.x);
  expect(b4.x).toBeGreaterThan(b3.x);
  expect(Math.abs(b5.x - b4.x)).toBeLessThan(2);
  expect(b5.y).toBeGreaterThan(b4.y + b4.height);

  // Start step 2: the new entry gets the step's title and template, and the flow links to it.
  await page.getByRole('button', { name: 'Start step 2: Transformation into BL21(DE3)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start step 2' });
  await expect(dialog.locator('#ne-title')).toHaveValue('Transformation into BL21(DE3)');
  await expect(dialog.locator('.gc-template-option.active')).toContainText('General experiment');
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.gc-title-input')).toHaveValue('Transformation into BL21(DE3)');
  await expect(page.locator('.gc-doc-kicker .id-chip')).toHaveText('EXP-0002');

  // Inside the step: where it is in the flow, and a result to report.
  const bar = page.getByRole('navigation', { name: 'Flow' });
  await expect(bar).toContainText('Step 2 of 5 in EXP-0001 Production of GFP');
  await expect(bar.locator('.gc-flowbar-step.is-prev')).toHaveText('Cloning of pET28-GFP');
  await expect(bar.locator('.gc-flowbar-step.is-next')).toHaveText('Expression test');
  await page.getByPlaceholder('The outcome in one line').fill('12 colonies, 3 picked');
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await page.getByRole('button', { name: 'Lock entry' }).click();
  await waitForSave(page);
  expect(await readFile(page, 'Projects/General/EXP-0002 Transformation into BL21(DE3).md')).toContain('result: 12 colonies, 3 picked');

  // Back in the plan, the step shows its entry: ID, status, lock and result.
  await bar.locator('.gc-flowbar-parent').click();
  await expect(page.locator('.gc-title-input')).toHaveValue('Production of GFP');
  await expect(flowCard(page, 2)).toHaveClass(/is-done/);
  await expect(flowCard(page, 2)).toContainText('EXP-0002');
  await expect(flowCard(page, 2)).toContainText('Completed');
  await expect(flowCard(page, 2).locator('.gc-flow-lock')).toBeVisible();
  await expect(flowCard(page, 2).locator('.gc-flow-result')).toHaveText('12 colonies, 3 picked');
  await expect(page.locator('.gc-flow-progress')).toContainText('1 of 5 done');
  await waitForSave(page);
  const md = await readFile(page, 'Projects/General/EXP-0001 Production of GFP.md');
  expect(md).toContain(
    '<!-- gc:flow {"templates":{"1":"molecular-cloning","2":"general-experiment","3":"general-experiment","4":"general-experiment","5":"general-experiment"}} -->\n' +
      '1. Cloning of pET28-GFP\n' +
      '2. [EXP-0002 Transformation into BL21(DE3)](EXP-0002%20Transformation%20into%20BL21%28DE3%29.md)\n' +
      '3. Expression test\n',
  );

  // The step opens from its card, and the board shows the flow's progress.
  await flowCard(page, 2).locator('.gc-flow-title').click();
  await expect(page.locator('.gc-title-input')).toHaveValue('Transformation into BL21(DE3)');
  await page.goto('/#/board');
  await expect(page.locator('.gc-card', { hasText: 'Production of GFP' })).toContainText('1/5');
});

test('a flow is quick to write and rearrange, and opens again as it was', async ({ page }) => {
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Spare entry');
  await newBlankEntry(page, 'Plasmid rescue');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('/flow');
  await expect(page.locator('.gc-slash-item, .menu-item').filter({ hasText: 'Flow' }).first()).toBeVisible();
  await page.keyboard.press('Enter');

  // The new flow starts in its "Add step" field; Enter adds a step and stays there.
  await expect(page.getByLabel('New step')).toBeFocused();
  for (const s of ['Digest', 'Ligation', 'Transform']) {
    await page.keyboard.type(s);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.press('Escape');
  const titles = page.locator('.gc-flow-card:not(.is-add) .gc-flow-title');
  await expect(titles).toHaveText(['Digest', 'Ligation', 'Transform']);

  // Rename by clicking a step's name; move and remove from its menu.
  await titles.nth(1).click();
  await page.getByLabel('Name of step 2').fill('Gibson assembly');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Step 3 options' }).click();
  await page.getByRole('menuitem', { name: 'Move earlier' }).click();
  await expect(titles).toHaveText(['Digest', 'Transform', 'Gibson assembly']);
  await page.getByRole('button', { name: 'Step 1 options' }).click();
  await page.getByRole('menuitem', { name: 'Remove step' }).click();
  await expect(titles).toHaveText(['Transform', 'Gibson assembly']);

  // A step can use an entry that already exists, and a template for when it starts.
  await page.getByRole('button', { name: 'Step 2 options' }).click();
  await page.getByRole('menuitem', { name: 'Start from a template…' }).click();
  await page.getByRole('dialog', { name: 'Template for step 2' }).getByText('Molecular cloning').click();
  await expect(flowCard(page, 2)).toContainText('Molecular cloning');
  await page.getByRole('button', { name: 'Step 1 options' }).click();
  await page.getByRole('menuitem', { name: 'Link an existing entry…' }).click();
  await page.getByRole('dialog', { name: 'Link an entry to step 1' }).getByText('Spare entry').click();
  await expect(flowCard(page, 1)).toContainText('EXP-0001');

  await waitForSave(page);
  await page.reload();
  await expect(titles).toHaveText(['Spare entry', 'Gibson assembly']);
  await expect(flowCard(page, 2)).toContainText('Molecular cloning');
  const md = await readFile(page, 'Projects/General/EXP-0002 Plasmid rescue.md');
  expect(md).toContain(
    '<!-- gc:flow {"templates":{"2":"molecular-cloning"}} -->\n1. [EXP-0001 Spare entry](EXP-0001%20Spare%20entry.md)\n2. Gibson assembly\n',
  );

  // A step's entry renamed: the plan's file follows.
  await titles.first().click();
  await page.locator('.gc-title-input').fill('Spare entry, renamed');
  await page.keyboard.press('Enter');
  await waitForSave(page);
  await page.goBack();
  await expect(titles.first()).toHaveText('Spare entry, renamed');
  await waitForSave(page);
  await expect
    .poll(() => readFile(page, 'Projects/General/EXP-0002 Plasmid rescue.md'))
    .toContain('1. [EXP-0001 Spare entry, renamed](EXP-0001%20Spare%20entry,%20renamed.md)\n');

  // Unlinking keeps the step, without its entry.
  await page.getByRole('button', { name: 'Step 1 options' }).click();
  await page.getByRole('menuitem', { name: 'Unlink entry' }).click();
  await expect(flowCard(page, 1)).toHaveClass(/is-planned/);
  await expect(titles.first()).toHaveText('Spare entry, renamed');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the steps stack, and fit the screen', async ({ page }) => {
    await openFolderNotebook(page);
    await page.locator('.gc-nav-toggle').first().click();
    await page.locator('.gc-new-btn').click();
    await page.locator('.gc-template-option', { hasText: 'Protein production' }).click();
    await page.locator('.gc-var', { hasText: 'Protein' }).locator('input').fill('GFP');
    await page.getByRole('button', { name: 'Create entry' }).click();
    await expect(flowCard(page, 5)).toBeAttached();
    let last = 0;
    for (let n = 1; n <= 5; n++) {
      const b = (await flowCard(page, n).boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(390);
      expect(b.y).toBeGreaterThan(last);
      last = b.y + b.height;
    }
  });
});

test('in a template, a flow shows what each step starts from', async ({ page }) => {
  await openFolderNotebook(page);
  await page.goto('/#/templates');
  await page.locator('.gc-tpl-card', { hasText: 'Protein production' }).click();
  // Its variables are read first: it never says it has none in the meantime.
  const asks = page.locator('.gc-prop').filter({ has: page.locator('.gc-prop-label', { hasText: /^Asks for$/ }) });
  for (let i = 0; i < 8; i++) {
    await expect(asks).not.toContainText('No variables');
    await page.waitForTimeout(30);
  }
  await expect(asks).toContainText('{{Protein}}');
  // Nothing to start in a template: each step shows the template its entry will start from.
  await expect(page.locator('.gc-flow-card.is-planned')).toHaveCount(5);
  await expect(page.locator('.gc-flow-planned')).toHaveCount(0);
  await expect(page.locator('.gc-flow-start')).toHaveCount(0);
  await expect(flowCard(page, 1)).toContainText('Molecular cloning');
  await expect(flowCard(page, 2)).toContainText('General experiment');
});

async function flowWith(page: Page, steps: string[]) {
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/flow');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('New step')).toBeFocused();
  for (const s of steps) {
    await page.keyboard.type(s);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.press('Escape');
}

test('a note can hold a flow too', async ({ page }) => {
  await openFolderNotebook(page);
  await page.goto('/#/notes');
  await page.getByRole('button', { name: 'New note' }).first().click();
  await expect(page.locator('.gc-title-input')).toBeFocused();
  await page.keyboard.type('Ideas for Q4');
  await page.keyboard.press('Enter');
  await flowWith(page, ['Pilot screen', 'Validation']);
  await page.getByRole('button', { name: /^Start step 1/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Start step 1' });
  await expect(dialog.locator('#ne-title')).toHaveValue('Pilot screen');
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.gc-title-input')).toHaveValue('Pilot screen');
  await expect(page.getByRole('navigation', { name: 'Flow' })).toContainText('Step 1 of 2 in Ideas for Q4');
  await page.locator('.gc-flowbar-parent').click();
  await expect(flowCard(page, 1)).toContainText('EXP-0001');
  await waitForSave(page);
  expect(await readFile(page, 'Notes/Ideas for Q4.md')).toContain(
    '<!-- gc:flow -->\n1. [EXP-0001 Pilot screen](../Projects/General/EXP-0001%20Pilot%20screen.md)\n2. Validation\n',
  );
});

test('a step whose entry is trashed says so, and comes back with Undo', async ({ page }) => {
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Plan');
  await flowWith(page, ['Step one']);
  await page.getByRole('button', { name: /^Start step 1/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.gc-title-input')).toHaveValue('Step one');
  await page.getByTitle('More actions').click();
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await page.locator('.gc-tree-row', { hasText: 'Plan' }).click();
  await expect(flowCard(page, 1)).toHaveClass(/is-missing/);
  await expect(flowCard(page, 1)).toContainText('Entry not found');
  await page.locator('.toast-action', { hasText: 'Undo' }).click();
  await expect(flowCard(page, 1)).toHaveClass(/is-started/);
});

test('a locked plan is read-only', async ({ page }) => {
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Plan');
  await flowWith(page, ['Step one', 'Step two']);
  await waitForSave(page);
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await page.getByRole('button', { name: 'Lock entry' }).click();
  await expect(page.locator('.gc-flow-card.is-add')).toHaveCount(0);
  await expect(page.locator('.gc-flow .icon-btn')).toHaveCount(0);
  await expect(page.locator('.gc-flow-start')).toHaveCount(0);
  await expect(page.locator('span.gc-flow-title')).toHaveCount(2);
});

test('a duplicate, or a template saved from the plan, starts with no step started', async ({ page }) => {
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Plan');
  await flowWith(page, ['Step one', 'Step two']);
  await page.getByRole('button', { name: /^Start step 1/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.gc-title-input')).toHaveValue('Step one');
  await page.locator('.gc-flowbar-parent').click();
  await expect(flowCard(page, 1)).toContainText('EXP-0002');
  await waitForSave(page);
  await page.getByTitle('More actions').click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page.locator('.gc-title-input')).toHaveValue('Plan (copy)');
  await expect(page.locator('.gc-flow-card.is-planned')).toHaveCount(2);
  await page.getByTitle('More actions').click();
  await page.getByRole('menuitem', { name: 'Save as template' }).click();
  await expect(page.locator('.gc-doc-kicker')).toContainText('Entry template');
  await expect(page.locator('.gc-flow-card.is-planned')).toHaveCount(2);
  await expect(page.locator('.gc-flow-start')).toHaveCount(0);
});

test('a notebook made before Notes gets the folder with its first note', async ({ page }) => {
  await skipTour(page);
  await page.addInitScript((name) => {
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
  }, NOTEBOOK);
  await page.goto('/');
  await page.evaluate(async (name) => void (await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true })), NOTEBOOK);
  await writeFile(page, 'assaycraft.json', JSON.stringify({ app: 'assaycraft', version: 1, name: 'Old', idPrefix: 'GC-', idDigits: 4 }));
  await writeFile(page, 'Projects/GC-0001 Old entry.md', '---\nid: GC-0001\ntitle: Old entry\nstatus: completed\n---\nHello\n');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.locator('.gc-main')).toBeVisible();
  await page.goto('/#/notes');
  await expect(page.locator('.gc-notes-empty')).toContainText('No notes yet');
  await page.locator('.gc-notes-empty').getByRole('button', { name: 'New note' }).click();
  await expect(page.locator('.gc-title-input')).toBeFocused();
  await page.keyboard.type('First note');
  await page.keyboard.press('Enter');
  await waitForSave(page);
  await expect.poll(() => listFiles(page, 'Notes')).toEqual(['First note.md']);
});
