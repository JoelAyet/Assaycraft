/**
 * Keeps a notebook the same on two devices, the computer (leader) and a phone (follower).
 *
 * When they connect, each lists its files with a fingerprint of each. The computer compares the
 * lists with the files as they were when the two last agreed (the base) to tell who changed what:
 * a file changed on one side is copied to the other, one deleted on one side and unchanged on the
 * other is deleted there too, and one changed on both is kept twice ("… (from phone).md") so no
 * work is lost. After that, every change made on either device is sent to the other as it is saved.
 */
import type { FileStat, Vault } from '../fs/types';
import { fingerprint } from './crypto';
import { decodeMessage, encodeMessage, type Link, type Message } from './link';
import type { SyncableVault, VaultChange } from './vault';

/** Files are sent in pieces of this size (well under what every browser's data channel accepts). */
export const CHUNK = 48 * 1024;
/** Larger files stay on their device. */
export const MAX_FILE = 50 * 1024 * 1024;
/** Lists (of files, of paths to send) go in parts of this many items. */
const PART = 400;
/** A directory in a file list. */
const DIR = '/';

/** Each device's own files (version history, activity), and files that are not part of the notebook. */
const LOCAL_ONLY =
  /^(\.assaycraft\/(history(\/|$)|activity\.json$)|\.labcraft(\/|$)|\.git(\/|$))|(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\._[^/]*)$/;
export const syncable = (path: string) => !!path && !LOCAL_ONLY.test(path);

type Hash = string;
/** A file's fingerprint, null for a file too big to copy, DIR for a directory. */
type Entry = Hash | null;

export interface Progress {
  phase: 'comparing' | 'copying' | 'live';
  done: number;
  total: number;
}

export interface EngineOptions {
  role: 'leader' | 'follower';
  vault: SyncableVault;
  link: Link;
  /** Names the other device in the copies kept when both changed a file: "(from phone)". */
  peerLabel: string;
  /** The leader's record of the files as they were when the two devices last agreed. */
  base?: { load(): Promise<Record<string, Hash>>; save(files: Record<string, Hash>): Promise<void> };
  hashes?: HashCache;
  /** True while the app has unsaved edits of this file. */
  isBusy?: (path: string) => boolean;
  /** Called before a file is overwritten by the other device's version (to keep a version of it). */
  beforeOverwrite?: (path: string) => Promise<void>;
  /** Files changed by the other device (written, deleted, or created). */
  onApplied?: (paths: string[]) => void;
  onProgress?: (p: Progress) => void;
  /** Files too big to copy; they stay where they are. */
  onSkipped?: (paths: string[]) => void;
  /** Both devices changed `path`: the other device's version was kept as `copy`. */
  onConflict?: (path: string, copy: string) => void;
  onError?: (err: unknown) => void;
}

/** Fingerprints of files, remembered by size and modification time so unchanged files are not read again. */
export class HashCache {
  private map: Map<string, { s: number; m: number; h: Hash }>;
  constructor(init?: Record<string, { s: number; m: number; h: Hash }>) {
    this.map = new Map(Object.entries(init ?? {}));
  }
  async of(v: Vault, path: string): Promise<Entry | undefined> {
    const st = await v.stat(path);
    if (!st) return undefined;
    if (st.size > MAX_FILE) return null;
    const c = this.map.get(path);
    if (c && c.s === st.size && c.m === st.lastModified && st.lastModified) return c.h;
    const h = await fingerprint(await readBytes(v, path));
    this.note(path, st, h);
    return h;
  }
  note(path: string, st: FileStat, h: Hash) {
    this.map.set(path, { s: st.size, m: st.lastModified, h });
  }
  toJSON() {
    return Object.fromEntries(this.map);
  }
}

async function readBytes(v: Vault, path: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await (await v.readBlob(path)).arrayBuffer());
}

async function walk(v: Vault): Promise<{ files: string[]; dirs: string[] }> {
  const files: string[] = [];
  const dirs: string[] = [];
  const visit = async (dir: string) => {
    for (const e of await v.list(dir)) {
      if (!syncable(e.path)) continue;
      if (e.kind === 'directory') {
        dirs.push(e.path);
        await visit(e.path);
      } else files.push(e.path);
    }
  };
  await visit('');
  return { files, dirs };
}

