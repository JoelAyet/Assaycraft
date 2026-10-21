import { describe, expect, it } from 'vitest';
import { applyPatch, countChanges, diffArrays, diffLines, makePatch } from '../../src/history/diff';
import { addVersion, historyPathFor, keepFlags, thin, versionTexts, MAX_VERSIONS, type HistoryFile } from '../../src/history/store';
import { dayLabel, historyItems, propChanges } from '../../src/history/view';

/** Small deterministic random numbers, so failures can be reproduced. */
function rng(seed: number) {
  return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function randomEdit(text: string, rnd: () => number): string {
  const lines = text.split('\n');
  const edits = 1 + Math.floor(rnd() * 4);
  for (let e = 0; e < edits; e++) {
    const at = Math.floor(rnd() * (lines.length + 1));
    const kind = rnd();
    if (kind < 0.35 && lines.length) lines.splice(at, 1 + Math.floor(rnd() * 3));
    else if (kind < 0.7) lines.splice(at, 0, `line ${Math.floor(rnd() * 1000)}`, ...(rnd() < 0.3 ? [''] : []));
    else if (lines.length) lines[Math.min(at, lines.length - 1)] += ` edited ${Math.floor(rnd() * 100)}`;
  }
  return lines.join('\n');
}

describe('diff', () => {
  it('finds the changes between two lists', () => {
    const ops = diffArrays(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e']);
    expect(ops).toEqual([
      { type: 'eq', items: ['a'] },
      { type: 'del', items: ['b'] },
      { type: 'ins', items: ['x'] },
      { type: 'eq', items: ['c', 'd'] },
      { type: 'ins', items: ['e'] },
    ]);
    expect(diffArrays([], [])).toEqual([]);
    expect(diffArrays(['a'], ['b'])).toEqual([
      { type: 'del', items: ['a'] },
      { type: 'ins', items: ['b'] },
    ]);
  });

  it('patches turn one text into the other, whatever the edits (500 random cases)', () => {
    const rnd = rng(42);
    let text = Array.from({ length: 30 }, (_, i) => `Line ${i}`).join('\n');
    for (let n = 0; n < 500; n++) {
      const next = n % 50 === 0 ? '' : randomEdit(text, rnd);
      expect(applyPatch(text, makePatch(text, next))).toBe(next);
      expect(applyPatch(next, makePatch(next, text))).toBe(text);
      text = next || 'restart';
    }
  });

  it('shows edited lines word by word, with the unchanged parts folded', () => {
    const before = ['# Goal', '', 'Clone EGFP into pUC19.', 'a', 'b', 'c', 'd', 'e', 'f', 'Last line.'].join('\n');
    const after = ['# Goal', '', 'Clone mCherry into pUC19.', 'a', 'b', 'c', 'd', 'e', 'f', 'Last line.', 'New line.'].join('\n');
    const lines = diffLines(before, after, 1);
    expect(lines[0]).toEqual({ kind: 'skip', count: 1, lines: ['# Goal'] });
    expect(lines[2]).toEqual({
      kind: 'mod',
      segments: [
        { type: 'eq', text: 'Clone ' },
        { type: 'del', text: 'EGFP' },
        { type: 'ins', text: 'mCherry' },
        { type: 'eq', text: ' into pUC19.' },
      ],
    });
    expect(lines.some((l) => l.kind === 'skip' && l.count === 5)).toBe(true);
    expect(lines[lines.length - 1]).toEqual({ kind: 'ins', segments: [{ type: 'ins', text: 'New line.' }] });
    // Only the words that changed count: EGFP → mCherry, and the new line.
    expect(countChanges(before, after)).toEqual({ added: 3, removed: 1 });
    expect(countChanges('a b\n\nc', 'a b\n\nc')).toEqual({ added: 0, removed: 0 });
    expect(countChanges('one two', '')).toEqual({ added: 0, removed: 2 });
    expect(countChanges('- [ ] Thaw', '- [ ] Thaw\n- [ ] Spin down\n\n| 1 | 2 |')).toEqual({ added: 4, removed: 0 });
  });
});

describe('version history', () => {
  const T0 = Date.UTC(2026, 0, 1);
  const HOUR = 3600_000;
  const DAY = 24 * HOUR;

  function build(texts: string[], times: number[]): HistoryFile {
    let h: HistoryFile | null = null;
    texts.forEach((t, i) => (h = addVersion(h, 'Projects/a.md', t, times[i])));
    return h!;
  }

  it('keeps the newest version whole and the older ones as changes', () => {
    const rnd = rng(7);
    const texts = ['first'];
    for (let i = 0; i < 40; i++) texts.push(randomEdit(texts[i], rnd));
    const h = build(
      texts,
      texts.map((_, i) => T0 + i * HOUR),
    );
    expect(h.head).toBe(texts[texts.length - 1]);
    // A save that changed nothing is not a new version.
    const distinct = texts.filter((t, i) => i === 0 || t !== texts[i - 1]);
    expect(versionTexts(h)).toEqual([...distinct].reverse());
    // The same text again is not a new version.
    expect(addVersion(h, 'Projects/a.md', h.head, T0 + 99 * HOUR).versions).toHaveLength(h.versions.length);
  });

  it('stays small: 200 versions of a 12 KB entry take a few copies’ worth, not 200', () => {
    const rnd = rng(3);
    const base = Array.from({ length: 200 }, (_, i) => `Paragraph ${i}: Lorem ipsum dolor sit amet, buffer and primers.`).join('\n');
    let text = base;
    let h: HistoryFile | null = null;
    for (let i = 0; i < 200; i++) {
      text = randomEdit(text, rnd);
      h = addVersion(h, 'Projects/a.md', text, T0 + i * 60_000);
    }
    const size = JSON.stringify(h).length;
    expect(base.length).toBeGreaterThan(10_000);
    // 200 full copies would be about 2.5 MB.
    expect(size).toBeLessThan((base.length * 200) / 50);
    expect(versionTexts(h!).length).toBeGreaterThan(190);
  });

  it('thins old versions: all of the last day, then hourly, daily and weekly', () => {
    const now = T0 + 200 * DAY;
    // A version every 15 minutes for 200 days, newest first.
    const versions = Array.from({ length: 200 * 96 }, (_, i) => ({ t: now - i * 15 * 60_000 }));
    const flags = keepFlags(versions, now);
    const kept = versions.filter((_, i) => flags[i]);
    const ages = kept.map((v) => now - v.t);
    expect(ages.filter((a) => a < DAY)).toHaveLength(96);
    expect(ages.filter((a) => a >= DAY && a < 7 * DAY).length).toBeGreaterThanOrEqual(6 * 24 - 1);
    expect(ages.filter((a) => a >= DAY && a < 7 * DAY).length).toBeLessThanOrEqual(6 * 24 + 1);
    expect(ages.filter((a) => a >= 7 * DAY && a < 90 * DAY).length).toBeGreaterThanOrEqual(82);
    expect(ages.filter((a) => a >= 7 * DAY && a < 90 * DAY).length).toBeLessThanOrEqual(84);
    expect(ages.filter((a) => a >= 90 * DAY).length).toBeLessThanOrEqual(18);
    // The very first version is always kept.
    expect(flags[flags.length - 1]).toBe(true);
    expect(kept.length).toBeLessThan(MAX_VERSIONS);
  });

  it('never thins out a version marked to keep, and the texts that stay are unchanged', () => {
    const rnd = rng(11);
    const texts = ['v0'];
    for (let i = 0; i < 30; i++) texts.push(randomEdit(texts[i], rnd));
    const times = texts.map((_, i) => T0 + i * 10 * 60_000); // every 10 minutes, all in one hour bucket
    let h = build(texts, times);
    h = { ...h, versions: h.versions.map((v, i) => (i === 10 ? { ...v, label: 'Before restoring' } : v)) };
    const later = thin(h, T0 + 3 * DAY);
    const all = versionTexts(h);
    const keptTexts = versionTexts(later);
    expect(later.versions.length).toBeLessThan(h.versions.length);
    expect(later.versions.some((v) => v.label === 'Before restoring')).toBe(true);
    for (const t of keptTexts) expect(all).toContain(t);
    expect(keptTexts[0]).toBe(all[0]);
    expect(keptTexts[keptTexts.length - 1]).toBe(all[all.length - 1]);
  });

  it('files history by ID, or by path for documents without one', () => {
    expect(historyPathFor({ id: 'GC-0001', path: 'Projects/General/GC-0001 Cloning.md' })).toBe('.assaycraft/history/GC-0001.json');
    const a = historyPathFor({ path: 'Templates/Molecular cloning.md' });
    expect(a).toMatch(/^\.assaycraft\/history\/Templates ~ Molecular cloning [0-9a-f]{8}\.json$/);
    expect(historyPathFor({ path: 'Templates/Sub-templates/Molecular cloning.md' })).not.toBe(a);
  });
});

describe('history window', () => {
  const T = new Date(2026, 9, 17, 15, 30).getTime();
  const file = (title: string, modified: string, body: string) => `---\nid: GC-0001\ntitle: ${title}\nmodified: ${modified}\n---\n${body}`;

  it('lists the current file and the versions, skipping ones that differ only in their save time', () => {
    let h = addVersion(null, 'a.md', file('Cloning', '2026-10-15T09:00', 'Clone EGFP.'), T - 2 * 86400_000);
    h = addVersion(h, 'a.md', file('Cloning', '2026-10-16T09:00', 'Clone EGFP into pUC19.'), T - 86400_000);
    h = addVersion(h, 'a.md', file('Cloning', '2026-10-16T09:05', 'Clone EGFP into pUC19.'), T - 86000_000);
    const items = historyItems({ text: file('Cloning v2', '2026-10-17T15:00', 'Clone EGFP into pUC19.'), t: T }, h);
    expect(items.map((i) => i.current)).toEqual([true, false, false]);
    expect(items[0]).toMatchObject({ delta: { added: 0, removed: 0 }, propsChanged: 1 });
    // "EGFP." became "EGFP into pUC19."
    expect(items[1]).toMatchObject({ body: 'Clone EGFP into pUC19.', delta: { added: 3, removed: 1 }, propsChanged: 0 });
    expect(items[2]).toMatchObject({ oldest: true, delta: null });
    expect(propChanges(items[1].props, items[0].props)).toEqual([{ key: 'title', from: 'Cloning', to: 'Cloning v2' }]);
    // A notebook with no history yet: only the current file.
    expect(historyItems({ text: 'x', t: T }, null)).toHaveLength(1);
  });

  it('groups by day', () => {
    expect(dayLabel(T - 3600_000, T)).toBe('Today');
    expect(dayLabel(T - 86400_000, T)).toBe('Yesterday');
    expect(dayLabel(T - 5 * 86400_000, T)).not.toMatch(/Today|Yesterday/);
  });
});
