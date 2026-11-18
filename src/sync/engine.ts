/**
 * Keeps a notebook the same on two devices, the computer (leader) and a phone (follower).
 *
 * When they connect, each lists its files with a fingerprint of each. The computer compares the
 * lists with the files as they were when the two last agreed (the base) to tell who changed what:
 * a file changed on one side is copied to the other, one deleted on one side and unchanged on the
 * other is deleted there too, and one changed on both keeps its latest edit (by the time the page
 * says it was edited) while the other version goes into the page's version history, on both
 * devices. Pictures and other files that are not text cannot go into a history: both are kept,
 * the other device's as "… (from phone).png". After that, every change made on either device is
 * sent to the other as it is saved.
 *
 * The base is what both devices are known to have, so the leader only adds to it what the phone
 * says it has (or what came from the phone). A change sent into a connection that had died without
 * a word (a phone put away: its socket looks open) never arrived; counted as agreed, the next
 * comparison would have taken the phone's older version over it, and a first copy cut off midway
 * would have read as files deleted on the phone.
 *
 * What the comparison decided is checked again, file by file, right before it is done: a file saved
 * meanwhile (someone typing as the devices reconnect) is never deleted or overwritten by a decision
 * made from the older list; the two versions are compared again. A folder deleted on one side is
 * deleted file by file on the other, and what was changed or added there meanwhile stays.
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
  /**
   * The leader's record of the files as they were when the two devices last agreed. `confirmed`:
   * every file in it was confirmed by the follower. One saved by an earlier version was not (it
   * counted what was sent as agreed), so it is used for everything but deleting on the leader.
   */
  base?: { load(): Promise<{ files: Record<string, Hash>; confirmed: boolean }>; save(files: Record<string, Hash>): Promise<void> };
  /**
   * The leader once had this version of `path` (it is in its version history): the follower's copy
   * is an older one, not a change of its own.
   */
  hadVersion?: (path: string, h: Hash) => Promise<boolean>;
  /** Keep a version of `path` that lost to a later edit, in its history (`label` says where from). */
  keepVersion?: (path: string, bytes: Uint8Array<ArrayBuffer>, label: string) => Promise<void>;
  /** Both devices had changed `path`: the latest edit was kept (`here`, or the one from `there`). */
  onResolved?: (path: string, kept: 'here' | 'there') => void;
  hashes?: HashCache;
  /** True while the app has unsaved edits of this file. */
  isBusy?: (path: string) => boolean;
  /** Called before a file is overwritten by the other device's version (to keep a version of it). */
  /**
   * Called before a file is replaced by the other device's version: `compare` when the devices meet,
   * `live` as the other saves, `resolve` when the other's is the later of two edits (keep it for good).
   */
  beforeOverwrite?: (path: string, when: 'compare' | 'live' | 'resolve') => Promise<void>;
  /** Files changed by the other device (written, deleted, or created). */
  onApplied?: (paths: string[]) => void;
  onProgress?: (p: Progress) => void;
  /** Files too big to copy; they stay where they are. */
  onSkipped?: (paths: string[]) => void;
  /** Both devices changed `path` (not a text file): the other device's version was kept as `copy`. */
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
/** Files whose versions can be kept in a page's history (and so resolved to the latest). */
const isText = (path: string) => TEXT.test(path);
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

/** Lists go in parts of at most PART items and about PART_BYTES (long paths: a message must stay well under the relay's limit). */
const PART_BYTES = 64 * 1024;
function parts<T>(items: T[]): T[][] {
  const out: T[][] = [];
  let part: T[] = [];
  let size = 0;
  for (const item of items) {
    const n = JSON.stringify(item).length;
    if (part.length && (part.length >= PART || size + n > PART_BYTES)) {
      out.push(part);
      part = [];
      size = 0;
    }
    part.push(item);
    size += n;
  }
  if (part.length) out.push(part);
  return out.length ? out : [[]];
}

/** When a page says it was last edited (its front matter's `modified`), in ms; undefined if it does not say. */
export function editedAt(bytes: Uint8Array): number | undefined {
  const head = new TextDecoder().decode(bytes.subarray(0, 4096));
  const fm = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(head);
  const m = fm && /^modified:\s*['"]?([^'"\r\n]+?)['"]?\s*$/m.exec(fm[1]);
  const t = m ? Date.parse(m[1]) : NaN;
  return Number.isNaN(t) ? undefined : t;
}

