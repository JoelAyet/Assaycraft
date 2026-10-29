import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { writeSnapGene } from '../../src/bio/snapgene';
import { listFiles, NOTEBOOK, newBlankEntry, openFolderNotebook, readFile, trackErrors, waitForSave, writeFile, ymd, skipTour } from './helpers';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = trackErrors(page);
});
test.afterEach(() => {
  expect(errors, 'uncaught errors in the page').toEqual([]);
});

test('a notebook made before the rename (genecraft.json) opens with its settings', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async (nb) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(nb, { create: true });
    const w = await (await dir.getFileHandle('genecraft.json', { create: true })).createWritable();
    await w.write(JSON.stringify({ app: 'genecraft', version: 1, name: 'Smith lab', idPrefix: 'SL-', idDigits: 3 }));
    await w.close();
  }, NOTEBOOK);
  await openFolderNotebook(page);
  await expect(page.locator('.gc-notebook-name')).toHaveText('Smith lab');
  expect(await listFiles(page, '')).not.toContain('genecraft.json');
  expect(JSON.parse(await readFile(page, 'assaycraft.json'))).toMatchObject({ app: 'assaycraft', name: 'Smith lab', idPrefix: 'SL-' });
});

test('a notebook made with Labcraft opens with its settings, history, activity and preferences', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('labcraft:accent')) localStorage.setItem('labcraft:accent', 'violet');
  });
  await page.goto('/');
  await page.evaluate((nb) => navigator.storage.getDirectory().then((d) => d.getDirectoryHandle(nb, { create: true })), NOTEBOOK);
  const today = ymd(new Date());
  await writeFile(page, 'labcraft.json', JSON.stringify({ app: 'labcraft', version: 1, name: 'Smith lab', idPrefix: 'SL-', idDigits: 3 }));
  await writeFile(page, 'Projects/SL-001 Digest.md', '---\nid: SL-001\nkind: entry\ntitle: Digest\n---\n\nCut with EcoRI.\n');
  await writeFile(page, '.labcraft/activity.json', JSON.stringify({ version: 1, days: { [today]: ['SL-001'] } }));
  await writeFile(page, '.labcraft/history/SL-001.json', '{"kept":"as it was"}');
  await openFolderNotebook(page);
  await expect(page.locator('.gc-notebook-name')).toHaveText('Smith lab');
  // Settings, version history and activity move to their new names, unchanged.
  const root = await listFiles(page, '');
  expect(root).toEqual(expect.arrayContaining(['assaycraft.json', '.assaycraft']));
  expect(root).not.toContain('labcraft.json');
  expect(root).not.toContain('.labcraft');
  expect(JSON.parse(await readFile(page, 'assaycraft.json'))).toMatchObject({ app: 'assaycraft', name: 'Smith lab', idPrefix: 'SL-' });
  expect(await readFile(page, '.assaycraft/history/SL-001.json')).toBe('{"kept":"as it was"}');
  await expect(page.locator('.gc-activity-foot')).toContainText('Active on 1 day');
  // Preferences saved in this browser carry over too.
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');
  expect(await page.evaluate(() => localStorage.getItem('assaycraft:accent'))).toBe('violet');
});

test('switching notebook straight after typing keeps the edit, without an error', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'Last words');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Typed just before switching.');
  await page.locator('.gc-notebook-name').click();
  await page.getByRole('menuitem', { name: 'Switch notebook' }).click();
  await expect(page.locator('.gc-wordmark')).toBeVisible();
  await expect(page.locator('.toast.error, .toast-error')).toHaveCount(0);
  expect(await readFile(page, 'Projects/EXP-0001 Last words.md')).toContain('Typed just before switching.');
});

