import { describe, expect, it } from 'vitest';
import { HEADING_MARK, previewParts, previewText, snippetAround, toPlainText } from '../../src/notebook/text';

describe('previews in the author’s own words', () => {
  it('leave out headings, prompts in italics, blanks to fill, empty items, tables and code', () => {
    const md = [
      '## Objective',
      '',
      '*What question does this experiment answer?*',
      '',
      'Clone {{Insert}} into {{Vector}}.',
      '',
      '## Materials',
      '',
      '-',
      '',
      '1.',
      '',
      '- [ ]',
      '',
      '| Component | Stock |',
      '| --- | --- |',
      '| Water | 5 |',
      '',
      '```python',
      'print(1)',
      '```',
    ].join('\n');
    expect(previewParts(md)).toEqual([]);
  });

  it('keep what was written, list items kept apart', () => {
    const md = [
      '## Results',
      '',
      'Bands at **1 kb** in lanes 2–4, see [the gel](attachments/x/gel.png).',
      '',
      '- Repeat with fresh Q5',
      '- Order primers',
    ].join('\n');
    expect(previewText(previewParts(md))).toBe('Bands at 1 kb in lanes 2–4, see the gel. Repeat with fresh Q5 · Order primers');
  });

  it('drop what only repeats the template', () => {
    const template = previewParts('## Plan\n\nStart each step when you get to it.\n');
    const entry = previewParts('## Plan\n\nStart each step when you get to it.\n\nStep 2 gave 12 colonies.\n');
    expect(previewText(entry, template)).toBe('Step 2 gave 12 colonies.');
    expect(previewText(previewParts('## Plan\n\nStart each step when you get to it.\n'), template)).toBe('');
  });
});

describe('search snippets', () => {
  const text = toPlainText(
    [
      '## Gel',
      '',
      '| Lane | Size |',
      '| --- | --- |',
      '| 5 | 4 |',
      '| 5 | 5 |',
      '',
      '*Drop the gel image here.*',
      '',
      '## Gibson assembly',
      '',
      'Vector:insert ≈ 1:2 (molar), 0.03–0.2 pmol.',
      '',
      '## Notes',
      '',
      'The band was faint. Gibson worked anyway, after a second try with more insert.',
    ].join('\n'),
  );

  it('start at the sentence of the match, with its section in front', () => {
    expect(snippetAround(text, 'second try')).toBe('Notes › Gibson worked anyway, after a second try with more insert.');
    expect(snippetAround(text, 'molar')).toMatch(/^Gibson assembly › Vector:insert ≈ 1:2 \(molar\)/);
  });

  it('name no section when the match is in its heading, and skip table numbers', () => {
    const s = snippetAround(text, 'gibson')!;
    expect(s.startsWith('Gibson assembly:')).toBe(true);
    expect(s).not.toMatch(/\d \d \d/);
    expect(s.includes(HEADING_MARK)).toBe(false);
  });

  it('find nothing that is not there', () => {
    expect(snippetAround(text, 'western')).toBeNull();
  });
});
