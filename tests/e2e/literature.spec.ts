import { test, expect, type Page } from '@playwright/test';
import { listFiles, newBlankEntry, openFolderNotebook, readFile, trackErrors, waitForSave } from './helpers';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = trackErrors(page);
});
test.afterEach(() => {
  expect(errors, 'uncaught errors in the page').toEqual([]);
});

const JINEK = 'Literature/Jinek2012 A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity.md';

/** Crossref and PubMed are not reachable from the test machine: these are their answers, recorded. */
async function mockLookups(page: Page) {
  const sent: string[] = [];
  await page.route('https://api.crossref.org/**', (route) => {
    sent.push(route.request().url());
    if (!route.request().url().endsWith('/10.1126/science.1231143')) return route.fulfill({ status: 404, body: 'Resource not found.' });
    return route.fulfill({
      json: {
        status: 'ok',
        message: {
          DOI: '10.1126/science.1231143',
          title: ['Multiplex Genome Engineering Using CRISPR/Cas Systems'],
          author: [
            { given: 'Le', family: 'Cong', sequence: 'first' },
            { given: 'F. Ann', family: 'Ran' },
            { given: 'David', family: 'Cox' },
            { given: 'Feng', family: 'Zhang' },
          ],
          'container-title': ['Science'],
          volume: '339',
          issue: '6121',
          page: '819-823',
          'published-print': { 'date-parts': [[2013, 2, 15]] },
          URL: 'https://doi.org/10.1126/science.1231143',
          abstract: '<jats:p>Functional elucidation of causal genetic variants and elements requires precise genome editing technologies.</jats:p>',
        },
      },
    });
  });
  await page.route('https://eutils.ncbi.nlm.nih.gov/**', (route) => {
    sent.push(route.request().url());
    return route.fulfill({
      json: {
        result: {
          uids: ['23287722'],
          '23287722': {
            uid: '23287722',
            pubdate: '2013 Feb 15',
            source: 'Science',
            authors: [
              { name: 'Mali P', authtype: 'Author' },
              { name: 'Yang L', authtype: 'Author' },
              { name: 'Church GM', authtype: 'Author' },
            ],
            title: 'RNA-guided human genome engineering via Cas9.',
            volume: '339',
            issue: '6121',
            pages: '823-6',
            articleids: [
              { idtype: 'pubmed', value: '23287722' },
              { idtype: 'doi', value: '10.1126/science.1232033' },
            ],
          },
        },
      },
    });
  });
  return sent;
}