test('a new folder notebook is seeded with templates and a task board', async ({ page }) => {
  await openFolderNotebook(page);
  expect(await listFiles(page, '')).toEqual(['Boards', 'Literature', 'Notes', 'Projects', 'Protocols', 'Stocks', 'Templates', 'assaycraft.json']);
  expect(await listFiles(page, 'Notes')).toEqual(['Lab meeting.md']);
  expect(await listFiles(page, 'Protocols')).toHaveLength(3);
  expect(await listFiles(page, 'Templates/Sub-templates')).toContain('PCR (Q5).md');
  await expect(page.locator('.gc-nav-item', { hasText: 'Lab tasks' })).toBeVisible();
  await expect(page.locator('.gc-template-card', { hasText: 'Molecular cloning' })).toBeVisible();
});

test('the activity graph on Home marks the days you edit something', async ({ page }) => {
  await openFolderNotebook(page);
  // The example templates of a new notebook are not your work.
  await expect(page.locator('.gc-activity-foot')).toContainText('No edits in the last 6 months yet');
  const today = ymd(new Date());

  await newBlankEntry(page, 'Colony PCR');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Picked 8 colonies.');
  await waitForSave(page);
  await page.locator('.gc-nav-item', { hasText: 'Protocols' }).click();
  await page.locator('.gc-protocol-table tbody tr').first().click();
  await page.locator('.ProseMirror').click();
  await page.keyboard.type(' Checked.');
  await waitForSave(page);

  await page.locator('.gc-nav-item', { hasText: 'Home' }).click();
  const cell = page.locator(`.gc-activity-cell[data-day="${today}"]`);
  await expect(cell).toHaveAttribute('data-count', '2');
  await expect(cell).toHaveAttribute('title', /^2 documents edited · /);
  await expect(page.locator('.gc-activity-foot')).toContainText('Active on 1 day in the last 6 months');

  // Kept in the notebook, so it is there next time and in exports.
  const log = JSON.parse(await readFile(page, '.assaycraft/activity.json'));
  expect(log.days[today]).toEqual(['EXP-0001', expect.stringMatching(/^P-000\d$/)]);
  await page.reload();
  await expect(page.locator(`.gc-activity-cell[data-day="${today}"]`)).toHaveAttribute('data-count', '2');
});

test('settings fields are named by their labels', async ({ page }) => {
  await openFolderNotebook(page);
  await page.goto('/#/settings');
  await expect(page.getByLabel('Notebook name')).toHaveValue('Test Notebook');
  await expect(page.getByLabel('Entry ID prefix')).toHaveValue('EXP-');
  await expect(page.getByLabel('Name of the “planned” status')).toHaveValue('Planned');
});

test('creating an entry from a template expands sub-templates and fills variables', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-new-btn').click();
  await page.locator('.gc-template-option', { hasText: 'Molecular cloning' }).click();
  const field = (label: string) => page.locator('.gc-var', { hasText: label }).locator('input');
  await field('Construct').fill('pLenti-GFP');
  await field('Insert').fill('EGFP');
  await field('Vector').fill('pLenti');
  await expect(page.locator('#ne-title')).toHaveValue('Cloning of pLenti-GFP');
  await page.getByRole('button', { name: 'Create entry' }).click();
  await expect(page.locator('.gc-title-input')).toHaveValue('Cloning of pLenti-GFP');
  await expect(page.locator('.ProseMirror')).toContainText('Clone EGFP into pLenti to make pLenti-GFP.');
  await expect(page.locator('.gc-include')).toHaveCount(0);

  const md = await readFile(page, 'Projects/General/EXP-0001 Cloning of pLenti-GFP.md');
  expect(md).toMatch(/^---\nid: EXP-0001\ntitle: Cloning of pLenti-GFP\nstatus: in-progress\n/);
  expect(md).toContain('template: Molecular cloning');
  expect(md).toContain('Clone **EGFP** into **pLenti** to make **pLenti-GFP**.');
  expect(md).toContain('### PCR: amplicon');
  expect(md).toContain('<!-- gc:table {"f":{"D2":"=D9-SUM(D3:D8)"');
  expect(md).toContain('| Nuclease-free water |   |   | 32.5 | 130 |');
  expect(md).not.toContain('gc:include');
});

