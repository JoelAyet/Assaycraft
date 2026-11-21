import type { Node as PMNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** Decorations for one top-level block at `pos`. */
export type BlockScan = (block: PMNode, pos: number) => Decoration[];

/** Decorations for the whole document, block by block. */
export function scanAll(doc: PMNode, scan: BlockScan): DecorationSet {
  const out: Decoration[] = [];
  doc.forEach((block, offset) => out.push(...scan(block, offset)));
  return DecorationSet.create(doc, out);
}

/**
 * The decorations after a change, looking again only at the top-level blocks it touched. Looking
 * at the whole page at every key made typing slow in long pages (audit of 21 November).
 */
export function rescanChanged(tr: Transaction, old: DecorationSet, scan: BlockScan): DecorationSet {
  if (!tr.docChanged) return old;
  const doc = tr.doc;
  let set = old.map(tr.mapping, doc);
  const blocks = new Map<number, PMNode>();
  const maps = tr.mapping.maps;
  maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((_from, _to, start, end) => {
      const from = Math.max(0, rest.map(start, -1) - 1);
      const to = Math.min(doc.content.size, rest.map(end, 1) + 1);
      doc.nodesBetween(from, to, (node, pos) => {
        blocks.set(pos, node);
        return false;
      });
    });
  });
  for (const [pos, block] of blocks) {
    const end = pos + block.nodeSize;
    // Also those reaching into it: a line split in the middle of one leaves it across both lines.
    set = set.remove(set.find(pos, end).filter((d) => d.from < end && d.to > pos));
    const fresh = scan(block, pos);
    if (fresh.length) set = set.add(doc, fresh);
  }
  return set;
}
