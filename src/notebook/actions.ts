/**
 * Notebook operations: open/scan, read/write docs, create entries/templates/boards/cards,
 * rename, move, trash. The store holds every doc's metadata; open editors register a body getter
 * so all writes (body or metadata) for a path go through one debounced, serialized pipeline.
 */
import type { JSONContent } from '@tiptap/core';
import { strFromU8, strToU8, zipSync, unzipSync } from 'fflate';
import type { Vault } from '../fs/types';
import { copyFile, moveDir, moveFile, uniquePath, walk } from '../fs/ops';
import { basename, dirname, extname, isInside, join, relative, sanitizeFileName, setAsciiFileNames, splitPath, stem } from '../lib/path';
import { localDate, localIso, timeOfDay } from '../lib/dates';
import { moveReminder, setReminderDone } from '../reminders/model';

import { docSchema } from '../editor/schema';
import { parseMarkdown } from '../markdown/parse';
import { serializeMarkdown, sheetToMarkdown } from '../markdown/serialize';
import {
  builtinValues,
  collectVariables,
  expandIncludes,
  fillVariables,
  lintTemplate,
  markAssets,
  relocateAssets,
  resetFlows,
  type IncludeResolver,
} from '../templates/engine';
import { joinFrontMatter, splitFrontMatter } from './frontmatter';
import {
  DEFAULT_ENTRY_STATUSES,
  LAYOUT,
  boardCards,
  cardNoun,
  frontMatterFromMeta,
  metaFromFrontMatter,
  slugify,
  type BoardCards,
  type ColorName,
  type DocKind,
  type DocMeta,
  type NotebookConfig,
  type Revision,
  type StatusOption,
} from './model';
import { defaultConfig, getState, hashToRoute, navigate, setState, toast, type SaveState } from './store';
import { FIGURE_SRC } from '../pdf/layout';
import type { ConvertedPdf } from '../pdf/convert';
import { bodyFacts } from './text';
import { replaceFlowStep, setFlowStepDate } from '../flow/model';
import { seedNotebook } from './seed';
import { stockType, writeStockTable, type StockTable } from '../stocks/model';
import { citationKey, refExtra, refFromMeta, type RefInfo } from '../literature/model';
import { TRASH_DIR, TRASH_INDEX, listTrash, parseTrashIndex, serializeTrashIndex, type TrashItem, type TrashRecord } from './trash';
import { HISTORY_DIR, historyPathFor, moveHistory, recordVersion } from '../history/store';
import { ACTIVITY_FILE, flushActivity, importActivity, loadActivity, recordEdit, reloadActivity } from './activity';
import { SyncableVault } from '../sync/vault';
import { setSyncHooks, startSync, stopSync } from '../sync/manager';
import { startFeed, stopFeed } from '../calendar/feed';

// ───────────────────────────── helpers ─────────────────────────────

function vault(): Vault {
  const v = getState().vault;
  if (!v) throw new Error('No notebook is open');
  return v;
}

export function kindForPath(path: string, fmKind?: unknown): DocKind | null {
  if (extname(path) !== '.md') return null;
  if (isInside(path, LAYOUT.boards)) return basename(path) === LAYOUT.boardFile ? 'board' : 'card';
  if (isInside(path, LAYOUT.templates)) {
    if (fmKind === 'subtemplate' || fmKind === 'template') return fmKind;
    return isInside(path, LAYOUT.subtemplates) ? 'subtemplate' : 'template';
  }
  if (isInside(path, LAYOUT.projects)) return 'entry';
  if (isInside(path, LAYOUT.protocols)) return 'protocol';
  if (isInside(path, LAYOUT.stocks)) return 'stocks';
  if (isInside(path, LAYOUT.notes)) return 'note';
  if (isInside(path, LAYOUT.literature)) return 'reference';
  return null;
}

function skipEntry(e: { name: string; kind: string }) {
  return e.name.startsWith('.') || (e.kind === 'directory' && e.name === LAYOUT.attachments);
}

export function projectOf(path: string): string {
  const parts = splitPath(path);
  return parts[0] === LAYOUT.projects && parts.length > 2 ? parts[1] : '';
}

export function boardFolderOf(cardPath: string): string {
  return dirname(cardPath);
}

/** Attachments folder of a doc: "<folder>/attachments/<id>" */
export function attachmentsDir(path: string, id: string): string {
  return join(dirname(path), LAYOUT.attachments, id || stem(path));
}

function setSave(saveState: SaveState) {
  if (getState().saveState !== saveState) setState({ saveState });
}

// ───────────────────────────── open / scan ─────────────────────────────

const isConfigFile = (path: string) => path === LAYOUT.config || (LAYOUT.legacyConfigs as readonly string[]).includes(path);

async function loadConfig(v: Vault): Promise<NotebookConfig | null> {
  // Notebooks made before the app was renamed keep their settings in labcraft.json (or genecraft.json): move it.
  const legacy = (await v.stat(LAYOUT.config)) ? undefined : await findAsync(LAYOUT.legacyConfigs, async (p) => !!(await v.stat(p)));
  if (legacy) {
    const text = await v.readText(legacy);
    let moved = text;
    try {
      moved = JSON.stringify({ ...JSON.parse(text), app: 'assaycraft' }, null, 2) + '\n';
    } catch {
      // Unreadable: move it as it is, and the defaults apply below.
    }
    await v.write(LAYOUT.config, moved);
    await v.remove(legacy).catch(() => {});
  }
  if (!(await v.stat(LAYOUT.config))) return null;
  try {
    const raw = JSON.parse(await v.readText(LAYOUT.config)) as Partial<NotebookConfig>;
    const base = defaultConfig(v.name);
    return {
      ...base,
      ...raw,
      app: 'assaycraft',
      version: 1,
      entryStatuses: Array.isArray(raw.entryStatuses) && raw.entryStatuses.length ? raw.entryStatuses : DEFAULT_ENTRY_STATUSES,
    };
  } catch {
    return defaultConfig(v.name);
  }
}

export async function saveConfig(patch: Partial<NotebookConfig>) {
  const config = { ...getState().config, ...patch };
  setState({ config });
  await vault().write(LAYOUT.config, JSON.stringify(config, null, 2) + '\n');
}

async function findAsync<T>(items: readonly T[], test: (item: T) => Promise<boolean>): Promise<T | undefined> {
  for (const item of items) if (await test(item)) return item;
  return undefined;
}

/** Version history and activity of notebooks made before the app was renamed are in .labcraft: move them. */
async function moveLegacyAppDir(v: Vault) {
  // Both there (an old copy of the app wrote to the old folder again): keep the old one as it is rather than mix them.
  if (!(await v.exists(LAYOUT.legacyAppDir)) || (await v.exists(LAYOUT.appDir))) return;
  await moveDir(v, LAYOUT.legacyAppDir, LAYOUT.appDir);
}

async function readMeta(v: Vault, path: string, kindHint: DocKind, mtime: number): Promise<DocMeta | null> {
  const text = await v.readText(path);
  const { data, body } = splitFrontMatter(text);
  const kind = kindForPath(path, data.kind) ?? kindHint;
  const fallback = kind === 'board' ? basename(dirname(path)) : stem(path).replace(/^[A-Z]{1,6}-\d+\s+/, '');
  const meta = metaFromFrontMatter(path, kind, data, fallback);
  return { ...meta, mtime, ...bodyFacts(body, kind) };
}