const TEXT = /\.(md|markdown|json|txt|csv|tsv)$/i;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function concat(pieces: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of pieces) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function parts<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += PART) out.push(items.slice(i, i + PART));
  return out.length ? out : [[]];
}

const newId = () => Math.random().toString(36).slice(2, 10);

export class SyncEngine {
  /** What both devices have, as far as this one knows. */
  private known = new Map<string, Hash>();
  private live = false;
  private stopped = false;
  /** Files changed here while the devices were still comparing. */
  private dirty = new Set<string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private work: Promise<void> = Promise.resolve();
  private pieces = new Map<string, { pieces: Uint8Array[]; got: number }>();
  private mine?: Map<string, Entry>;
  private theirs = new Map<string, Entry>();
  private theirsComplete = false;
  private reconciling = false;
  private incomingKnown: [string, Hash][] = [];
  private hashes: HashCache;
  private unsubscribe?: () => void;
  private progress: Progress = { phase: 'comparing', done: 0, total: 0 };
  private appliedBatch = new Set<string>();
  private appliedTimer?: ReturnType<typeof setTimeout>;
  private baseTimer?: ReturnType<typeof setTimeout>;
  // The leader's bookkeeping while copying.
  private expecting = 0;
  private received = new Map<string, Hash>();
  private finish?: () => Promise<void>;

  readonly synced: Promise<void>;
  private resolveSynced!: () => void;

  constructor(private readonly o: EngineOptions) {
    this.hashes = o.hashes ?? new HashCache();
    this.synced = new Promise((resolve) => (this.resolveSynced = resolve));
  }

  get isLive() {
    return this.live;
  }

  start() {
    this.unsubscribe = this.o.vault.subscribe((change) => this.onLocal(change));
    this.o.link.onMessage((data) => this.enqueue(() => this.receive(data)));
    this.o.link.onClose(() => this.stop());
    this.enqueue(() => this.sendManifest());
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubscribe?.();
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    if (this.baseTimer) void this.saveBase();
    this.flushApplied();
  }

  private enqueue(fn: () => Promise<void>) {
    this.work = this.work
      .then(() => (this.stopped ? undefined : fn()))
      .catch((err) => {
        if (this.stopped) return;
        this.o.onError?.(err);
        this.o.link.close();
      });
  }

  private send(header: Message, payload?: Uint8Array) {
    return this.o.link.send(encodeMessage(header, payload));
  }

  private report(change: Partial<Progress>) {
    this.progress = { ...this.progress, ...change };
    this.o.onProgress?.(this.progress);
  }

  private step() {
    this.report({ done: this.progress.done + 1 });
  }

  // ───────────── comparing ─────────────

  private async sendManifest() {
    const raw = this.o.vault.raw;
    const { files, dirs } = await walk(raw);
    const entries: [string, Entry][] = dirs.map((d) => [d, DIR]);
    const skipped: string[] = [];
    for (const path of files) {
      const h = await this.hashes.of(raw, path);
      if (h === undefined) continue;
      entries.push([path, h]);
      if (h === null) skipped.push(path);
    }
    this.mine = new Map(entries);
    if (skipped.length) this.o.onSkipped?.(skipped);
    const list = parts(entries);
    for (let i = 0; i < list.length; i++) await this.send({ t: 'manifest', entries: list[i], last: i === list.length - 1 });
    if (this.o.role === 'leader' && this.theirsComplete) await this.reconcile();
  }

  private async copyName(path: string, taken: (p: string) => boolean | Promise<boolean>) {
    const slash = path.lastIndexOf('/');
    const dir = path.slice(0, slash + 1);
    const file = path.slice(slash + 1);
    const dot = file.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [file.slice(0, dot), file.slice(dot)] : [file, ''];
    for (let n = 1; ; n++) {
      const candidate = `${dir}${stem} (from ${this.o.peerLabel}${n > 1 ? ` ${n}` : ''})${ext}`;
      if (!(await taken(candidate))) return candidate;
    }
  }

