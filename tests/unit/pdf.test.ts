// @vitest-environment node
/**
 * PDF → protocol conversion. The fixtures in tests/fixtures/pdf are real PDFs made by different
 * tools (Word-style via LibreOffice, Chromium, ReportLab) — see tests/fixtures/pdf/README.md.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { DOCUMENT_OPTIONS, extractDocument, type PdfLib } from '../../src/pdf/extract';
import { pdfToDoc, titleFromFileName, type PdfConversion } from '../../src/pdf/layout';
import type { PdfPageData, PdfText } from '../../src/pdf/types';
import { serializeMarkdown } from '../../src/markdown/serialize';
import { parseMarkdown } from '../../src/markdown/parse';
import { docSchema } from '../../src/editor/schema';

const md = (conv: PdfConversion) => serializeMarkdown(docSchema().nodeFromJSON(conv.doc));

async function convert(name: string) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(`tests/fixtures/pdf/${name}`)), ...DOCUMENT_OPTIONS }).promise;
  try {
    const { info, pages } = await extractDocument(pdfjs as unknown as PdfLib, doc);
    const conv = pdfToDoc(pages, info, name);
    return { conv, md: md(conv) };
  } finally {
    await doc.loadingTask.destroy();
  }
}

/** The order in which snippets appear in the text (throws if one is missing). */
function order(text: string, ...snippets: string[]) {
  return snippets.map((s) => {
    const i = text.indexOf(s);
    if (i < 0) throw new Error(`Missing: ${s}`);
    return i;
  });
}
const increasing = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]);

