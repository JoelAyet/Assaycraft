/**
 * The notebook's trash: deleted pages and folders are moved into `.trash/`, named
 * "<when> <file name>", with their attachments beside them. `.trash/trash.json` remembers where each
 * one came from, so it can go back there. Items trashed before that file existed are still listed:
 * their place is worked out from their kind.
 */
import type { Vault } from '../fs/types';
import { LAYOUT, type DocKind } from './model';
import { splitFrontMatter } from './frontmatter';
import { basename, dirname, extname, join, stem } from '../lib/path';

export const TRASH_DIR = '.trash';
export const TRASH_INDEX = `${TRASH_DIR}/trash.json`;

/** What the trash remembers about one item. */
export interface TrashRecord {
  /** Its name inside .trash/. */
  name: string;
  kind: 'doc' | 'folder';
  /** Where it was. */
  from: string;
  title: string;
  docKind?: DocKind;
  id?: string;
  /** When it was trashed (local ISO time). */
  deleted: string;
  /** Its attachments folder, moved along with it. */
  attachments?: { name: string; from: string };
}

export interface TrashItem extends TrashRecord {
  /** Where it came from is a guess (trashed before the trash kept track). */
  guessed?: boolean;
}

const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2}) (.+)$/;

/** "2026-10-19-15-33-00 EXP-0007 Gel.md" → when, and the original name. */
export function splitTrashName(name: string): { deleted: string; original: string } | null {
  const m = STAMP_RE.exec(name);
  if (!m) return null;
  return { deleted: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`, original: m[7] };
}

export function parseTrashIndex(text: string): TrashRecord[] {
  try {
    const data = JSON.parse(text) as { items?: unknown };
    if (!Array.isArray(data.items)) return [];
    return data.items.filter(
      (r): r is TrashRecord =>
        !!r && typeof r === 'object' && typeof (r as TrashRecord).name === 'string' && typeof (r as TrashRecord).from === 'string',
    );
  } catch {
    return [];
  }
}

export function serializeTrashIndex(items: TrashRecord[]): string {
  return JSON.stringify({ version: 1, items }, null, 2) + '\n';
}

/** The folder a page of this kind lives in, for items whose place was not recorded. */
function homeOf(kind: DocKind | undefined): string {
  switch (kind) {
    case 'protocol':
      return LAYOUT.protocols;
    case 'stocks':
      return LAYOUT.stocks;
    case 'note':
      return LAYOUT.notes;
    case 'reference':
      return LAYOUT.literature;
    case 'template':
      return LAYOUT.templates;
    case 'subtemplate':
      return LAYOUT.subtemplates;
    default:
      return LAYOUT.projects;
  }
}

/** Kinds a file can be, from its front matter (entries have none). */
const FM_KINDS: DocKind[] = ['entry', 'template', 'subtemplate', 'card', 'board', 'protocol', 'stocks', 'note', 'reference'];

async function readRecord(v: Vault, name: string): Promise<TrashItem | null> {
  const when = splitTrashName(name);
  if (!when) return null;
  const path = join(TRASH_DIR, name);
  const stat = await v.stat(path);
  if (!stat) return null;
  let data: Record<string, unknown> = {};
  try {
    data = splitFrontMatter(await v.readText(path)).data;
  } catch {
    /* unreadable: keep what the name says */
  }
  const kind = FM_KINDS.includes(data.kind as DocKind) ? (data.kind as DocKind) : 'entry';
  const id = typeof data.id === 'string' ? data.id : undefined;
  const title = typeof data.title === 'string' && data.title.trim() ? data.title : stem(when.original);
  return { name, kind: 'doc', from: join(homeOf(kind), when.original), title, docKind: kind, id, deleted: when.deleted, guessed: true };
}

/**
 * Everything in the trash, newest first: what trash.json records, plus anything else in .trash/
 * (trashed before it kept track, or put there by hand).
 */
export async function listTrash(v: Vault): Promise<TrashItem[]> {
  if (!(await v.exists(TRASH_DIR))) return [];
  const entries = await v.list(TRASH_DIR);
  const names = new Set(entries.map((e) => e.name));
  const index = (await v.exists(TRASH_INDEX)) ? parseTrashIndex(await v.readText(TRASH_INDEX)) : [];
  const items: TrashItem[] = index.filter((r) => names.has(r.name));
  const claimed = new Set(items.flatMap((r) => [r.name, r.attachments?.name].filter((n): n is string => !!n)));
  claimed.add(basename(TRASH_INDEX));
  const attachmentDirs = entries.filter((e) => e.kind === 'directory' && / attachments$/.test(e.name) && !claimed.has(e.name));
  for (const e of entries) {
    if (claimed.has(e.name) || attachmentDirs.includes(e)) continue;
    if (e.kind === 'file') {
      if (extname(e.name) !== '.md') continue;
      const item = await readRecord(v, e.name);
      if (!item) continue;
      // Its attachments were trashed at the same moment, as "<when> <id or name> attachments".
      const stamp = e.name.slice(0, 19);
      const att = attachmentDirs.find(
        (d) => d.name.startsWith(stamp + ' ') && d.name === `${stamp} ${item.id || stem(splitTrashName(e.name)!.original)} attachments`,
      );
      if (att) item.attachments = { name: att.name, from: join(dirname(item.from), LAYOUT.attachments, item.id || stem(item.from)) };
      items.push(item);
    } else {
      const when = splitTrashName(e.name);
      if (!when) continue;
      const board = await v.exists(join(TRASH_DIR, e.name, LAYOUT.boardFile));
      items.push({
        name: e.name,
        kind: 'folder',
        from: join(board ? LAYOUT.boards : LAYOUT.projects, when.original),
        title: when.original,
        deleted: when.deleted,
        guessed: true,
      });
    }
  }
  return items.sort((a, b) => b.deleted.localeCompare(a.deleted) || a.title.localeCompare(b.title));
}