  /** The leader decides what goes where (see the comment at the top). */
  private async reconcile() {
    if (this.reconciling) return;
    this.reconciling = true;
    const base = (await this.o.base?.load()) ?? {};
    const L = this.mine!;
    const F = this.theirs;
    const push: string[] = [];
    const pull: string[] = [];
    const delMine: string[] = [];
    const delTheirs: string[] = [];
    const mkdirMine: string[] = [];
    const mkdirTheirs: string[] = [];
    const conflicts: [string, string][] = [];
    const final = new Map<string, Hash>();
    for (const path of new Set([...L.keys(), ...F.keys()])) {
      const l = L.get(path);
      const f = F.get(path);
      if (l === DIR || f === DIR) {
        if (l === DIR && f === undefined) mkdirTheirs.push(path);
        else if (f === DIR && l === undefined) mkdirMine.push(path);
        continue;
      }
      if (l === null || f === null) continue; // too big: stays where it is
      if (l === f) {
        if (l !== undefined) final.set(path, l);
        continue;
      }
      const b = base[path];
      if (f === undefined) (b !== undefined && l === b ? delMine : push).push(path);
      else if (l === undefined) (b !== undefined && f === b ? delTheirs : pull).push(path);
      else if (f === b) push.push(path);
      else if (l === b) pull.push(path);
      else conflicts.push([path, await this.copyName(path, (p) => L.has(p) || F.has(p))]);
    }

    this.report({ phase: 'copying', done: 0, total: push.length + pull.length + conflicts.length * 3 + delMine.length + delTheirs.length });
    const plan = parts(delTheirs);
    for (let i = 0; i < plan.length; i++)
      await this.send({ t: 'plan', del: plan[i], mkdir: i === 0 ? mkdirTheirs : [], total: this.progress.total, last: i === plan.length - 1 });
    const raw = this.o.vault.raw;
    for (const path of delMine) {
      await raw.remove(path);
      this.applied(path);
      this.step();
    }
    for (const dir of mkdirMine) {
      await raw.mkdir(dir);
      this.applied(dir);
    }

    this.expecting = pull.length + conflicts.length;
    this.finish = async () => {
      this.finish = undefined;
      for (const [path, copy] of conflicts) {
        const mineNow = await this.sendFile(path, 'sync');
        if (mineNow) final.set(path, mineNow);
        this.step();
        const theirsNow = this.received.get(copy);
        if (theirsNow && (await this.sendFile(copy, 'sync'))) final.set(copy, theirsNow);
        this.step();
        this.o.onConflict?.(path, copy);
      }
      for (const [path, h] of this.received) if (!final.has(path)) final.set(path, h);
      this.received.clear();
      const list = parts([...final]);
      for (let i = 0; i < list.length; i++) await this.send({ t: 'known', entries: list[i] });
      await this.send({ t: 'synced' });
      this.known = final;
      await this.saveBase();
      this.goLive();
    };
    for (const [i, paths] of parts(pull).entries()) await this.send({ t: 'get', paths, conflicts: i === 0 ? conflicts : [] });
    for (const path of push) {
      const h = await this.sendFile(path, 'sync');
      if (h) final.set(path, h);
      this.step();
    }
    if (this.expecting === 0) await this.finish();
  }

  private goLive() {
    this.live = true;
    this.report({ phase: 'live' });
    this.resolveSynced();
    for (const path of this.dirty) this.schedule(path);
    this.dirty.clear();
  }

  // ───────────── sending ─────────────

  private async readLocal(path: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; h: Hash; st: FileStat } | null> {
    const raw = this.o.vault.raw;
    const st = await raw.stat(path);
    if (!st || st.size > MAX_FILE) return null;
    const bytes = await readBytes(raw, path);
    const h = await fingerprint(bytes);
    this.hashes.note(path, st, h);
    return { bytes, h, st };
  }

  private async sendBytes(path: string, bytes: Uint8Array, h: Hash, mode: 'sync' | 'put', base?: Hash) {
    const id = newId();
    const n = Math.max(1, Math.ceil(bytes.length / CHUNK));
    for (let i = 0; i < n; i++) await this.send({ t: 'file', id, path, h, mode, base, i, n }, bytes.subarray(i * CHUNK, (i + 1) * CHUNK));
  }

