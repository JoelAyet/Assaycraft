import { test, expect, type Page } from '@playwright/test';
import { listFiles, newBlankEntry, openFolderNotebook, readFile, trackErrors, waitForSave } from './helpers';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = trackErrors(page);
});
test.afterEach(() => {
  expect(errors, 'uncaught errors in the page').toEqual([]);
});

/** Path of the only file in `dir` whose name starts with `prefix`. */
async function fileStartingWith(page: Page, dir: string, prefix: string): Promise<string> {
  const names = (await listFiles(page, dir)).filter((n) => n.startsWith(prefix));
  expect(names, `${prefix}* in ${dir}`).toHaveLength(1);
  return `${dir}/${names[0]}`;
}

const frontMatter = (md: string) => md.split('\n---\n')[0];

test('protocols: create, version, link from an entry and see where they are used', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Protocols' }).click();
  await expect(page.locator('.gc-protocol-table tbody tr')).toHaveCount(3);

  // Create one with the standard outline.
  await page.getByRole('button', { name: 'New protocol' }).first().click();
  await expect(page.locator('.gc-help-panel')).toContainText('Good protocols');
  await page.locator('#np-title').fill('Western blot transfer');
  await page.locator('#np-desc').fill('Wet transfer to PVDF');
  await page.getByRole('button', { name: 'Create protocol' }).click();
  await expect(page.locator('.gc-title-input')).toHaveValue('Western blot transfer');
  await expect(page.locator('.gc-kind', { hasText: 'Protocol' })).toBeVisible();
  await waitForSave(page);
  const path = 'Protocols/P-0004 Western blot transfer.md';
  let md = await readFile(page, path);
  expect(frontMatter(md)).toContain('id: P-0004\nkind: protocol\ntitle: Western blot transfer\nstatus: draft');
  expect(md).toContain('version: "1.0"');
  expect(md).toContain('description: Wet transfer to PVDF');
  expect(md).toContain('## Procedure');

  // Release a new version with a note.
  await page.getByRole('button', { name: 'Release new version' }).click();
  await expect(page.locator('#rel-version')).toHaveValue('1.0');
  await page.locator('#rel-version').fill('1.1');
  await page.locator('#rel-note').fill('Transfer at 4 °C');
  await page.getByRole('button', { name: 'Release v1.1' }).click();
  await expect(page.locator('.gc-revisions')).toContainText('Transfer at 4 °C');
  await waitForSave(page);
  md = await readFile(page, path);
  expect(md).toContain('version: "1.1"');
  expect(md).toMatch(/revisions:\n {2}- version: "1\.1"\n {4}date: \d{4}-\d{2}-\d{2}\n {4}note: Transfer at 4 °C/);

  // Link it from an entry's header, and insert a copy of another protocol with "/".
  await newBlankEntry(page, 'Blot of GAPDH');
  await page.locator('.gc-prop', { hasText: 'Protocols' }).getByRole('button', { name: 'Link protocol' }).click();
  await page.locator('.dialog .gc-picker-item', { hasText: 'Western blot transfer' }).click();
  await expect(page.locator('.gc-link-chip.is-protocol')).toContainText('P-0004');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('/protocol');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Insert a copy of its steps' }).click();
  await page.locator('.dialog .gc-picker-item', { hasText: 'Bacterial glycerol stocks' }).click();
  await expect(page.locator('.ProseMirror h2')).toContainText('Protocol: P-0002 Bacterial glycerol stocks · v1.0');
  await waitForSave(page);
  const entry = 'Projects/General/EXP-0001 Blot of GAPDH.md';
  md = await readFile(page, entry);
  expect(frontMatter(md)).toContain('protocols: [P-0004, P-0002]');
  expect(md).toContain('## Protocol: [P-0002 Bacterial glycerol stocks](../../Protocols/P-0002%20Bacterial%20glycerol%20stocks.md) · v1.0');
  expect(md).toContain('### Procedure\n\n1. Grow 5 mL LB + antibiotic overnight');

  // A linked protocol opens next to the entry.
  await page.locator('.gc-link-chip.is-protocol', { hasText: 'P-0004' }).locator('button').first().click();
  await expect(page.locator('.gc-peek .gc-title-input')).toHaveValue('Western blot transfer');
  await page.keyboard.press('Escape');
  await expect(page.locator('.gc-peek')).toHaveCount(0);

  // The protocol lists where it is used.
  await page.locator('.gc-nav-item', { hasText: 'Protocols' }).click();
  await expect(page.locator('.gc-protocol-table tbody tr', { hasText: 'Western blot transfer' }).locator('.col-used')).toHaveText('1');
  await page.locator('.gc-protocol-table tbody tr', { hasText: 'Western blot transfer' }).click();
  await expect(page.locator('.gc-prop', { hasText: 'Used in' })).toContainText('Blot of GAPDH');
});

