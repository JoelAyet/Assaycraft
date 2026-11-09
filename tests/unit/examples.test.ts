/**
 * The examples a new notebook comes with (audit D03): marked as examples, nothing to do or keep on
 * hand until you add it, out of the calendar feed, and gone in one go from Settings.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { FileStat, Vault, VaultEntry, WriteData } from '../../src/fs/types';
import { closeNotebook, exampleContent, flushAllWrites, openNotebook, projectOf, removeExamples, rescan, saveBody } from '../../src/notebook/actions';
import { getState } from '../../src/notebook/store';
import { isExample } from '../../src/notebook/model';
import { notebookCalendar } from '../../src/calendar/ics';
import { parseStockTable } from '../../src/stocks/model';

class MemVault implements Vault {
  readonly kind = 'browser' as const;
  readonly id = 'examples';
  readonly name = 'Examples';
  files = new Map<string, { text: string; m: number }>();
  private clock = 1;
  async list(dir: string): Promise<VaultEntry[]> {
    const prefix = dir ? dir + '/' : '';
    const out = new Map<string, VaultEntry>();
    for (const p of this.files.keys()) {
      if (!p.startsWith(prefix)) continue;
      const name = p.slice(prefix.length).split('/')[0];
      const path = prefix + name;
      out.set(name, { name, path, kind: this.files.has(path) ? 'file' : 'directory' });
    }
    return [...out.values()];
  }
  async stat(path: string): Promise<FileStat | null> {
    const f = this.files.get(path);
    return f ? { size: f.text.length, lastModified: f.m } : null;
  }
  async readText(path: string) {
    const f = this.files.get(path);
    if (!f) throw new Error(`No file ${path}`);
    return f.text;
  }
  async readBlob(path: string) {
    return new Blob([await this.readText(path)]);
  }
  async write(path: string, data: WriteData) {
    const text = typeof data === 'string' ? data : await new Blob([data as BlobPart]).text();
    this.files.set(path, { text, m: this.clock++ });
  }
  async remove(path: string) {
    for (const p of [...this.files.keys()]) if (p === path || p.startsWith(path + '/')) this.files.delete(p);
  }
  async mkdir() {}
  async exists(path: string) {
    return this.files.has(path) || [...this.files.keys()].some((p) => p.startsWith(path + '/'));
  }
}

afterEach(async () => {
  if (getState().vault) await closeNotebook({ discard: true });
});

const feed = () => notebookCalendar(getState().docs, { name: 'Lab', feedId: 'feed1234', statuses: getState().config.entryStatuses, projectOf }).ics;

describe('the examples in a new notebook', () => {
  it('are marked, plan nothing, keep no stocks in a freezer and stay out of the calendar feed', async () => {
    await openNotebook(new MemVault());
    const docs = Object.values(getState().docs);
    const tasks = docs.filter((d) => d.kind === 'card');
    expect(tasks.length).toBe(3);
    for (const t of tasks) {
      expect(isExample(t)).toBe(true);
      expect(t.due).toBeUndefined();
      expect(t.tags).toContain('example');
    }
    expect(
      docs
        .filter(isExample)
        .map((d) => d.kind)
        .sort(),
    ).toEqual(['card', 'card', 'card', 'entry', 'note', 'reference']);
    // Templates and protocols are tools, not examples: they stay.
    expect(docs.some((d) => d.kind === 'template' && isExample(d))).toBe(false);
    for (const path of ['Stocks/Primers.md', 'Stocks/Glycerol stocks.md']) {
      const t = parseStockTable(await getState().vault!.readText(path));
      const loc = t.columns.indexOf('Location');
      expect(t.rows.length).toBeGreaterThan(0);
      for (const r of t.rows) {
        expect(r[loc]).toBe('');
        expect(r[r.length - 1]).toBe('Example');
      }
    }
    expect(feed()).not.toContain('BEGIN:VEVENT');
  });

  it('go in one go, except what your own work links to', async () => {
    const v = new MemVault();
    await openNotebook(v);
    // An entry of yours that uses the example primer PR-0002: that row stays.
    const mine = 'Projects/General/EXP-0001 PCR.md';
    await v.write(mine, '---\nid: EXP-0001\ntitle: PCR\nkind: entry\nstatus: planned\n---\n\nPlaceholder.\n');
    await rescan();
    await saveBody(mine, 'Amplified with [PR-0002 EGFP-rev](../../Stocks/Primers.md#PR-0002).\n');
    await flushAllWrites();
    await rescan();
    const found = exampleContent();
    expect(found.docs.length).toBe(6);
    expect(found.stocks.flatMap((s) => s.ids).sort()).toEqual(['GS-0001', 'PR-0001', 'PR-0003']);

    expect(await removeExamples()).toEqual({ pages: 6, stocks: 3 });
    await flushAllWrites();
    const left = Object.values(getState().docs);
    expect(left.filter(isExample)).toEqual([]);
    expect(left.some((d) => d.kind === 'template')).toBe(true);
    expect(left.find((d) => d.path === mine)).toBeTruthy();
    const primers = parseStockTable(await v.readText('Stocks/Primers.md'));
    expect(primers.rows.map((r) => r[0])).toEqual(['PR-0002']);
    expect(parseStockTable(await v.readText('Stocks/Glycerol stocks.md')).rows).toEqual([]);
    // In the trash, where they can be restored from.
    expect(getState().trash.length).toBe(6);
    expect([...v.files.keys()].some((p) => p.startsWith('Projects/Getting started/'))).toBe(false);
    // Nothing left to remove: Settings no longer offers it.
    expect(exampleContent()).toEqual({ docs: [], stocks: [] });
  });
});
