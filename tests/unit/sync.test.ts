// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { FileStat, Vault, VaultEntry, WriteData } from '../../src/fs/types';
import { SyncEngine, syncable } from '../../src/sync/engine';
import { fromB64url, isSecret, newSecret, pairKeys, seal, unseal } from '../../src/sync/crypto';
import { decodeMessage, encodeMessage, linkPair } from '../../src/sync/link';
import { SyncableVault } from '../../src/sync/vault';

/** A notebook in memory. */
class MemVault implements Vault {
  readonly kind = 'browser' as const;
  files = new Map<string, { data: Uint8Array<ArrayBuffer>; m: number }>();
  dirs = new Set<string>();
  private clock = 1;
  constructor(
    readonly id: string,
    init: Record<string, string> = {},
  ) {
    for (const [p, t] of Object.entries(init)) void this.write(p, t);
  }
  get name() {
    return this.id;
  }
  private addDirs(path: string) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) this.dirs.add(parts.slice(0, i).join('/'));
  }
  async list(dir: string): Promise<VaultEntry[]> {
    const prefix = dir ? dir + '/' : '';
    const out = new Map<string, VaultEntry>();
    for (const p of [...this.files.keys(), ...this.dirs]) {
      if (!p.startsWith(prefix) || p === dir) continue;
      const name = p.slice(prefix.length).split('/')[0];
      const path = prefix + name;
      out.set(name, { name, path, kind: this.files.has(path) ? 'file' : 'directory' });
    }
    return [...out.values()];
  }
  async stat(path: string): Promise<FileStat | null> {
    const f = this.files.get(path);
    return f ? { size: f.data.length, lastModified: f.m } : null;
  }
  async readText(path: string) {
    return new TextDecoder().decode(this.files.get(path)!.data);
  }
  async readBlob(path: string) {
    return new Blob([this.files.get(path)!.data]);
  }
  async write(path: string, data: WriteData) {
    const bytes =
      typeof data === 'string'
        ? new TextEncoder().encode(data)
        : data instanceof Blob
          ? new Uint8Array(await data.arrayBuffer())
          : new Uint8Array(data instanceof ArrayBuffer ? data : data.slice().buffer);
    this.files.set(path, { data: bytes, m: this.clock++ });
    this.addDirs(path);
  }
  async remove(path: string) {
    for (const p of [...this.files.keys()]) if (p === path || p.startsWith(path + '/')) this.files.delete(p);
    for (const d of [...this.dirs]) if (d === path || d.startsWith(path + '/')) this.dirs.delete(d);
  }
  async mkdir(path: string) {
    this.addDirs(path + '/x');
  }
  async exists(path: string) {
    return this.files.has(path) || this.dirs.has(path);
  }
  text(path: string) {
    const f = this.files.get(path);
    return f && new TextDecoder().decode(f.data);
  }
  syncedFiles() {
    return Object.fromEntries([...this.files.keys()].filter(syncable).map((p) => [p, this.text(p)]));
  }
}

/** A computer and a phone with their notebooks; `connect` runs one session between them. */
function devices(computerFiles: Record<string, string>, phoneFiles: Record<string, string> = {}) {
  const computer = new SyncableVault(new MemVault('computer', computerFiles));
  const phone = new SyncableVault(new MemVault('phone', phoneFiles));
  let base: Record<string, string> = {};
  const conflicts: [string, string][] = [];
  const busy = new Set<string>();
  const connect = async () => {
    const [a, b] = linkPair();
    const leader = new SyncEngine({
      role: 'leader',
      vault: computer,
      link: a,
      peerLabel: 'phone',
      base: { load: async () => ({ ...base }), save: async (files) => void (base = files) },
      onConflict: (path, copy) => conflicts.push([path, copy]),
      isBusy: (p) => busy.has('computer:' + p),
    });
    const follower = new SyncEngine({
      role: 'follower',
      vault: phone,
      link: b,
      peerLabel: 'computer',
      onConflict: (path, copy) => conflicts.push([path, copy]),
      isBusy: (p) => busy.has('phone:' + p),
    });
    leader.start();
    follower.start();
    await Promise.all([leader.synced, follower.synced]);
    return { disconnect: () => a.close(), leader, follower };
  };
  const mem = (v: SyncableVault) => v.raw as MemVault;
  return { computer, phone, connect, conflicts, busy, pc: mem(computer), mobile: mem(phone), base: () => base };
}

