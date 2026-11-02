import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { Slice, type Node as PMNode } from '@tiptap/pm/model';
import { parseMarkdown } from '../../src/markdown/parse';
import { serializeMarkdown } from '../../src/markdown/serialize';
import { docSchema } from '../../src/editor/schema';
import { legacySpellings, safeDecode } from '../../src/lib/path';
import { VAULT_PREFIX, markCopiedFiles, resolvePastedFiles } from '../../src/editor/clipboardFiles';
import type { Vault } from '../../src/fs/types';
import { cellIndex, columnName, formatKind, openXlsx, serialToText } from '../../src/lib/xlsx';
import { guessLanguage, highlightSpans } from '../../src/editor/codeHighlight';
import { languageValue } from '../../src/editor/codeBlock';

const schema = docSchema();
const p = (t: string) => schema.nodes.paragraph.create(null, t ? schema.text(t) : undefined);
const att = (name: string, src = `attachments/EXP-0001/${name}`) => schema.nodes.attachment.create({ src, name });
const img = (name: string, src = `attachments/EXP-0001/${name}`) => schema.nodes.image.create({ src, alt: name });

function files(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((n) => {
    if (n.type.name === 'attachment' || n.type.name === 'image') out.push(`${n.type.name}:${n.attrs.src}`);
  });
  return out;
}

/** Save and reopen twice, as a file is over the days it is used. */
function reopened(doc: PMNode) {
  const md = serializeMarkdown(doc);
  const once = parseMarkdown(md);
  const md2 = serializeMarkdown(once);
  return { md, md2, again: parseMarkdown(md2) };
}

describe('files stay in their entry after saving and reopening', () => {
  const names = [
    'gel.png',
    'gel (2).png',
    'Western blot #3.tif',
    'data#1.xlsx',
    'sample #12 final.pdf',
    'what?.pdf',
    '50% glycerol.pdf',
    'pct%20.pdf',
    'a[1].csv',
    'é gel.png',
    'üñí.xlsx',
    "it's.pdf",
    'a&b.png',
    'my  double.pdf',
    'x_y*z.pdf',
    'a`b.pdf',
    'plus+.pdf',
    'semi;colon.png',
    'brace{}.pdf',
    'hat^.pdf',
  ];
  for (const name of names) {
    for (const where of ['top', 'list', 'task', 'quote'] as const) {
      it(`${name} (${where})`, () => {
        for (const make of [att, img]) {
          const node = make(name);
          const block =
            where === 'top'
              ? node
              : where === 'list'
                ? schema.nodes.bulletList.create(null, schema.nodes.listItem.create(null, [p('a'), node]))
                : where === 'task'
                  ? schema.nodes.taskList.create(null, schema.nodes.taskItem.create({ checked: false }, [p('a'), node]))
                  : schema.nodes.blockquote.create(null, [p('a'), node]);
          const doc = schema.nodes.doc.create(null, [p('before'), block, p('after')]);
          const { md, md2, again } = reopened(doc);
          expect(files(again), md).toEqual(files(doc));
          expect(md2).toBe(md);
        }
      });
    }
  }

  it('keeps files side by side, after headings and with Markdown characters in their names', () => {
    const doc = schema.nodes.doc.create(null, [
      p('before'),
      att('a.pdf'),
      att('b.pdf'),
      img('c.png'),
      att('d.pdf'),
      schema.nodes.heading.create({ level: 2 }, schema.text('Results')),
      att('e.pdf'),
      schema.nodes.attachment.create({ src: 'attachments/EXP-0001/f.pdf', name: 'My *final* _data_ [v2]' }),
      p('after'),
    ]);
    const { md, md2, again } = reopened(doc);
    expect(files(again)).toEqual(files(doc));
    expect(md2).toBe(md);
    let name = '';
    again.descendants((n) => {
      if (n.attrs.src === 'attachments/EXP-0001/f.pdf') name = n.attrs.name;
    });
    expect(name).toBe('My *final* _data_ [v2]');
  });

  it('keeps a Markdown file attached to an entry as a file, and a link to a page as a link', () => {
    const doc = parseMarkdown('[notes.md](attachments/EXP-0001/notes.md)\n\n[EXP-0002](EXP-0002%20Cloning.md)\n');
    expect(files(doc)).toEqual(['attachment:attachments/EXP-0001/notes.md']);
  });

  it('decodes # and ? in links, and leaves a bare % alone', () => {
    expect(safeDecode('attachments/EXP-0001/data%231.xlsx')).toBe('attachments/EXP-0001/data#1.xlsx');
    expect(safeDecode('what%3F.pdf')).toBe('what?.pdf');
    expect(safeDecode('50% glycerol.pdf')).toBe('50% glycerol.pdf');
    expect(safeDecode('pct%2520.pdf')).toBe('pct%20.pdf');
  });

  it('finds links saved before the fix under their older spellings', () => {
    // Saved once: "%23" left in; saved again: "%2523".
    expect(legacySpellings('attachments/EXP-0001/data%231.xlsx')).toEqual(['attachments/EXP-0001/data#1.xlsx']);
    expect(legacySpellings('attachments/EXP-0001/data%25231.xlsx')).toEqual([
      'attachments/EXP-0001/data%231.xlsx',
      'attachments/EXP-0001/data#1.xlsx',
    ]);
    expect(legacySpellings('attachments/EXP-0001/gel.png')).toEqual([]);
    // What such an entry reads as now: the old spelling, which the file view then repairs.
    const old = parseMarkdown('[data#1.xlsx](attachments/EXP-0001/data%25231.xlsx)\n');
    expect(files(old)).toEqual(['attachment:attachments/EXP-0001/data%231.xlsx']);
  });
});

