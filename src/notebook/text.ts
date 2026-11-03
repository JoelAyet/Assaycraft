import { basename, extname, isRelativeFileLink, safeDecode, stem } from '../lib/path';
import { stockItems, type StockItem } from '../stocks/model';
import type { DocKind, FlowStepRef } from './model';
import { flowStepRefs } from '../flow/model';
import { plateFromTable, plateRefs } from '../plate/model';
import { REMINDER_RE, remindersIn, type Reminder } from '../reminders/model';

/** Marks where a heading starts in plain text (U+2063, invisible): see snippetAround. */
export const HEADING_MARK = '\u2063';

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
      // Marked (invisibly), so a search result can name the section a match is in.
      if (heading) return HEADING_MARK + (heading[1] && !/[.:;!?]$/.test(heading[1]) ? `${heading[1]}:` : heading[1]);
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
    .replace(REMINDER_RE, (_, d: string, t?: string) => ` ${d}${t ? ` ${t}` : ''} `)
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

/**
 * What a page says in its author's own words, for previews (Home, Notes), in short parts: not its
 * headings, tables, code or drawn notes, not a template's prompts (lines all in italics) and not
 * lines with blanks still to fill ({{Construct}}). A page made from a template and not yet written
 * in has none.
 */
export function previewParts(markdown: string, limit = 400): string[] {
  const parts: string[] = [];
  let size = 0;
  let fence = false;
  for (const raw of summarizePlates(markdown).split('\n')) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence || !line || /^#{1,6}\s/.test(line) || line.startsWith('|') || line.startsWith('<!--')) continue;
    if (/\{\{[^}]*\}\}/.test(line)) continue;
    const bare = line
      .replace(/^>\s?/, '')
      .replace(/^(?:[-*+]|\d+[.)])(?:\s+|$)/, '')
      .replace(/^\[[ xX]\](?:\s+|$)/, '')
      .trim();
    if (!bare || /^([*_])(?!\1)[^*_].*[^*_\s]\1$/.test(bare) || /^([*_])[^*_]\1$/.test(bare)) continue;
    const item = bare !== line.replace(/^>\s?/, '').trim();
    const text = toPlainText(bare, limit);
    if (!text) continue;
    parts.push(item && !/[.:;!?,]$/.test(text) ? `${text} ·` : text);
    size += text.length + 1;
    if (size >= limit) break;
  }
  return parts;
}

/** A preview from preview parts, leaving out the parts that only repeat its template's. */
export function previewText(parts: readonly string[] | undefined, templateParts?: readonly string[]): string {
  if (!parts?.length) return '';
  const boiler = new Set(templateParts ?? []);
  return parts
    .filter((p) => !boiler.has(p))
    .join(' ')
    .replace(/\s*·\s*$/, '');
}

/**
 * A search result's context: the sentence the match is in (not the table numbers before it), with
 * the section it is under in front, "PCR: amplicon › Template pUC19 · primers…".
 */
export function snippetAround(text: string, q: string, after = 70): string | null {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return null;
  // The section: the last heading before the match, unless the match is in that heading.
  const h = text.lastIndexOf(HEADING_MARK, i);
  let heading = '';
  let floor = 0;
  if (h >= 0) {
    const colon = text.indexOf(':', h);
    const headEnd = colon < 0 ? h + 1 : colon + 1;
    floor = headEnd;
    if (i >= headEnd) heading = text.slice(h + 1, colon < 0 ? h + 1 : colon).trim();
    else floor = h + 1;
  }
  // From the start of the sentence (or list item) the match is in.
  let start = floor;
  for (const sep of ['. ', '? ', '! ', ' · ', '; ']) {
    const at = text.lastIndexOf(sep, i - 1);
    if (at >= floor && at + sep.length <= i) start = Math.max(start, at + sep.length);
  }
  if (i - start > 60) {
    start = i - 40;
    const sp = text.indexOf(' ', start);
    if (sp > 0 && sp < i) start = sp + 1;
  }
  let body = text.slice(start, i + q.length + after).replace(new RegExp(HEADING_MARK, 'g'), '');
  // Numbers from a table just before the match say nothing.
  if (start < i) body = body.replace(/^(?:[\d.,−-]+\s+){2,}/, '');
  const end = i + q.length + after < text.length;
  const lead = !heading && start > floor && !/[.?!·]\s*$/.test(text.slice(0, start)) ? '…' : '';
  return `${heading ? `${heading} › ` : ''}${lead}${body.trim()}${end ? '…' : ''}`;
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
  preview: string[];
  includes: string[];
  tasks?: { done: number; total: number };
  refs: string[];
  stockItems?: StockItem[];
  flow: FlowStepRef[] | undefined;
  reminders: Reminder[] | undefined;
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
    preview: previewParts(body),
    includes,
    tasks: total ? { done, total } : undefined,
    // Links in the text, and the stocks and entries plate layouts are linked to.
    refs: [...new Set([...linkedIds(body), ...plateRefs(body)])],
    flow: flowStepRefs(body),
    reminders: (kind === undefined || kind === 'entry' || kind === 'note' || kind === 'card') && body.includes('(@') ? remindersIn(body) : undefined,
    ...(kind === 'stocks' ? { stockItems: stockItems(body) } : {}),
  };
}
