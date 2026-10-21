import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { listFiles, openFolderNotebook, readFile, trackErrors, waitForSave } from './helpers';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = trackErrors(page);
});
test.afterEach(() => {
  expect(errors, 'uncaught errors in the page').toEqual([]);
});

const fixture = (name: string) => readFileSync(`tests/fixtures/pdf/${name}`);

/** Drop files onto an element, as if dragged from the desktop. */
async function dropFiles(page: Page, selector: string, files: { name: string; data: Buffer }[]) {
  const payload = files.map((f) => ({ name: f.name, b64: f.data.toString('base64') }));
  await page.evaluate(
    ({ selector, payload }) => {
      const dt = new DataTransfer();
      for (const f of payload) {
        const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
        dt.items.add(new File([bytes], f.name, { type: 'application/pdf' }));
      }
      const el = document.querySelector(selector)!;
      for (const type of ['dragenter', 'dragover', 'drop'])
        el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    { selector, payload },
  );
}

test('import a PDF as a protocol, keep the original and compare them side by side', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Protocols' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import PDF' }).first().click();
  await (await chooser).setFiles({ name: 'SOP-021 Inoue.pdf', mimeType: 'application/pdf', buffer: fixture('inoue-word.pdf') });

  // The dialog converts it right away and fills in the name.
  await expect(page.locator('.gc-help-panel')).toContainText('From PDF to protocol');
  await expect(page.locator('.gc-pdf-card-sub')).toContainText('3 pages converted', { timeout: 30_000 });
  await expect(page.locator('.gc-pdf-card-sub')).toContainText('2 tables');
  await expect(page.locator('#np-title')).toHaveValue('Chemically competent E. coli by the Inoue method');
  await page.getByRole('button', { name: 'Create protocol' }).click();

  await expect(page.locator('.gc-title-input')).toHaveValue('Chemically competent E. coli by the Inoue method');
  await expect(page.locator('.gc-import-banner')).toContainText('Converted from a PDF');
  await expect(page.locator('.ProseMirror h2', { hasText: '2. Materials and reagents' })).toBeVisible();
  await expect(page.locator('.ProseMirror ol li', { hasText: 'Transfer the flask to an ice-water bath' })).toBeVisible();
  await expect(page.locator('.gc-sheet')).toHaveCount(2);
  await expect(page.locator('.ProseMirror img')).toHaveCount(1);
  await waitForSave(page);

  // Saved as Markdown, with the PDF and the figure next to it.
  const md = await readFile(page, 'Protocols/P-0004 Chemically competent E. coli by the Inoue method.md');
  expect(md).toContain('kind: protocol');
  expect(md).toContain('status: draft');
  expect(md).toContain('source: attachments/P-0004/SOP-021 Inoue.pdf');
  expect(md).toContain('note: Imported from SOP-021 Inoue.pdf');
  expect(md).toContain('| Inoue transformation buffer (ITB) | 80 ml, ice-cold | see section 4 |');
  expect(md).toContain('![](attachments/P-0004/Figure%201.png)');
  expect(await listFiles(page, 'Protocols/attachments/P-0004')).toEqual(['Figure 1.png', 'SOP-021 Inoue.pdf']);

  // The original, next to the protocol.
  await page.getByRole('button', { name: 'Compare with the PDF' }).click();
  const pane = page.locator('.gc-source-pane');
  await expect(pane).toContainText('SOP-021 Inoue.pdf');
  await expect(pane.locator('.gc-pdf-page img, iframe.gc-pdf-frame').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('.gc-source-pane').getByRole('button', { name: 'Close the original PDF' }).click();
  await expect(pane).toHaveCount(0);
  await page.locator('.gc-source-chip button').click();
  await expect(pane).toBeVisible();

  // Once checked and active, the reminder goes away.
  await page.locator('.gc-props .pill', { hasText: 'Draft' }).first().click();
  await page.locator('.menu-item', { hasText: 'Active' }).click();
  await expect(page.locator('.gc-import-banner')).toHaveCount(0);

  // In the list, imported protocols are marked.
  await page.locator('.gc-nav-item', { hasText: 'Protocols' }).click();
  await expect(page.locator('.gc-protocol-table tr', { hasText: 'Inoue method' }).locator('.gc-pdf-badge')).toBeVisible();
});

test('drop several PDFs on the Protocols page to import them all', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await page.locator('.gc-nav-item', { hasText: 'Protocols' }).click();
  await dropFiles(page, '.gc-protocols-page', [
    { name: 'Gibson assembly.pdf', data: fixture('gibson-chromium.pdf') },
    { name: 'Kit handbook.pdf', data: fixture('kit-manual.pdf') },
    { name: 'Bradford scan.pdf', data: fixture('scanned.pdf') },
  ]);
  const dialog = page.locator('.dialog');
  await expect(dialog.locator('h2')).toHaveText('Imported 3 protocols', { timeout: 60_000 });
  await expect(dialog.locator('.gc-batch-row.is-done')).toHaveCount(3);
  await expect(dialog.locator('.gc-batch-row', { hasText: 'Bradford scan.pdf' })).toContainText('Scanned: pages added as images');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.gc-protocol-table tbody tr')).toHaveCount(3);
  await expect(page.locator('.gc-protocol-table')).toContainText('PlasmidPure Mini Kit');
  await expect(page.locator('.gc-protocol-table')).toContainText('Handbook for the purification of plasmid DNA');
  await waitForSave(page);
  const files = await listFiles(page, 'Protocols');
  expect(files).toEqual(['P-0001 Gibson assembly of three fragments.md', 'P-0002 PlasmidPure Mini Kit.md', 'P-0003 Bradford scan.md', 'attachments']);
  expect(await listFiles(page, 'Protocols/attachments/P-0003')).toEqual(['Bradford scan.pdf', 'Page 1.png']);
  const gibson = await readFile(page, 'Protocols/P-0001 Gibson assembly of three fragments.md');
  expect(gibson).toContain('See [the NEB protocol](https://www.neb.com/en-us/protocols/gibson) for details.');
});

test('only PDFs are imported', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await page.locator('.gc-nav-item', { hasText: 'Protocols' }).click();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    const el = document.querySelector('.gc-protocols-page')!;
    for (const type of ['dragenter', 'dragover', 'drop'])
      el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await expect(page.locator('.toast')).toContainText('Only PDF files can be imported');
  await expect(page.locator('.dialog')).toHaveCount(0);
});

test('a PDF attached to an entry can be previewed in place', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await page.locator('.gc-new-btn').click();
  await page.locator('.gc-template-option', { hasText: 'Blank entry' }).click();
  await page.locator('#ne-title').fill('Kit test');
  await page.getByRole('button', { name: 'Create entry' }).click();
  await page.locator('.ProseMirror').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.gc-toolbar').getByRole('button', { name: 'Attach files' }).click();
  await (await chooser).setFiles({ name: 'handbook.pdf', mimeType: 'application/pdf', buffer: fixture('kit-manual.pdf') });
  const file = page.locator('.gc-file', { hasText: 'handbook.pdf' });
  await expect(file).toBeVisible();
  await file.getByTitle('Preview').click();
  // The browser's PDF viewer where there is one, otherwise the pages drawn by pdf.js.
  await expect(file.locator('.gc-pdf iframe.gc-pdf-frame, .gc-pdf .gc-pdf-page img').first()).toBeVisible({ timeout: 20_000 });
});
