/**
 * Files in copied blocks follow them. On copy, each file (image, attached file, link to a file)
 * is marked with its notebook and its place in it; on paste into another entry, the file is
 * copied into that entry's own attachments folder and the block points at the copy. Links in the
 * text keep pointing at the same file or page, written from the new entry's folder.
 */
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import type { Vault } from '../fs/types';
import { copyFile, uniquePath } from '../fs/ops';
import { basename, isInside, isRelativeFileLink, join, relative, splitFragment, stem } from '../lib/path';
import { LAYOUT } from '../notebook/model';
import type { DocContextValue } from './context';

/** How a file is written while it is on the clipboard: "gcvault:<notebook id>:<path in it>". */
export const VAULT_PREFIX = 'gcvault:';

type Ctx = Pick<DocContextValue, 'vault' | 'folder' | 'docId' | 'path'>;

/** Notebooks open in this tab, by id: a file copied from one can be copied into another. */
const openVaults = new Map<string, Vault>();

const isFileNode = (n: PMNode) => n.type.name === 'image' || n.type.name === 'attachment';

function mapNodes(fragment: Fragment, f: (n: PMNode) => PMNode): Fragment {
  const out: PMNode[] = [];
  fragment.forEach((child) => out.push(f(child.isLeaf ? child : child.copy(mapNodes(child.content, f)))));
  return Fragment.fromArray(out);
}

function mapSlice(slice: Slice, f: (n: PMNode) => PMNode): Slice {
  return new Slice(mapNodes(slice.content, f), slice.openStart, slice.openEnd);
}

function withSrc(n: PMNode, src: string): PMNode {
  return n.type.create({ ...n.attrs, src }, n.content, n.marks);
}

/** Change the links of a text node: a new href, null to leave it, false to take the link away. */
function withHrefs(n: PMNode, href: (h: string) => string | null | false): PMNode {
  if (!n.isText || !n.marks.some((m) => m.type.name === 'link')) return n;
  let changed = false;
  const marks = n.marks.flatMap((m) => {
    if (m.type.name !== 'link') return [m];
    const next = href(String(m.attrs.href ?? ''));
    if (next === null) return [m];
    changed = true;
    return next === false ? [] : [m.type.create({ ...m.attrs, href: next })];
  });
  return changed ? n.mark(marks) : n;
}

const mark = (vault: Vault, path: string) => `${VAULT_PREFIX}${encodeURIComponent(vault.id)}:${path}`;

/** A clipboard mark: the notebook's id and the path in it (old marks, from templates, name no notebook). */
function unmark(value: string): { notebook: string | null; path: string } {
  const rest = value.slice(VAULT_PREFIX.length);
  const m = /^([^:/]*):(.*)$/.exec(rest);
  return m ? { notebook: decodeURIComponent(m[1]), path: m[2] } : { notebook: null, path: rest };
}

/** Copy: write each file's notebook and place into the copied blocks. */
export function markCopiedFiles(slice: Slice, ctx: Pick<Ctx, 'vault' | 'folder'>): Slice {
  openVaults.set(ctx.vault.id, ctx.vault);
  return mapSlice(slice, (n) => {
    if (isFileNode(n)) {
      const src = String(n.attrs.src ?? '');
      return src && !src.startsWith(VAULT_PREFIX) && isRelativeFileLink(src) ? withSrc(n, mark(ctx.vault, join(ctx.folder, src))) : n;
    }
    return withHrefs(n, (h) => {
      if (!h || h.startsWith(VAULT_PREFIX) || !isRelativeFileLink(h)) return null;
      const [path, fragment] = splitFragment(h);
      return mark(ctx.vault, join(ctx.folder, path)) + fragment;
    });
  });
}

export interface PastedFile {
  /** The notebook the file is in (its id), and where. */
  notebook: string;
  path: string;
  /** What the pasted block shows until the file is copied. */
  shown: string;
}

export interface PastedFiles {
  slice: Slice;
  /** Files that belong to another entry (or notebook), to copy into this one. */
  copies: PastedFile[];
}

/** The folder this entry's files are kept in: "<folder>/attachments/<id>". */
export function ownFilesDir(ctx: Pick<Ctx, 'folder' | 'docId' | 'path'>): string {
  return join(ctx.folder, LAYOUT.attachments, ctx.docId || stem(ctx.path));
}

/**
 * Paste: write each marked file and link from this entry's folder. Files from another entry are
 * listed in `copies`; until they are copied, blocks from this notebook show the original. Links to
 * pages of another notebook would lead to the wrong page here, so they become plain text.
 */
export function resolvePastedFiles(slice: Slice, ctx: Ctx): PastedFiles {
  const own = ownFilesDir(ctx);
  const copies = new Map<string, PastedFile>();
  const out = mapSlice(slice, (n) => {
    if (isFileNode(n)) {
      const src = String(n.attrs.src ?? '');
      if (!src.startsWith(VAULT_PREFIX)) return n;
      const { notebook, path } = unmark(src);
      const here = notebook == null || notebook === ctx.vault.id;
      if (here && isInside(path, own)) return withSrc(n, relative(ctx.folder, path) || basename(path));
      // From another notebook, the block waits for its copy (the same path here may be another file).
      const shown = here ? relative(ctx.folder, path) || basename(path) : src;
      copies.set(src, { notebook: notebook ?? ctx.vault.id, path, shown });
      return withSrc(n, shown);
    }
    return withHrefs(n, (h) => {
      if (!h.startsWith(VAULT_PREFIX)) return null;
      const { notebook, path: marked } = unmark(h);
      if (notebook != null && notebook !== ctx.vault.id) return false;
      const [path, fragment] = splitFragment(marked);
      return (relative(ctx.folder, path) || basename(path)) + fragment;
    });
  });
  return { slice: out, copies: [...copies.values()] };
}

/**
 * Copy files pasted from another entry into this entry's attachments folder, then point every
 * block that shows the original at its copy. A file of this notebook that cannot be copied stays
 * linked as it was. Returns how many files from another notebook could not be copied.
 */
export async function adoptPastedFiles(view: EditorView, ctx: DocContextValue, copies: PastedFile[]): Promise<number> {
  const dir = ownFilesDir(ctx);
  const moved = new Map<string, string>();
  let lost = 0;
  for (const c of copies) {
    const from = c.notebook === ctx.vault.id ? ctx.vault : openVaults.get(c.notebook);
    try {
      if (!from || !(await from.exists(c.path))) throw new Error('The file is not there');
      const to = await uniquePath(ctx.vault, dir, basename(c.path));
      if (from === ctx.vault) await copyFile(ctx.vault, c.path, to);
      else await ctx.vault.write(to, await from.readBlob(c.path));
      moved.set(c.shown, relative(ctx.folder, to));
    } catch (err) {
      console.warn('Could not copy a pasted file into this entry', c.path, err);
      if (c.shown.startsWith(VAULT_PREFIX)) {
        // Not reachable from this notebook: the block names the file, and says it is not found.
        moved.set(c.shown, relative(ctx.folder, join(dir, basename(c.path))));
        lost++;
      }
    }
  }
  if (!moved.size || view.isDestroyed) return lost;
  const tr = view.state.tr;
  view.state.doc.descendants((node, pos) => {
    if (!isFileNode(node)) return;
    const to = moved.get(String(node.attrs.src ?? ''));
    if (to) tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: to });
  });
  if (tr.docChanged) view.dispatch(tr.setMeta('addToHistory', false));
  return lost;
}