export async function scanVault(v: Vault, prev: Record<string, DocMeta>): Promise<{ docs: Record<string, DocMeta>; folders: string[] }> {
  const docs: Record<string, DocMeta> = {};
  const folders: string[] = [];
  const files: string[] = [];
  for (const root of [LAYOUT.projects, LAYOUT.protocols, LAYOUT.stocks, LAYOUT.templates, LAYOUT.boards, LAYOUT.notes, LAYOUT.literature]) {
    for (const e of await walk(v, root, skipEntry)) {
      if (e.kind === 'directory') {
        if (root === LAYOUT.projects) folders.push(e.path);
      } else if (extname(e.path) === '.md') files.push(e.path);
    }
  }
  const queue = [...files];
  const worker = async () => {
    for (let path = queue.shift(); path; path = queue.shift()) {
      try {
        const stat = await v.stat(path);
        if (!stat) continue;
        const old = prev[path];
        if (old && old.mtime === stat.lastModified) {
          docs[path] = old;
          continue;
        }
        const kind = kindForPath(path);
        if (!kind) continue;
        const meta = await readMeta(v, path, kind, stat.lastModified);
        if (meta) docs[path] = meta;
      } catch (err) {
        console.warn('Could not read', path, err);
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  folders.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
  return { docs, folders };
}

/** Whether the folder can store file names such as "CaCl₂ 10 µM.md". */
async function supportsUnicodeNames(v: Vault): Promise<boolean> {
  if (v.kind === 'browser') return true;
  const probe = '.assaycraft-name-test-µ₂';
  try {
    await v.write(probe, '');
  } catch {
    // Nothing was created. Do not try to remove it: on such systems the name may resolve to the folder itself.
    return false;
  }
  await v.remove(probe).catch(() => undefined);
  return true;
}

/** Open a notebook, creating it first in an empty folder. Resolves true when it was just created. */
export async function openNotebook(opened: Vault, opts: { seed?: boolean } = {}): Promise<boolean> {
  // Every change goes through this wrapper, so a connected phone or computer can be sent it.
  const v = opened instanceof SyncableVault ? opened : new SyncableVault(opened);
  setState({ loading: true });
  try {
    setAsciiFileNames(!(await supportsUnicodeNames(v)));
    let config = await loadConfig(v);
    await moveLegacyAppDir(v).catch((err) => console.warn('Could not move .labcraft to .assaycraft:', err));
    const created = !config;
    if (!config) {
      config = defaultConfig(v.name);
      await v.write(LAYOUT.config, JSON.stringify(config, null, 2) + '\n');
      for (const d of [
        LAYOUT.projects,
        LAYOUT.protocols,
        LAYOUT.stocks,
        LAYOUT.templates,
        LAYOUT.subtemplates,
        LAYOUT.boards,
        LAYOUT.notes,
        LAYOUT.literature,
      ])
        await v.mkdir(d);
      if (opts.seed !== false) await seedNotebook(v, config);
    }
    const { docs, folders } = await scanVault(v, {});
    await loadActivity(v);
    const trash = await listTrash(v).catch(() => []);
    setState({ vault: v, config, docs, folders, trash, docKeys: {}, loading: false, route: hashToRoute(location.hash) });
    void startSync(v).catch((err) => console.warn('Could not start syncing with paired devices', err));
    void startFeed(v.id);
    return created;
  } catch (err) {
    setState({ loading: false });
    throw err;
  }
}

export async function closeNotebook() {
  await flushAllWrites();
  stopSync();
  stopFeed();
  await loadActivity(null);
  setState({ vault: null, docs: {}, folders: [], route: { name: 'home' }, peek: null });
  history.replaceState(null, '', '#/');
}

let rescanning: Promise<void> | null = null;
let rescanAgain: Promise<void> | null = null;
/** Re-read files that changed on disk (e.g. edited in another app). */
export function rescan(): Promise<void> {
  // A file may have changed after the running scan read it: one more scan follows that one.
  if (rescanning) {
    const next = () => {
      rescanAgain = null;
      return rescan();
    };
    return (rescanAgain ??= rescanning.then(next, next));
  }
  const v = getState().vault;
  if (!v) return Promise.resolve();
  setState({ scanning: true });
  rescanning = (async () => {
    try {
      const before = getState().docs;
      const { docs, folders } = await scanVault(v, before);
      await reloadActivity(v);
      // Keep metadata of docs with pending writes (the store is ahead of the disk).
      for (const p of pending.keys()) if (before[p]) docs[p] = before[p];
      setState({ docs, folders });
      await loadTrash();
      for (const [path, listener] of externalListeners) {
        const now = docs[path];
        const known = lastWritten.get(path);
        if (now && known !== undefined && now.mtime !== known && !pending.has(path)) {
          lastWritten.set(path, now.mtime);
          listener();
        }
      }
    } finally {
      rescanning = null;
      setState({ scanning: false });
    }
  })();
  return rescanning;
}

// ───────────────────────────── read / write ─────────────────────────────

export async function readDoc(path: string): Promise<{ meta: DocMeta; body: string }> {
  const v = vault();
  // The date first: a file written in between (by the other device) then reads as changed, and reloads.
  const stat = await v.stat(path);
  const text = await v.readText(path);
  const { data, body } = splitFrontMatter(text);
  const kind = kindForPath(path, data.kind) ?? 'entry';
  const fallback = kind === 'board' ? basename(dirname(path)) : stem(path).replace(/^[A-Z]{1,6}-\d+\s+/, '');
  const meta: DocMeta = { ...metaFromFrontMatter(path, kind, data, fallback), mtime: stat?.lastModified ?? 0, ...bodyFacts(body, kind) };
  lastWritten.set(path, meta.mtime);
  return { meta, body };
}

const chains = new Map<string, Promise<unknown>>();
function serialized<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(path) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  chains.set(path, next);
  void next.finally(() => {
    if (chains.get(path) === next) chains.delete(path);
  });
  return next;
}

/** Open editors register here so metadata-only writes use their live body. */
const openBodies = new Map<string, () => string>();
const externalListeners = new Map<string, () => void>();
const lastWritten = new Map<string, number>();
/** Body known to be on disk (as the editor would write it), to skip writes when nothing changed. */
const lastBodies = new Map<string, string>();
/** Docs whose metadata changed since their last write. */
const metaDirty = new Set<string>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();

export function registerOpenDoc(path: string, getBody: () => string, onExternalChange: () => void, loadedBody?: string) {
  openBodies.set(path, getBody);
  externalListeners.set(path, onExternalChange);
  if (loadedBody !== undefined) lastBodies.set(path, loadedBody);
  return () => {
    if (openBodies.get(path) === getBody) {
      openBodies.delete(path);
      externalListeners.delete(path);
    }
  };
}

/** Tell the save pipeline what is on disk now (after reloading external changes). */
export function setLoadedBody(path: string, body: string) {
  lastBodies.set(currentPath(path), body);
}

function rekeyOpenDoc(from: string, to: string) {
  const move = <T>(m: Map<string, T>) => {
    if (!m.has(from)) return;
    m.set(to, m.get(from)!);
    m.delete(from);
  };
  move(openBodies);
  move(externalListeners);
  move(lastWritten);
  move(lastBodies);
  if (metaDirty.delete(from)) metaDirty.add(to);
}

async function writeNow(path: string, bodyOverride?: string) {
  const v = vault();
  await serialized(path, async () => {
    const meta = getState().docs[path];
    if (!meta) return;
    const live = bodyOverride ?? openBodies.get(path)?.();
    const known = lastBodies.get(path);
    const bodyChanged = live !== undefined && live !== known;
    if (!bodyChanged && !metaDirty.has(path)) return; // nothing new to write
    let body = live;
    if (body === undefined) body = splitFrontMatter(await v.readText(path)).body;
    const edited = bodyChanged && known !== undefined;
    const written: DocMeta = edited ? { ...meta, modified: localIso() } : meta;
    const metaChanged = metaDirty.delete(path);
    await versionBeforeWrite(v, path, meta);
    await v.write(path, joinFrontMatter(frontMatterFromMeta(written), body));
    if (edited || metaChanged) recordEdit(written);
    lastBodies.set(path, body);
    const stat = await v.stat(path);
    const mtime = stat?.lastModified ?? Date.now();
    lastWritten.set(path, mtime);
    const cur = getState().docs[path];
    if (cur) setState((s) => ({ docs: { ...s.docs, [path]: { ...cur, modified: written.modified, mtime, ...bodyFacts(body!, cur.kind) } } }));
  });
}

// ───────────────────────────── version history ─────────────────────────────

/** An editing session ends after 10 minutes without saving, or after an hour of saving. */
const SESSION_IDLE = 10 * 60_000;
const SESSION_MAX = 60 * 60_000;
const sessions = new Map<string, { start: number; last: number }>();

/**
 * At the first save of an editing session, the file as it was becomes a version in the history.
 * (The file itself is always the current version, so this keeps one version per session.)
 */
async function versionBeforeWrite(v: Vault, path: string, meta: DocMeta) {
  const now = Date.now();
  const s = sessions.get(path);
  const fresh = !s || now - s.last > SESSION_IDLE || now - s.start > SESSION_MAX;
  sessions.set(path, fresh ? { start: now, last: now } : { start: s.start, last: now });
  if (!fresh) return;
  try {
    const stat = await v.stat(path);
    if (!stat) return; // a new file: nothing came before it
    const text = await v.readText(path);
    void recordVersion(v, meta, text, stat.lastModified || now).catch((err) => console.warn('Could not keep a version of', path, err));
  } catch (err) {
    console.warn('Could not keep a version of', path, err);
  }
}

/** Paths reloaded because a version was restored (their editors reload without the "changed outside" note). */
const quietReloads = new Set<string>();
export function takeQuietReload(path: string): boolean {
  return quietReloads.delete(path);
}

/** Put an earlier version back. The version it replaces is kept in the history (marked), so this can be undone. */
export async function restoreVersion(stalePath: string, text: string) {
  const path = currentPath(stalePath);
  const meta = getState().docs[path];
  if (!meta) return;
  await flushWrite(path);
  const v = vault();
  const { data, body } = splitFrontMatter(text);
  const restored = joinFrontMatter({ ...data, modified: localIso() }, body);
  await serialized(path, async () => {
    const stat = await v.stat(path);
    if (stat) await recordVersion(v, meta, await v.readText(path), stat.lastModified || Date.now(), { label: 'Before restoring' });
    await v.write(path, restored);
  });
  lastBodies.set(path, body);
  sessions.delete(path);
  quietReloads.add(path);
  recordEdit(meta);
  await rescan();
  // A doc whose editor was not open has nothing to reload.
  setTimeout(() => quietReloads.delete(path), 2000);
}

function anyPending() {
  return pending.size > 0 || chains.size > 0;
}

/** Debounced save of a doc (metadata from the store, body from the open editor or the file). */
export function scheduleWrite(path: string, delay = 600) {
  const t = pending.get(path);
  if (t) clearTimeout(t);
  setSave('pending');
  pending.set(
    path,
    setTimeout(() => {
      pending.delete(path);
      void runWrite(path);
    }, delay),
  );
}

async function runWrite(path: string, body?: string) {
  setSave('saving');
  try {
    await writeNow(path, body);
    if (!anyPending()) setSave('saved');
  } catch (err) {
    console.error(err);
    setSave('error');
    toast(`Could not save ${basename(path)}: ${(err as Error).message}`, 'error');
  }
}

export async function flushWrite(stalePath: string) {
  const path = currentPath(stalePath);
  const t = pending.get(path);
  if (t) {
    clearTimeout(t);
    pending.delete(path);
    await runWrite(path);
  }
  await chains.get(path)?.catch(() => undefined);
}

export async function flushAllWrites() {
  await Promise.all([...pending.keys()].map(flushWrite));
  await Promise.all([...chains.values()].map((p) => p.catch(() => undefined)));
  await flushActivity();
}

export function hasPendingWrites() {
  return anyPending();
}

export function hasPendingWrite(path: string) {
  return pending.has(currentPath(path));
}

/** Write a body right away (used when an editor closes, so nothing waits on a timer). */
export async function saveBody(stalePath: string, body: string) {
  // The notebook was closed (Switch notebook): it saved every open page first, so there is nothing left to write.
  if (!getState().vault) return;
  const path = currentPath(stalePath);
  const t = pending.get(path);
  if (t) {
    clearTimeout(t);
    pending.delete(path);
  }
  await runWrite(path, body);
}

/** Link an entry to step `index` of the flow kept in another page (from the step bar), writing that page's file. */
export async function linkFlowStep(parentPath: string, index: number, entry: DocMeta) {
  const path = currentPath(parentPath);
  if (openBodies.has(path)) throw new Error('Its flow is open in another editor');
  await flushWrite(path);
  const { body } = await readDoc(path);
  const next = replaceFlowStep(body, index, { title: entry.title, ref: entry.id, href: relative(dirname(path), entry.path) });
  if (next === undefined) throw new Error('The flow no longer has that step');
  await runWrite(path, next);
}

/** Rewrite a page's body (from its open editor, or its file) and save it, reloading an open editor quietly. */
async function rewriteBody(stalePath: string, edit: (body: string) => string | undefined, missing: string) {
  const path = currentPath(stalePath);
  await flushWrite(path);
  const open = openBodies.get(path);
  const body = open ? open() : (await readDoc(path)).body;
  const next = edit(body);
  if (next === undefined) throw new Error(missing);
  await runWrite(path, next);
  const reload = externalListeners.get(path);
  if (reload) {
    quietReloads.add(path);
    reload();
  }
}

/** Plan step `index` of the flow in a page for another day (from the calendar). */
export function updateFlowStepDate(stalePath: string, index: number, date: string) {
  return rewriteBody(stalePath, (body) => setFlowStepDate(body, index, date), 'That step is no longer in its flow');
}

/** Move a reminder in a page to another day (keeping its time), or tick it off, writing the page's file. */
export async function updateReminder(stalePath: string, index: number, change: { date: string } | { done: boolean }) {
  return rewriteBody(
    stalePath,
    (body) => ('date' in change ? moveReminder(body, index, change.date) : setReminderDone(body, index, change.done)),
    'That reminder is no longer in its page',
  );
}

/** Update metadata in the store immediately and save it shortly after. */
export function patchMeta(stalePath: string, patch: Partial<DocMeta>, delay = 500) {
  const path = currentPath(stalePath);
  const cur = getState().docs[path];
  if (!cur) return;
  const next: DocMeta = { ...cur, ...patch, modified: localIso() };
  setState((s) => ({ docs: { ...s.docs, [path]: next } }));
  metaDirty.add(path);
  scheduleWrite(path, delay);
}

/** Record that an open editor's content changed. */
export function touchDoc(stalePath: string) {
  const path = currentPath(stalePath);
  if (!getState().docs[path]) return;
  scheduleWrite(path);
}

/** Create a new doc file from metadata + body. */
async function createDoc(path: string, meta: Omit<DocMeta, 'path' | 'mtime' | 'text'>, body: string): Promise<string> {
  const full: DocMeta = { ...meta, path, mtime: 0, ...bodyFacts(body, meta.kind) };
  setState((s) => ({ docs: { ...s.docs, [path]: full } }));
  metaDirty.add(path);
  await writeNow(path, body);
  return path;
}

// ───────────────────────────── ids ─────────────────────────────

const reserved = new Set<string>();

export function nextId(prefix: string, digits: number): string {
  let max = 0;
  const consider = (id: string) => {
    if (!id.startsWith(prefix)) return;
    const n = parseInt(id.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  };
  for (const d of Object.values(getState().docs)) consider(d.id);
  for (const id of reserved) consider(id);
  // Nor are those of trashed pages, so a restored page never meets its own ID on another.
  for (const t of getState().trash) if (t.id) consider(t.id);
  const id = prefix + String(max + 1).padStart(digits, '0');
  reserved.add(id);
  return id;
}

function uniqueTemplateId(title: string): string {
  const base = slugify(title);
  const taken = new Set(
    Object.values(getState().docs)
      .filter((d) => d.kind === 'template' || d.kind === 'subtemplate')
      .map((d) => d.id),
  );
  for (const t of getState().trash) if (t.id) taken.add(t.id);
  let id = base;
  for (let i = 2; taken.has(id) || reserved.has(id); i++) id = `${base}-${i}`;
  reserved.add(id);
  return id;
}

/**
 * Notes have no visible ID; this one, made from the first title, only names their history and
 * attachments folder so both survive renames.
 */
function uniqueNoteId(title: string): string {
  const base = `note-${slugify(title)}`;
  const taken = new Set([...Object.values(getState().docs).map((d) => d.id), ...getState().trash.map((t) => t.id ?? '')]);
  let id = base;
  for (let i = 2; taken.has(id) || reserved.has(id); i++) id = `${base}-${i}`;
  reserved.add(id);
  return id;
}

function fileNameFor(meta: { kind: DocKind; id: string; title: string }): string {
  const title = sanitizeFileName(meta.title, 'Untitled');
  if (meta.kind === 'entry' || meta.kind === 'card' || meta.kind === 'protocol' || meta.kind === 'reference') return `${meta.id} ${title}.md`;
  return `${title}.md`;
}

// ───────────────────────────── templates ─────────────────────────────

export const resolveInclude: IncludeResolver = async (ref, name) => {
  const all = Object.values(getState().docs).filter((d) => d.kind === 'subtemplate' || d.kind === 'template');
  const t = all.find((d) => d.id && d.id === ref) ?? all.find((d) => d.title.toLowerCase() === name.toLowerCase());
  if (!t) return null;
  const { body } = await readDoc(t.path);
  return { id: t.id || t.path, title: t.title, folder: dirname(t.path), json: parseMarkdown(body).toJSON() as JSONContent };
};

/**
 * Turn a template/sub-template into content for a target doc: expand sub-templates,
 * fill variables (unless `values` is null, e.g. when copying into another template) and copy
 * referenced files into the target's attachments folder.
 */
export async function materializeTemplate(
  templatePath: string,
  values: Record<string, string> | null,
  target: { folder: string; id: string; title: string },
): Promise<JSONContent> {
  const { body } = await readDoc(templatePath);
  const parsed = parseMarkdown(body).toJSON() as JSONContent;
  const expanded = await expandIncludes(parsed, dirname(templatePath), resolveInclude, [getState().docs[templatePath]?.id ?? templatePath]);
  let filled = expanded;
  if (values) {
    const config = getState().config;
    const all = {
      ...builtinValues({ id: target.id, title: target.title, author: config.author, project: projectOf(join(target.folder, 'x')) }),
      ...values,
    };
    filled = fillVariables(expanded, all);
  }
  const { json, copies } = relocateAssets(resetFlows(filled), target.folder, target.id);
  const v = vault();
  for (const c of copies) {
    try {
      await copyFile(v, c.from, c.to);
    } catch (err) {
      console.warn('Could not copy template file', c.from, err);
    }
  }
  return json;
}

/**
 * Variables a template asks for (including those of nested sub-templates and its entry-title pattern),
 * and problems found in it.
 */
export async function templateVariables(templatePath: string) {
  const { body, meta } = await readDoc(templatePath);
  const expanded = await expandIncludes(parseMarkdown(body).toJSON() as JSONContent, dirname(templatePath), resolveInclude, [
    meta.id || templatePath,
  ]);
  const pattern = typeof meta.extra.entryTitle === 'string' ? meta.extra.entryTitle : '';
  const kind = meta.kind === 'subtemplate' ? 'subtemplate' : 'template';
  return {
    variables: collectVariables(expanded, pattern ? [pattern] : []),
    titlePattern: pattern,
    meta,
    issues: lintTemplate(expanded, { kind, titlePattern: pattern }),
  };
}

/** Copy content (e.g. an entry or a selection) into another doc's attachment space. */
export async function relocateContent(json: JSONContent, sourceFolder: string, target: { folder: string; id: string }): Promise<JSONContent> {
  const { json: out, copies } = relocateAssets(markAssets(resetFlows(json), sourceFolder), target.folder, target.id);
  const v = vault();
  for (const c of copies) {
    try {
      await copyFile(v, c.from, c.to);
    } catch (err) {
      console.warn('Could not copy file', c.from, err);
    }
  }
  return out;
}

const toMarkdown = (json: JSONContent) => serializeMarkdown(docSchema().nodeFromJSON(json));

// ───────────────────────────── create ─────────────────────────────

export interface NewEntryOptions {
  folder?: string;
  title?: string;
  templatePath?: string;
  values?: Record<string, string>;
  date?: string;
  /** Start time on `date` (HH:MM), for a planned experiment. */
  time?: string;
  status?: string;
  /** Protocols to link, in addition to those of the template. */
  protocols?: string[];
  /** Also copy the content of `protocols` into the entry. */
  copyProtocolSteps?: boolean;
  open?: boolean;
}

export async function createEntry(opts: NewEntryOptions = {}): Promise<string> {
  const v = vault();
  const { config, docs } = getState();
  const folder = opts.folder && isInside(opts.folder, LAYOUT.projects) ? opts.folder : LAYOUT.projects;
  const id = nextId(config.idPrefix, config.idDigits);
  const title = opts.title?.trim() || 'Untitled experiment';
  let body = '';
  let tags: string[] = [];
  let templateName: string | undefined;
  let protocols: string[] = [];
  if (opts.templatePath) {
    const json = await materializeTemplate(opts.templatePath, opts.values ?? {}, { folder, id, title });
    body = toMarkdown(json);
    const t = docs[opts.templatePath];
    tags = t?.tags ?? [];
    templateName = t?.title;
    protocols = t?.protocols ?? [];
  }
  for (const pid of new Set(opts.protocols ?? [])) {
    if (!pid) continue;
    if (!protocols.includes(pid)) protocols = [...protocols, pid];
    const p = opts.copyProtocolSteps ? findProtocol(pid) : undefined;
    if (p) body = (body ? body.replace(/\s*$/, '\n\n') : '') + toMarkdown(await protocolCopy(p.path, { folder, id }));
  }
  const now = localIso();
  const path = await uniquePath(v, folder, fileNameFor({ kind: 'entry', id, title }));
  await createDoc(
    path,
    {
      kind: 'entry',
      id,
      title,
      status: opts.status ?? 'in-progress',
      tags,
      author: config.author || undefined,
      created: now,
      modified: now,
      date: opts.date ?? localDate(),
      time: timeOfDay(opts.time),
      template: templateName,
      protocols,
      extra: {},
    },
    body,
  );
  reserved.delete(id);
  if (opts.open !== false) navigate({ name: 'doc', path });
  return path;
}

/** Copy an entry or a protocol (with its files) under a new id. */
export async function duplicateDoc(path: string): Promise<string> {
  await flushWrite(path);
  const { meta, body } = await readDoc(path);
  const v = vault();
  const { config } = getState();
  const folder = dirname(path);
  const isProtocol = meta.kind === 'protocol';
  const id = isProtocol ? nextId(config.protocolPrefix || 'P-', 4) : nextId(config.idPrefix, config.idDigits);
  const json = await relocateContent(parseMarkdown(body).toJSON() as JSONContent, folder, { folder, id });
  const title = `${meta.title} (copy)`;
  const now = localIso();
  const newPath = await uniquePath(v, folder, fileNameFor({ kind: meta.kind, id, title }));
  const reset: Partial<DocMeta> = isProtocol
    ? { status: 'draft', version: '1.0', revisions: undefined }
    : { date: localDate(), end: undefined, status: 'in-progress' };
  // The original file of an imported protocol is copied too.
  let source = meta.source;
  if (source) {
    const from = join(folder, source);
    if (await v.exists(from)) {
      const to = await uniquePath(v, join(folder, LAYOUT.attachments, id), basename(from));
      await copyFile(v, from, to);
      source = relative(folder, to);
    } else source = undefined;
  }
  await createDoc(newPath, { ...meta, id, title, created: now, modified: now, locked: undefined, source, ...reset }, toMarkdown(json));
  reserved.delete(id);
  navigate({ name: 'doc', path: newPath });
  return newPath;
}

export async function createTemplate(opts: {
  kind: 'template' | 'subtemplate';
  title: string;
  description?: string;
  /** Templates: title pattern for new entries, e.g. "Cloning of {{Construct}}". */
  entryTitle?: string;
  protocols?: string[];
  content?: JSONContent;
  sourceFolder?: string;
  open?: boolean;
}): Promise<string> {
  const v = vault();
  const title = opts.title.trim() || (opts.kind === 'template' ? 'New template' : 'New sub-template');
  const id = uniqueTemplateId(title);
  const folder = opts.kind === 'template' ? LAYOUT.templates : LAYOUT.subtemplates;
  let body = '';
  if (opts.content) body = toMarkdown(opts.sourceFolder ? await relocateContent(opts.content, opts.sourceFolder, { folder, id }) : opts.content);
  const now = localIso();
  const path = await uniquePath(v, folder, fileNameFor({ kind: opts.kind, id, title }));
  await createDoc(
    path,
    {
      kind: opts.kind,
      id,
      title,
      tags: [],
      description: opts.description?.trim() || undefined,
      protocols: opts.kind === 'template' ? opts.protocols : undefined,
      created: now,
      modified: now,
      extra: opts.kind === 'template' && opts.entryTitle?.trim() ? { entryTitle: opts.entryTitle.trim() } : {},
    },
    body,
  );
  reserved.delete(id);
  if (opts.open !== false) navigate({ name: 'doc', path });
  return path;
}

export async function saveEntryAsTemplate(path: string, kind: 'template' | 'subtemplate' = 'template') {
  await flushWrite(path);
  const { meta, body } = await readDoc(path);
  return createTemplate({
    kind,
    title: meta.title,
    content: parseMarkdown(body).toJSON() as JSONContent,
    sourceFolder: dirname(path),
  });
}

// ───────────────────────────── protocols ─────────────────────────────

/** Starting structure of a new protocol. */
export function protocolOutline(): string {
  return [
    '## Purpose',
    '',
    '*What this protocol is for, and when to use it.*',
    '',
    '## Materials',
    '',
    sheetToMarkdown({
      rows: [
        ['Reagent or equipment', 'Amount', 'Supplier · cat. no.', 'Notes'],
        ['', '', '', ''],
        ['', '', '', ''],
      ],
    }).trim(),
    '',
    '## Procedure',
    '',
    '1.',
    '',
    '## Notes and safety',
    '',
    '-',
    '',
  ].join('\n');
}

export function findProtocol(id: string): DocMeta | undefined {
  return Object.values(getState().docs).find((d) => d.kind === 'protocol' && d.id === id);
}

export async function createProtocol(opts: {
  title: string;
  description?: string;
  tags?: string[];
  /** Content to start from (e.g. an entry); otherwise the standard outline, unless `outline` is false. */
  content?: JSONContent;
  sourceFolder?: string;
  outline?: boolean;
  open?: boolean;
  /** An id from nextId, when files were saved under it before the protocol is created. */
  id?: string;
  /** Imported protocols: the original file, relative to the Protocols folder. */
  source?: string;
  /** Recorded as the first version's note, e.g. "Imported from kit.pdf". */
  note?: string;
}): Promise<string> {
  const v = vault();
  const { config } = getState();
  const id = opts.id ?? nextId(config.protocolPrefix || 'P-', 4);
  const title = opts.title.trim() || 'Untitled protocol';
  const folder = LAYOUT.protocols;
  let body = '';
  if (opts.content) body = toMarkdown(opts.sourceFolder ? await relocateContent(opts.content, opts.sourceFolder, { folder, id }) : opts.content);
  else if (opts.outline !== false) body = protocolOutline();
  const now = localIso();
  const path = await uniquePath(v, folder, fileNameFor({ kind: 'protocol', id, title }));
  await createDoc(
    path,
    {
      kind: 'protocol',
      id,
      title,
      status: 'draft',
      version: '1.0',
      tags: opts.tags ?? [],
      author: config.author || undefined,
      description: opts.description?.trim() || undefined,
      source: opts.source,
      revisions: opts.note ? [{ version: '1.0', date: localDate(), note: opts.note, author: config.author || undefined }] : undefined,
      created: now,
      modified: now,
      extra: {},
    },
    body,
  );
  reserved.delete(id);
  if (opts.open !== false) navigate({ name: 'doc', path });
  return path;
}

export interface PdfImportProgress {
  /** 0 to 1 */
  fraction: number;
  message: string;
}

export interface PdfImportResult {
  path: string;
  title: string;
  stats: ConvertedPdf['stats'];
  scanned: boolean;
  truncated: boolean;
}

/**
 * Import a PDF as a protocol: its text becomes the protocol (headings, steps, tables, figures) and the
 * original is kept next to it in Protocols/attachments/<id>/, linked from the protocol's `source`.
 */
export async function importPdfProtocol(
  file: File,
  opts: { title?: string; description?: string; tags?: string[]; open?: boolean; onProgress?: (p: PdfImportProgress) => void } = {},
): Promise<PdfImportResult> {
  const { convertPdf } = await import('../pdf/convert');
  const conv = await convertPdf(file, file.name, opts.onProgress);
  return savePdfProtocol(file, conv, opts);
}

/** Save a converted PDF (see importPdfProtocol). */
export async function savePdfProtocol(
  file: File,
  conv: ConvertedPdf,
  opts: { title?: string; description?: string; tags?: string[]; open?: boolean } = {},
): Promise<PdfImportResult> {
  const v = vault();
  const { config } = getState();
  const id = nextId(config.protocolPrefix || 'P-', 4);
  const folder = LAYOUT.protocols;
  const dir = join(folder, LAYOUT.attachments, id);
  try {
    let name = sanitizeFileName(file.name || 'protocol.pdf', 'protocol.pdf');
    if (extname(name) !== '.pdf') name += '.pdf';
    const original = await uniquePath(v, dir, name);
    await v.write(original, file);
    // Figures, in the order they appear.
    const srcs = new Map<string, string>();
    let n = 0;
    for (const fig of conv.figures) {
      const blob = conv.images.get(fig.id);
      if (!blob) continue;
      const ext = blob.type === 'image/jpeg' ? '.jpg' : '.png';
      const target = await uniquePath(v, dir, fig.wholePage ? `Page ${fig.page + 1}${ext}` : `Figure ${++n}${ext}`);
      await v.write(target, blob);
      srcs.set(fig.id, relative(folder, target));
    }
    const content = mapImages(conv.doc, (src) => (src.startsWith(FIGURE_SRC) ? srcs.get(src.slice(FIGURE_SRC.length)) : src));
    const path = await createProtocol({
      id,
      title: opts.title?.trim() || conv.title,
      description: opts.description ?? conv.description,
      tags: opts.tags,
      content,
      outline: false,
      open: opts.open,
      source: relative(folder, original),
      note: `Imported from ${file.name || name}`,
    });
    return { path, title: getState().docs[path]?.title ?? conv.title, stats: conv.stats, scanned: conv.scanned, truncated: conv.truncated };
  } finally {
    reserved.delete(id);
  }
}

/** Replace image sources; images whose new source is undefined are removed. */
function mapImages(node: JSONContent, map: (src: string) => string | undefined): JSONContent {
  if (!node.content) return node;
  const content: JSONContent[] = [];
  for (const child of node.content) {
    if (child.type === 'image') {
      const src = map(String(child.attrs?.src ?? ''));
      if (src) content.push({ ...child, attrs: { ...child.attrs, src } });
    } else content.push(mapImages(child, map));
  }
  return { ...node, content };
}

export async function saveAsProtocol(path: string): Promise<string> {
  await flushWrite(path);
  const { meta, body } = await readDoc(path);
  return createProtocol({ title: meta.title, tags: meta.tags, content: parseMarkdown(body).toJSON() as JSONContent, sourceFolder: dirname(path) });
}

/**
 * A protocol as blocks to insert into another doc: a heading that links to the protocol (with its version),
 * then a copy of its content. Its files are copied into the target's attachments.
 */
export async function protocolCopy(protocolPath: string, target: { folder: string; id: string }): Promise<JSONContent> {
  const { meta, body } = await readDoc(protocolPath);
  const json = await relocateContent(parseMarkdown(body).toJSON() as JSONContent, dirname(protocolPath), target);
  const demote = (n: JSONContent): JSONContent =>
    n.type === 'heading' ? { ...n, attrs: { ...n.attrs, level: Math.min(6, Number(n.attrs?.level ?? 2) + 1) } } : n;
  const heading: JSONContent = {
    type: 'heading',
    attrs: { level: 2 },
    content: [
      { type: 'text', text: 'Protocol: ' },
      {
        type: 'text',
        text: [meta.id, meta.title].filter(Boolean).join(' '),
        marks: [{ type: 'link', attrs: { href: relative(target.folder, protocolPath) } }],
      },
      ...(meta.version ? [{ type: 'text', text: ` · v${meta.version}` }] : []),
    ],
  };
  return { type: 'doc', content: [heading, ...(json.content ?? []).map(demote)] };
}

/** Add protocols to a doc's "Protocols" list. */
export function linkProtocols(path: string, ids: string[]) {
  const cur = getState().docs[currentPath(path)];
  if (!cur || cur.kind === 'protocol' || cur.kind === 'board') return;
  const next = [...(cur.protocols ?? [])];
  for (const id of ids) if (id && !next.includes(id)) next.push(id);
  if (next.length !== (cur.protocols ?? []).length) patchMeta(path, { protocols: next });
}

/** Release a new version of a protocol: set its version and record what changed. */
export function releaseVersion(path: string, version: string, note: string) {
  const cur = getState().docs[currentPath(path)];
  if (!cur) return;
  const v = version.trim();
  if (!v) return;
  const rev: Revision = { version: v, date: localDate(), note: note.trim() || undefined, author: getState().config.author || undefined };
  patchMeta(path, { version: v, revisions: [rev, ...(cur.revisions ?? []).filter((r) => r.version !== v)] }, 0);
}

/** Columns from their names: grey to start, green to finish, colours in between. */
export function boardColumns(names: string[]): StatusOption[] {
  const middle: ColorName[] = ['blue', 'purple', 'orange', 'teal', 'yellow', 'pink'];
  const taken = new Set<string>();
  const clean = names.map((n) => n.trim()).filter(Boolean);
  return clean.map((name, i) => {
    let id = slugify(name) || 'column';
    while (taken.has(id)) id += '-2';
    taken.add(id);
    const color: ColorName = i === 0 && clean.length > 1 ? 'gray' : i === clean.length - 1 ? 'green' : middle[(i - 1) % middle.length];
    return { id, name, color };
  });
}

export const BOARD_PRESETS: Record<BoardCards, string[]> = {
  items: ['Not started', 'In progress', 'Done'],
  tasks: ['To do', 'In progress', 'Done'],
};

export async function createBoard(name: string, opts: { cards?: BoardCards; columns?: string[]; description?: string } = {}): Promise<string> {
  const v = vault();
  const title = name.trim() || 'New board';
  const cards = opts.cards ?? 'items';
  const columns = boardColumns(opts.columns?.length ? opts.columns : BOARD_PRESETS[cards]);
  let folder = join(LAYOUT.boards, sanitizeFileName(title, 'Board'));
  for (let i = 2; await v.exists(folder); i++) folder = join(LAYOUT.boards, `${sanitizeFileName(title, 'Board')} (${i})`);
  const now = localIso();
  await createDoc(
    join(folder, LAYOUT.boardFile),
    {
      kind: 'board',
      id: slugify(title),
      title,
      tags: [],
      columns: columns.length ? columns : boardColumns(BOARD_PRESETS[cards]),
      description: opts.description?.trim() || undefined,
      created: now,
      modified: now,
      extra: { cards },
    },
    '',
  );
  navigate({ name: 'board', path: folder });
  return folder;
}

// ───────────────────────────── stocks ─────────────────────────────

/** A new stock collection (Stocks/<title>.md) with the columns of its type. */
export async function createStockCollection(opts: { type: string; title?: string; prefix?: string; open?: boolean }): Promise<string> {
  const v = vault();
  const type = stockType(opts.type);
  const title = opts.title?.trim() || type.name;
  const prefix = opts.prefix?.trim().toUpperCase() || type.prefix;
  if (!(await v.exists(LAYOUT.stocks))) await v.mkdir(LAYOUT.stocks);
  const now = localIso();
  const path = await uniquePath(v, LAYOUT.stocks, fileNameFor({ kind: 'stocks', id: '', title }));
  await createDoc(
    path,
    { kind: 'stocks', id: '', title, tags: [], created: now, modified: now, extra: { stock: type.id, prefix } },
    writeStockTable({ columns: [...type.columns], rows: [], before: '', after: '' }),
  );
  if (opts.open !== false) navigate({ name: 'stocks', path });
  return path;
}

/** Save a collection's table (written right away; the Stocks page debounces its edits). */
export async function saveStockTable(path: string, table: StockTable) {
  await saveBody(path, writeStockTable(table));
}

/** Rename a collection: its title and its file name. */
export async function renameStockCollection(path: string, title: string): Promise<string> {
  patchMeta(path, { title: title.trim() || 'Stocks' }, 0);
  await flushWrite(path);
  return syncFileName(path);
}

export interface NewCardOptions {
  title?: string;
  status?: string;
  order?: number;
  due?: string;
  start?: string;
  links?: string[];
  open?: boolean;
}

export async function createCard(boardFolder: string, opts: NewCardOptions = {}): Promise<string> {
  const v = vault();
  const { config, docs } = getState();
  const board = docs[join(boardFolder, LAYOUT.boardFile)];
  const id = nextId(config.cardPrefix, 4);
  const title = opts.title?.trim() || `Untitled ${cardNoun(boardCards(board))}`;
  const status = opts.status ?? board?.columns?.[0]?.id ?? 'todo';
  const siblings = Object.values(docs).filter((d) => d.kind === 'card' && dirname(d.path) === boardFolder && d.status === status);
  const order = opts.order ?? (siblings.length ? Math.max(...siblings.map((d) => d.order ?? 0)) + 1 : 1);
  const now = localIso();
  const path = await uniquePath(v, boardFolder, fileNameFor({ kind: 'card', id, title }));
  await createDoc(
    path,
    {
      kind: 'card',
      id,
      title,
      status,
      order,
      due: opts.due,
      start: opts.start,
      links: opts.links ?? [],
      tags: [],
      created: now,
      modified: now,
      extra: {},
    },
    '',
  );
  reserved.delete(id);
  if (opts.open) setState({ peek: path });
  return path;
}

// ───────────────────────────── notes ─────────────────────────────

/** Pages just created whose title should be selected when they open. */
const freshTitles = new Set<string>();
export function takeFreshTitle(path: string): boolean {
  return freshTitles.delete(path);
}

/** A note: a page for meeting notes or ideas, kept in Notes/ and not part of any project. */
export async function createNote(opts: { title?: string; open?: boolean } = {}): Promise<string> {
  const v = vault();
  const { config } = getState();
  const title = opts.title?.trim() || 'Untitled note';
  const id = uniqueNoteId(title);
  await v.mkdir(LAYOUT.notes);
  const now = localIso();
  const path = await uniquePath(v, LAYOUT.notes, fileNameFor({ kind: 'note', id, title }));
  await createDoc(
    path,
    { kind: 'note', id, title, tags: [], author: config.author || undefined, created: now, modified: now, date: localDate(), extra: {} },
    '',
  );
  reserved.delete(id);
  freshTitles.add(path);
  if (opts.open !== false) navigate({ name: 'doc', path });
  return path;
}

// ───────────────────────────── literature ─────────────────────────────

/** A paper already in Literature/ with the same DOI, PubMed ID or title and year. */
export function findReference(info: RefInfo): DocMeta | undefined {
  const norm = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return Object.values(getState().docs).find((d) => {
    if (d.kind !== 'reference') return false;
    const r = refFromMeta(d);
    if (info.doi && r.doi && info.doi.toLowerCase() === r.doi.toLowerCase()) return true;
    if (info.pmid && r.pmid && info.pmid === r.pmid) return true;
    return !!info.title && norm(info.title) === norm(r.title) && (info.year ?? '') === (r.year ?? '');
  });
}

/** A paper in Literature/, saved as "<citation key> <title>.md"; the abstract (if any) and your notes are its body. */
export async function createReference(info: RefInfo, opts: { open?: boolean } = {}): Promise<string> {
  const v = vault();
  const taken = new Set(
    [...Object.values(getState().docs).map((d) => d.id), ...reserved, ...getState().trash.map((t) => t.id ?? '')].map((id) => id.toLowerCase()),
  );
  const id = citationKey(info, taken);
  reserved.add(id);
  await v.mkdir(LAYOUT.literature);
  const now = localIso();
  const title = info.title.trim() || 'Untitled paper';
  const path = await uniquePath(v, LAYOUT.literature, fileNameFor({ kind: 'reference', id, title }));
  const body = info.abstract ? `## Abstract\n\n${info.abstract}\n\n## Notes\n\n` : '';
  await createDoc(path, { kind: 'reference', id, title, tags: [], created: now, modified: now, extra: refExtra(info) }, body);
  reserved.delete(id);
  if (opts.open) navigate({ name: 'doc', path });
  return path;
}

/** Papers from a BibTeX or RIS file; those already in the notebook are skipped. */
export async function importReferences(infos: RefInfo[]): Promise<{ added: string[]; skipped: number }> {
  const added: string[] = [];
  let skipped = 0;
  for (const info of infos) {
    if (findReference(info)) skipped++;
    else added.push(await createReference(info));
  }
  return { added, skipped };
}

// ───────────────────────────── rename / move / trash ─────────────────────────────

function replaceDocPath(from: string, to: string) {
  const moved = getState().docs[from];
  if (moved && !moved.id) void moveHistory(vault(), { path: from }, { path: to }).catch(() => undefined);
  const session = sessions.get(from);
  if (session) sessions.set(to, session);
  sessions.delete(from);
  renamedTo.set(from, to);
  renamedTo.delete(to);
  const timer = pending.get(from);
  if (timer) {
    clearTimeout(timer);
    pending.delete(from);
  }
  setState((s) => {
    const docs = { ...s.docs };
    const meta = docs[from];
    delete docs[from];
    if (meta) docs[to] = { ...meta, path: to };
    const docKeys = { ...s.docKeys, [to]: s.docKeys[from] ?? from };
    delete docKeys[from];
    const route = (s.route.name === 'doc' && s.route.path === from ? { name: 'doc', path: to } : s.route) as typeof s.route;
    const peek = s.peek === from ? to : s.peek;
    return { docs, docKeys, route, peek };
  });
  rekeyOpenDoc(from, to);
  if (timer) scheduleWrite(to);
  const st = getState();
  if (st.route.name === 'doc' && st.route.path === to) navigate(st.route, { replace: true });
}

/** Old path → new path, so callers holding a stale path still find the doc after a rename. */
const renamedTo = new Map<string, string>();
export function currentPath(path: string): string {
  let p = path;
  for (let i = 0; i < 50 && renamedTo.has(p); i++) p = renamedTo.get(p)!;
  return p;
}

let renameQueue: Promise<unknown> = Promise.resolve();

/** Rename the file to match the doc's title ("EXP-0007 New title.md"). Calls are serialized. */
export function syncFileName(path: string): Promise<string> {
  const run = async (): Promise<string> => {
    const p = currentPath(path);
    const meta = getState().docs[p];
    if (!meta || meta.kind === 'board') return p;
    const wanted = fileNameFor(meta);
    if (basename(p) === wanted) return p;
    await flushWrite(p);
    const v = vault();
    const target = await uniquePath(v, dirname(p), wanted);
    if (target === p) return p;
    await serialized(p, () => moveFile(v, p, target));
    renamedTo.set(p, target);
    replaceDocPath(p, target);
    return target;
  };
  const next = renameQueue.then(run, run);
  renameQueue = next.catch(() => undefined);
  return next;
}

export async function moveDoc(path: string, folder: string): Promise<string> {
  const meta = getState().docs[path];
  if (!meta || dirname(path) === folder) return path;
  await flushWrite(path);
  const v = vault();
  const target = await uniquePath(v, folder, basename(path));
  await serialized(path, () => moveFile(v, path, target));
  const att = attachmentsDir(path, meta.id);
  if (await v.exists(att)) await moveDir(v, att, attachmentsDir(target, meta.id));
  replaceDocPath(path, target);
  toast(`Moved to ${folder.split('/').slice(1).join(' / ') || 'Projects'}`, 'success');
  return target;
}

function trashStamp() {
  return localIso().slice(0, 19).replace(/[:T]/g, '-');
}

export async function trashDoc(path: string) {
  const meta = getState().docs[path];
  if (!meta) return;
  await flushWrite(path);
  const v = vault();
  const stamp = trashStamp();
  const name = `${stamp} ${basename(path)}`;
  const att = attachmentsDir(path, meta.id);
  const attName = `${stamp} ${meta.id || stem(path)} attachments`;
  const hadAtt = await v.exists(att);
  // Where it came from is noted first, so the trash never lists it without knowing.
  const record: TrashRecord = {
    name,
    kind: 'doc',
    from: path,
    title: meta.title,
    docKind: meta.kind,
    id: meta.id || undefined,
    deleted: localIso(),
    attachments: hadAtt ? { name: attName, from: att } : undefined,
  };
  await updateTrashIndex((items) => [...items, record]);
  await serialized(path, () => moveFile(v, path, join(TRASH_DIR, name)));
  if (hadAtt) await moveDir(v, att, join(TRASH_DIR, attName));
  setState((s) => {
    const docs = { ...s.docs };
    delete docs[path];
    return { docs, peek: s.peek === path ? null : s.peek };
  });
  await loadTrash();
  const st = getState();
  if (st.route.name === 'doc' && st.route.path === path) navigate({ name: 'home' }, { replace: true });
  toast(`Moved “${meta.title}” to the trash`, 'info', { label: 'Undo', run: () => void restoreFromTrash(record, { quiet: true }) });
}

export async function createFolder(parent: string, name: string): Promise<string> {
  const v = vault();
  const base = sanitizeFileName(name, 'New folder');
  let path = join(parent || LAYOUT.projects, base);
  for (let i = 2; await v.exists(path); i++) path = join(parent || LAYOUT.projects, `${base} (${i})`);
  await v.mkdir(path);
  setState((s) => ({ folders: [...s.folders, path].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })) }));
  return path;
}

