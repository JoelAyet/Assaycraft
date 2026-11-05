import { describe, expect, it } from 'vitest';
import { cleanOfficeHtml, hasPastableText, pasteAsFiles } from '../../src/editor/officePaste';
import { parseMarkdown } from '../../src/markdown/parse';
import { serializeMarkdown } from '../../src/markdown/serialize';

describe('pasting from Word and PowerPoint', () => {
  it('pastes their text, not the picture they put beside it', () => {
    expect(pasteAsFiles(1, '<p class=MsoNormal>Lysis buffer</p>', 'Lysis buffer\r\n')).toBe(false);
    // A picture copied on its own (Word gives an empty line, or the object placeholder).
    expect(pasteAsFiles(1, '<img src="file:///C:/clip_image001.png">', '\r\n')).toBe(true);
    expect(pasteAsFiles(1, '', '\ufffc')).toBe(true);
    // Excel cells become a table, as before.
    expect(pasteAsFiles(1, '<table><tr><td>1</td></tr></table>', '1')).toBe(false);
    expect(pasteAsFiles(0, '', 'text')).toBe(false);
    expect(hasPastableText(' \u00a0\n')).toBe(false);
  });

  it('leaves out what only Office reads: list bullets kept as text, comments, pictures on the copier’s disk', () => {
    const html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"><body><!--StartFragment-->' +
      '<p class=MsoListParagraph><span style="mso-list:Ignore">1.<span>&nbsp;&nbsp;</span></span>Spin 5 min<o:p></o:p></p>' +
      '<img src="file:///C:/Users/x/clip_image001.png"><img src="https://example.org/gel.png"><!--EndFragment--></body></html>';
    const out = cleanOfficeHtml(html);
    expect(out).toContain('Spin 5 min');
    expect(out).not.toContain('1.');
    expect(out).not.toContain('StartFragment');
    expect(out).not.toContain('file:');
    expect(out).toContain('https://example.org/gel.png');
    expect(out).not.toMatch(/<o:p/);
    // Other HTML is left as it is.
    expect(cleanOfficeHtml('<p>plain <b>web</b> text</p>')).toBe('<p>plain <b>web</b> text</p>');
  });
});

describe('a week of the calendar in a page', () => {
  it('is kept in the file as a comment with its week, and read back', () => {
    const md = 'Plan:\n\n<!-- gc:calendar {"week":"2026-11-05"} -->\n\nAfter.';
    const doc = parseMarkdown(md);
    const node = doc.child(1);
    expect(node.type.name).toBe('calendarWeek');
    expect(node.attrs.week).toBe('2026-11-05');
    expect(serializeMarkdown(doc)).toBe(md + '\n');
  });
});

describe('a highlight over a subscript', () => {
  it('wraps it (one mark), and is written that way', () => {
    const doc = parseMarkdown('<mark>H<sub>2</sub>O</mark>');
    const marksOf = (i: number) => doc.child(0).child(i).marks.map((m) => m.type.name);
    expect(marksOf(1)).toEqual(['highlight', 'subscript']);
    expect(serializeMarkdown(doc).trim()).toBe('<mark>H<sub>2</sub>O</mark>');
  });
});