describe('copying file blocks between entries', () => {
  const slice = (...nodes: PMNode[]) => new Slice(schema.nodes.doc.create(null, nodes).content, 0, 0);
  const linked = (text: string, href: string) => p('').type.create(null, schema.text(text, [schema.marks.link.create({ href })]));
  const srcs = (s: Slice) => {
    const out: string[] = [];
    s.content.descendants((n) => {
      if (n.type.name === 'attachment' || n.type.name === 'image') out.push(n.attrs.src);
      for (const m of n.marks) if (m.type.name === 'link') out.push(`link:${m.attrs.href}`);
    });
    return out;
  };
  const mine = { id: 'my notebook', kind: 'folder' } as unknown as Vault;
  const theirs = { id: 'server:ana', kind: 'folder' } as unknown as Vault;
  const from = { vault: mine, folder: 'Projects/CRISPR', docId: 'EXP-0001', path: 'Projects/CRISPR/EXP-0001 Cut.md' };
  const at = (path: string, vault = mine) => `${VAULT_PREFIX}${encodeURIComponent(vault.id)}:${path}`;

  it('marks each file with its notebook and place on copy', () => {
    const copied = markCopiedFiles(slice(att('gel #2.pdf'), img('blot.png'), linked('EXP-0003', 'EXP-0003 Repeat.md#Results')), from);
    expect(srcs(copied)).toEqual([
      at('Projects/CRISPR/attachments/EXP-0001/gel #2.pdf'),
      at('Projects/CRISPR/attachments/EXP-0001/blot.png'),
      `link:${at('Projects/CRISPR/EXP-0003 Repeat.md')}#Results`,
    ]);
    // URLs are left alone.
    expect(srcs(markCopiedFiles(slice(linked('NEB', 'https://neb.com')), from))).toEqual(['link:https://neb.com']);
  });

  it('pasted into another entry, files are listed to copy there and links are written from its folder', () => {
    const copied = markCopiedFiles(slice(att('gel #2.pdf'), img('blot.png'), linked('EXP-0003', 'EXP-0003 Repeat.md')), from);
    const to = { vault: mine, folder: 'Projects/Imaging', docId: 'EXP-0009', path: 'Projects/Imaging/EXP-0009 Scope.md' };
    const { slice: pasted, copies } = resolvePastedFiles(copied, to);
    expect(copies.map((c) => [c.notebook, c.path])).toEqual([
      ['my notebook', 'Projects/CRISPR/attachments/EXP-0001/gel #2.pdf'],
      ['my notebook', 'Projects/CRISPR/attachments/EXP-0001/blot.png'],
    ]);
    // Until the copies are made, the blocks show the originals.
    expect(srcs(pasted)).toEqual([
      '../CRISPR/attachments/EXP-0001/gel #2.pdf',
      '../CRISPR/attachments/EXP-0001/blot.png',
      'link:../CRISPR/EXP-0003 Repeat.md',
    ]);
  });

  it('pasted back into the same entry, nothing is copied', () => {
    const copied = markCopiedFiles(slice(att('gel.pdf')), from);
    const { slice: pasted, copies } = resolvePastedFiles(copied, from);
    expect(copies).toEqual([]);
    expect(srcs(pasted)).toEqual(['attachments/EXP-0001/gel.pdf']);
  });

  it('pasted from another notebook (a PI reading a member’s), files wait for their copy and links to its pages become text', () => {
    const copied = markCopiedFiles(slice(att('gel.pdf'), linked('EXP-0003', 'EXP-0003 Repeat.md')), { ...from, vault: theirs });
    const { slice: pasted, copies } = resolvePastedFiles(copied, from);
    // The same path in this notebook is another entry's file: it is not shown meanwhile.
    expect(copies).toEqual([
      {
        notebook: 'server:ana',
        path: 'Projects/CRISPR/attachments/EXP-0001/gel.pdf',
        shown: at('Projects/CRISPR/attachments/EXP-0001/gel.pdf', theirs),
      },
    ]);
    expect(srcs(pasted)).toEqual([at('Projects/CRISPR/attachments/EXP-0001/gel.pdf', theirs)]);
    let text = '';
    pasted.content.descendants((n) => {
      if (n.isText) text += n.text;
    });
    expect(text).toBe('EXP-0003');
  });
});