export async function renameFolder(path: string, name: string): Promise<string> {
  const v = vault();
  const target = join(dirname(path), sanitizeFileName(name, 'Folder'));
  if (target === path) return path;
  if (await v.exists(target)) throw new Error(`A folder named “${name}” already exists`);
  await flushAllWrites();
  await moveDir(v, path, target);
  await rescan();
  const r = getState().route;
  if (r.name === 'folder' && r.path === path) navigate({ name: 'folder', path: target }, { replace: true });
  if (r.name === 'doc' && isInside(r.path, path)) navigate({ name: 'doc', path: join(target, r.path.slice(path.length + 1)) }, { replace: true });
  return target;
}

export async function trashFolder(path: string) {
  const v = vault();
  await flushAllWrites();
  const name = `${trashStamp()} ${basename(path)}`;
  const board = isInside(path, LAYOUT.boards) ? getState().docs[join(path, LAYOUT.boardFile)] : undefined;
  const record: TrashRecord = { name, kind: 'folder', from: path, title: board?.title ?? basename(path), deleted: localIso() };
  await updateTrashIndex((items) => [...items, record]);
  await moveDir(v, path, join(TRASH_DIR, name));
  await rescan();
  const r = getState().route;
  if ((r.name === 'folder' || r.name === 'doc') && isInside(r.path, path)) navigate({ name: 'home' }, { replace: true });
  toast(`Moved ${board ? 'board' : 'folder'} “${record.title}” to the trash`, 'info', {
    label: 'Undo',
    run: () => void restoreFromTrash(record, { quiet: true }),
  });
}