test('tables behave like a spreadsheet and are saved as Markdown with formulas', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'OD measurements');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('/table');
  await page.keyboard.press('Enter');
  const sheet = page.locator('.gc-sheet');
  const cell = (r: number, c: number) => sheet.locator(`td[data-r="${r}"][data-c="${c}"]`);
  // header + two rows (typing starts editing, Tab/Enter move like Excel)
  for (const [r, values] of [
    [0, ['Sample', 'OD600', 'x2']],
    [1, ['S1', '0.4', '=B2*2']],
    [2, ['S2', '0.6']],
  ] as const) {
    await cell(r, 0).click();
    for (const [i, v] of values.entries()) {
      if (v) await page.keyboard.type(v);
      await page.keyboard.press(i < values.length - 1 ? 'Tab' : 'Enter');
    }
  }
  await expect(cell(1, 2)).toHaveText('0.8');
  // fill down C2 → C3
  await cell(1, 2).click();
  await cell(2, 2).click({ modifiers: ['Shift'] });
  await page.keyboard.press('Control+d');
  await expect(cell(2, 2)).toHaveText('1.2');
  // copy two rows and paste below: formulas shift like Excel
  await cell(1, 0).click();
  await cell(2, 2).click({ modifiers: ['Shift'] });
  await page.keyboard.press('Control+c');
  await cell(3, 0).click();
  await page.keyboard.press('Control+v');
  await expect(cell(4, 2)).toHaveText('1.2');
  // formula by clicking cells
  await cell(4, 1).click();
  await page.keyboard.type('=');
  await cell(1, 1).click();
  await page.keyboard.type('+');
  await cell(2, 1).click();
  await page.keyboard.press('Enter');
  await expect(cell(4, 1)).toHaveText('1');
  await expect(cell(4, 2)).toHaveText('2');
  await waitForSave(page);

  const md = await readFile(page, 'Projects/EXP-0001 OD measurements.md');
  expect(md).toContain('| Sample | OD600 | x2 |');
  expect(md).toContain('| S1 | 0.4 | 0.8 |');
  expect(md).toContain('| S2 | 1 | 2 |');
  expect(md).toContain('"C2":"=B2*2","C3":"=B3*2"');
  expect(md).toContain('"B5":"=B2+B3"');
});

test('improving a sub-template updates entries created afterward', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Templates' }).click();
  await page.getByRole('group', { name: 'Kind' }).getByRole('button', { name: 'Sub-templates' }).click();
  await page.locator('.gc-tpl-card', { hasText: 'Agarose gel' }).click();
  await expect(page.locator('.gc-title-input')).toHaveValue('Agarose gel');
  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Image on the blue-light transilluminator.');
  await waitForSave(page);
  expect(await readFile(page, 'Templates/Sub-templates/Agarose gel.md')).toContain('Image on the blue-light transilluminator.');

  await page.locator('.gc-nav-item', { hasText: 'Templates' }).click();
  await page.getByRole('group', { name: 'Kind' }).getByRole('button', { name: 'Entry templates' }).click();
  await page.locator('.gc-tpl-card', { hasText: 'Molecular cloning' }).getByRole('button', { name: 'Use' }).click();
  await page.getByRole('button', { name: 'Create entry' }).click();
  await expect(page.locator('.ProseMirror')).toContainText('Image on the blue-light transilluminator.');
});