  /** Send a file as it is now; `as` sends it under another name. Returns its fingerprint, or nothing if it is gone. */
  private async sendFile(path: string, mode: 'sync' | 'put', opts: { as?: string; base?: Hash } = {}): Promise<Hash | undefined> {
    const local = await this.readLocal(path);
    if (!local) return undefined;
    await this.sendBytes(opts.as ?? path, local.bytes, local.h, mode, opts.base);
    return local.h;
  }

  /** A file changed here other than through the vault (e.g. sent by another phone): send it. */
  changed(path: string) {
    if (!syncable(path)) return;
    if (this.live) this.schedule(path);
    else this.dirty.add(path);
  }

  private onLocal(change: VaultChange) {
    const paths = change.op === 'move' ? [change.from, change.to] : [change.path];
    for (const path of paths) {
      if (!syncable(path)) continue;
      if (this.live) this.schedule(path);
      else this.dirty.add(path);
    }
  }

  /** Send a change shortly after it is saved (saves come in bursts while typing). */
  private schedule(path: string) {
    clearTimeout(this.timers.get(path));
    this.timers.set(
      path,
      setTimeout(() => {
        this.timers.delete(path);
        this.enqueue(() => this.sendChange(path));
      }, 150),
    );
  }

  private async sendChange(path: string) {
    const raw = this.o.vault.raw;
    const local = await this.readLocal(path);
    if (local) {
      const before = this.known.get(path);
      if (local.h === before) return;
      await this.sendBytes(path, local.bytes, local.h, 'put', before);
      this.known.set(path, local.h);
      this.baseChanged();
      return;
    }
    if (await raw.exists(path)) {
      if (!(await raw.stat(path))) await this.send({ t: 'mkdir', path }); // a directory
      return;
    }
    const inside = [...this.known.keys()].filter((k) => k.startsWith(path + '/'));
    await this.send({ t: 'del', path, base: this.known.get(path), dir: inside.length > 0 || !this.known.has(path) });
    this.known.delete(path);
    for (const k of inside) this.known.delete(k);
    this.baseChanged();
  }

  // ───────────── receiving ─────────────

  private async receive(data: Uint8Array<ArrayBuffer>) {
    const { header, payload } = decodeMessage(data);
    switch (header.t) {
      case 'manifest':
        for (const [path, h] of header.entries as [string, Entry][]) this.theirs.set(path, h);
        if (header.last) {
          this.theirsComplete = true;
          if (this.o.role === 'leader' && this.mine) await this.reconcile();
        }
        return;
      case 'plan':
        return this.onPlan(header);
      case 'get':
        return this.onGet(header);
      case 'missing':
        this.expecting--;
        this.step();
        if (this.expecting === 0) await this.finish?.();
        return;
      case 'file':
        return this.onPiece(header, payload);
      case 'known':
        this.incomingKnown.push(...(header.entries as [string, Hash][]));
        return;
      case 'synced':
        this.known = new Map(this.incomingKnown);
        this.incomingKnown = [];
        this.goLive();
        return;
      case 'del':
        return this.onDelete(header);
      case 'mkdir':
        await this.o.vault.raw.mkdir(header.path as string);
        this.applied(header.path as string);
        return;
    }
  }

  private async onPlan(header: Message) {
    const raw = this.o.vault.raw;
    if (header.total !== undefined) this.report({ phase: 'copying', total: header.total as number });
    for (const dir of header.mkdir as string[]) {
      await raw.mkdir(dir);
      this.applied(dir);
    }
    for (const path of header.del as string[]) {
      // Only if it has not changed here since the list was made (if it has, the change is sent once live).
      if ((await this.hashes.of(raw, path)) === this.mine?.get(path)) {
        await raw.remove(path);
        this.applied(path);
      }
      this.step();
    }
  }

  private async onGet(header: Message) {
    const get = async (path: string, as?: string) => {
      if (!(await this.sendFile(path, 'sync', { as }))) await this.send({ t: 'missing', path: as ?? path });
      this.step();
    };
    for (const path of header.paths as string[]) await get(path);
    for (const [path, copy] of header.conflicts as [string, string][]) await get(path, copy);
  }