// ───────────────────────────── the trash ─────────────────────────────

let trashIndexQueue: Promise<unknown> = Promise.resolve();

/** Change trash.json (one change at a time). */
function updateTrashIndex(change: (items: TrashRecord[]) => TrashRecord[]): Promise<void> {
  const run = async () => {
    const v = vault();
    const items = (await v.exists(TRASH_INDEX)) ? parseTrashIndex(await v.readText(TRASH_INDEX)) : [];
    const next = change(items);
    if (next.length) await v.write(TRASH_INDEX, serializeTrashIndex(next));
    else await v.remove(TRASH_INDEX);
  };
  const next = trashIndexQueue.then(run, run);
  trashIndexQueue = next.catch(() => undefined);
  return next;
}

/** Read what is in the trash again (when the notebook opens, and on the Trash page). */
let trashLoads = 0;
export async function loadTrash(): Promise<TrashItem[]> {
  const v = getState().vault;
  if (!v) return [];
  // Two reads at once: the later one wins, even if the earlier one finishes last.
  const load = ++trashLoads;
  const trash = await listTrash(v).catch(() => getState().trash);
  if (load === trashLoads) setState({ trash });
  return trash;
}

/** A free path for something coming back: its own if it is free, else "Name (restored).md". */
async function freePath(v: Vault, path: string, isFolder: boolean): Promise<string> {
  if (!(await v.exists(path))) return path;
  if (!isFolder) return uniquePath(v, dirname(path), basename(path));
  for (let i = 1; ; i++) {
    const p = `${path} (restored${i > 1 ? ` ${i}` : ''})`;
    if (!(await v.exists(p))) return p;
  }
}

