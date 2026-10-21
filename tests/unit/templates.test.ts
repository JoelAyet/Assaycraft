import { describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { parseMarkdown } from '../../src/markdown/parse';
import { serializeMarkdown } from '../../src/markdown/serialize';
import { docSchema } from '../../src/editor/schema';
import {
  collectVariables,
  expandIncludes,
  fillText,
  fillVariables,
  includesOf,
  lintTemplate,
  markAssets,
  relocateAssets,
  type IncludeResolver,
} from '../../src/templates/engine';

const md = (s: string) => parseMarkdown(s).toJSON() as JSONContent;
const toMd = (json: JSONContent) => serializeMarkdown(docSchema().nodeFromJSON(json));

const SUBS: Record<string, { title: string; folder: string; body: string }> = {
  pcr: {
    title: 'PCR (Q5)',
    folder: 'Templates/Sub-templates',
    body: '### PCR of {{Template DNA}}\n\n| Component | µL |\n|---|---|\n| Q5 buffer | 10 |\n\n![gel](attachments/pcr/gel.png)\n',
  },
  gel: {
    title: 'Gel',
    folder: 'Templates/Sub-templates',
    body: '### Gel at {{Voltage|120}} V\n\n<!-- gc:include {"id":"pcr","name":"PCR (Q5)"} -->\n',
  },
  loop: { title: 'Loop', folder: 'Templates/Sub-templates', body: 'loop\n\n<!-- gc:include {"id":"loop","name":"Loop"} -->\n' },
};

const resolver: IncludeResolver = async (ref) => {
  const s = SUBS[ref];
  return s ? { id: ref, title: s.title, folder: s.folder, json: md(s.body) } : null;
};

describe('variables', () => {
  it('collects user variables with defaults, skipping built-ins', () => {
    const json = md('Digest {{Plasmid}} with {{Enzyme|EcoRI}} on {{date}}\n\n| {{Plasmid}} | {{Volume|5}} |\n|---|---|\n| a | b |\n');
    expect(collectVariables(json, ['Title for {{Construct}}'])).toEqual([
      { name: 'Construct', defaultValue: '' },
      { name: 'Plasmid', defaultValue: '' },
      { name: 'Enzyme', defaultValue: 'EcoRI' },
      { name: 'Volume', defaultValue: '5' },
    ]);
  });

  it('fills text, cells and defaults; keeps unknown placeholders', () => {
    expect(fillText('A {{x}} B {{Y|def}} C {{z}}', { X: '1' })).toBe('A 1 B def C {{z}}');
    const json = fillVariables(md('Digest {{Plasmid}}\n\n| {{Plasmid}} |\n|---|\n| {{date}} |\n'), { plasmid: 'pUC19', date: '2026-10-16' });
    expect(toMd(json)).toBe('Digest pUC19\n\n| pUC19 |\n| --- |\n| 2026-10-16 |\n');
  });

  it('removes text nodes that become empty', () => {
    const json = fillVariables(md('**{{x}}** rest\n'), { x: '' });
    expect(() => docSchema().nodeFromJSON(json).check()).not.toThrow();
    expect(toMd(json).trim()).toBe('rest');
  });
});

describe('sub-templates', () => {
  it('expands nested includes and relocates assets', async () => {
    const template = md('## Cloning\n\n<!-- gc:include {"id":"gel","name":"Gel"} -->\n\n![map](attachments/tpl/map.png)\n');
    expect(includesOf(template)).toEqual([{ ref: 'gel', name: 'Gel' }]);
    const expanded = await expandIncludes(template, 'Templates', resolver);
    const { json, copies } = relocateAssets(expanded, 'Projects/CRISPR', 'GC-0012');
    expect(copies).toEqual([
      { from: 'Templates/Sub-templates/attachments/pcr/gel.png', to: 'Projects/CRISPR/attachments/GC-0012/gel.png' },
      { from: 'Templates/attachments/tpl/map.png', to: 'Projects/CRISPR/attachments/GC-0012/map.png' },
    ]);
    const out = toMd(fillVariables(json, { 'template dna': 'pX330' }));
    expect(out).toBe(
      [
        '## Cloning',
        '',
        '### Gel at 120 V',
        '',
        '### PCR of pX330',
        '',
        '| Component | µL |',
        '| --- | ---: |',
        '| Q5 buffer | 10 |',
        '',
        '![gel](attachments/GC-0012/gel.png)',
        '',
        '![map](attachments/GC-0012/map.png)',
        '',
      ].join('\n'),
    );
  });

  it('stops include cycles and reports missing sub-templates', async () => {
    const expanded = await expandIncludes(
      md('<!-- gc:include {"id":"loop","name":"Loop"} -->\n\n<!-- gc:include {"id":"nope","name":"Nope"} -->\n'),
      'Templates',
      resolver,
    );
    const out = toMd(expanded);
    expect(out).toContain('loop');
    expect(out).toContain('includes itself');
    expect(out).toContain('Missing sub-template: Nope');
  });

  it('de-duplicates relocated file names', () => {
    const json: JSONContent = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: 'gcvault:A/gel.png' } },
        { type: 'image', attrs: { src: 'gcvault:B/gel.png' } },
        { type: 'image', attrs: { src: 'gcvault:A/gel.png' } },
      ],
    };
    const { json: out, copies } = relocateAssets(json, 'P', 'GC-1');
    expect(copies.map((c) => c.to)).toEqual(['P/attachments/GC-1/gel.png', 'P/attachments/GC-1/gel (2).png']);
    expect(out.content!.map((n) => n.attrs!.src)).toEqual(['attachments/GC-1/gel.png', 'attachments/GC-1/gel (2).png', 'attachments/GC-1/gel.png']);
  });
});