test('entries from a template link its protocols, and copied links still work', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Templates' }).click();
  await page.locator('.gc-tpl-card', { hasText: 'Molecular cloning' }).click();
  await expect(page.locator('.gc-prop', { hasText: 'Protocols' })).toContainText('P-0001');
  await page.getByRole('button', { name: 'New entry from template' }).click();
  await page.locator('#ne-folder').selectOption('Projects');
  await page.locator('.gc-var', { hasText: 'Construct' }).locator('input').fill('pX330-GFP');
  await expect(page.locator('.dialog .gc-link-chip')).toHaveCount(2);
  await page.getByRole('button', { name: 'Create entry' }).click();
  await expect(page.locator('.gc-title-input')).toHaveValue('Cloning of pX330-GFP');
  await waitForSave(page);
  const md = await readFile(page, 'Projects/EXP-0001 Cloning of pX330-GFP.md');
  expect(frontMatter(md)).toContain('protocols: [P-0001, P-0002]');
  // The sub-template's link to a protocol now starts from the entry's folder.
  expect(md).toMatch(/Cells made with \[P-0001 Chemically competent E\. coli \(CaCl₂\)\]\(\.\.\/Protocols\/P-0001%20Chemically/);

  // Ctrl+click follows the link to the protocol.
  await page.locator('.ProseMirror a', { hasText: 'P-0001' }).click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('.gc-title-input')).toHaveValue('Chemically competent E. coli (CaCl₂)');
  await expect(page.locator('.gc-prop', { hasText: 'Used in' })).toContainText('Cloning of pX330-GFP');
});

test('new entry from a protocol page copies its steps', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Protocols' }).click();
  await page.locator('.gc-protocol-table tbody tr', { hasText: 'Freezing and thawing' }).click();
  await page.getByRole('button', { name: 'New entry with protocol' }).click();
  await expect(page.locator('#ne-title')).toHaveValue('Freezing and thawing mammalian cells');
  await expect(page.locator('.dialog input[type=checkbox]')).toBeChecked();
  await page.getByRole('button', { name: 'Create entry' }).click();
  await expect(page.locator('.ProseMirror')).toContainText('Protocol: P-0003 Freezing and thawing mammalian cells · v1.1');
  await waitForSave(page);
  const md = await readFile(page, await fileStartingWith(page, 'Projects/General', 'EXP-0001'));
  expect(frontMatter(md)).toContain('protocols: [P-0003]');
  expect(md).toContain('### Thawing');
});