test('SnapGene files are attached next to the entry and shown with a map', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'Plasmid check');
  const bytes = writeSnapGene({
    seq: 'ATGCGT'.repeat(500),
    circular: true,
    features: [
      { name: 'AmpR', type: 'CDS', start: 100, end: 961, strand: -1, color: '#ccffcc', segments: [{ start: 100, end: 961 }] },
      { name: 'ori', type: 'rep_origin', start: 1200, end: 1789, strand: 1, segments: [{ start: 1200, end: 1789 }] },
    ],
  });
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.gc-tb-insert', { hasText: 'Sequence' }).click();
  await (await chooser).setFiles({ name: 'pTest 1.dna', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
  const card = page.locator('.gc-seq');
  await expect(card).toContainText('pTest 1.dna');
  await expect(card).toContainText('3,000 bp');
  await expect(card).toContainText('circular');
  await expect(card.locator('.gc-seq-features')).toContainText('AmpR');
  await expect(card.locator('svg.gc-map')).toBeVisible();
  await waitForSave(page);
  expect(await listFiles(page, 'Projects/attachments/EXP-0001')).toEqual(['pTest 1.dna']);
  expect(await readFile(page, 'Projects/EXP-0001 Plasmid check.md')).toContain('[pTest 1.dna](attachments/EXP-0001/pTest%201.dna)');
});

test('TIFF images from microscopes and gel imagers are shown, a page at a time, and kept as they are', async ({ page }) => {
  const tiff = (name: string) => readFileSync(`tests/fixtures/tiff/${name}`);
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'Imaging');
  await page.locator('.ProseMirror').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.gc-toolbar').getByRole('button', { name: 'Attach files' }).click();
  await (
    await chooser
  ).setFiles([
    { name: 'cells 16-bit.tif', mimeType: 'image/tiff', buffer: tiff('cells-16bit-be.tif') },
    { name: 'stack.tif', mimeType: 'image/tiff', buffer: tiff('stack-3pages.tif') },
    { name: 'IMG_0042.heic', mimeType: 'image/heic', buffer: Buffer.from('a format this browser cannot draw') },
  ]);
  const [cells, stack, heic] = [0, 1, 2].map((i) => page.locator('.gc-image').nth(i));
  // Drawn, not a blank line: the picture has the file's size, with its depth noted under it.
  await expect.poll(() => cells.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(64);
  await expect(cells.locator('.gc-image-meta')).toHaveText('TIFF · 64 × 48 · 16-bit, contrast stretched for display');
  await expect(stack.locator('.gc-image-meta')).toContainText('Page 1 of 3');
  await stack.getByTitle('Next page').click();
  await expect(stack.locator('.gc-image-meta')).toContainText('Page 2 of 3');
  // A photo that can't be read (not a real HEIC) is kept as it is, and says so, with the file to download.
  await expect(heic.locator('.gc-image-fallback')).toContainText('IMG_0042.heic', { timeout: 20_000 });
  await expect(heic.locator('.gc-image-fallback')).toContainText('Can’t show this HEIC photo');
  await expect(heic.locator('.gc-image-fallback').getByRole('link', { name: 'Download' })).toHaveAttribute('download', 'IMG_0042.heic');
  await waitForSave(page);
  expect(await readFile(page, 'Projects/EXP-0001 Imaging.md')).toContain('![](attachments/EXP-0001/cells%2016-bit.tif)');
  const kept = await page.evaluate(async (nb) => {
    let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(nb);
    for (const part of ['Projects', 'attachments', 'EXP-0001']) dir = await dir.getDirectoryHandle(part);
    return (await (await dir.getFileHandle('cells 16-bit.tif')).getFile()).size;
  }, NOTEBOOK);
  expect(kept).toBe(tiff('cells-16bit-be.tif').length);
});

test('task boards: quick add, drag between columns, edit in the side panel', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Lab tasks' }).click();
  const todo = page.locator('.gc-col').nth(0);
  const done = page.locator('.gc-col').nth(2);
  await todo.locator('.gc-col-add').click();
  await page.keyboard.type('Buy filter tips');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  const card = page.locator('.gc-card', { hasText: 'Buy filter tips' });
  await expect(card).toBeVisible();
  await card.dragTo(done.locator('.gc-col-body'));
  await expect(done).toContainText('Buy filter tips');
  await waitForSave(page);
  const path = 'Boards/Lab tasks/T-0004 Buy filter tips.md';
  expect(await readFile(page, path)).toContain('status: done');

  await page.locator('.gc-card', { hasText: 'Buy filter tips' }).click();
  const peek = page.locator('.gc-peek');
  await expect(peek.locator('.gc-title-input')).toHaveValue('Buy filter tips');
  await peek.locator('.gc-date-native').nth(1).fill('2026-11-02');
  await peek.locator('.ProseMirror').click();
  await page.keyboard.type('Ask for the 10 µL ones');
  await waitForSave(page);
  const md = await readFile(page, path);
  expect(md).toContain('due: 2026-11-02');
  expect(md).toContain('Ask for the 10 µL ones');
  await page.keyboard.press('Escape');
  await expect(peek).toHaveCount(0);
});

