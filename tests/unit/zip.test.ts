import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { unpackZip, zipPath } from '../../src/notebook/actions';
import { isWebLink } from '../../src/lib/path';

const paths = (files: Record<string, string>) =>
  unpackZip(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))).map((f) => f.path);

describe('unpackZip', () => {
  it('removes the folder around a zipped notebook', () => {
    expect(paths({ 'My notebook/assaycraft.json': '{}', 'My notebook/Projects/A.md': '# A' })).toEqual(['assaycraft.json', 'Projects/A.md']);
  });
  it('keeps the notebook’s own folders when they are the only thing in the zip', () => {
    expect(paths({ 'Projects/General/A.md': '# A', 'Projects/General/B.md': '# B' })).toEqual(['Projects/General/A.md', 'Projects/General/B.md']);
    expect(paths({ 'Protocols/P-0001 Miniprep.md': '# P' })).toEqual(['Protocols/P-0001 Miniprep.md']);
    expect(paths({ 'Notes/Lab meeting.md': '# N' })).toEqual(['Notes/Lab meeting.md']);
    expect(paths({ 'Literature/Jinek2012 A.md': '# A', 'Literature/Cong2013 B.md': '# B' })).toEqual([
      'Literature/Jinek2012 A.md',
      'Literature/Cong2013 B.md',
    ]);
  });
  it('keeps an exported notebook as it is and skips macOS metadata', () => {
    expect(paths({ 'assaycraft.json': '{}', 'Projects/A.md': '# A', '__MACOSX/._A.md': 'x' })).toEqual(['assaycraft.json', 'Projects/A.md']);
  });
  it('leaves out names that point outside the notebook, and reads the \\ some Windows tools write', () => {
    expect(paths({ 'Projects/A.md': '# A', '../outside.md': 'x', 'Projects/../../etc/passwd': 'x', '/Notes/B.md': '# B' })).toEqual([
      'Projects/A.md',
      'Notes/B.md',
    ]);
    expect(paths({ 'My notebook\\Projects\\General\\A.md': '# A', 'My notebook\\assaycraft.json': '{}' })).toEqual([
      'Projects/General/A.md',
      'assaycraft.json',
    ]);
    expect(zipPath('./Projects//A.md')).toBe('Projects/A.md');
    expect(zipPath('..')).toBe(null);
    expect(zipPath('a/..\\b')).toBe(null);
  });
});

describe('links opened from a page', () => {
  it('are web pages, e-mail and phone numbers: nothing a file could run', () => {
    for (const ok of ['https://example.org/a', 'HTTP://example.org', 'mailto:ana@example.org', 'tel:+34600000000', ' https://example.org'])
      expect(isWebLink(ok), ok).toBe(true);
    for (const no of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>1</script>',
      'vbscript:x',
      'file:///etc/passwd',
      'blob:x',
      '//example.org',
      '',
    ])
      expect(isWebLink(no), no).toBe(false);
  });
});