const newId = () => Math.random().toString(36).slice(2, 10);

export class SyncEngine {
  /** What both devices have, as far as this one knows (what it sent counts, before it arrives). */
  private known = new Map<string, Hash>();
  /** The leader's base: what the follower has confirmed, or sent itself. Saved for the next comparison. */
  private agreed = new Map<string, Hash>();
  /** The comparison's result, agreed once the follower confirms it has all of it. */
  private pendingFinal?: Map<string, Hash>;
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
  /** The follower's versions of files changed on both, held to compare (by the name they come under). */
  private holding = new Set<string>();
  private held = new Map<string, { bytes: Uint8Array<ArrayBuffer>; h: Hash }>();
  /** Files whose version here won over the other device's while comparing: sent again before the end. */
  private resend = new Set<string>();
  /** Files to send (once live) as the winner of a comparison: the other side keeps what it replaces. */
  private resolvedSend = new Set<string>();
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
    const { files: base, confirmed } = (await this.o.base?.load()) ?? { files: {}, confirmed: true };
    this.agreed = new Map(Object.entries(base));
    const L = this.mine!;
    const F = this.theirs;
    const push: string[] = [];
    const pull: string[] = [];
    const delMine: string[] = [];
    const delTheirs: string[] = [];
    const mkdirMine: string[] = [];
    const mkdirTheirs: string[] = [];
    const rmdirMine: string[] = [];
    const rmdirTheirs: string[] = [];
    const conflicts: [string, string][] = [];
    const final = new Map<string, Hash>();
    for (const path of new Set([...L.keys(), ...F.keys()])) {
      const l = L.get(path);
      const f = F.get(path);
      const b = base[path];
      if (l === DIR || f === DIR) {
        // A folder: one both had and one side removed goes on the other too (if nothing is left in it).
        if (l === DIR && f === DIR) final.set(path, DIR);
        else if (l === DIR && f === undefined) (confirmed && b === DIR ? rmdirMine : mkdirTheirs).push(path);
        else if (f === DIR && l === undefined) (b === DIR ? rmdirTheirs : mkdirMine).push(path);
        continue;
      }
      if (l === null || f === null) continue; // too big: stays where it is
      if (l === f) {
        if (l !== undefined) final.set(path, l);
        continue;
      }
      // Missing on the follower: deleted there, if the base can be trusted to say it had it.
      if (f === undefined) (confirmed && b !== undefined && l === b ? delMine : push).push(path);
      else if (l === undefined) (b !== undefined && f === b ? delTheirs : pull).push(path);
      else if (f === b) push.push(path);
      else if (l === b) pull.push(path);
      // Not in the base (or none): the follower's may just be an older version the leader had.
      else if (await this.o.hadVersion?.(path, f).catch(() => false)) push.push(path);
      else conflicts.push([path, await this.copyName(path, (p) => L.has(p) || F.has(p))]);
    }
    for (const dir of [...mkdirMine, ...mkdirTheirs]) final.set(dir, DIR);

    this.report({ phase: 'copying', done: 0, total: push.length + pull.length + conflicts.length * 3 + delMine.length + delTheirs.length });
    const plan = parts(delTheirs);
    for (let i = 0; i < plan.length; i++)
      await this.send({
        t: 'plan',
        del: plan[i],
        mkdir: i === 0 ? mkdirTheirs : [],
        rmdir: i === 0 ? rmdirTheirs : [],
        total: this.progress.total,
        last: i === plan.length - 1,
      });
    const raw = this.o.vault.raw;
    for (const path of delMine) {
      // Only if it is still as listed: saved meanwhile, it stays, and goes to the follower once live.
      if ((await this.hashes.of(raw, path)) === L.get(path) && !this.busy(path)) {
        await raw.remove(path);
        this.applied(path);
      } else this.dirty.add(path);
      this.step();
    }
    for (const dir of mkdirMine) {
      await raw.mkdir(dir);
      this.applied(dir);
    }

