import { describe, expect, it } from 'vitest';
import { backlinksOf, docSpan, frontMatterFromMeta, metaFromFrontMatter, nextVersion, slugify, type DocMeta } from '../../src/notebook/model';
import { joinFrontMatter, splitFrontMatter } from '../../src/notebook/frontmatter';
import { bodyFacts, linkedIds, toPlainText } from '../../src/notebook/text';
import { asciiFold, encodeLinkPath, relative, resolveLink, sanitizeFileName, setAsciiFileNames, splitFragment, splitPath } from '../../src/lib/path';

const meta = (m: Partial<DocMeta>): DocMeta => ({ path: 'x.md', kind: 'entry', id: '', title: '', tags: [], extra: {}, mtime: 0, text: '', ...m });

describe('front matter ↔ metadata', () => {
  it('round-trips and preserves unknown keys', () => {
    const data = {
      id: 'GC-0007',
      title: 'PCR: test',
      status: 'in-progress',
      tags: ['pcr', 'q5'],
      date: '2026-10-16',
      reviewer: 'Ana',
      custom: { a: 1 },
    };
    const m = metaFromFrontMatter('Projects/A/GC-0007 PCR test.md', 'entry', data, 'fallback');
    expect(m).toMatchObject({ id: 'GC-0007', title: 'PCR: test', status: 'in-progress', tags: ['pcr', 'q5'], date: '2026-10-16' });
    expect(m.extra).toEqual({ reviewer: 'Ana', custom: { a: 1 } });
    const text = joinFrontMatter(frontMatterFromMeta(m), 'body\n');
    expect(splitFrontMatter(text).data).toEqual(data);
  });

  it('is lenient with hand-written front matter', () => {
    const m = metaFromFrontMatter(
      'p.md',
      'card',
      { title: 42, tags: 'a, b', due: '2026-10-20T10:00:00Z', priority: 'whatever', order: '3.5' },
      'Fallback',
    );
    expect(m).toMatchObject({ title: '42', tags: ['a', 'b'], due: '2026-10-20', priority: undefined, order: 3.5 });
    expect(metaFromFrontMatter('p.md', 'entry', {}, 'From file name').title).toBe('From file name');
  });

  it('reads board columns', () => {
    const m = metaFromFrontMatter(
      'Boards/X/_board.md',
      'board',
      { columns: [{ name: 'Waiting' }, { id: 'go', name: 'Go', color: 'green' }, 'junk'] },
      'X',
    );
    expect(m.columns).toEqual([
      { id: 'waiting', name: 'Waiting', color: 'gray' },
      { id: 'go', name: 'Go', color: 'green' },
    ]);
  });
});

describe('protocols', () => {
  it('round-trips version, history and linked protocols', () => {
    const data = {
      id: 'P-0003',
      kind: 'protocol',
      title: 'Freezing cells',
      status: 'active',
      tags: ['cell culture'],
      version: '1.1',
      revisions: [
        { version: '1.1', date: '2026-10-16', note: 'Spin out the DMSO' },
        { version: '1.0', date: '2026-09-01' },
      ],
    };
    const m = metaFromFrontMatter('Protocols/P-0003 Freezing cells.md', 'protocol', data, 'x');
    expect(m).toMatchObject({
      version: '1.1',
      revisions: [
        { version: '1.1', note: 'Spin out the DMSO' },
        { version: '1.0', date: '2026-09-01' },
      ],
    });
    const text = joinFrontMatter(frontMatterFromMeta(m), '');
    expect(text).toContain('version: "1.1"');
    expect(splitFrontMatter(text).data).toEqual(data);
    const entry = metaFromFrontMatter('Projects/GC-0001 x.md', 'entry', { id: 'GC-0001', protocols: ['P-0001', 'P-0003'] }, 'x');
    expect(entry.protocols).toEqual(['P-0001', 'P-0003']);
    expect(joinFrontMatter(frontMatterFromMeta(entry), '')).toContain('protocols: [P-0001, P-0003]');
  });

  it('suggests the next version', () => {
    expect(nextVersion(undefined)).toBe('1.0');
    expect(nextVersion('1.0')).toBe('1.1');
    expect(nextVersion('1.9')).toBe('1.10');
    expect(nextVersion('2')).toBe('3');
    expect(nextVersion('v2.3-rc')).toBe('v2.4-rc');
    expect(nextVersion('draft')).toBe('draft.1');
  });

  it('finds where a doc is used: protocol fields, linked entries and links in the text', () => {
    const p = meta({ path: 'Protocols/P-0001 a.md', kind: 'protocol', id: 'P-0001' });
    const docs = [
      p,
      meta({ path: 'Projects/GC-0001 a.md', id: 'GC-0001', protocols: ['P-0001'] }),
      meta({ path: 'Projects/GC-0002 b.md', id: 'GC-0002', refs: ['P-0001'] }),
      meta({ path: 'Boards/X/T-0001 c.md', kind: 'card', id: 'T-0001', links: ['GC-0001'] }),
      meta({ path: 'Templates/T.md', kind: 'template', id: 't', protocols: ['P-0002'] }),
    ];
    expect(backlinksOf(p, docs).map((d) => d.id)).toEqual(['GC-0001', 'GC-0002']);
    expect(backlinksOf(docs[1], docs).map((d) => d.id)).toEqual(['T-0001']);
  });
});

