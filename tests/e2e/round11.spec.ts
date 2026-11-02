import { test, expect, type Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { listFiles, newBlankEntry, openFolderNotebook, readFile, trackErrors, waitForSave, writeFile } from './helpers';

const pathOf = (page: Page) => decodeURIComponent(new URL(page.url()).hash.replace('#/doc/', ''));

/** A 2×2 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');

async function attach(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.gc-toolbar').getByRole('button', { name: 'Attach files' }).click();
  await (await chooser).setFiles(files);
}

async function newNote(page: Page, title: string) {
  await page.locator('.gc-nav-item', { hasText: 'Notes' }).click();
  await page.locator('.gc-new-main').click();
  await expect(page.locator('.gc-title-input')).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
}

test('blocks selected with the mouse are copied whole, and paste back as blocks', async ({ page, context }) => {
  const errors = trackErrors(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openFolderNotebook(page);
  await newNote(page, 'Copying blocks');
  for (const w of ['one', 'two', 'three']) {
    await page.keyboard.type(w);
    await page.keyboard.press('Enter');
  }
  const ps = page.locator('.ProseMirror > p');
  const a = (await ps.nth(0).boundingBox())!;
  const b = (await ps.nth(1).boundingBox())!;
  await page.mouse.move(a.x + 10, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 20, a.y + a.height / 2, { steps: 2 });
  await page.mouse.move(b.x + 10, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.gc-block-selected')).toHaveCount(2);
  // Ctrl (pressed first) does not end the selection, so Ctrl+C copies the blocks.
  await page.keyboard.press('Control+c');
  await expect(page.locator('.gc-block-selected')).toHaveCount(2);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('one\n\ntwo');
  await ps.last().click();
  await page.keyboard.press('Control+v');
  // (The empty line the blocks were pasted on is replaced by them.)
  await expect(ps).toHaveText(['one', 'two', 'three', 'one', 'two']);
  expect(errors).toEqual([]);
});

test('files with # in their names are still there after reopening, and links broken by older versions are repaired', async ({ page }) => {
  const errors = trackErrors(page);
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Blots');
  await page.locator('.ProseMirror').click();
  await attach(page, [
    { name: 'Western blot #3.png', mimeType: 'image/png', buffer: PNG },
    { name: 'counts #1.csv', mimeType: 'text/csv', buffer: Buffer.from('lane,count\n1,40\n') },
  ]);
  await expect(page.locator('.gc-file-name')).toHaveText('counts #1.csv');
  await waitForSave(page);
  const path = pathOf(page);
  const md = await readFile(page, path);
  expect(md).toContain('/Western%20blot%20%233.png)');
  expect(md).toContain('/counts%20%231.csv)');

  // Opened again (the next day, say): both are there.
  await page.reload();
  await expect(page.locator('.gc-image img')).toBeVisible();
  await expect.poll(() => page.locator('.gc-image img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2);
  await expect(page.locator('.gc-file-sub')).toContainText('CSV');
  await expect(page.locator('.gc-missing, .gc-warn')).toHaveCount(0);

  // An entry saved by an older version, which wrote "#" back as %23 and then %2523.
  await writeFile(page, path, md.replace('%233.png', '%25233.png').replace('%231.csv', '%25231.csv'));
  await page.reload();
  await expect(page.locator('.gc-image img')).toBeVisible();
  await expect(page.locator('.gc-file-sub')).toContainText('CSV');
  await expect(page.locator('.gc-missing, .gc-warn')).toHaveCount(0);
  await waitForSave(page);
  const repaired = await readFile(page, path);
  expect(repaired).toContain('/Western%20blot%20%233.png)');
  expect(repaired).toContain('/counts%20%231.csv)');
  expect(errors).toEqual([]);
});

test('a file block copied into another entry brings its file into that entry’s folder', async ({ page, context }) => {
  const errors = trackErrors(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Counting');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Counts below.');
  await attach(page, [{ name: 'colony counts.csv', mimeType: 'text/csv', buffer: Buffer.from('plate,colonies\nA,120\n') }]);
  await expect(page.locator('.gc-file-name')).toHaveText('colony counts.csv');
  await waitForSave(page);
  const source = pathOf(page);
  // Select the file block (a click on its card) and copy it.
  await page.locator('.gc-file-card .gc-file-meta').click();
  await expect(page.locator('.gc-file.is-selected')).toBeVisible();
  await page.keyboard.press('Control+c');

  // Into a note: the Notes folder, not the entry's.
  await newNote(page, 'Counts summary');
  await page.keyboard.press('Control+v');
  await expect(page.locator('.gc-file-name')).toHaveText('colony counts.csv');
  await waitForSave(page);
  const note = pathOf(page);
  expect(note.startsWith('Notes/')).toBe(true);
  await expect.poll(async () => readFile(page, note)).toMatch(/\[colony counts\.csv\]\(attachments\/note-[^/)]+\/colony%20counts\.csv\)/);
  const md = await readFile(page, note);
  const dir = /\]\((attachments\/note-[^/)]+)\//.exec(md)![1];
  expect(await listFiles(page, `Notes/${dir}`)).toEqual(['colony counts.csv']);
  // The original stays with its entry.
  expect(await readFile(page, source)).toContain('[colony counts.csv](attachments/');
  // Its own copy: still there when the note is opened again.
  await page.reload();
  await expect(page.locator('.gc-file-sub')).toContainText('CSV');
  expect(errors).toEqual([]);
});

test('code blocks are colored, copy their code, and long code can be made small or big', async ({ page, context }) => {
  const errors = trackErrors(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Analysis');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('```python ');
  const code = ['import numpy as np', '', 'def mean(xs):', '    return sum(xs) / len(xs)  # average'];
  for (const [i, line] of code.entries()) {
    await page.keyboard.type(line);
    if (i < code.length - 1) await page.keyboard.press('Enter');
  }
  const block = page.locator('.gc-code');
  await expect(block.getByLabel('Code language')).toHaveValue('python');
  await expect(block.locator('.hljs-keyword').first()).toHaveText('import');
  await expect(block.locator('.hljs-comment')).toHaveText('# average');
  await expect(block.getByRole('button', { name: 'Expand' })).toHaveCount(0);
  await block.getByRole('button', { name: 'Copy' }).click();
  await expect(block.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code.join('\n'));
  await waitForSave(page);
  expect(await readFile(page, pathOf(page))).toContain('```python\nimport numpy as np\n\ndef mean(xs):');

  // Long code starts small (it scrolls inside the block); Expand shows all of it.
  // At the end of the code's last line (an empty line may follow the block).
  const box = (await block.locator('code').boundingBox())!;
  await page.mouse.click(box.x + box.width - 4, box.y + box.height - 6);
  await page.keyboard.press('End');
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(`print(${i})`);
  }
  await expect(block.locator('code')).toContainText('print(29)');
  await expect(block).toHaveClass(/is-collapsed/);
  const small = (await block.locator('pre').boundingBox())!.height;
  await block.getByRole('button', { name: 'Expand' }).click();
  await expect(block).not.toHaveClass(/is-collapsed/);
  const big = (await block.locator('pre').boundingBox())!.height;
  expect(big).toBeGreaterThan(small + 100);
  await block.getByRole('button', { name: 'Collapse' }).click();
  await expect(block).toHaveClass(/is-collapsed/);

  // Another language, from the bar.
  await block.getByLabel('Code language').selectOption('r');
  await waitForSave(page);
  expect(await readFile(page, pathOf(page))).toContain('```r\nimport numpy');
  expect(errors).toEqual([]);
});

/** A workbook with two sheets, as Excel writes one. */
function workbook(): Buffer {
  const main = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const rel = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'xl/workbook.xml': strToU8(
        `<workbook ${main} ${rel}><sheets><sheet name="OD600" sheetId="1" r:id="rId1"/><sheet name="Plate map" sheetId="2" r:id="rId2"/></sheets></workbook>`,
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
      ),
      'xl/sharedStrings.xml': strToU8(`<sst ${main}><si><t>Strain</t></si><si><t>OD600</t></si><si><t>Wild type</t></si><si><t>ΔlacZ</t></si></sst>`),
      'xl/styles.xml': strToU8(`<styleSheet ${main}><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`),
      'xl/worksheets/sheet1.xml': strToU8(
        `<worksheet ${main}><sheetData>` +
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
          '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>0.42</v></c></row>' +
          '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>0.38</v></c></row>' +
          '</sheetData></worksheet>',
      ),
      'xl/worksheets/sheet2.xml': strToU8(
        `<worksheet ${main}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Read on</t></is></c><c r="B1" s="1"><v>46325</v></c></row></sheetData></worksheet>`,
      ),
    }),
  );
}

