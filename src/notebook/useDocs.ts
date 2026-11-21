import { useRef } from 'react';
import { useNotebook } from './store';
import type { DocMeta } from './model';

/**
 * What saving a page's text changes at every pause in typing: the text itself (for searching), its
 * first lines, and when it was saved. Views that show none of these need not be drawn again.
 */
const EVERY_SAVE = new Set<string>(['text', 'preview', 'modified', 'mtime']);

/**
 * What else a save reads from the text (its checklist, links, flow steps, reminders, stocks…) is
 * made anew at each save, the same or not: compared by what it holds. The sidebar shows a flow's
 * steps under it, for one.
 */
const READ_FROM_TEXT = new Set<string>(['includes', 'tasks', 'refs', 'stockItems', 'flow', 'reminders']);

function sameBesidesSave(a: DocMeta, b: DocMeta): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (EVERY_SAVE.has(k)) continue;
    const x = a[k as keyof DocMeta];
    const y = b[k as keyof DocMeta];
    if (x === y) continue;
    if (READ_FROM_TEXT.has(k) && JSON.stringify(x) === JSON.stringify(y)) continue;
    return false;
  }
  return true;
}

export function sameDocs(prev: Record<string, DocMeta>, next: Record<string, DocMeta>, skip: string | true): boolean {
  if (prev === next) return true;
  const keys = Object.keys(next);
  if (keys.length !== Object.keys(prev).length) return false;
  for (const k of keys) {
    const a = prev[k];
    const b = next[k];
    if (a === b) continue;
    if (!a) return false;
    if (skip !== true && k !== skip) return false;
    if (!sameBesidesSave(a, b)) return false;
  }
  return true;
}

/**
 * The notebook's pages, for a view that does not show what saving a page's text changes. `skip`
 * is the page whose saves to ignore (the page open around the view), or true for every page.
 * Saving the page being written then redraws nothing else, so typing stays quick in long pages.
 */
export function useDocsBesidesSaves(skip: string | true): Record<string, DocMeta> {
  const last = useRef<Record<string, DocMeta> | null>(null);
  return useNotebook((s) => {
    const prev = last.current;
    if (prev && sameDocs(prev, s.docs, skip)) return prev;
    last.current = s.docs;
    return s.docs;
  });
}
