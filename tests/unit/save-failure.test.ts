import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileStat, Vault, VaultEntry, WriteData } from '../../src/fs/types';
import {
  closeNotebook,
  flushAllWrites,
  flushWrite,
  hasPendingWrites,
  openNotebook,
  patchMeta,
  retryFailedWrites,
  UnsavedChangesError,
} from '../../src/notebook/actions';
import { getState } from '../../src/notebook/store';

/** A notebook in memory whose writes can be made to fail (a full disk, a lost connection, no permission). */
class FlakyVault implements Vault {
  readonly kind = 'browser' as const;
  readonly id = 'flaky';
  readonly name = 'Flaky';
  files = new Map<string, { text: string; m: number }>();
  failing = false;
  writes = 0;
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
    this.writes++;
    if (this.failing && path.endsWith('.md')) throw new Error('The disk is full');
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

const ENTRY = 'Projects/Gels/EXP-0001 Gel.md';

async function notebook() {
  const v = new FlakyVault();
  await v.write(ENTRY, '---\nid: EXP-0001\ntitle: Gel\nkind: entry\nstatus: planned\n---\n\nRan the gel.\n');
  await openNotebook(v, { seed: false });
  expect(getState().docs[ENTRY]?.status).toBe('planned');
  return v;
}

afterEach(async () => {
  vi.useRealTimers();
  if (getState().vault) await closeNotebook({ discard: true });
});

describe('a save that fails', () => {
  it('keeps the change, says Save failed (never Saved), and writes it once storage works again', async () => {
    const v = await notebook();
    v.failing = true;
    patchMeta(ENTRY, { status: 'completed' }, 0);
    expect(await flushWrite(ENTRY)).toBe(false);
    expect(getState().saveState).toBe('error');
    expect(v.files.get(ENTRY)!.text).toContain('status: planned');
    expect(hasPendingWrites()).toBe(true);

    // Storage is back; another save (nothing new in the body) must still write the status.
    v.failing = false;
    expect(await flushWrite(ENTRY)).toBe(true);
    expect(v.files.get(ENTRY)!.text).toContain('status: completed');
    expect(getState().saveState).toBe('saved');
    expect(hasPendingWrites()).toBe(false);
  });

  it('is tried again by itself, and from Try again', async () => {
    const v = await notebook();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    v.failing = true;
    patchMeta(ENTRY, { status: 'in-progress' }, 0);
    await vi.advanceTimersByTimeAsync(10);
    expect(getState().saveState).toBe('error');
    const before = v.writes;
    await vi.advanceTimersByTimeAsync(3_100);
    expect(v.writes).toBeGreaterThan(before);
    expect(getState().saveState).toBe('error');
    v.failing = false;
    expect(await retryFailedWrites()).toBe(true);
    expect(v.files.get(ENTRY)!.text).toContain('status: in-progress');
    expect(getState().saveState).toBe('saved');
  });

  it('makes flushing report it, and Switch notebook refuse to lose it unless asked', async () => {
    const v = await notebook();
    v.failing = true;
    patchMeta(ENTRY, { status: 'failed' }, 0);
    expect(await flushAllWrites()).toBe(false);
    await expect(closeNotebook()).rejects.toBeInstanceOf(UnsavedChangesError);
    expect(getState().vault).not.toBe(null);
    await closeNotebook({ discard: true });
    expect(getState().vault).toBe(null);
  });
});