test('experiments board changes an entry status by drag and drop', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'Western blot');
  await page.locator('.gc-nav-item', { hasText: 'Experiments' }).click();
  const card = page.locator('.gc-card', { hasText: 'Western blot' });
  await card.dragTo(page.locator('.gc-col', { hasText: 'Completed' }).locator('.gc-col-body'));
  await expect(page.locator('.gc-col', { hasText: 'Completed' })).toContainText('Western blot');
  await waitForSave(page);
  expect(await readFile(page, 'Projects/EXP-0001 Western blot.md')).toContain('status: completed');
});

test('calendar shows entries on their date and reschedules by drag', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'Transfection');
  await page.locator('.gc-nav-item', { hasText: 'Calendar' }).click();
  const item = page.locator('.gc-cal-item', { hasText: 'Transfection' });
  await expect(item).toBeVisible();
  const today = new Date();
  const target = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (today.getDate() > 20 ? -2 : 2));
  await item.dragTo(page.locator(`.gc-day[data-day="${ymd(target)}"]`));
  await waitForSave(page);
  expect(await readFile(page, 'Projects/EXP-0001 Transfection.md')).toContain(`date: ${ymd(target)}`);
});

test('a browser-storage notebook keeps its entries across reloads', async ({ page }) => {
  await skipTour(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Create browser notebook/ }).click();
  await page.getByRole('button', { name: 'Create notebook' }).click();
  await expect(page.locator('.gc-sidebar')).toBeVisible();
  await newBlankEntry(page, 'Buffer prep');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Made 1 L of 10X TBE.');
  await waitForSave(page);
  await page.reload();
  await expect(page.locator('.gc-title-input')).toHaveValue('Buffer prep');
  await expect(page.locator('.ProseMirror')).toContainText('Made 1 L of 10X TBE.');
});

test('edits made outside Assaycraft are picked up', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'Shared protocol');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('First line.');
  await waitForSave(page);
  const path = 'Projects/EXP-0001 Shared protocol.md';
  const md = await readFile(page, path);
  await page.waitForTimeout(1100); // make sure the modification time changes
  await writeFile(page, path, md.replace('First line.', 'First line.\n\nAdded in another editor.'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.ProseMirror')).toContainText('Added in another editor.');
});

test('rename, move and trash entries (with undo)', async ({ page }) => {
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Old name');
  await page.locator('.gc-title-input').fill('Gel extraction');
  await page.locator('.gc-title-input').press('Enter');
  await waitForSave(page);
  await expect.poll(() => listFiles(page, 'Projects/General')).toEqual(['EXP-0001 Gel extraction.md']);

  await page.locator('.gc-section', { hasText: 'Projects' }).getByRole('button', { name: 'New project folder' }).click();
  await page.getByLabel('Project name').fill('CRISPR');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.locator('.gc-tree-row', { hasText: 'Gel extraction' }).click();
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Move to…' }).click();
  await page.locator('.gc-picker-item', { hasText: 'CRISPR' }).click();
  await page.getByRole('button', { name: 'Move here' }).click();
  await expect.poll(() => listFiles(page, 'Projects/CRISPR')).toEqual(['EXP-0001 Gel extraction.md']);

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await expect(page.locator('.gc-tree-row', { hasText: 'Gel extraction' })).toHaveCount(0);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.gc-tree-row', { hasText: 'Gel extraction' })).toBeVisible();
});