describe('calendar spans', () => {
  it('uses the experiment date, falling back to the creation day', () => {
    expect(docSpan(meta({ date: '2026-10-16', end: '2026-10-18' }))).toEqual({ start: '2026-10-16', end: '2026-10-18' });
    expect(docSpan(meta({ date: '2026-10-16', end: '2026-10-10' }))).toEqual({ start: '2026-10-16', end: '2026-10-16' });
    expect(docSpan(meta({ created: '2026-10-01T09:00:00+02:00' }))?.start).toBe('2026-10-01');
    expect(docSpan(meta({}))).toBeNull();
  });

  it('places tasks on their due date or start → due span', () => {
    expect(docSpan(meta({ kind: 'card', due: '2026-10-20' }))).toEqual({ start: '2026-10-20', end: '2026-10-20' });
    expect(docSpan(meta({ kind: 'card', start: '2026-10-18', due: '2026-10-20' }))).toEqual({ start: '2026-10-18', end: '2026-10-20' });
    expect(docSpan(meta({ kind: 'template', date: '2026-10-20' }))).toBeNull();
  });
});

describe('body facts', () => {
  it('extracts sub-template references, checklist progress and searchable text', () => {
    const body = '## Steps\n\n<!-- gc:include {"id":"pcr-q5","name":"PCR"} -->\n\n- [x] thaw\n- [ ] mix **Q5**\n\n| A | B |\n|---|---|\n| 1 | 2 |\n';
    const f = bodyFacts(body);
    expect(f.includes).toEqual(['pcr-q5']);
    expect(f.tasks).toEqual({ done: 1, total: 2 });
    expect(f.text).toBe('Steps: thaw · mix Q5 · A B 1 2');
    expect(toPlainText('[link](http://x) and ![img](a.png)')).toBe('link and img');
  });

  it('lists the notebook docs a body links to', () => {
    const body =
      'See [GC-0002 PCR](../B/GC-0002%20PCR.md), [the protocol](<../../Protocols/P-0001 Q5 PCR.md#steps>), ' +
      '[again](../B/GC-0002%20PCR.md), [a file](attachments/x.pdf), [web](https://x.org/a.md) and ![img](attachments/GC-9 a.md).';
    expect(linkedIds(body)).toEqual(['GC-0002', 'P-0001']);
    expect(bodyFacts(body).refs).toEqual(['GC-0002', 'P-0001']);
  });
});

describe('paths', () => {
  it('normalizes, resolves and encodes', () => {
    expect(splitPath('a/./b/../c//d')).toEqual(['a', 'c', 'd']);
    expect(resolveLink('Projects/A', 'attachments/GC-0001/gel%201.png')).toBe('Projects/A/attachments/GC-0001/gel 1.png');
    expect(relative('Projects/A', 'Projects/B/GC-0002 x.md')).toBe('../B/GC-0002 x.md');
    expect(encodeLinkPath('attachments/GC-0001/gel (1) #2.png')).toBe('attachments/GC-0001/gel%20%281%29%20%232.png');
  });

  it('makes safe file names', () => {
    expect(sanitizeFileName('PCR: pUC19/EcoRI? *test*')).toBe('PCR pUC19 EcoRI test');
    expect(sanitizeFileName('  ...  ')).toBe('Untitled');
    expect(sanitizeFileName('CON')).toBe('_CON');
    expect(slugify('Gibson assembly (NEBuilder HiFi)')).toBe('gibson-assembly-nebuilder-hifi');
  });

  it('spells file names in ASCII when the folder cannot store others', () => {
    expect(asciiFold('CaCl₂ 10 µM α-tubulin, β-actin, Größe, café')).toBe('CaCl2 10 uM alpha-tubulin, beta-actin, Grosse, cafe');
    expect(sanitizeFileName('CaCl₂ (α)')).toBe('CaCl₂ (α)');
    setAsciiFileNames(true);
    try {
      expect(sanitizeFileName('CaCl₂ (α)')).toBe('CaCl2 (alpha)');
      expect(sanitizeFileName('漢字')).toBe('Untitled');
    } finally {
      setAsciiFileNames(false);
    }
  });

  it('separates a link fragment from a file name', () => {
    expect(splitFragment('../P/P-0001 Q5.md#steps')).toEqual(['../P/P-0001 Q5.md', '#steps']);
    expect(splitFragment('Notes #2.md')).toEqual(['Notes #2.md', '']);
    expect(splitFragment('a.md')).toEqual(['a.md', '']);
  });
});

describe('previews', () => {
  it('keep headings and list items apart', () => {
    const md = '```\n# code\n- code\n```\n\n## Updates\n\n- Cloning done.\n\n## Actions\n\n- [ ] Order Q5\n- [x] Book the reader\n';
    expect(toPlainText(md)).toBe('code code Updates: Cloning done. Actions: Order Q5 · Book the reader');
    expect(toPlainText('# Notes:\n\nText')).toBe('Notes: Text');
  });
});
