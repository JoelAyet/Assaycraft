/**
 * Version history of the notebook's documents, kept in the notebook itself (.assaycraft/history), one
 * JSON file per document. The newest stored version is kept in full; each older one only as the
 * change from the version after it ("reverse deltas"), so a long history of a text file stays small.
 * Older versions are thinned out: all from the last day, then one per hour for a week, one per day
 * for three months and one per week after that. The document's own file is always the current version.
 */
import type { Vault } from '../fs/types';
import { sanitizeFileName } from '../lib/path';
import { applyPatch, makePatch, type Patch } from './diff';

export const HISTORY_DIR = '.assaycraft/history';

export interface Version {
  /** When this version was saved (ms since 1970). */
  t: number;
  /** Characters in this version. */
  size: number;
  /** Kept whatever its age, e.g. the version from before a restore. */
  keep?: boolean;
  label?: string;
  /** Turns this version's text into the next older version's. Absent on the oldest. */
  back?: Patch;
}

export interface HistoryFile {
  v: 1;
  /** The document's path when this was last written. */
  path: string;
  /** Full text of versions[0]. */
  head: string;
  /** Newest first. */
  versions: Version[];
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;
export const MAX_VERSIONS = 500;

/** FNV-1a, to tell apart long paths that look the same once shortened. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Where a document's history lives: by its ID when it has one (IDs survive renames), else by its path. */
export function historyPathFor(doc: { id?: string; path: string }): string {
  if (doc.id) return `${HISTORY_DIR}/${sanitizeFileName(doc.id, 'doc')}.json`;
  const readable = sanitizeFileName(doc.path.replace(/\.md$/, '').replace(/\//g, ' ~ '), 'doc').slice(-80);
  return `${HISTORY_DIR}/${readable} ${hash(doc.path)}.json`;
}

/** Every stored version's full text, newest first. */
export function versionTexts(h: HistoryFile): string[] {
  const out = [h.head];
  for (let i = 0; i < h.versions.length - 1; i++) out.push(applyPatch(out[i], h.versions[i].back ?? []));
  return out;
}

/** Rebuild the chain of changes for a list of full texts (newest first). */
function fromTexts(path: string, versions: Omit<Version, 'back'>[], texts: string[]): HistoryFile {
  return {
    v: 1,
    path,
    head: texts[0],
    versions: versions.map((ver, i) => (i < texts.length - 1 ? { ...ver, back: makePatch(texts[i], texts[i + 1]) } : { ...ver })),
  };
}

/** Add `text` as the newest version (nothing new if it is the same as the newest one). */
export function addVersion(h: HistoryFile | null, path: string, text: string, t: number, opts: { keep?: boolean; label?: string } = {}): HistoryFile {
  const meta: Version = { t, size: text.length, ...(opts.keep ? { keep: true } : {}), ...(opts.label ? { label: opts.label } : {}) };
  if (!h || !h.versions.length) return { v: 1, path, head: text, versions: [meta] };
  if (h.head === text) {
    if (!opts.keep && !opts.label) return { ...h, path };
    const [first, ...rest] = h.versions;
    return { ...h, path, versions: [{ ...first, keep: first.keep || opts.keep || undefined, label: opts.label ?? first.label }, ...rest] };
  }
  return { v: 1, path, head: text, versions: [{ ...meta, back: makePatch(text, h.head) }, ...h.versions] };
}

/**
 * Which versions to keep: the newest and the oldest, those marked to keep, everything from the
 * last day, then the newest one per hour (up to a week), per day (up to 90 days) and per week.
 */
export function keepFlags(versions: Pick<Version, 't' | 'keep' | 'label'>[], now: number): boolean[] {
  const seen = new Set<string>();
  let kept = 0;
  return versions.map((ver, i) => {
    const always = i === 0 || i === versions.length - 1 || !!ver.keep || !!ver.label;
    const age = now - ver.t;
    let keep = always || age < DAY;
    if (!keep) {
      const bucket =
        age < 7 * DAY ? `h${Math.floor(ver.t / HOUR)}` : age < 90 * DAY ? `d${Math.floor(ver.t / DAY)}` : `w${Math.floor(ver.t / (7 * DAY))}`;
      keep = !seen.has(bucket);
      seen.add(bucket);
    }
    // A hard cap, whatever happens: the oldest ones beyond it go (except the first and those marked).
    if (keep && !always && kept >= MAX_VERSIONS - 1) keep = false;
    if (keep) kept++;
    return keep;
  });
}

export function thin(h: HistoryFile, now: number): HistoryFile {
  const flags = keepFlags(h.versions, now);
  if (flags.every(Boolean)) return h;
  const texts = versionTexts(h);
  const versions = h.versions.filter((_, i) => flags[i]).map(({ back: _, ...rest }) => rest);
  return fromTexts(
    h.path,
    versions,
    texts.filter((_, i) => flags[i]),
  );
}

// ───────────── In the notebook ─────────────

export async function readHistory(v: Vault, file: string): Promise<HistoryFile | null> {
  try {
    if (!(await v.exists(file))) return null;
    const h = JSON.parse(await v.readText(file)) as HistoryFile;
    return h && h.v === 1 && typeof h.head === 'string' && Array.isArray(h.versions) ? h : null;
  } catch {
    return null;
  }
}

async function writeHistory(v: Vault, file: string, h: HistoryFile) {
  if (!(await v.exists(HISTORY_DIR))) {
    if (!(await v.exists('.assaycraft'))) await v.mkdir('.assaycraft');
    await v.mkdir(HISTORY_DIR);
  }
  await v.write(file, JSON.stringify(h));
}

/** One change at a time per history file. */
const queues = new Map<string, Promise<unknown>>();
function queued<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(file) ?? Promise.resolve()).catch(() => undefined).then(fn);
  queues.set(file, next);
  void next.finally(() => queues.get(file) === next && queues.delete(file));
  return next;
}

/** Store a version of a document (and thin out the old ones). */
export function recordVersion(
  v: Vault,
  doc: { id?: string; path: string },
  text: string,
  t: number,
  opts: { keep?: boolean; label?: string } = {},
): Promise<void> {
  const file = historyPathFor(doc);
  return queued(file, async () => {
    const before = await readHistory(v, file);
    const after = thin(addVersion(before, doc.path, text, t, opts), Date.now());
    if (after !== before) await writeHistory(v, file, after);
  });
}

/** A document without an ID was renamed or moved: its history follows it. */
export function moveHistory(v: Vault, from: { path: string }, to: { path: string }): Promise<void> {
  const a = historyPathFor(from);
  const b = historyPathFor(to);
  if (a === b) return Promise.resolve();
  return queued(a, async () => {
    const h = await readHistory(v, a);
    if (!h) return;
    await writeHistory(v, b, { ...h, path: to.path });
    await v.remove(a).catch(() => undefined);
  });
}

/** Wait for history being written (e.g. before showing it). */
export async function flushHistory(): Promise<void> {
  await Promise.all([...queues.values()].map((p) => p.catch(() => undefined)));
}