describe('PDF fixtures', () => {
  it('converts a Word-style SOP: tables with borders, numbered steps across sections, figure, header and footer', async () => {
    const { conv, md } = await convert('inoue-word.pdf');
    expect(conv.title).toBe('Chemically competent E. coli by the Inoue method');
    expect(md).toContain('| Version | Author | Effective | Review by |');
    expect(md).toContain('| Inoue transformation buffer (ITB) | 80 ml, ice-cold | see section 4 |');
    expect(md).toContain('| SOB medium | 250 ml per prep, autoclaved and pre-warmed to 18 °C before inoculation | Prepared in-house |');
    expect(md).toContain('## 2. Materials and reagents');
    expect(md).toContain('### 3.1 Growing the cells');
    expect(md).toMatch(/^1\. Streak DH5α/m);
    expect(md).toMatch(/^ {3}1\. Measure every 45 min/m);
    // Numbering continues after the sub-heading.
    expect(md).toMatch(/^4\. Transfer the flask to an ice-water bath/m);
    expect(md).toContain('**Note:** work quickly');
    expect(md).toContain('1–3 × 10<sup>8</sup> cfu');
    expect(md).toContain('- 55 mM MnCl₂');
    expect(md).toContain('![](figure:p2-1)');
    expect(conv.figures.map((f) => f.id)).toEqual(['p2-1']);
    // Running header, logo and "Page x of y" are gone.
    expect(md).not.toContain('SOP-021');
    expect(md).not.toMatch(/Page \d of \d/);
    expect(conv.stats).toMatchObject({ pages: 3, tables: 2, figures: 1 });
  });

  it('converts a Chromium PDF: links, nested sub-steps, drawn bullets, code, two columns', async () => {
    const { conv, md } = await convert('gibson-chromium.pdf');
    expect(conv.title).toBe('Gibson assembly of three fragments');
    expect(md).toContain('See [the NEB protocol](https://www.neb.com/en-us/protocols/gibson) for details.');
    expect(md).toContain('| Insert fragments | 2.0 | 3:1 molar ratio to the vector backbone, adjusted by length |');
    expect(md).toMatch(/^ {3}2\. For 4–6 fragments, incubate 60 min\./m);
    expect(md).toContain('(10<sup>8</sup> cfu/μg)');
    expect(md).toContain('5% CO<sub>2</sub>-free');
    expect(md).toContain('- No colonies: check the competent cells');
    expect(md).toContain('`primer3 --overlap 25`');
    expect(md).toContain('*Figure 1. Colony PCR of four clones; expected band at 1.2 kb.*');
    // Two-column text is read column by column, across the page break.
    expect(
      increasing(
        order(md, 'The left column continues', 'primers, overlaps and the assembly temperature', 'Keep the overlaps', 'The right column should'),
      ),
    ).toBe(true);
    expect(md).not.toContain('Smith Lab SOP');
  });

  it('converts a ReportLab PDF: restarted numbering, super- and subscripts, header lines that are not repeated', async () => {
    const { conv, md } = await convert('miniprep-reportlab.pdf');
    expect(conv.title).toBe('Plasmid miniprep (alkaline lysis)');
    expect(md).toContain('**Purpose:** isolate high-copy plasmid DNA from 1.5–5 ml of *E. coli* overnight culture.');
    expect(md).toMatch(/^4\. Add 350 μl Buffer N3/m);
    expect(md).toContain('Use 10<sup>6</sup> cells per prep; CO<sub>2</sub> is not required.');
    // Body text near the bottom and top of pages is kept (only repeated headers/footers are dropped).
    for (let i = 1; i <= 12; i++) expect(md).toContain(`Filler paragraph ${i} to push`);
    expect(md).not.toContain('Standard operating procedure');
    expect(md).not.toContain('Page 1 of 2');
  });

  it('reads a two-column paper with hyphenation in order', async () => {
    const { conv, md } = await convert('paper-two-column.pdf');
    expect(conv.title).toBe('Rapid one-pot assembly of lentiviral vectors');
    expect(md).toContain('A. Researcher<sup>1</sup>, B. Scientist<sup>1,2</sup> and C. Professor<sup>2</sup>');
    expect(md).toContain('10% fetal bovine serum.<sup>3</sup> The cells');
    expect(md).not.toMatch(/Trans[-‐] fection|phos[-‐] phate|tri[-‐] plicates/);
    expect(md).toContain('phosphate-buffered saline');
    expect(increasing(order(md, '## 2 Methods', '2.1 Cell culture', 'HEK293T cells', '2.2 Lentivirus production'))).toBe(true);
  });

  it('converts a kit handbook: cover title and subtitle, contents page, tables without side borders', async () => {
    const { conv, md } = await convert('kit-manual.pdf');
    expect(conv.title).toBe('PlasmidPure Mini Kit');
    expect(conv.description).toBe('Handbook for the purification of plasmid DNA');
    expect(md).not.toContain('.....');
    expect(md).toContain('| Component | 50 preps | 250 preps |');
    expect(md).toContain(
      '| Low yield | The culture was too old or the lysis was incomplete. Use fresh cultures and mix thoroughly after adding Buffer L2. |',
    );
    expect(md).toContain('| RNA in the eluate | RNase A was not added');
    expect(md).toContain('**Important:** add the supplied RNase A');
    expect(md).toMatch(
      /^3\. Add 250 μl Buffer L2 and mix thoroughly by inverting the tube 4–6 times until the solution becomes clear\. Do not allow/m,
    );
    expect(md).toContain('*Optional:* wash the column');
    expect(md).toMatch(/^5\. Elute the DNA in 50 μl of water\./m);
    expect(md).not.toContain('Handbook 06/2026');
  });

  it('turns the pages of a scanned PDF into images', async () => {
    const { conv, md } = await convert('scanned.pdf');
    expect(conv.scanned).toBe(true);
    expect(conv.title).toBe('scanned');
    expect(conv.figures).toEqual([{ id: 'p1', page: 0, box: expect.anything(), wholePage: true }]);
    expect(md).toContain('![Page 1](figure:p1)');
  });

  it('round-trips through Markdown: tables keep their column widths', async () => {
    const { md } = await convert('inoue-word.pdf');
    expect(md).toMatch(/<!-- gc:table \{"w":\[\d+,\d+,\d+\]\} -->/);
    const again = serializeMarkdown(parseMarkdown(md));
    expect(again).toBe(md);
  });
});

// ───────────── Synthetic pages ─────────────

type Spec = { t: string; x?: number; y: number; size?: number; f?: 'r' | 'b' | 'i'; w?: number };

function page(index: number, specs: Spec[]): PdfPageData {
  const texts: PdfText[] = specs.map((s) => ({
    str: s.t,
    x: s.x ?? 72,
    y: s.y,
    size: s.size ?? 10,
    w: s.w ?? s.t.length * (s.size ?? 10) * 0.5,
    font: s.f ?? 'r',
  }));
  return {
    index,
    width: 595,
    height: 842,
    texts,
    fonts: {
      r: { name: 'Arial', bold: false, italic: false, mono: false },
      b: { name: 'Arial-Bold', bold: true, italic: false, mono: false },
      i: { name: 'Arial-Italic', bold: false, italic: true, mono: false },
    },
    dots: [],
    rules: [],
    vrules: [],
    images: [],
    links: [],
  };
}

/** Lines of body text, 12 pt apart, starting at y. */
const body = (y: number, ...lines: string[]): Spec[] => lines.map((t, i) => ({ t, y: y + i * 12 }));
const convertPages = (...pages: PdfPageData[]) => md(pdfToDoc(pages, {}, 'test.pdf'));

