import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../../src/markdown/parse';
import { serializeMarkdown, sheetToMarkdown } from '../../src/markdown/serialize';
import { joinFrontMatter, splitFrontMatter } from '../../src/notebook/frontmatter';

const roundTrip = (md: string) => serializeMarkdown(parseMarkdown(md));

describe('markdown round-trip', () => {
  it('keeps common rich text', () => {
    const md = [
      '## Objective',
      '',
      'Clone **GFP** into *pUC19* with ~~old~~ `code` and a [link](https://neb.com).',
      '',
      '- one',
      '- two',
      '  - nested',
      '',
      '1. first',
      '2. second',
      '',
      '> a quote',
      '',
      '```python',
      'print("hi")',
      '```',
      '',
      '---',
      '',
    ].join('\n');
    expect(roundTrip(md)).toBe(md);
  });

  it('round-trips sub/superscript, highlight and underline as HTML', () => {
    const md = 'H<sub>2</sub>O at 10<sup>6</sup> cells, <mark>important</mark> and <u>underlined</u>\n';
    expect(roundTrip(md)).toBe(md);
    const doc = parseMarkdown(md).toJSON();
    const marks = JSON.stringify(doc);
    expect(marks).toContain('subscript');
    expect(marks).toContain('superscript');
    expect(marks).toContain('highlight');
    expect(marks).toContain('underline');
  });

  it('parses task lists', () => {
    const md = '- [ ] thaw cells\n- [x] prepare *LB*\n';
    const doc = parseMarkdown(md);
    expect(doc.firstChild?.type.name).toBe('taskList');
    expect(doc.firstChild?.child(1).attrs.checked).toBe(true);
    expect(roundTrip(md)).toBe(md);
  });

  it('turns tables into spreadsheets and keeps formulas', () => {
    const md = [
      '<!-- gc:table {"f":{"C2":"=A2*B2","C3":"=SUM(C2:C2)"}} -->',
      '| Volume | Count | Total |',
      '| ---: | ---: | ---: |',
      '| 5 | 4 | 20 |',
      '| x | y | 20 |',
      '',
    ].join('\n');
    const doc = parseMarkdown(md);
    const sheet = doc.firstChild!;
    expect(sheet.type.name).toBe('spreadsheet');
    expect(sheet.attrs.data.rows).toEqual([
      ['Volume', 'Count', 'Total'],
      ['5', '4', '=A2*B2'],
      ['x', 'y', '=SUM(C2:C2)'],
    ]);
    const out = roundTrip(md);
    expect(out).toContain('<!-- gc:table {"f":{"C2":"=A2*B2","C3":"=SUM(C2:C2)"}} -->');
    expect(out).toContain('| 5 | 4 | 20 |');
  });

  it('recomputes formula values on save and escapes pipes / newlines in cells', () => {
    const md = sheetToMarkdown({
      rows: [
        ['a', 'b'],
        ['1|2', '=1+2'],
        ['line1\nline2', ''],
      ],
    });
    expect(md).toContain('| 1\\|2 | 3 |');
    expect(md).toContain('| line1<br>line2 |   |');
    const doc = parseMarkdown(md);
    expect(doc.firstChild!.attrs.data.rows[1]).toEqual(['1|2', '=1+2']);
    expect(doc.firstChild!.attrs.data.rows[2]).toEqual(['line1\nline2', '']);
  });

  it('protects comment JSON from "--"', () => {
    const md = sheetToMarkdown({ rows: [['a'], ['=--5']] });
    expect(md).not.toMatch(/gc:table [^\n]*--[^>]/);
    expect(parseMarkdown(md).firstChild!.attrs.data.rows[1][0]).toBe('=--5');
  });

  it('parses a plain GFM table written by hand', () => {
    const doc = parseMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n');
    expect(doc.firstChild!.attrs.data.rows).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
  });

  it('keeps column widths', () => {
    const md = sheetToMarkdown({ rows: [['a', 'b']], widths: [200, null] });
    expect(md).toContain('"w":[200,null]');
    expect(parseMarkdown(md).firstChild!.attrs.data.widths).toEqual([200, null]);
  });

  it('turns a lone link to a local file into an attachment', () => {
    const md = '[pX330 GFP.dna](attachments/GC-0001/pX330%20GFP.dna)\n';
    const doc = parseMarkdown(md);
    expect(doc.firstChild!.type.name).toBe('attachment');
    expect(doc.firstChild!.attrs).toMatchObject({ src: 'attachments/GC-0001/pX330 GFP.dna', name: 'pX330 GFP.dna' });
    expect(roundTrip(md)).toBe(md);
  });

  it('keeps links to other notes and URLs as links', () => {
    expect(parseMarkdown('[GC-0002](../B/GC-0002.md)\n').firstChild!.type.name).toBe('paragraph');
    expect(parseMarkdown('[NEB](https://neb.com/file.pdf)\n').firstChild!.type.name).toBe('paragraph');
  });

  it('does not re-encode links to notebook files on every save', () => {
    const md = 'See [GC-0002 My entry](../B/GC-0002%20My%20entry.md) and [the protocol](../../Protocols/P-0001%20Q5%20PCR.md#steps).\n';
    const doc = parseMarkdown(md);
    expect(doc.firstChild!.child(1).marks[0].attrs.href).toBe('../B/GC-0002 My entry.md');
    expect(roundTrip(md)).toBe(md);
    expect(roundTrip(roundTrip(md))).toBe(md);
    expect(roundTrip('[NEB](https://neb.com/a%20b.pdf)\n')).toBe('[NEB](https://neb.com/a%20b.pdf)\n');
  });

  it('handles images, including width via <img>', () => {
    const md = '![gel](attachments/GC-0001/gel%201.png)\n\n<img src="attachments/GC-0001/blot.png" alt="blot" width="50%">\n';
    const doc = parseMarkdown(md);
    expect(doc.child(0).type.name).toBe('image');
    expect(doc.child(0).attrs.src).toBe('attachments/GC-0001/gel 1.png');
    expect(doc.child(1).attrs).toMatchObject({ src: 'attachments/GC-0001/blot.png', alt: 'blot', width: '50%' });
    expect(roundTrip(md)).toBe(md);
  });

  it('round-trips sub-template includes', () => {
    const md = '## PCR\n\n<!-- gc:include {"id":"sub-pcr","name":"PCR (Q5)"} -->\n';
    const doc = parseMarkdown(md);
    expect(doc.child(1).type.name).toBe('include');
    expect(doc.child(1).attrs).toEqual({ ref: 'sub-pcr', name: 'PCR (Q5)' });
    expect(roundTrip(md)).toBe(md);
  });

  it('preserves unknown HTML verbatim', () => {
    const md = '<details>\n<summary>More</summary>\nhidden\n</details>\n\nText with <span class="x">span</span> inside.\n';
    expect(roundTrip(md)).toBe(md);
  });

  it('escapes text that would otherwise become markup', () => {
    const doc = parseMarkdown('plain');
    const json = doc.toJSON();
    json.content[0].content[0].text = '5 * 3 and <b> and [x]';
    const out = serializeMarkdown(doc.type.schema.nodeFromJSON(json));
    expect(out).toBe('5 \\* 3 and \\<b> and \\[x\\]\n');
    expect(parseMarkdown(out).textContent).toBe('5 * 3 and <b> and [x]');
  });

  it('keeps intraword underscores readable', () => {
    expect(roundTrip('sgRNA_1_test\n')).toBe('sgRNA_1_test\n');
  });

  it('handles hard breaks', () => {
    const md = 'line one\\\nline two\n';
    expect(roundTrip(md)).toBe(md);
  });

  it('keeps empty lines between paragraphs, as <br> (Markdown drops empty paragraphs)', () => {
    const schema = parseMarkdown('x').type.schema;
    const p = (text?: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
    const doc = schema.nodes.doc.create(null, [p(), p('First'), p(), p(), p('Second'), p(), p()]);
    const md = serializeMarkdown(doc);
    // Empty lines before and between paragraphs are kept; those at the end are not.
    expect(md).toBe('<br>\n\nFirst\n\n<br>\n\n<br>\n\nSecond\n');
    const back = parseMarkdown(md);
    expect(back.childCount).toBe(5);
    expect(back.child(2).type.name).toBe('paragraph');
    expect(back.child(2).childCount).toBe(0);
    expect(roundTrip(md)).toBe(md);
    // A blank page stays an empty file, and a <br> inside a paragraph is still a line break.
    expect(serializeMarkdown(schema.nodes.doc.create(null, [p()]))).toBe('');
    expect(roundTrip('a<br>b\n')).toBe('a\\\nb\n');
  });

  it('handles an empty document', () => {
    expect(roundTrip('')).toBe('');
  });
});

describe('front matter', () => {
  it('splits and joins', () => {
    const text = joinFrontMatter({ id: 'GC-0001', title: 'PCR: test', tags: ['a', 'b'], empty: '', none: null }, '# Body\n');
    expect(text).toBe('---\nid: GC-0001\ntitle: "PCR: test"\ntags: [a, b]\n---\n\n# Body\n');
    const { data, body, hasFrontMatter } = splitFrontMatter(text);
    expect(hasFrontMatter).toBe(true);
    expect(data).toEqual({ id: 'GC-0001', title: 'PCR: test', tags: ['a', 'b'] });
    expect(body).toBe('# Body\n');
  });

  it('keeps dates as strings', () => {
    const { data } = splitFrontMatter('---\ncreated: 2026-10-16T14:03:00+02:00\ndate: 2026-10-16\n---\nx');
    expect(data.created).toBe('2026-10-16T14:03:00+02:00');
    expect(data.date).toBe('2026-10-16');
  });

  it('treats files without front matter as body only', () => {
    expect(splitFrontMatter('# Hello\n')).toEqual({ data: {}, body: '# Hello\n', hasFrontMatter: false });
  });

  it('does not lose content when YAML is invalid', () => {
    const text = '---\ntitle: [broken\n---\nbody';
    const r = splitFrontMatter(text);
    expect(r.hasFrontMatter).toBe(false);
    expect(r.body).toBe(text);
  });

  it('writes board columns as a block list', () => {
    const text = joinFrontMatter({ kind: 'board', columns: [{ id: 'todo', name: 'To do', color: 'gray' }] }, '');
    expect(text).toContain('columns:\n  - id: todo\n    name: To do\n    color: gray');
  });

  it('keeps buffers as a readable table with their settings in a comment', () => {
    const md = [
      'Before.',
      '',
      '<!-- gc:buffer {"name":"Lysis buffer","volume":"50 mL","solvent":"Water"} -->',
      '| Component | Stock | Final | Add |',
      '| --- | ---: | ---: | ---: |',
      '| Tris-HCl pH 8.0 | 1 M | 50 mM | 2.5 mL |',
      '| NaCl | 58.44 g/mol | 150 mM | 438.3 mg |',
      '| Water |   |   | to 50 mL (47.5 mL) |',
      '',
      '| A | B |',
      '| ---: | ---: |',
      '| 1 | 2 |',
      '',
    ].join('\n');
    const doc = parseMarkdown(md);
    expect(doc.child(1).type.name).toBe('buffer');
    expect(doc.child(1).attrs.data.rows).toHaveLength(2);
    // A table after a buffer is still an ordinary table.
    expect(doc.child(2).type.name).toBe('spreadsheet');
    expect(roundTrip(md)).toBe(md);
  });

  it('recomputes the amounts of a buffer edited by hand', () => {
    const md = ['<!-- gc:buffer {"volume":"1 L"} -->', '| Component | Stock | Final |', '| --- | --- | --- |', '| KCl | 2 M | 100 mM |', ''].join(
      '\n',
    );
    expect(roundTrip(md)).toBe(
      [
        '<!-- gc:buffer {"volume":"1 L","solvent":"Water"} -->',
        '| Component | Stock | Final | Add |',
        '| --- | ---: | ---: | ---: |',
        '| KCl | 2 M | 100 mM | 50 mL |',
        '| Water |   |   | to 1 L (950 mL) |',
        '',
      ].join('\n'),
    );
  });
});