test('an attached Excel workbook can be previewed, sheet by sheet, and inserted as a table', async ({ page }) => {
  const errors = trackErrors(page);
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Growth');
  await page.locator('.ProseMirror').click();
  await attach(page, [
    { name: 'plate reader.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: workbook() },
  ]);
  await expect(page.locator('.gc-file-name')).toHaveText('plate reader.xlsx');
  await page.locator('.gc-file').getByRole('button', { name: 'Preview' }).click();
  const preview = page.locator('.gc-xlsx');
  await expect(preview.getByRole('tab', { name: 'OD600' })).toHaveAttribute('aria-selected', 'true');
  await expect(preview.locator('thead th')).toHaveText(['', 'A', 'B']);
  await expect(preview.locator('tbody tr').nth(1)).toHaveText(['2', 'Wild type', '0.42'].join(''));
  await expect(preview.locator('td.is-num').first()).toHaveText('0.42');
  await expect(preview.locator('.gc-csv-foot')).toContainText('3 rows × 2 columns');
  await preview.getByRole('tab', { name: 'Plate map' }).click();
  await expect(preview.locator('tbody td')).toHaveText(['Read on', '2026-10-30']);
  await preview.getByRole('tab', { name: 'OD600' }).click();
  await preview.getByRole('button', { name: 'Insert as table' }).click();
  await expect(page.locator('.gc-sheet')).toBeVisible();
  await waitForSave(page);
  expect(await readFile(page, pathOf(page))).toMatch(/\| Strain\s*\| OD600\s*\|/);
  await page.locator('.gc-file').getByRole('button', { name: 'Hide preview' }).click();
  await expect(preview).toHaveCount(0);
  expect(errors).toEqual([]);
});