test('guided template and sub-template creation, with checks', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Templates' }).click();

  // Sub-template from the example: New makes what the open tab shows.
  await page.getByRole('group', { name: 'Kind' }).getByRole('button', { name: 'Sub-templates' }).click();
  await page.getByRole('button', { name: 'New sub-template' }).click();
  await expect(page.locator('.gc-help-panel')).toContainText('How sub-templates work');
  await page.locator('#nt-title').fill('BCA assay');
  await page.getByRole('button', { name: 'Create sub-template' }).click();
  await expect(page.locator('.gc-title-input')).toHaveValue('BCA assay');
  await expect(page.locator('.gc-check-ok')).toContainText('Ready to use · asks for 2 values');
  await waitForSave(page);
  const sub = await readFile(page, 'Templates/Sub-templates/BCA assay.md');
  expect(sub).toContain('"C2":"=B2*{{Reactions|4}}"');
  expect(sub).toContain('Sample **{{Sample}}** · {{Reactions|4}} reactions');

  // Template from the outline, with a linked sub-template, an entry title and a protocol.
  await page.locator('.gc-nav-item', { hasText: 'Templates' }).click();
  await page.getByRole('group', { name: 'Kind' }).getByRole('button', { name: 'Entry templates' }).click();
  await page.getByRole('button', { name: 'New template' }).click();
  await expect(page.locator('.gc-help-panel')).toContainText('How templates work');
  await page.locator('#nt-title').fill('Western blot');
  await page.locator('#nt-entry-title').fill('Western blot of {{Protein}}');
  await page.locator('.gc-check-chip', { hasText: 'BCA assay' }).locator('input').check();
  await page.locator('.dialog').getByRole('button', { name: 'Link protocol' }).click();
  await page.locator('.dialog .gc-picker-item', { hasText: 'Bacterial glycerol stocks' }).click();
  await page.getByRole('button', { name: 'Create template' }).click();
  await expect(page.locator('.gc-title-input')).toHaveValue('Western blot');
  await expect(page.locator('.gc-include')).toContainText('BCA assay');
  await expect(page.locator('.gc-check-ok')).toContainText('Ready to use');
  await waitForSave(page);
  const tpl = await readFile(page, 'Templates/Western blot.md');
  expect(tpl).toContain('protocols: [P-0002]');
  expect(tpl).toContain('entryTitle: Western blot of {{Protein}}');
  expect(tpl).toContain('## Procedure\n\n<!-- gc:include {"id":"bca-assay","name":"BCA assay"} -->');

  // Tips can be opened from the page, and mistakes are pointed out.
  await page.getByRole('button', { name: 'How to build it' }).click();
  await expect(page.locator('.gc-guide-inline')).toContainText('Put {{double brackets}} where the value changes');
  await expect(page.locator('.gc-guide-inline .gc-howto-demo')).toContainText('Digest pUC19 with EcoRI');
  await page.locator('.ProseMirror p', { hasText: 'What question' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Antibody: {{Antibody');
  await expect(page.locator('.gc-issue.is-warning')).toContainText('Check the braces', { timeout: 15_000 });
  await page.keyboard.type('}}');
  await expect(page.locator('.gc-check-ok')).toBeVisible({ timeout: 15_000 });

  // Using it: values are asked for, the title is built and the protocol is linked.
  await page.getByRole('button', { name: 'New entry from template' }).click();
  await page.locator('.gc-var', { hasText: 'Protein' }).locator('input').fill('GAPDH');
  await expect(page.locator('#ne-title')).toHaveValue('Western blot of GAPDH');
  await page.getByRole('button', { name: 'Create entry' }).click();
  await expect(page.locator('.gc-title-input')).toHaveValue('Western blot of GAPDH');
  await expect(page.locator('.gc-link-chip.is-protocol')).toContainText('P-0002');
});

test('settings show who made Assaycraft', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await page.goto('/#/settings');
  await expect(page.locator('.gc-about')).toContainText('Created by Joel Ayet · 2026');
  await expect(page.locator('.gc-about')).toContainText(/v\d+\.\d+\.\d+/);
});

test('appearance: accent color and entry font are applied and remembered', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await page.goto('/#/settings');
  await page.getByRole('radio', { name: 'Violet' }).click();
  await page.getByRole('radio', { name: /Serif/ }).click();
  const appearance = () => page.evaluate(() => [document.documentElement.dataset.accent, document.documentElement.dataset.font]);
  expect(await appearance()).toEqual(['violet', 'serif']);
  await page.reload();
  await expect(page.locator('.gc-sidebar')).toBeVisible();
  expect(await appearance()).toEqual(['violet', 'serif']);
  await expect(page.getByRole('radio', { name: 'Violet' })).toHaveAttribute('aria-checked', 'true');
});