describe('links in copied content', () => {
  it('rewrites links to protocols and entries for the new folder, without copying them', () => {
    const json = markAssets(
      md(
        'Cells made with [P-0001 Competent cells](../../Protocols/P-0001%20Competent%20cells.md#steps); see [GC-0002](../../Projects/A/GC-0002%20x.md) and [NEB](https://neb.com).\n',
      ),
      'Templates/Sub-templates',
    );
    const { json: out, copies } = relocateAssets(json, 'Projects/CRISPR/Screens', 'GC-0013');
    expect(copies).toEqual([]);
    expect(toMd(out)).toBe(
      'Cells made with [P-0001 Competent cells](../../../Protocols/P-0001%20Competent%20cells.md#steps); see [GC-0002](../../A/GC-0002%20x.md) and [NEB](https://neb.com).\n',
    );
  });
});

describe('template check', () => {
  const lint = async (body: string, kind: 'template' | 'subtemplate' = 'template', titlePattern = 'Run {{x}}') =>
    lintTemplate(await expandIncludes(md(body), 'Templates', resolver), { kind, titlePattern });

  it('passes a well-formed template', async () => {
    expect(await lint('## Run\n\n{{Sample}} at {{Temp|37}} °C\n\n<!-- gc:include {"id":"gel","name":"Gel"} -->\n')).toEqual([]);
  });

  it('reports missing sub-templates, cycles, malformed braces and conflicting defaults', async () => {
    const issues = await lint(
      '<!-- gc:include {"id":"nope","name":"Western"} -->\n\n<!-- gc:include {"id":"loop","name":"Loop"} -->\n\nDigest {{Plasmid} with {{Enzyme|EcoRI}}\n\n| {{Enzyme|BamHI}} |\n|---|\n| 1 |\n',
    );
    const text = issues.map((i) => i.message).join('\n');
    expect(issues.every((i) => i.level === 'warning')).toBe(true);
    expect(text).toContain('The sub-template “Western” is missing');
    expect(text).toContain('includes itself');
    expect(text).toContain('Check the braces in “Digest {{Plasmid} with {{Enzyme|EcoRI}}”');
    expect(text).toContain('{{Enzyme}} has different defaults (EcoRI, BamHI)');
  });

  it('gives tips for empty templates and missing entry titles', async () => {
    expect((await lint('', 'template', ''))[0]).toMatchObject({ level: 'tip', message: expect.stringContaining('This template is empty') });
    expect((await lint('## A\n\ntext\n', 'template', ''))[0].message).toContain('No entry title');
    expect(await lint('## A\n\ntext\n', 'subtemplate', '')).toEqual([]);
  });
});