test('literature: add a paper by DOI, keep notes on it, and see where it is cited', async ({ page }) => {
  const sent = await mockLookups(page);
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Literature' }).click();
  await expect(page.locator('.gc-literature-page h1')).toHaveText('Literature');
  // A new notebook has one paper, cited by the example entry.
  const jinek = page.locator('.gc-paper-row', { hasText: 'Jinek et al., 2012' });
  await expect(jinek).toContainText('A programmable dual-RNA-guided DNA endonuclease');
  await expect(jinek).toContainText('cited in 1');

  await page.getByRole('button', { name: 'Add paper' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('DOI or PubMed ID').fill('https://doi.org/10.1126/science.1231143');
  await dialog.getByRole('button', { name: 'Look up' }).click();
  await expect(dialog.locator('#paper-title')).toHaveValue('Multiplex Genome Engineering Using CRISPR/Cas Systems');
  await expect(dialog.locator('#paper-authors')).toHaveValue('Cong, Le\nRan, F. Ann\nCox, David\nZhang, Feng');
  await expect(dialog.locator('#paper-pages')).toHaveValue('819–823');
  await expect(dialog.locator('#paper-year')).toHaveValue('2013');
  // The authors box is tall enough for all four.
  await expect(dialog.locator('#paper-authors')).toHaveAttribute('rows', '4');
  // Only the DOI went out.
  expect(sent).toEqual(['https://api.crossref.org/works/10.1126/science.1231143']);
  await dialog.getByRole('button', { name: 'Add paper', exact: true }).click();
  await expect(page.locator('.gc-paper-row', { hasText: 'Cong et al., 2013' })).toContainText('not cited yet');

  const file = 'Literature/Cong2013 Multiplex Genome Engineering Using CRISPR Cas Systems.md';
  await expect.poll(() => listFiles(page, 'Literature')).toContain(file.split('/')[1]);
  const md = await readFile(page, file);
  expect(md).toContain('id: Cong2013\nkind: reference\ntitle: Multiplex Genome Engineering Using CRISPR/Cas Systems\n');
  expect(md).toContain(
    'authors:\n  - Cong, Le\n  - Ran, F. Ann\n  - Cox, David\n  - Zhang, Feng\nyear: 2013\njournal: Science\nvolume: 339\nissue: 6121\npages: 819–823\ndoi: 10.1126/science.1231143\n',
  );
  expect(md).toContain('## Abstract\n\nFunctional elucidation of causal genetic variants');

  // The same DOI again: it is already in the library.
  await page.getByRole('button', { name: 'Add paper' }).first().click();
  await dialog.getByLabel('DOI or PubMed ID').fill('10.1126/science.1231143');
  await dialog.getByRole('button', { name: 'Look up' }).click();
  await expect(dialog.locator('.gc-paper-dup')).toContainText('Already in your library as Cong et al., 2013');
  // Right under the look-up, where you are looking, not below the form.
  expect((await dialog.locator('.gc-paper-dup').boundingBox())!.y).toBeLessThan((await dialog.locator('#paper-title').boundingBox())!.y);
  await dialog.getByRole('button', { name: 'Open it' }).click();

  // Its page: the reference, links out, and reading notes as the body.
  await expect(page.locator('.gc-doc-kicker')).toContainText('Cong2013');
  await expect(page.locator('.gc-doc-kicker')).toContainText('Paper');
  await expect(page.locator('.gc-crumbs')).toContainText('Literature');
  await expect(page.locator('.gc-props .gc-prop-label')).toHaveText(['Reading', 'Authors', 'Journal', 'DOI', 'Tags', 'Cited in']);
  await expect(page.locator('.gc-paper-authors')).toHaveText('Le Cong, F. Ann Ran, David Cox, Feng Zhang');
  await expect(page.locator('.gc-props')).toContainText('Science, 2013; 339(6121): 819–823');
  await expect(page.getByRole('link', { name: /10\.1126\/science\.1231143/ })).toHaveAttribute('href', 'https://doi.org/10.1126/science.1231143');
  await expect(page.locator('.gc-props')).toContainText('Not cited yet');

  // A DOI that does not exist, and no connection.
  await page.locator('.gc-nav-item', { hasText: 'Literature' }).click();
  await page.getByRole('button', { name: 'Add paper' }).first().click();
  await dialog.getByLabel('DOI or PubMed ID').fill('10.9999/nothing');
  await dialog.getByRole('button', { name: 'Look up' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('No paper found with the DOI 10.9999/nothing.');
  await page.route('https://api.crossref.org/**', (route) => route.abort('internetdisconnected'));
  await dialog.getByRole('button', { name: 'Look up' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Could not reach Crossref. Are you offline?');
  await dialog.getByLabel('DOI or PubMed ID').fill('not an id');
  await dialog.getByRole('button', { name: 'Look up' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Type a DOI');
});

test('cite a paper from an entry: a link to it, listed under "Cited in"', async ({ page }) => {
  await mockLookups(page);
  await openFolderNotebook(page);
  await newBlankEntry(page, 'Guide design');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Guides designed as in ');
  await page.keyboard.type('/cite');
  await expect(page.locator('.gc-slash-item, .menu-item').filter({ hasText: 'Cite a paper' }).first()).toBeVisible();
  await page.keyboard.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Cite a paper' });
  // Papers are found by author and year too.
  await picker.getByRole('textbox').fill('doudna 2012');
  await expect(picker.locator('.gc-picker-item')).toHaveCount(1);
  await expect(picker.locator('.gc-picker-item')).toContainText('Jinek et al., 2012 · Science');
  // A search that finds nothing says so (the library is not empty).
  await picker.getByRole('textbox').fill('base editing');
  await expect(picker.locator('.empty-state')).toHaveText('Nothing matches “base editing”.');
  await picker.getByRole('textbox').fill('doudna 2012');
  await page.keyboard.press('Enter');
  await expect(page.locator('.ProseMirror a', { hasText: 'Jinek et al., 2012' })).toBeVisible();
  // Typing goes on after the citation.
  await expect(page.locator('.ProseMirror')).toBeFocused();

  // A paper that is not in the library yet: add it by its PubMed ID from the picker, and it is cited.
  await page.keyboard.type('and ');
  await page.keyboard.type('/cite');
  await page.keyboard.press('Enter');
  await picker.getByRole('textbox').fill('23287722');
  await expect(picker.locator('.gc-picker-item')).toHaveCount(0);
  await picker.getByRole('button', { name: /Add a paper/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a paper' });
  await expect(dialog.locator('#paper-title')).toHaveValue('RNA-guided human genome engineering via Cas9');
  await expect(dialog.locator('#paper-authors')).toHaveValue('Mali, P\nYang, L\nChurch, GM');
  await expect(dialog.locator('#paper-doi')).toHaveValue('10.1126/science.1232033');
  await dialog.getByRole('button', { name: 'Add paper', exact: true }).click();
  await expect(page.locator('.ProseMirror a', { hasText: 'Mali et al., 2013' })).toBeVisible();
  await waitForSave(page);

  const md = await readFile(page, 'Projects/General/EXP-0001 Guide design.md');
  expect(md).toContain(
    'Guides designed as in [Jinek et al., 2012](../../Literature/Jinek2012%20A%20programmable%20dual-RNA-guided%20DNA%20endonuclease%20in%20adaptive%20bacterial%20immunity.md) and [Mali et al., 2013](../../Literature/Mali2013%20RNA-guided%20human%20genome%20engineering%20via%20Cas9.md)',
  );
  expect(await readFile(page, 'Literature/Mali2013 RNA-guided human genome engineering via Cas9.md')).toContain('pmid: 23287722');

  // A click on the citation opens the paper, which lists where it is cited.
  await page.locator('.ProseMirror a', { hasText: 'Jinek et al., 2012' }).click();
  await expect(page.locator('.gc-title-input')).toHaveValue('A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity');
  const citedIn = page.locator('.gc-prop', { hasText: 'Cited in' });
  await expect(citedIn.locator('.gc-backlink')).toHaveCount(2);
  await expect(citedIn).toContainText('EXP-0001Guide design');
  await expect(citedIn).toContainText('EXAMPLE-1');
  expect(await readFile(page, JINEK)).toContain('pmid: 22745249');
});

test('import papers from BibTeX and RIS, and export the library as BibTeX', async ({ page }) => {
  await openFolderNotebook(page);
  await page.locator('.gc-nav-item', { hasText: 'Literature' }).click();
  await page.getByRole('button', { name: 'Literature options' }).click();
  await page.getByRole('menuitem', { name: 'Import BibTeX or RIS…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a paper' });
  await dialog.locator('#paper-bib').fill(`% From Zotero
@article{doudna_new_2014,
  title = {The new frontier of genome engineering with {CRISPR}-{Cas9}},
  author = {Doudna, Jennifer A. and Charpentier, Emmanuelle},
  journal = {Science},
  year = {2014},
  volume = {346},
  number = {6213},
  pages = {1258096},
  doi = {10.1126/science.1258096}
}
@article{jinek_programmable_2012,
  title = {A programmable dual-{RNA}-guided {DNA} endonuclease in adaptive bacterial immunity},
  author = {Jinek, Martin and Chylinski, Krzysztof},
  year = {2012},
  doi = {10.1126/science.1225829}
}

TY  - JOUR
AU  - Hsu, Patrick D.
AU  - Lander, Eric S.
AU  - Zhang, Feng
TI  - Development and applications of CRISPR-Cas9 for genome engineering
JO  - Cell
PY  - 2014
VL  - 157
IS  - 6
SP  - 1262
EP  - 1278
DO  - 10.1016/j.cell.2014.05.010
ER  - `);
  await expect(dialog.getByRole('status')).toHaveText('3 papers: Doudna & Charpentier, 2014 · Jinek & Chylinski, 2012 · Hsu et al., 2014');
  await dialog.getByRole('button', { name: 'Import 3 papers' }).click();
  // The Jinek paper is already in the library (same DOI): it is skipped.
  await expect(page.locator('.toast').last()).toContainText('Imported 2 papers (1 paper already in your library)');
  await expect(page.locator('.gc-paper-row')).toHaveCount(3);
  // A key from the BibTeX file is kept.
  await expect
    .poll(() => listFiles(page, 'Literature'))
    .toEqual([
      'Hsu2014 Development and applications of CRISPR-Cas9 for genome engineering.md',
      'Jinek2012 A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity.md',
      'doudna_new_2014 The new frontier of genome engineering with CRISPR-Cas9.md',
    ]);

  await page.getByLabel('Filter papers').fill('cell 2014');
  await expect(page.locator('.gc-paper-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Literature options' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export this paper as BibTeX' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Literature.bib');
  const bib = await (await file.createReadStream()).toArray();
  expect(Buffer.concat(bib).toString('utf8')).toBe(
    '@article{Hsu2014,\n  title = {Development and applications of CRISPR-Cas9 for genome engineering},\n  author = {Hsu, Patrick D. and Lander, Eric S. and Zhang, Feng},\n  journal = {Cell},\n  year = {2014},\n  volume = {157},\n  number = {6},\n  pages = {1262--1278},\n  doi = {10.1016/j.cell.2014.05.010}\n}\n',
  );
});

test('a web page as a reference shows its year and link, not a journal', async ({ page }) => {
  await openFolderNotebook(page, { seed: false });
  await page.locator('.gc-nav-item', { hasText: 'Literature' }).click();
  await page.getByRole('button', { name: 'Import BibTeX or RIS' }).click();
  await page
    .locator('#paper-bib')
    .fill('@misc{addgene2020, title = {Addgene CRISPR guide}, author = {Addgene}, year = {2020}, url = {https://www.addgene.org/guides/crispr/}}');
  await page.getByRole('button', { name: 'Import paper' }).click();
  await page.locator('.gc-paper-row .gc-note-open').click();
  await expect(page.locator('.gc-props .gc-prop-label')).toHaveText(['Reading', 'Authors', 'Year', 'Link', 'Tags', 'Cited in']);
  await expect(page.getByRole('link', { name: /addgene\.org/ })).toHaveAttribute('href', 'https://www.addgene.org/guides/crispr/');
});