describe('PDF layout rules', () => {
  it('drops running headers, footers and page numbers but keeps the rest', () => {
    const text = ['Pellet the cells and remove the supernatant.', 'Resuspend the pellet in lysis buffer.', 'Paragraph on page 3 ends here.'];
    const pages = [0, 1, 2].map((i) =>
      page(i, [{ t: 'Lab manual | Confidential', y: 30, size: 8 }, ...body(76, text[i]), { t: `${i + 1}`, x: 290, y: 810, size: 8 }]),
    );
    const out = convertPages(...pages);
    expect(out).not.toContain('Lab manual');
    expect(out).not.toMatch(/^\d$/m);
    expect(out).toContain('Paragraph on page 3');
  });

  it('rejoins words split at the end of a line', () => {
    const out = convertPages(
      page(
        0,
        body(
          100,
          'Cells were washed and the transfor-',
          'mation mix was added to the DNA-',
          'binding buffer with 50 mM of Tris-',
          'HCl and some double-stranded and a double-',
          'stranded oligo; the oligos work best.',
        ),
      ),
    );
    expect(out).toContain('the transformation mix');
    expect(out).toContain('DNA-binding buffer');
    expect(out).toContain('50 mM of Tris-HCl and');
    expect(out).toContain('a double-stranded oligo');
  });

  it('recognises step markers, nesting, checklists, and not decimals', () => {
    const out = convertPages(
      page(0, [
        { t: 'Step 3: Add the enzyme mix.', y: 100 },
        { t: 'Step 4: Incubate for 1 h.', y: 116 },
        { t: 'a) at 37 °C for most enzymes;', x: 90, y: 132 },
        { t: 'b) at 50 °C for BsaI-HF.', x: 90, y: 148 },
        { t: 'Step 5: Heat-inactivate.', y: 164 },
        { t: 'Checklist before you start', y: 200, f: 'b' },
        { t: '☐ Label the tubes', y: 220 },
        { t: '☑ Thaw the buffers', y: 236 },
        { t: '1.5 ml of buffer is enough for ten reactions and keeps for a month at 4 °C in the dark.', y: 270 },
      ]),
    );
    expect(out).toMatch(/^3\. Add the enzyme mix\.\n4\. Incubate for 1 h\.\n {3}1\. at 37 °C/m);
    expect(out).toMatch(/^5\. Heat-inactivate\./m);
    expect(out).toContain('- [ ] Label the tubes');
    expect(out).toContain('- [x] Thaw the buffers');
    expect(out).toMatch(/^1\.5 ml of buffer is enough/m);
  });

  it('makes headings from bigger and bold text, and takes the biggest as the title', () => {
    const conv = pdfToDoc(
      [
        page(0, [
          { t: 'Western blot', y: 80, size: 22, f: 'b' },
          { t: 'Transfer', y: 130, size: 14, f: 'b' },
          ...body(150, 'Assemble the sandwich without bubbles between the gel and the membrane.'),
          { t: 'Wet transfer', y: 190, f: 'b' },
          ...body(206, 'Run at 100 V for 60 min in the cold room with an ice pack in the tank.'),
        ]),
      ],
      { title: 'Microsoft Word - WB.docx' },
      'wb.pdf',
    );
    expect(conv.title).toBe('Western blot');
    const out = md(conv);
    expect(out).not.toContain('Western blot');
    expect(out).toMatch(/^## Transfer$/m);
    expect(out).toMatch(/^### Wet transfer$/m);
  });

  it('leaves out contents pages', () => {
    const out = convertPages(
      page(0, [
        { t: 'Contents', y: 80, size: 14, f: 'b' },
        { t: 'Kit contents .................... 3', y: 110 },
        { t: 'Protocol ........................ 5', y: 126 },
        ...body(160, 'Read the whole handbook before you start the first preparation of the day.'),
      ]),
    );
    expect(out).not.toContain('....');
    expect(out).not.toContain('Contents');
    expect(out).toContain('Read the whole handbook');
  });

  it('uses the PDF title, else the file name', () => {
    expect(pdfToDoc([page(0, body(100, 'Some text.'))], { title: 'Microsoft Word - SOP_Gel_extraction.docx' }, 'x.pdf').title).toBe(
      'SOP Gel extraction',
    );
    expect(pdfToDoc([page(0, body(100, 'Some text.'))], { title: 'untitled' }, 'Gel_extraction_v2.pdf').title).toBe('Gel extraction v2');
    expect(titleFromFileName('PCR.pdf')).toBe('PCR');
  });
});