/** Put a trashed page or folder back where it was, with its attachments. Returns where it went. */
export async function restoreFromTrash(item: TrashItem, opts: { quiet?: boolean } = {}): Promise<string> {
  const v = vault();
  const src = join(TRASH_DIR, item.name);
  if (!(await v.exists(src))) {
    await loadTrash();
    throw new Error('It is no longer in the trash');
  }
  const target = await freePath(v, item.from, item.kind === 'folder');
  await v.mkdir(dirname(target));
  if (item.kind === 'folder') await moveDir(v, src, target);
  else {
    await moveFile(v, src, target);
    if (item.attachments && (await v.exists(join(TRASH_DIR, item.attachments.name)))) {
      // Back where it was, unless the page had to take a new name (then beside it, under that name).
      const att = target === item.from ? item.attachments.from : attachmentsDir(target, item.id ?? '');
      await moveDir(v, join(TRASH_DIR, item.attachments.name), att);
    }
  }
  await updateTrashIndex((items) => items.filter((r) => r.name !== item.name));
  await rescan();
  if (!opts.quiet) {
    const where = dirname(target).split('/').join(' / ') || 'the notebook';
    const open =
      item.kind === 'doc'
        ? { label: 'Open', run: () => navigate({ name: 'doc', path: target }) }
        : item.from.startsWith(LAYOUT.boards + '/')
          ? { label: 'Open', run: () => navigate({ name: 'board', path: target }) }
          : { label: 'Open', run: () => navigate({ name: 'folder', path: target }) };
    toast(`Restored “${item.title}” to ${where}`, 'success', open);
  }
  return target;
}

