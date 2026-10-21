import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { unpackZip } from '../../src/notebook/actions';

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
});