  private async onPiece(header: Message, payload: Uint8Array) {
    const id = header.id as string;
    const n = header.n as number;
    const entry = this.pieces.get(id) ?? { pieces: [], got: 0 };
    entry.pieces[header.i as number] = payload;
    entry.got++;
    if (entry.got < n) {
      this.pieces.set(id, entry);
      return;
    }
    this.pieces.delete(id);
    const bytes = concat(entry.pieces);
    const path = header.path as string;
    const h = header.h as Hash;
    if ((await fingerprint(bytes)) !== h) throw new Error(`${path} arrived damaged`);
    if (!syncable(path)) return;
    if (header.mode === 'sync') {
      await this.writeLocal(path, bytes, h);
      this.step();
      if (this.o.role === 'leader') {
        this.received.set(path, h);
        this.expecting--;
        if (this.expecting === 0) await this.finish?.();
      }
      return;
    }
    await this.onPut(path, bytes, h, header.base as Hash | undefined);
  }

  /** A file changed on the other device. */
  private async onPut(path: string, bytes: Uint8Array<ArrayBuffer>, h: Hash, base: Hash | undefined) {
    const current = await this.hashes.of(this.o.vault.raw, path);
    if (current === h) {
      this.known.set(path, h);
      return;
    }
    if (current === null) return; // too big to compare: keep this device's
    const busy = this.o.isBusy?.(path) ?? false;
    if (!busy && (current === undefined || current === base)) {
      await this.writeLocal(path, bytes, h);
      this.known.set(path, h);
      this.baseChanged();
      return;
    }
    // Changed on both: keep this device's version, keep the other's as a copy, and send both back.
    const copy = await this.copyName(path, (p) => this.o.vault.raw.exists(p));
    await this.writeLocal(copy, bytes, h);
    this.known.set(path, h);
    this.o.onConflict?.(path, copy);
    await this.sendChange(copy);
    if (!busy) await this.sendChange(path);
  }

  private async onDelete(header: Message) {
    const raw = this.o.vault.raw;
    const path = header.path as string;
    if (header.dir) {
      await raw.remove(path);
      for (const k of [...this.known.keys()]) if (k === path || k.startsWith(path + '/')) this.known.delete(k);
      this.applied(path);
      this.baseChanged();
      return;
    }
    const current = await this.hashes.of(raw, path);
    this.known.delete(path);
    this.baseChanged();
    if (current === undefined || current === null) return;
    if (current !== header.base) {
      // Changed here since: keep it, and give it back to the other device.
      await this.sendChange(path);
      return;
    }
    await raw.remove(path);
    this.applied(path);
  }

  private async writeLocal(path: string, bytes: Uint8Array<ArrayBuffer>, h: Hash) {
    const raw = this.o.vault.raw;
    if (this.o.beforeOverwrite && (await raw.stat(path))) await this.o.beforeOverwrite(path);
    let data: string | Uint8Array<ArrayBuffer> = bytes;
    if (TEXT.test(path)) {
      try {
        data = utf8.decode(bytes);
      } catch {
        /* not UTF-8: keep the bytes */
      }
    }
    await raw.write(path, data);
    const st = await raw.stat(path);
    if (st) this.hashes.note(path, st, h);
    this.applied(path);
  }

  private applied(path: string) {
    this.appliedBatch.add(path);
    clearTimeout(this.appliedTimer);
    this.appliedTimer = setTimeout(() => this.flushApplied(), 120);
  }

  private flushApplied() {
    clearTimeout(this.appliedTimer);
    if (!this.appliedBatch.size) return;
    const paths = [...this.appliedBatch];
    this.appliedBatch.clear();
    this.o.onApplied?.(paths);
  }

  /** The leader keeps the agreed state as the base for next time. */
  private baseChanged() {
    if (!this.o.base || this.baseTimer) return;
    this.baseTimer = setTimeout(() => void this.saveBase(), 1500);
  }

  private async saveBase() {
    clearTimeout(this.baseTimer);
    this.baseTimer = undefined;
    await this.o.base?.save(Object.fromEntries(this.known)).catch((err) => console.warn('Could not save the sync state', err));
  }
}