/** Delete a trashed page or folder for good (with its attachments and version history). */
export async function deleteFromTrash(item: TrashItem): Promise<void> {
  const v = vault();
  await v.remove(join(TRASH_DIR, item.name));
  if (item.attachments) await v.remove(join(TRASH_DIR, item.attachments.name));
  // Its history goes too, unless a page in the notebook has the same ID.
  if (item.kind === 'doc' && !Object.values(getState().docs).some((d) => item.id && d.id === item.id))
    await v.remove(historyPathFor({ id: item.id, path: item.from })).catch(() => undefined);
  await updateTrashIndex((items) => items.filter((r) => r.name !== item.name));
  await loadTrash();
}

/** Delete everything in the trash for good. */
export async function emptyTrash(): Promise<number> {
  const items = await loadTrash();
  for (const item of items) await deleteFromTrash(item);
  const v = vault();
  // Anything else left in there (stray attachments).
  if (await v.exists(TRASH_DIR)) await v.remove(TRASH_DIR);
  setState({ trash: [] });
  return items.length;
}

export async function trashBoard(folder: string) {
  await trashFolder(folder);
}

// ───────────────────────────── import / export ─────────────────────────────

export async function exportZip(): Promise<{ blob: Blob; name: string }> {
  await flushAllWrites();
  const v = vault();
  const files: Record<string, Uint8Array> = {};
  for (const e of await walk(v, '', (x) => x.name === '.trash')) {
    if (e.kind !== 'file') continue;
    files[e.path] = new Uint8Array(await (await v.readBlob(e.path)).arrayBuffer());
  }
  if (!Object.keys(files).length) files['README.txt'] = strToU8('Empty notebook');
  const zipped = zipSync(files, { level: 6 });
  const name = `${sanitizeFileName(getState().config.name || v.name, 'notebook')} ${localDate()}.zip`;
  return { blob: new Blob([zipped.slice()], { type: 'application/zip' }), name };
}