    this.expecting = pull.length + conflicts.length;
    for (const [, copy] of conflicts) this.holding.add(copy);
    this.finish = async () => {
      this.finish = undefined;
      for (const [path, copy] of conflicts) {
        const theirs = this.held.get(copy);
        this.held.delete(copy);
        this.holding.delete(copy);
        if (!theirs) {
          // Gone from the follower meanwhile: it gets this one.
          const h = await this.sendFile(path, 'sync');
          if (h) final.set(path, h);
        } else if (isText(path)) {
          const kept = await this.both(path, theirs.bytes, theirs.h);
          if (kept === 'there') final.set(path, theirs.h);
          else {
            const h = await this.sendFile(path, 'sync', { resolved: true });
            if (h) final.set(path, h);
          }
        } else {
          // Not text: both are kept, the follower's as a copy, on both devices.
          await this.writeLocal(copy, theirs.bytes, theirs.h, 'compare');
          final.set(copy, theirs.h);
          const h = await this.sendFile(path, 'sync');
          if (h) final.set(path, h);
          await this.sendFile(copy, 'sync');
          this.o.onConflict?.(path, copy);
        }
        this.step();
        this.step();
      }
      for (const [path, h] of this.received) if (!final.has(path)) final.set(path, h);
      this.received.clear();
      for (const path of this.resend) {
        const h = await this.sendFile(path, 'sync', { resolved: true });
        if (h) final.set(path, h);
      }
      this.resend.clear();
      for (const dir of rmdirMine) if (await this.emptyDir(dir)) await raw.remove(dir);
      const list = parts([...final]);
      for (let i = 0; i < list.length; i++) await this.send({ t: 'known', entries: list[i] });
      await this.send({ t: 'synced' });
      this.known = final;
      // Saved as the base once the follower says it has it all (see 'ack').
      this.pendingFinal = new Map(final);
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

  private busy(path: string) {
    return this.o.isBusy?.(path) ?? false;
  }

  /** No file (that syncs) left anywhere inside the folder. */
  private async emptyDir(dir: string): Promise<boolean> {
    const raw = this.o.vault.raw;
    if (!(await raw.exists(dir))) return false;
    for (const e of await raw.list(dir)) {
      if (!syncable(e.path)) continue;
      if (e.kind === 'file' || !(await this.emptyDir(e.path))) return false;
    }
    return true;
  }

  /**
   * Both devices changed `path`: this side's version against the other's (a text file). The latest
   * edit is kept, by the time the page says it was edited; when that says nothing (or the same), the
   * leader's. The one that loses goes into the page's version history: the other's here, through
   * keepVersion; this side's, through beforeOverwrite as it is replaced. Being edited here right now
   * makes this side's the latest. Returns which was kept; `here` must still be sent to the other side.
   */
  private async both(path: string, bytes: Uint8Array<ArrayBuffer>, h: Hash): Promise<'here' | 'there'> {
    const local = await this.readLocal(path);
    if (!local) {
      await this.writeLocal(path, bytes, h, 'compare');
      return 'there';
    }
    if (local.h === h) return 'there';
    let kept: 'here' | 'there';
    if (this.busy(path)) kept = 'here';
    else {
      const mine = editedAt(local.bytes);
      const theirs = editedAt(bytes);
      kept =
        mine !== undefined && theirs !== undefined && mine !== theirs
          ? mine > theirs
            ? 'here'
            : 'there'
          : this.o.role === 'leader'
            ? 'here'
            : 'there';
    }
    if (kept === 'there') await this.writeLocal(path, bytes, h, 'resolve');
    else await this.o.keepVersion?.(path, bytes, `From ${this.o.peerLabel}`);
    this.o.onResolved?.(path, kept);
    return kept;
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

  /** `resolved`: the latest of two edits; the receiver keeps the version it replaces in the page's history. */
  private async sendBytes(path: string, bytes: Uint8Array, h: Hash, mode: 'sync' | 'put', base?: Hash, resolved = false) {
    const id = newId();
    const n = Math.max(1, Math.ceil(bytes.length / CHUNK));
    for (let i = 0; i < n; i++)
      await this.send({ t: 'file', id, path, h, mode, base, i, n, ...(resolved ? { resolved } : {}) }, bytes.subarray(i * CHUNK, (i + 1) * CHUNK));
  }

  /** Send a file as it is now; `as` sends it under another name. Returns its fingerprint, or nothing if it is gone. */
  private async sendFile(path: string, mode: 'sync' | 'put', opts: { as?: string; base?: Hash; resolved?: boolean } = {}): Promise<Hash | undefined> {
    const local = await this.readLocal(path);
    if (!local) return undefined;
    await this.sendBytes(opts.as ?? path, local.bytes, local.h, mode, opts.base, opts.resolved);
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
      const resolved = this.resolvedSend.delete(path);
      if (local.h === before) return;
      await this.sendBytes(path, local.bytes, local.h, 'put', before, resolved);
      this.known.set(path, local.h);
      return;
    }
    if (await raw.exists(path)) {
      if (!(await raw.stat(path))) await this.send({ t: 'mkdir', path }); // a directory
      return;
    }
    const inside = [...this.known.keys()].filter((k) => k.startsWith(path + '/'));
    const dir = this.known.get(path) === DIR || inside.length > 0 || !this.known.has(path);
    await this.send({ t: 'del', path, base: this.known.get(path), dir });
    this.known.delete(path);
    for (const k of inside) this.known.delete(k);
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
        // Everything the comparison sent came before this, and is written: say so.
        await this.send({ t: 'ack', synced: true });
        this.goLive();
        return;
      case 'ack':
        return this.onAck(header);
      case 'del':
        return this.onDelete(header);
      case 'mkdir':
        await this.o.vault.raw.mkdir(header.path as string);
        this.applied(header.path as string);
        if (this.live) await this.have(header.path as string, DIR);
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
    for (const dir of (header.rmdir as string[] | undefined) ?? [])
      if (await this.emptyDir(dir)) {
        await raw.remove(dir);
        this.applied(dir);
      }
    for (const path of header.del as string[]) {
      // Only if it has not changed here since the list was made (if it has, the change is sent once live).
      if ((await this.hashes.of(raw, path)) === this.mine?.get(path) && !this.busy(path)) {
        await raw.remove(path);
        this.applied(path);
      } else this.dirty.add(path);
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
      await this.onSyncFile(path, bytes, h, !!header.resolved);
      this.step();
      if (this.o.role === 'leader') {
        this.expecting--;
        if (this.expecting === 0) await this.finish?.();
      }
      return;
    }
    await this.onPut(path, bytes, h, header.base as Hash | undefined, !!header.resolved);
  }

  /**
   * A file the comparison decided this side should take. Written only if the file is still as this
   * side listed it (and not being edited): saved meanwhile, the two versions are compared again.
   */
  private async onSyncFile(path: string, bytes: Uint8Array<ArrayBuffer>, h: Hash, resolved: boolean) {
    if (this.holding.has(path)) {
      this.held.set(path, { bytes, h });
      return;
    }
    const now = await this.hashes.of(this.o.vault.raw, path);
    if (now === null) return; // too big here to compare: stays
    const leader = this.o.role === 'leader';
    if (now !== h && (now !== this.mine?.get(path) || this.busy(path))) {
      const kept = isText(path) ? await this.both(path, bytes, h) : await this.keepBoth(path, bytes, h);
      if (kept === 'there') {
        if (leader) this.received.set(path, h);
      } else if (leader) this.resend.add(path);
      else {
        // The follower's own goes back once live, as the latest.
        this.resolvedSend.add(path);
        this.dirty.add(path);
      }
      return;
    }
    if (now !== h) {
      await this.writeLocal(path, bytes, h, resolved && now !== undefined ? 'resolve' : 'compare');
      // The other side's edit was the latest: this side's is in the page's history.
      if (resolved && now !== undefined) this.o.onResolved?.(path, 'there');
    }
    if (leader) this.received.set(path, h);
  }

  /** Not text: this side's stays, the other's is kept beside it as a copy, and both go to the other side. */
  private async keepBoth(path: string, bytes: Uint8Array<ArrayBuffer>, h: Hash): Promise<'here'> {
    const copy = await this.copyName(path, (p) => this.o.vault.raw.exists(p));
    await this.writeLocal(copy, bytes, h, 'live');
    this.o.onConflict?.(path, copy);
    this.dirty.add(copy);
    if (this.live) this.schedule(copy);
    return 'here';
  }

  /** A file changed on the other device. `resolved`: it won over this side's version, which goes into the history. */
  private async onPut(path: string, bytes: Uint8Array<ArrayBuffer>, h: Hash, base: Hash | undefined, resolved = false) {
    const current = await this.hashes.of(this.o.vault.raw, path);
    if (current === h) {
      this.known.set(path, h);
      await this.have(path, h);
      return;
    }
    if (current === null) return; // too big to compare: keep this device's
    const busy = this.busy(path);
    if (!busy && (current === undefined || current === base)) {
      await this.writeLocal(path, bytes, h, resolved ? 'resolve' : 'live');
      if (resolved && current !== undefined) this.o.onResolved?.(path, 'there');
      this.known.set(path, h);
      await this.have(path, h);
      return;
    }
    // Changed on both: the latest edit is kept (text), or both (anything else).
    this.known.set(path, h);
    if (!isText(path)) {
      await this.keepBoth(path, bytes, h);
      if (!busy) await this.sendChange(path);
      return;
    }
    const kept = await this.both(path, bytes, h);
    if (kept === 'there') await this.have(path, h);
    else {
      this.resolvedSend.add(path);
      if (!busy) await this.sendChange(path);
    }
  }

  private async onDelete(header: Message) {
    const raw = this.o.vault.raw;
    const path = header.path as string;
    if (header.dir) {
      // File by file: what was changed or added here since stays (and goes back to the other side).
      const kept: string[] = [];
      const removed: string[] = [];
      const visit = async (dir: string) => {
        for (const e of await raw.list(dir).catch(() => [])) {
          if (e.kind === 'directory') await visit(e.path);
          else if (!syncable(e.path)) continue;
          else if ((await this.hashes.of(raw, e.path)) === this.known.get(e.path) && !this.busy(e.path)) removed.push(e.path);
          else kept.push(e.path);
        }
      };
      await visit(path);
      for (const k of [...this.known.keys()]) if (k === path || k.startsWith(path + '/')) this.known.delete(k);
      if (!kept.length) {
        await raw.remove(path);
        this.applied(path);
        await this.have(path, null, true);
        return;
      }
      for (const file of removed) {
        await raw.remove(file);
        this.applied(file);
        await this.have(file, null);
      }
      for (const file of kept) await this.sendChange(file);
      return;
    }
    const current = await this.hashes.of(raw, path);
    this.known.delete(path);
    if (current === null) return;
    if (current === undefined) return this.have(path, null);
    if (current !== header.base) {
      // Changed here since: keep it, and give it back to the other device.
      await this.sendChange(path);
      return;
    }
    await raw.remove(path);
    this.applied(path);
    await this.have(path, null);
  }

  /**
   * Both devices now have this version of `path` (null: neither has it). The follower tells the
   * leader; the leader, which got it from the follower, takes it into the base.
   */
  private async have(path: string, h: Hash | null, dir = false) {
    if (this.o.role === 'follower') {
      await this.send({ t: 'ack', path, h, dir });
      return;
    }
    this.agree(path, h, dir);
  }

  private agree(path: string, h: Hash | null, dir: boolean) {
    if (h !== null) this.agreed.set(path, h);
    else {
      this.agreed.delete(path);
      if (dir) for (const k of [...this.agreed.keys()]) if (k.startsWith(path + '/')) this.agreed.delete(k);
    }
    this.baseChanged();
  }

  /** The follower has what the leader sent: it is agreed, and the base for the next comparison. */
  private async onAck(header: Message) {
    if (this.o.role !== 'leader') return;
    if (header.synced) {
      if (!this.pendingFinal) return;
      this.agreed = this.pendingFinal;
      this.pendingFinal = undefined;
      await this.saveBase();
      return;
    }
    this.agree(header.path as string, (header.h as Hash | null) ?? null, !!header.dir);
  }

  private async writeLocal(path: string, bytes: Uint8Array<ArrayBuffer>, h: Hash, when: 'compare' | 'live' | 'resolve') {
    const raw = this.o.vault.raw;
    if (this.o.beforeOverwrite && (await raw.stat(path))) await this.o.beforeOverwrite(path, when);
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
    await this.o.base?.save(Object.fromEntries(this.agreed)).catch((err) => console.warn('Could not save the sync state', err));
  }
}