const same = (d: ReturnType<typeof devices>) => expect(d.mobile.syncedFiles()).toEqual(d.pc.syncedFiles());

describe('pairing secret', () => {
  it('is 128 random bits in 22 characters, giving both devices the same room and key', async () => {
    const secret = newSecret();
    expect(isSecret(secret)).toBe(true);
    expect(fromB64url(secret)).toHaveLength(16);
    const [a, b] = [await pairKeys(secret), await pairKeys(secret)];
    expect(a.room).toMatch(/^[0-9a-f]{32}$/);
    expect(a.room).toBe(b.room);
    const sealed = await seal(a.key, new TextEncoder().encode('offer'));
    expect(new TextDecoder().decode(await unseal(b.key, sealed))).toBe('offer');
  });
  it('rejects messages made with another key or changed on the way', async () => {
    const mine = await pairKeys(newSecret());
    const other = await pairKeys(newSecret());
    const sealed = await seal(mine.key, new TextEncoder().encode('hello'));
    await expect(unseal(other.key, sealed)).rejects.toThrow();
    sealed[20] ^= 1;
    await expect(unseal(mine.key, sealed)).rejects.toThrow();
  });
});

describe('messages', () => {
  it('carry a header and bytes', () => {
    const { header, payload } = decodeMessage(encodeMessage({ t: 'file', path: 'a/b.md' }, new Uint8Array([1, 2, 3])));
    expect(header).toEqual({ t: 'file', path: 'a/b.md' });
    expect([...payload]).toEqual([1, 2, 3]);
  });
});