/** The files of a zip (e.g. an exported notebook) by path, without a single top-level folder around them all. */
export function unpackZip(data: Uint8Array): { path: string; data: Uint8Array }[] {
  const entries = unzipSync(data);
  const names = Object.keys(entries).filter((n) => !n.endsWith('/') && !n.startsWith('__MACOSX'));
  // A zipped notebook folder ("My notebook/Projects/…") loses its outer folder, but not a zip of just "Projects/…".
  const own = new Set<string>([
    LAYOUT.projects,
    LAYOUT.protocols,
    LAYOUT.stocks,
    LAYOUT.templates,
    LAYOUT.boards,
    LAYOUT.notes,
    LAYOUT.literature,
    LAYOUT.appDir,
    LAYOUT.legacyAppDir,
    '.trash',
  ]);
  const firstSeg = names[0]?.split('/')[0] ?? '';
  const strip = names.length > 0 && !own.has(firstSeg) && names.every((n) => n.split('/').length > 1 && n.split('/')[0] === firstSeg);
  return names.map((n) => ({ path: strip ? n.split('/').slice(1).join('/') : n, data: entries[n] })).filter((f) => f.path);
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Import a zip (e.g. an exported notebook) into the open notebook. Files that are already there
 * unchanged are skipped; a file that differs is added next to the existing one as a copy.
 */
export function importSummary(r: { added: number; copies: number; unchanged: number }): string {
  const parts = [`${r.added} new file${r.added === 1 ? '' : 's'}`];
  if (r.copies) parts.push(`${r.copies} changed (added as copies next to the existing files)`);
  if (r.unchanged) parts.push(`${r.unchanged} unchanged`);
  return `Imported: ${parts.join(', ')}.`;
}

export async function importZip(file: Blob): Promise<{ added: number; copies: number; unchanged: number }> {
  const v = vault();
  const result = { added: 0, copies: 0, unchanged: 0 };
  for (const f of unpackZip(new Uint8Array(await file.arrayBuffer()))) {
    if (isConfigFile(f.path)) continue;
    // Version history is the notebook's own; activity adds up (also from a notebook made before the app was renamed).
    if (f.path.startsWith(`${HISTORY_DIR}/`) || f.path.startsWith(`${LAYOUT.legacyAppDir}/history/`)) continue;
    if (f.path === ACTIVITY_FILE || f.path === `${LAYOUT.legacyAppDir}/activity.json`) {
      await importActivity(strFromU8(f.data));
      continue;
    }
    let target = f.path;
    if (await v.exists(f.path)) {
      if (sameBytes(new Uint8Array(await (await v.readBlob(f.path)).arrayBuffer()), f.data)) {
        result.unchanged++;
        continue;
      }
      target = await uniquePath(v, dirname(f.path), basename(f.path));
      result.copies++;
    } else result.added++;
    await v.write(target, f.data.slice());
  }
  await rescan();
  return result;
}

/**
 * Open an exported notebook (.zip) as a new notebook stored in this browser, e.g. on a phone or
 * tablet, which cannot open folders. `create` makes the empty vault.
 */
export async function openZipNotebook(file: File, create: (name: string) => Promise<Vault>): Promise<number> {
  const files = unpackZip(new Uint8Array(await file.arrayBuffer()));
  if (!files.some((f) => f.path.endsWith('.md'))) throw new Error('This .zip does not contain a notebook (no Markdown files in it).');
  const name = stem(file.name).replace(/\s+\d{4}-\d{2}-\d{2}$/, '');
  return openNotebookCopy(
    files.map((f) => ({ path: f.path, read: () => f.data.slice() })),
    name,
    create,
  );
}

// Files a computer adds to folders on its own, and a Git repository's internals: not part of the notebook.
const FOLDER_JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\._[^/]*)$|(^|\/)\.git\//;

