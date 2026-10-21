import { basename, extname, isRelativeFileLink, safeDecode, stem } from '../lib/path';
import { stockItems, type StockItem } from '../stocks/model';
import type { DocKind, FlowStepRef } from './model';
import { flowStepRefs } from '../flow/model';
import { plateFromTable, plateRefs } from '../plate/model';

/**
 * Headings end with a colon and list items are kept apart with " · ", so that a preview reads
 * "Updates: Cloning done. Actions: Order Q5 · Book the reader" rather than running them together.
 */
function separateBlocks(markdown: string): string {
  let fence = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) fence = !fence;
      if (fence) return line;
      const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
      if (heading) return heading[1] && !/[.:;!?]$/.test(heading[1]) ? `${heading[1]}:` : heading[1];
      const item = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*\S)\s*$/.exec(line);
      return item && !/[.:;!?,]$/.test(item[1]) ? `${line} ·` : line;
    })
    .join('\n');
}

const PLATE_BLOCK_RE = /<!--\s*gc:plate\s+(\{[\s\S]*?\})\s*-->[ \t]*\n((?:[ \t]*\|.*(?:\n|$))*)/g;

/** A plate in a preview: "ELISA 1, 96-well plate: Blank, WT, KO." (its samples, not every well of the table). */
function summarizePlates(markdown: string): string {
  return markdown.replace(PLATE_BLOCK_RE, (_, json: string, table: string) => {
    let meta: Record<string, unknown> | null = null;
    try {
      meta = JSON.parse(json) as Record<string, unknown>;
    } catch {
      /* the table alone */
    }
    const rows = table
      .split('\n')
      .filter((l) => l.trim() && !/^\s*\|?\s*:?-{3,}/.test(l))
      .map((l) =>
        l
          .trim()
          .replace(/^\||\|$/g, '')
          .split(/(?<!\\)\|/),
      );
    const d = plateFromTable(rows, meta);
    const what = `${d.name.trim() ? `${d.name.trim()}, ` : ''}${d.format}-well plate`;
    return `${what}${d.samples.length ? `: ${d.samples.map((s) => s.name).join(', ')}` : ''}.\n\n`;
  });
}

/** Rough Markdown → plain text, for search and previews. */
export function toPlainText(markdown: string, limit = 20000): string {
  return separateBlocks(summarizePlates(markdown))
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*/g, ' '))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, '')
    .replace(/[|*_`~]/g, ' ')
    .replace(/\\([\\`*_{}[\]()#+\-.!|<>])/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/(\s*·)+\s*$/, '')
    .replace(/·(\s*·)+/g, '·')
    .trim()
    .slice(0, limit);
}

export function excerpt(text: string, length = 140): string {
  if (text.length <= length) return text;
  const cut = text.slice(0, length);
  const sp = cut.lastIndexOf(' ');
  return (sp > length * 0.6 ? cut.slice(0, sp) : cut) + '…';
}

const INCLUDE_RE = /<!--\s*gc:include\s*(\{[\s\S]*?\})\s*-->/g;
const TASK_RE = /^\s*[-*+]\s+\[([ xX])\]/gm;
// [text](dest) or [text](<dest with spaces>), not images.
const LINK_RE = /(?<!!)\[(?:[^\]\\]|\\.)*\]\(\s*(?:<([^>\n]+)>|([^)\s]+))/g;

/**
 * Ids of notebook docs linked from a body. Docs with ids are saved as "<id> <title>.md",
 * so the id is the file name up to the first space.
 */
export function linkedIds(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(LINK_RE)) {
    const href = m[1] ?? m[2];
    if (!isRelativeFileLink(href)) continue;
    // In Markdown a literal "#" starts the fragment ("#" in a file name is written %23).
    const i = href.indexOf('#');
    const path = safeDecode(i < 0 ? href : href.slice(0, i));
    if (extname(path) !== '.md') continue;
    const id = stem(basename(path)).split(' ')[0];
    if (id) out.add(id);
    // A link to one stock: Stocks/Primers.md#PR-0001.
    if (i >= 0 && /(^|\/)Stocks\/[^/]+\.md$/.test(path)) {
      const stock = safeDecode(href.slice(i + 1));
      if (stock) out.add(stock);
    }
  }
  return [...out];
}

/** Facts derived from a Markdown body (not stored in front matter). */
export function bodyFacts(
  body: string,
  kind?: DocKind,
): {
  text: string;
  includes: string[];
  tasks?: { done: number; total: number };
  refs: string[];
  stockItems?: StockItem[];
  flow: FlowStepRef[] | undefined;
} {
  const includes: string[] = [];
  for (const m of body.matchAll(INCLUDE_RE)) {
    try {
      const data = JSON.parse(m[1]) as { id?: string; ref?: string };
      const id = data.id ?? data.ref;
      if (id) includes.push(id);
    } catch {
      /* ignore */
    }
  }
  let done = 0;
  let total = 0;
  for (const m of body.matchAll(TASK_RE)) {
    total++;
    if (m[1] !== ' ') done++;
  }
  return {
    text: toPlainText(body),
    includes,
    tasks: total ? { done, total } : undefined,
    // Links in the text, and the stocks and entries plate layouts are linked to.
    refs: [...new Set([...linkedIds(body), ...plateRefs(body)])],
    flow: flowStepRefs(body),
    ...(kind === 'stocks' ? { stockItems: stockItems(body) } : {}),
  };
}