describe('sync engine', () => {
  it('copies the computer’s notebook to a new phone, without its version history or Git folder', async () => {
    const d = devices({
      'assaycraft.json': '{"name":"Smith lab"}',
      'Projects/IL-6/EXP-0001 ELISA.md': '# ELISA',
      'Projects/IL-6/attachments/gel.png': 'PNG…',
      '.assaycraft/history/EXP-0001.json': '{}',
      '.assaycraft/activity.json': '{}',
      '.git/config': '[core]',
      'Protocols/.DS_Store': 'x',
    });
    await d.pc.mkdir('Projects/Empty project');
    await d.connect();
    same(d);
    expect(d.mobile.text('Projects/IL-6/EXP-0001 ELISA.md')).toBe('# ELISA');
    expect(d.mobile.files.has('.assaycraft/history/EXP-0001.json')).toBe(false);
    expect(d.mobile.files.has('.git/config')).toBe(false);
    expect(d.mobile.files.has('Protocols/.DS_Store')).toBe(false);
    expect(d.mobile.dirs.has('Projects/Empty project')).toBe(true);
    expect(Object.keys(d.base())).toContain('Projects/IL-6/EXP-0001 ELISA.md');
  });

  it('sends changes both ways while connected', async () => {
    const d = devices({ 'Projects/A.md': 'a1', 'Projects/B.md': 'b1' });
    await d.connect();
    await d.phone.write('Projects/A.md', 'a2 from the bench');
    await vi.waitFor(() => expect(d.pc.text('Projects/A.md')).toBe('a2 from the bench'));
    await d.computer.write('Projects/B.md', 'b2 from the desk');
    await vi.waitFor(() => expect(d.mobile.text('Projects/B.md')).toBe('b2 from the desk'));
    await d.phone.write('Projects/New.md', 'new on phone');
    await d.computer.remove('Projects/B.md');
    await d.computer.mkdir('Notes');
    await vi.waitFor(() => {
      expect(d.pc.text('Projects/New.md')).toBe('new on phone');
      expect(d.mobile.files.has('Projects/B.md')).toBe(false);
      expect(d.mobile.dirs.has('Notes')).toBe(true);
    });
    same(d);
  });

  it('after time apart, takes each side’s changes and deletions', async () => {
    const d = devices({ 'A.md': 'a1', 'B.md': 'b1', 'C.md': 'c1', 'D.md': 'd1' });
    (await d.connect()).disconnect();
    // Offline: the computer edits A and deletes D, the phone edits B, deletes C and adds E.
    await d.computer.write('A.md', 'a2');
    await d.computer.remove('D.md');
    await d.phone.write('B.md', 'b2');
    await d.phone.remove('C.md');
    await d.phone.write('E.md', 'e1');
    await d.connect();
    same(d);
    expect(d.pc.syncedFiles()).toEqual({ 'A.md': 'a2', 'B.md': 'b2', 'E.md': 'e1' });
    expect(d.conflicts).toEqual([]);
  });

  it('keeps both versions when both devices changed the same file apart', async () => {
    const d = devices({ 'Projects/EXP-0007 Gel.md': 'v1' });
    (await d.connect()).disconnect();
    await d.computer.write('Projects/EXP-0007 Gel.md', 'computer edit');
    await d.phone.write('Projects/EXP-0007 Gel.md', 'phone edit');
    await d.connect();
    same(d);
    expect(d.pc.text('Projects/EXP-0007 Gel.md')).toBe('computer edit');
    expect(d.pc.text('Projects/EXP-0007 Gel (from phone).md')).toBe('phone edit');
    expect(d.conflicts).toEqual([['Projects/EXP-0007 Gel.md', 'Projects/EXP-0007 Gel (from phone).md']]);
  });

  it('an edit wins over a deletion made apart', async () => {
    const d = devices({ 'X.md': 'x1' });
    (await d.connect()).disconnect();
    await d.phone.remove('X.md');
    await d.computer.write('X.md', 'x2');
    await d.connect();
    same(d);
    expect(d.mobile.text('X.md')).toBe('x2');
  });

  it('a live change to a page being edited on the other device is kept as a copy, not lost', async () => {
    const d = devices({ 'Notes/Bench.md': 'start' });
    await d.connect();
    d.busy.add('computer:Notes/Bench.md');
    await d.phone.write('Notes/Bench.md', 'typed on the phone');
    await vi.waitFor(() => expect(d.pc.text('Notes/Bench (from phone).md')).toBe('typed on the phone'));
    expect(d.pc.text('Notes/Bench.md')).toBe('start');
    // The computer's pending edit is saved and sent: both end up with it, and with the copy.
    d.busy.clear();
    await d.computer.write('Notes/Bench.md', 'typed on the computer');
    await vi.waitFor(() => same(d));
    expect(d.mobile.text('Notes/Bench.md')).toBe('typed on the computer');
    expect(d.mobile.text('Notes/Bench (from phone).md')).toBe('typed on the phone');
  });

  it('a deletion does not remove a file the other device changed since; that version comes back', async () => {
    const d = devices({ 'X.md': 'x1' });
    await d.connect();
    // The phone has changed X (its change not sent yet) when the computer deletes it.
    await d.mobile.write('X.md', 'x2 on the phone');
    await d.computer.remove('X.md');
    await vi.waitFor(() => expect(d.pc.text('X.md')).toBe('x2 on the phone'));
    same(d);
  });

  it('copies large files in pieces, byte for byte', async () => {
    const d = devices({});
    const big = new Uint8Array(300_000).map((_, i) => (i * 7) % 251);
    await d.pc.write('Projects/attachments/scan.tif', big);
    await d.connect();
    expect([...d.mobile.files.get('Projects/attachments/scan.tif')!.data]).toEqual([...big]);
  });

  it('changes made while the devices are still comparing are sent once they agree', async () => {
    const d = devices({ 'A.md': 'a1' });
    const [a, b] = linkPair();
    const leader = new SyncEngine({ role: 'leader', vault: d.computer, link: a, peerLabel: 'phone' });
    const follower = new SyncEngine({ role: 'follower', vault: d.phone, link: b, peerLabel: 'computer' });
    leader.start();
    follower.start();
    await d.computer.write('A.md', 'a2 while comparing');
    await Promise.all([leader.synced, follower.synced]);
    await vi.waitFor(() => expect(d.mobile.text('A.md')).toBe('a2 while comparing'));
  });
});