/** A small workbook, as Excel writes one. */
function workbook(opts: { prefix?: string } = {}) {
  const x = opts.prefix ? `${opts.prefix}:` : '';
  const ns = opts.prefix ? `xmlns:${opts.prefix}` : 'xmlns';
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'xl/workbook.xml': strToU8(
      `<${x}workbook ${ns}="${main}" xmlns:r="${rel}"><${x}sheets><${x}sheet name="Results" sheetId="1" r:id="rId1"/><${x}sheet name="Plate map" sheetId="2" r:id="rId2"/></${x}sheets></${x}workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    ),
    'xl/sharedStrings.xml': strToU8(
      `<${x}sst ${ns}="${main}"><${x}si><${x}t>Sample</${x}t></${x}si><${x}si><${x}t>OD600</${x}t></${x}si><${x}si><${x}r><${x}t>Wild </${x}t></${x}r><${x}r><${x}t>type</${x}t></${x}r></${x}si><${x}si><${x}t>Date</${x}t></${x}si></${x}sst>`,
    ),
    'xl/styles.xml': strToU8(
      `<${x}styleSheet ${ns}="${main}"><${x}numFmts><${x}numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><${x}numFmt numFmtId="165" formatCode="0.0&quot; mM&quot;"/></${x}numFmts><${x}cellXfs><${x}xf numFmtId="0"/><${x}xf numFmtId="164"/><${x}xf numFmtId="10"/><${x}xf numFmtId="165"/><${x}xf numFmtId="14"/></${x}cellXfs></${x}styleSheet>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<${x}worksheet ${ns}="${main}"><${x}sheetData>` +
        `<${x}row r="1"><${x}c r="A1" t="s"><${x}v>0</${x}v></${x}c><${x}c r="B1" t="s"><${x}v>1</${x}v></${x}c><${x}c r="C1" t="s"><${x}v>3</${x}v></${x}c><${x}c r="D1" t="inlineStr"><${x}is><${x}t>Pass</${x}t></${x}is></${x}c></${x}row>` +
        `<${x}row r="2"><${x}c r="A2" t="s"><${x}v>2</${x}v></${x}c><${x}c r="B2"><${x}v>0.30000000000000004</${x}v></${x}c><${x}c r="C2" s="1"><${x}v>46325</${x}v></${x}c><${x}c r="D2" t="b"><${x}v>1</${x}v></${x}c></${x}row>` +
        `<${x}row r="4"><${x}c r="A4" t="str"><${x}f>A2&amp;"!"</${x}f><${x}v>Wild type!</${x}v></${x}c><${x}c r="B4" s="2"><${x}v>0.125</${x}v></${x}c><${x}c r="C4" s="3"><${x}v>12.5</${x}v></${x}c><${x}c r="E4"><${x}f>SUM(B2:B3)</${x}f></${x}c></${x}row>` +
        `</${x}sheetData></${x}worksheet>`,
    ),
    'xl/worksheets/sheet2.xml': strToU8(
      `<${x}worksheet ${ns}="${main}"><${x}sheetData><${x}row r="1"><${x}c r="B1" s="4"><${x}v>45000</${x}v></${x}c></${x}row></${x}sheetData></${x}worksheet>`,
    ),
  });
}

describe('Excel preview', () => {
  it('reads sheets, shared and inline text, numbers, dates, percentages, booleans and formulas', () => {
    for (const prefix of [undefined, 'x']) {
      const book = openXlsx(workbook({ prefix }));
      expect(book.sheets.map((s) => s.name)).toEqual(['Results', 'Plate map']);
      const s = book.read(0);
      expect(s.rows).toEqual([
        ['Sample', 'OD600', 'Date', 'Pass', ''],
        ['Wild type', '0.3', '2026-10-30', 'TRUE', ''],
        ['', '', '', '', ''],
        ['Wild type!', '12.5%', '12.5', '', '=SUM(B2:B3)'],
      ]);
      expect(s.numeric[1]).toEqual([false, true, true, false, false]);
      expect(book.read(1).rows).toEqual([['', '2023-03-15']]);
    }
  });

  it('refuses a file that is not a workbook', () => {
    expect(() => openXlsx(zipSync({ 'word/document.xml': strToU8('<w/>') }))).toThrow(/not an Excel workbook/);
  });

  it('knows cell names and number formats', () => {
    expect(cellIndex('A1')).toEqual([0, 0]);
    expect(cellIndex('AB12')).toEqual([11, 27]);
    expect([0, 25, 26, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'ZZ', 'AAA']);
    expect(formatKind(14, undefined)).toBe('date');
    expect(formatKind(164, 'dd/mm/yyyy hh:mm')).toBe('datetime');
    expect(formatKind(164, 'h:mm AM/PM')).toBe('time');
    expect(formatKind(164, '0.00%')).toBe('percent');
    expect(formatKind(164, '0.0" mM"')).toBe(null);
    expect(formatKind(164, '[Red]#,##0.00')).toBe(null);
    expect(formatKind(164, '_(* #,##0_)')).toBe(null);
    expect(serialToText(46325.5, 'datetime')).toBe('2026-10-30 12:00');
    expect(serialToText(0.75, 'time')).toBe('18:00');
    expect(serialToText(0, 'date', true)).toBe('1904-01-01');
  });
});

describe('code blocks', () => {
  it('stay fenced code with their language in Markdown', () => {
    const md = '```python\nimport numpy as np\nprint(np.pi)\n```\n\n```\nplain\n```\n';
    expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
  });

  it('are colored by language, and guessed when none is named', () => {
    const spans = highlightSpans('def f(x):\n    return x  # double', 'python');
    const classes = spans.map((s) => s.className);
    expect(classes).toContain('hljs-keyword');
    expect(classes).toContain('hljs-comment');
    const code = 'def f(x):\n    return x';
    const kw = spans.find((s) => s.className === 'hljs-keyword')!;
    expect(code.slice(kw.from, kw.to)).toBe('def');
    expect(highlightSpans('anything', 'plaintext')).toEqual([]);
    expect(guessLanguage('import numpy as np\n\ndef mean(xs):\n    return sum(xs) / len(xs)\n\nprint(mean([1, 2, 3]))')).toBe('python');
    expect(languageValue('py')).toBe('python');
    expect(languageValue('YML')).toBe('yaml');
    expect(languageValue(null)).toBe('');
  });
});