/**
 * Open a notebook folder in a browser that can read folders but not save into them (Safari,
 * Firefox): its files are copied into a new notebook stored in this browser. `files` come from a
 * folder picker, each with its path inside the chosen folder in `webkitRelativePath`.
 */
export async function openFolderCopyNotebook(files: File[], create: (name: string) => Promise<Vault>): Promise<number> {
  const folder = files[0]?.webkitRelativePath.split('/')[0] || '';
  const inFolder = (f: File) => f.webkitRelativePath.split('/').slice(1).join('/');
  const kept = files.filter((f) => inFolder(f) && !FOLDER_JUNK.test(inFolder(f)));
  if (!kept.some((f) => inFolder(f).endsWith('.md')))
    throw new Error(
      `${folder ? `“${folder}”` : 'This folder'} has no notebook in it (no Markdown files). To start a new notebook, use “Create browser notebook”.`,
    );
  return openNotebookCopy(
    kept.map((f) => ({ path: inFolder(f), read: async () => new Uint8Array(await f.arrayBuffer()) })),
    folder,
    create,
  );
}

/** Copy a notebook's files into a new browser notebook and open it. Named after its config, else `fallbackName`. */
async function openNotebookCopy(
  files: { path: string; read: () => Uint8Array<ArrayBuffer> | Promise<Uint8Array<ArrayBuffer>> }[],
  fallbackName: string,
  create: (name: string) => Promise<Vault>,
): Promise<number> {
  let name = fallbackName || 'Lab notebook';
  const config = files.find((f) => isConfigFile(f.path));
  try {
    if (config) name = (JSON.parse(strFromU8(await config.read())) as { name?: string }).name || name;
  } catch {
    // Keep the file or folder name.
  }
  const v = await create(name);
  // One file at a time, so a folder of large images is never all in memory at once.
  for (const f of files) await v.write(f.path, await f.read());
  await openNotebook(v, { seed: false });
  for (const d of [
    LAYOUT.projects,
    LAYOUT.protocols,
    LAYOUT.stocks,
    LAYOUT.templates,
    LAYOUT.subtemplates,
    LAYOUT.boards,
    LAYOUT.notes,
    LAYOUT.literature,
  ])
    if (!(await v.exists(d))) await v.mkdir(d);
  return files.length;
}

// ───────────────────────────── connected devices ─────────────────────────────

/** Paths changed by the other device, reloaded without the "changed outside" note. */
let remoteRescan: ReturnType<typeof setTimeout> | undefined;
function remoteChanged(paths: string[]) {
  for (const p of paths) {
    quietReloads.add(p);
    setTimeout(() => quietReloads.delete(p), 3000);
  }
  clearTimeout(remoteRescan);
  remoteRescan = setTimeout(
    () =>
      void rescan().then(async () => {
        // The other device may have changed the notebook's settings (name, ID prefixes, statuses).
        const v = getState().vault;
        if (v && paths.some(isConfigFile)) {
          const config = await loadConfig(v);
          if (config) setState({ config });
        }
        warnDuplicateIds();
      }),
    100,
  );
}

/**
 * Each device numbers new entries after the highest ID it knows. Entries made on both while they
 * were apart can share an ID: both are kept, and this says which ones, once.
 */
const warnedIds = new Set<string>();
function warnDuplicateIds() {
  const byId = new Map<string, DocMeta[]>();
  for (const d of Object.values(getState().docs))
    if (d.id && (d.kind === 'entry' || d.kind === 'protocol' || d.kind === 'card')) byId.set(d.id, [...(byId.get(d.id) ?? []), d]);
  for (const [id, docs] of byId) {
    const key =
      id +
      '|' +
      docs
        .map((d) => d.path)
        .sort()
        .join('|');
    if (docs.length < 2 || warnedIds.has(key)) continue;
    warnedIds.add(key);
    toast(
      `${id} is now the ID of ${docs.length} pages, made on different devices while they were apart: ${docs.map((d) => `“${d.title}”`).join(' and ')}. Both are kept.`,
      'info',
      undefined,
      { sticky: true },
    );
  }
}

setSyncHooks({
  isBusy: (path) => pending.has(path) || chains.has(path),
  // Overwriting a page with the other device's version: the version it replaces goes into its history.
  beforeOverwrite: async (path) => {
    const meta = getState().docs[path];
    const v = getState().vault;
    if (meta && v) await versionBeforeWrite(v, path, meta);
  },
  applied: remoteChanged,
  conflict: (path, copy, from) =>
    toast(`“${basename(path)}” was changed here and on the ${from}: both versions are kept (${basename(copy)}).`, 'info', undefined, {
      sticky: true,
    }),
  notice: (message, kind = 'info') => toast(message, kind),
});
