// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { FileStat, Vault, VaultEntry, WriteData } from '../../src/fs/types';
import { SyncEngine, syncable } from '../../src/sync/engine';
import { fromB64url, isSecret, newSecret, pairKeys, rekeyPair, rekeySecret, seal, unseal } from '../../src/sync/crypto';
import { decodeMessage, encodeMessage, linkPair, type Link } from '../../src/sync/link';
import { SyncableVault } from '../../src/sync/vault';
import { baseFiles, baseRecord } from '../../src/sync/store';

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
  /** False: the base was saved by an earlier version (see baseFiles). */
  let confirmed = true;
  /** Versions the computer had before, by path (its version history). */
  const history = new Map<string, Set<string>>();
  const conflicts: [string, string][] = [];
  const busy = new Set<string>();
  /** Files replaced on the computer by the phone's version, and when: "compare:A.md", "live:A.md". */
  const overwrites: string[] = [];
  /** Versions that lost to a later edit, kept in a history: "computer:A.md:text". */
  const kept: string[] = [];
  /** Resolved both-changed files: "computer:A.md:here". */
  const resolved: string[] = [];
  const dec = (b: Uint8Array) => new TextDecoder().decode(b);
  /** One session. `silence()` makes what the computer sends vanish, as into a phone's dead connection. */
  let silent = false;
  /** The largest message the computer sent. */
  let largest = 0;
  const connect = async (opts: { quiet?: boolean } = {}) => {
    silent = !!opts.quiet;
    const [pair, b] = linkPair();
    const a: Link = {
      ...pair,
      send: (data) => {
        largest = Math.max(largest, data.length);
        return silent ? Promise.resolve() : pair.send(data);
      },
    };
    const leader = new SyncEngine({
      role: 'leader',
      vault: computer,
      link: a,
      peerLabel: 'phone',
      base: { load: async () => ({ files: { ...base }, confirmed }), save: async (files) => void ((base = files), (confirmed = true)) },
      hadVersion: async (path, h) => history.get(path)?.has(h) ?? false,
      beforeOverwrite: async (path, when) => {
        overwrites.push(`${when}:${path}`);
        if (when !== 'live') kept.push(`computer:${path}:${(computer.raw as MemVault).text(path)}`);
      },
      keepVersion: async (path, bytes) => void kept.push(`computer:${path}:${dec(bytes)}`),
      onResolved: (path, k) => void resolved.push(`computer:${path}:${k}`),
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
      beforeOverwrite: async (path, when) => {
        if (when !== 'live') kept.push(`phone:${path}:${(phone.raw as MemVault).text(path)}`);
      },
      keepVersion: async (path, bytes) => void kept.push(`phone:${path}:${dec(bytes)}`),
      onResolved: (path, k) => void resolved.push(`phone:${path}:${k}`),
    });
    leader.start();
    follower.start();
    await (opts.quiet ? leader.synced : Promise.all([leader.synced, follower.synced]));
    return { disconnect: () => a.close(), silence: () => (silent = true), leader, follower };
  };
  const mem = (v: SyncableVault) => v.raw as MemVault;
  return {
    computer,
    phone,
    connect,
    conflicts,
    busy,
    overwrites,
    kept,
    resolved,
    largest: () => largest,
    pc: mem(computer),
    mobile: mem(phone),
    base: () => base,
    /** As a base saved by an earlier version: unconfirmed. */
    oldBase: (files: Record<string, string>) => void ((base = files), (confirmed = false)),
    hadBefore: (path: string, h: string) => history.set(path, new Set([...(history.get(path) ?? []), h])),
  };
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
  it('after pairing, both devices work out the same new secret, which no one else can', async () => {
    const computer = await rekeyPair();
    const phone = await rekeyPair();
    const onComputer = await rekeySecret(computer.priv, phone.pub, 'abc123');
    const onPhone = await rekeySecret(phone.priv, computer.pub, 'abc123');
    expect(onComputer).toBe(onPhone);
    expect(isSecret(onComputer)).toBe(true);
    // Someone else with both public halves (they went through the relay) and a key pair of their own gets another.
    const eve = await rekeyPair();
    expect(await rekeySecret(eve.priv, computer.pub, 'abc123')).not.toBe(onComputer);
    expect(await rekeySecret(computer.priv, phone.pub, 'other')).not.toBe(onComputer);
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

  it('a page changed on both apart keeps its latest edit on both; the other goes into its history on both', async () => {
    const page = (text: string, when: string) => `---\nid: EXP-0007\nmodified: ${when}\n---\n\n${text}\n`;
    const d = devices({ 'Projects/EXP-0007 Gel.md': page('v1', '2026-11-18T09:00:00+01:00') });
    (await d.connect()).disconnect();
    // The phone's edit is the later one, though the computer's was saved last.
    await d.phone.write('Projects/EXP-0007 Gel.md', page('phone edit', '2026-11-18T10:05:00+01:00'));
    await d.computer.write('Projects/EXP-0007 Gel.md', page('computer edit', '2026-11-18T10:01:00+01:00'));
    await d.connect();
    same(d);
    expect(d.pc.text('Projects/EXP-0007 Gel.md')).toContain('phone edit');
    expect(d.conflicts).toEqual([]);
    expect(d.resolved).toEqual(['computer:Projects/EXP-0007 Gel.md:there']);
    expect(d.kept.some((k) => k.startsWith('computer:Projects/EXP-0007 Gel.md:') && k.includes('computer edit'))).toBe(true);

    // Again, the computer's later this time: the phone gets it, and keeps its own in its history.
    (await d.connect()).disconnect();
    await d.phone.write('Projects/EXP-0007 Gel.md', page('phone again', '2026-11-18T11:00:00+01:00'));
    await d.computer.write('Projects/EXP-0007 Gel.md', page('computer later', '2026-11-18T11:30:00+01:00'));
    await d.connect();
    same(d);
    expect(d.mobile.text('Projects/EXP-0007 Gel.md')).toContain('computer later');
    expect(d.kept.some((k) => k.startsWith('phone:Projects/EXP-0007 Gel.md:') && k.includes('phone again'))).toBe(true);
    expect(d.kept.some((k) => k.startsWith('computer:Projects/EXP-0007 Gel.md:') && k.includes('phone again'))).toBe(true);
  });

  it('a page changed on both with no edit time keeps the computer’s; not text, both are kept', async () => {
    const d = devices({ 'Notes/Plan.md': 'p1', 'gel.png': 'png1' });
    (await d.connect()).disconnect();
    await d.computer.write('Notes/Plan.md', 'computer plan');
    await d.phone.write('Notes/Plan.md', 'phone plan');
    await d.computer.write('gel.png', 'png from the desk');
    await d.phone.write('gel.png', 'png from the bench');
    await d.connect();
    same(d);
    expect(d.pc.text('Notes/Plan.md')).toBe('computer plan');
    expect(d.kept).toContain('computer:Notes/Plan.md:phone plan');
    expect(d.pc.text('gel.png')).toBe('png from the desk');
    expect(d.pc.text('gel (from phone).png')).toBe('png from the bench');
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

  it('a live change to a page being edited on the other device is not lost: it goes into the page’s history', async () => {
    const d = devices({ 'Notes/Bench.md': 'start' });
    await d.connect();
    d.busy.add('computer:Notes/Bench.md');
    await d.phone.write('Notes/Bench.md', 'typed on the phone');
    await vi.waitFor(() => expect(d.kept).toContain('computer:Notes/Bench.md:typed on the phone'));
    expect(d.pc.text('Notes/Bench.md')).toBe('start');
    // The computer's edit, being typed, is the latest: once saved, both have it.
    d.busy.clear();
    await d.computer.write('Notes/Bench.md', 'typed on the computer');
    await vi.waitFor(() => same(d));
    expect(d.mobile.text('Notes/Bench.md')).toBe('typed on the computer');
    expect([...d.mobile.files.keys()].filter((p) => p.includes('(from'))).toEqual([]);
  });

  // ── From the audit report (F01, F02, F06): what the comparison decided is checked again. ──

  it('a folder deleted on the computer keeps a page the phone added inside it meanwhile (F01)', async () => {
    const d = devices({ 'P/A.md': 'a1', 'P/attachments/x/gel.png': 'g' });
    await d.connect();
    await d.phone.raw.write('P/B.md', 'new result at the bench'); // saved, not sent yet
    await d.computer.remove('P');
    await vi.waitFor(() => expect(d.pc.text('P/B.md')).toBe('new result at the bench'));
    expect(d.mobile.text('P/B.md')).toBe('new result at the bench');
    expect(d.mobile.files.has('P/A.md')).toBe(false);
    expect(d.mobile.files.has('P/attachments/x/gel.png')).toBe(false);
  });

  it('a page edited on the computer while the devices compare is not deleted (F02)', async () => {
    const d = devices({ 'A.md': 'a1' });
    (await d.connect()).disconnect();
    await d.phone.remove('A.md'); // deleted on the phone while apart
    // The computer saves A again after it listed its files, right before the comparison acts on it.
    const stat = d.pc.stat.bind(d.pc);
    let calls = 0;
    d.pc.stat = async (path: string) => {
      if (path === 'A.md' && ++calls === 2) await d.computer.write('A.md', 'a2 typed during the comparison');
      return stat(path);
    };
    await d.connect();
    await vi.waitFor(() => expect(d.mobile.text('A.md')).toBe('a2 typed during the comparison'));
    expect(d.pc.text('A.md')).toBe('a2 typed during the comparison');
  });

  it('a page saved on the phone while the devices compare is not overwritten by the computer’s (F02)', async () => {
    const page = (text: string, when: string) => `---\nmodified: ${when}\n---\n\n${text}\n`;
    const d = devices({ 'A.md': page('a1', '2026-11-18T09:00:00Z') });
    (await d.connect()).disconnect();
    await d.computer.write('A.md', page('a2 from the desk', '2026-11-18T10:00:00Z'));
    // The phone saves A after it listed its files, right before the computer's version is written.
    const stat = d.mobile.stat.bind(d.mobile);
    let calls = 0;
    d.mobile.stat = async (path: string) => {
      if (path === 'A.md' && ++calls === 2) await d.phone.write('A.md', page('a3 typed at the bench meanwhile', '2026-11-18T10:05:00Z'));
      return stat(path);
    };
    await d.connect();
    // The phone's is the later edit: the page on both; the computer's is in its history.
    await vi.waitFor(() => {
      same(d);
      expect(d.pc.text('A.md')).toContain('a3 typed at the bench meanwhile');
    });
    expect(d.kept.some((k) => k.includes('a2 from the desk'))).toBe(true);
  });

  it('an empty folder deleted on the phone while apart does not come back (F06)', async () => {
    const d = devices({ 'A.md': 'a1' });
    await d.computer.mkdir('Empty');
    (await d.connect()).disconnect();
    await d.phone.remove('Empty');
    await d.connect();
    expect(d.pc.dirs.has('Empty')).toBe(false);
    (await d.connect()).disconnect();
    expect(d.pc.dirs.has('Empty')).toBe(false);
    expect(d.mobile.dirs.has('Empty')).toBe(false);
  });

  it('an empty folder deleted on the computer while connected is deleted on the phone', async () => {
    const d = devices({ 'A.md': 'a1' });
    await d.computer.mkdir('Old');
    await d.connect();
    expect(d.mobile.dirs.has('Old')).toBe(true);
    await d.computer.remove('Old');
    await vi.waitFor(() => expect(d.mobile.dirs.has('Old')).toBe(false));
  });

  it('lists with long paths go in parts well under the relay’s limit', async () => {
    const long = 'Projects/' + 'A very long project folder name '.repeat(8);
    const files: Record<string, string> = {};
    for (let i = 0; i < 500; i++) files[`${long}/EXP-${i} ${'entry '.repeat(10)}.md`] = `e${i}`;
    const d = devices(files);
    await d.connect();
    same(d);
    expect(d.largest()).toBeLessThan(100 * 1024);
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

  it('a change sent into a connection that had died without a word is not lost at the next connection', async () => {
    const d = devices({ 'A.md': 'a1', 'B.md': 'b1' });
    const session = await d.connect();
    // The phone is put away: its connection looks open, but nothing reaches it.
    session.silence();
    await d.computer.write('A.md', 'a2 while the phone was away');
    await new Promise((r) => setTimeout(r, 400));
    session.disconnect();
    await d.connect();
    expect(d.pc.text('A.md')).toBe('a2 while the phone was away');
    same(d);
    expect(d.conflicts).toEqual([]);
  });

  it('a first copy cut off before the phone had the files does not delete them on the computer', async () => {
    const d = devices({ 'A.md': 'a1', 'B.md': 'b1' });
    // The computer sends the notebook, but none of it arrives before the connection is gone.
    const first = await d.connect({ quiet: true });
    await new Promise((r) => setTimeout(r, 100));
    first.disconnect();
    await d.connect();
    expect(d.pc.syncedFiles()).toEqual({ 'A.md': 'a1', 'B.md': 'b1' });
    same(d);
  });

  it('a base saved by an earlier version is read as unconfirmed', () => {
    expect(baseFiles({ 'A.md': 'h1' })).toEqual({ files: { 'A.md': 'h1' }, confirmed: false });
    expect(baseFiles(undefined)).toEqual({ files: {}, confirmed: true });
    expect(baseFiles(baseRecord({ 'A.md': 'h1' }))).toEqual({ files: { 'A.md': 'h1' }, confirmed: true });
  });

  it('an unconfirmed base still says who changed what, but never deletes on the computer', async () => {
    const d = devices({ 'A.md': 'a1', 'B.md': 'b1', 'C.md': 'c1' }, { 'A.md': 'a1', 'B.md': 'b1', 'C.md': 'c1' });
    await d.connect();
    const agreed = d.base();
    (await d.connect()).disconnect();
    // Apart: the computer edits A, the phone edits B; C never reached the phone (as from a cut-off copy).
    await d.computer.write('A.md', 'a2 at the desk');
    await d.phone.write('B.md', 'b2 at the bench');
    await d.phone.raw.remove('C.md');
    d.oldBase(agreed);
    await d.connect();
    expect(d.pc.syncedFiles()).toEqual({ 'A.md': 'a2 at the desk', 'B.md': 'b2 at the bench', 'C.md': 'c1' });
    same(d);
    expect(d.conflicts).toEqual([]);
  });

  it('with no base, a page the phone has in a version the computer had before is not kept twice', async () => {
    const d = devices({ 'A.md': 'a1' }, { 'A.md': 'a1' });
    await d.connect();
    const a1 = d.base()['A.md'];
    // The computer edited A since (its version history has a1); the base is gone.
    await d.computer.write('A.md', 'a2');
    d.oldBase({});
    d.hadBefore('A.md', a1);
    await d.connect();
    expect(d.pc.text('A.md')).toBe('a2');
    same(d);
    expect(d.conflicts).toEqual([]);
  });

  it('with no base, files the phone does not have are copied to it, never deleted on the computer', async () => {
    const d = devices({ 'A.md': 'a1', 'B.md': 'b1' }, { 'A.md': 'a1' });
    await d.connect();
    expect(d.pc.syncedFiles()).toEqual({ 'A.md': 'a1', 'B.md': 'b1' });
    same(d);
  });

  it('a file replaced when the devices meet is told apart from one replaced as the other saves', async () => {
    const d = devices({ 'A.md': 'a1', 'B.md': 'b1' });
    const session = await d.connect();
    await d.phone.write('A.md', 'a2 typed at the bench');
    await vi.waitFor(() => expect(d.pc.text('A.md')).toBe('a2 typed at the bench'));
    session.disconnect();
    await d.phone.write('B.md', 'b2 while apart');
    await d.connect();
    expect(d.overwrites).toEqual(['live:A.md', 'compare:B.md']);
  });

  it('the computer counts a change as agreed only once the phone has it', async () => {
    const d = devices({ 'A.md': 'a1' });
    const session = await d.connect();
    await vi.waitFor(() => expect(Object.keys(d.base())).toEqual(['A.md']));
    const agreed = d.base()['A.md'];
    session.silence();
    await d.computer.write('A.md', 'a2');
    await new Promise((r) => setTimeout(r, 1800));
    session.disconnect();
    await new Promise((r) => setTimeout(r, 50));
    expect(d.base()['A.md']).toBe(agreed);
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
