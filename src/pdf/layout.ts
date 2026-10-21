/**
 * Turns the text of PDF pages back into a structured document: title, headings, paragraphs,
 * numbered steps and bullet lists (nested), tables, figures, bold/italic, superscripts and links.
 *
 * A PDF only knows where glyphs are drawn, so the structure is inferred from the layout:
 * - text runs on the same baseline form rows; big horizontal gaps split rows into segments (cells);
 * - running headers, footers and page numbers (repeated at the top or bottom of pages) are dropped;
 * - two-column pages are read column by column;
 * - font size and weight make headings; markers ("1.", "a)", "•", drawn bullets) make lists;
 * - rows whose segments line up in columns make tables;
 * - lines are joined into paragraphs, and words split by a hyphen at the end of a line are rejoined.
 */
import type { JSONContent } from '@tiptap/core';
import type { Box, PdfFont, PdfInfo, PdfPageData } from './types';

export interface Figure {
  /** Referenced by image nodes as `src: "figure:<id>"`. */
  id: string;
  page: number;
  box: Box;
  /** The whole page, for scanned pages without text. */
  wholePage?: boolean;
}

export interface PdfConversion {
  title: string;
  description?: string;
  doc: JSONContent;
  figures: Figure[];
  /** No text layer: the PDF is a scan (or text converted to outlines). */
  scanned: boolean;
  stats: { pages: number; headings: number; steps: number; lists: number; tables: number; figures: number; words: number };
}

export const FIGURE_SRC = 'figure:';

// ───────────────────────────── characters ─────────────────────────────

/** A character table from runs of consecutive codes: { 0x41: 'ΑΒ' } maps 0x41 → Α and 0x42 → Β. */
function runs(table: Record<number, string>): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [start, chars] of Object.entries(table)) [...chars].forEach((ch, i) => (out[Number(start) + i] = ch));
  return out;
}

/** Symbol font (Word's bullets, Greek letters, °, ±, ×, µ…) to Unicode, for fonts that map to the private-use area. */
const SYMBOL = runs({
  0x20: ' ',
  0x22: '∀',
  0x24: '∃',
  0x27: '∋',
  0x2d: '−',
  0x40: '≅ΑΒΧΔΕΦΓΗΙ',
  0x4b: 'ΚΛΜΝΟΠΘΡΣΤΥ',
  0x57: 'ΩΞΨΖ',
  0x61: 'αβχδεφγηιϕκλµνοπθρστυ',
  0x77: 'ωξψζ',
  0x7e: '∼',
  0xa2: '′≤',
  0xa5: '∞',
  0xab: '↔←↑→↓°±″≥×∝∂•÷≠≡≈',
  0xd6: '√·',
  0xde: '⇒',
});
/** Wingdings bullets and check marks. */
const WINGDINGS = runs({
  0x6c: '●',
  0x6e: '■□',
  0x71: '❑',
  0x75: '◆❖◆',
  0x9f: '•',
  0xa7: '▪□',
  0xd8: '➢',
  0xe0: '→',
  0xe8: '→',
  0xf0: '⇨',
  0xfb: '✗✓',
  0xfe: '☑',
});

function fixChars(s: string, font: PdfFont | undefined): string {
  let out = s.replace(/[\uF020-\uF0FF]/g, (ch) => {
    const code = ch.charCodeAt(0) - 0xf000;
    const name = font?.name ?? '';
    if (/wingding|webding|zapf|dingbat/i.test(name)) return WINGDINGS[code] ?? '•';
    if (/symbol/i.test(name)) return SYMBOL[code] ?? '';
    return SYMBOL[code] ?? (code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : '');
  });
  out = out
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/[\u00A0\u2000-\u200A\u202F]/g, ' ')
    .replace(/\u200B|\uFEFF/g, '');
  return out;
}

// ───────────────────────────── rows and segments ─────────────────────────────

interface Run {
  str: string;
  x: number;
  x1: number;
  y: number;
  size: number;
  bold: boolean;
  italic: boolean;
  mono: boolean;
  /** 1 = superscript, -1 = subscript */
  script: 0 | 1 | -1;
  href?: string;
  /** Continues the previous run without a space (the item was split, e.g. at a link). */
  joinLeft?: boolean;
}

interface Segment {
  runs: Run[];
  x0: number;
  x1: number;
}

interface Row {
  page: number;
  y: number;
  size: number;
  runs: Run[];
  segs: Segment[];
}

/** A line of text in reading order (a row, or one column's part of it). */
interface Line {
  page: number;
  region: string;
  y: number;
  size: number;
  x0: number;
  x1: number;
  segs: Segment[];
  text: string;
  bold: boolean;
  italic: boolean;
  /** Left and right edges of the column the line is in. */
  left: number;
  right: number;
  /** A bullet drawn as a shape just before the line. */
  dot?: Box;
  figure?: Figure;
}

const lettersOf = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '');

function modeOf(values: number[], weights?: number[]): number {
  const m = new Map<number, number>();
  values.forEach((v, i) => m.set(v, (m.get(v) ?? 0) + (weights?.[i] ?? 1)));
  let best = values[0] ?? 0;
  let bestW = -1;
  for (const [v, w] of m) if (w > bestW || (w === bestW && v < best)) [best, bestW] = [v, w];
  return best;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function pageRuns(p: PdfPageData): Run[] {
  const runs: Run[] = [];
  for (const t of p.texts) {
    const font = p.fonts[t.font];
    const str = fixChars(t.str, font);
    if (!str.trim()) continue;
    const base = { y: t.y, size: t.size, bold: !!font?.bold, italic: !!font?.italic, mono: !!font?.mono, script: 0 as const };
    const cw = t.w / Math.max(1, str.length);
    // Character ranges, split where links start and end and at runs of spaces (typewriter-style tables).
    const cuts = new Set<number>([0, str.length]);
    const mid = t.y - t.size / 3;
    const links = p.links.filter((l) => mid >= l.y0 - 2 && mid <= l.y1 + 2 && l.x0 < t.x + t.w - cw / 2 && l.x1 > t.x + cw / 2);
    const snap = (i: number) => {
      // Move a cut to the nearest word boundary.
      let a = i;
      let b = i;
      while (a > 0 && /\S/.test(str[a - 1]) && /\S/.test(str[a] ?? ' ')) a--;
      while (b < str.length && /\S/.test(str[b - 1] ?? ' ') && /\S/.test(str[b])) b++;
      return i - a <= b - i ? a : b;
    };
    for (const l of links) {
      cuts.add(snap(Math.max(0, Math.min(str.length, Math.round((l.x0 - t.x) / cw)))));
      cuts.add(snap(Math.max(0, Math.min(str.length, Math.round((l.x1 - t.x) / cw)))));
    }
    for (const m of str.matchAll(/ {3,}|\t+/g)) {
      cuts.add(m.index!);
      cuts.add(m.index! + m[0].length);
    }
    const sorted = [...cuts].sort((a, b) => a - b);
    for (let k = 1; k < sorted.length; k++) {
      const part = str.slice(sorted[k - 1], sorted[k]);
      if (!part.trim()) continue;
      const x = t.x + sorted[k - 1] * cw;
      const x1 = t.x + sorted[k] * cw;
      const href = links.find((l) => (x + x1) / 2 >= l.x0 - 1 && (x + x1) / 2 <= l.x1 + 1)?.url;
      // Keep one run when nothing splits it, so spacing inside it is as drawn.
      if (sorted.length === 2) runs.push({ ...base, str, x: t.x, x1: t.x + t.w, href });
      else runs.push({ ...base, str: part, x, x1, href, joinLeft: k > 1 && !/^\s/.test(part) && !/\s$/.test(str.slice(0, sorted[k - 1])) });
    }
  }
  return runs;
}

function rowSize(runs: Run[]) {
  const main = runs.filter((r) => !r.script);
  const use = main.length ? main : runs;
  return modeOf(
    use.map((r) => Math.round(r.size * 2) / 2),
    use.map((r) => r.str.length),
  );
}

/**
 * Superscripts and subscripts: smaller text right next to bigger text, raised or lowered. They get
 * the baseline of the text they belong to, so they end up on its row.
 */
function markScripts(runs: Run[]) {
  if (runs.length < 2) return;
  // Only runs a few points apart vertically can belong together: scan a window of runs sorted by baseline.
  const byY = [...runs].sort((a, b) => a.y - b.y);
  const reach = 0.7 * Math.max(...runs.map((r) => r.size));
  const found: { run: Run; y: number; script: 1 | -1 }[] = [];
  let lo = 0;
  for (const r of byY) {
    while (byY[lo].y < r.y - reach) lo++;
    let best: Run | null = null;
    let bestD = Infinity;
    for (let j = lo; j < byY.length && byY[j].y <= r.y + reach; j++) {
      const h = byY[j];
      if (h === r || h.size < r.size * 1.18) continue;
      const d = Math.abs(h.y - r.y);
      if (d < 0.15 * h.size || d > 0.7 * h.size) continue;
      const after = r.x >= h.x1 - 1 && r.x - h.x1 <= 0.6 * h.size;
      const before = r.x1 <= h.x + 1 && h.x - r.x1 <= 0.6 * h.size;
      if ((after || before) && d < bestD) [best, bestD] = [h, d];
    }
    if (best) found.push({ run: r, y: best.y, script: r.y < best.y ? 1 : -1 });
  }
  for (const f of found) {
    f.run.script = f.script;
    f.run.y = f.y;
  }
}

function buildRows(p: PdfPageData): Row[] {
  const all = pageRuns(p);
  markScripts(all);
  const runs = all.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: { y: number; size: number; runs: Run[] }[] = [];
  for (const r of runs) {
    const row = rows.length ? rows[rows.length - 1] : null;
    if (row && Math.abs(r.y - row.y) <= 0.25 * Math.max(r.size, row.size)) {
      row.runs.push(r);
      if (r.size > row.size) [row.y, row.size] = [r.y, r.size];
    } else rows.push({ y: r.y, size: r.size, runs: [r] });
  }
  const out: Row[] = [];
  for (const row of rows) {
    if (!row.runs.length) continue;
    const sorted = row.runs.sort((a, b) => a.x - b.x);
    // Text drawn twice with a small offset is a "fake bold".
    const runsOut: Run[] = [];
    for (const r of sorted) {
      const prev = runsOut[runsOut.length - 1];
      if (prev && prev.str === r.str && Math.abs(prev.x - r.x) < 1.5 && Math.abs(prev.y - r.y) < 1.5) {
        prev.bold = true;
        continue;
      }
      runsOut.push(r);
    }
    const size = rowSize(runsOut);
    const main = runsOut.filter((r) => !r.script && Math.abs(r.size - size) < 0.5);
    const y = main.length ? median(main.map((r) => r.y)) : row.y;
    const segs: Segment[] = [];
    for (const r of runsOut) {
      const seg = segs[segs.length - 1];
      if (seg && r.x - seg.x1 <= Math.max(size * 1.0, 6) && r.x >= seg.x0) {
        seg.runs.push(r);
        seg.x1 = Math.max(seg.x1, r.x1);
      } else segs.push({ runs: [r], x0: r.x, x1: r.x1 });
    }
    out.push({ page: p.index, y, size, runs: runsOut, segs });
  }
  return out;
}

const rowText = (segs: Segment[]) => segs.map((s) => segmentText(s)).join(' ');

function segmentText(s: Segment): string {
  let out = '';
  let prev: Run | null = null;
  for (const r of s.runs) {
    if (prev && !r.joinLeft && !/\s$/.test(out) && !/^\s/.test(r.str) && r.x - prev.x1 > 0.15 * Math.min(r.size, prev.size)) out += ' ';
    out += r.str;
    prev = r;
  }
  return out.replace(/\s+/g, ' ').trim();
}

// ───────────────────────────── headers, footers, columns ─────────────────────────────

const normalizeRepeat = (s: string) => s.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
const PAGE_NUMBER = /^(page|p\.|seite|página|pagina)?\s*#\s*((of|\/|de|von|sur|di)\s*#)?$|^[-–—]\s*#\s*[-–—]$|^#\s*\|.*|.*\|\s*#$/i;

/** Drop running headers and footers: rows near the top or bottom that repeat on many pages, and page numbers. */
function dropHeadersFooters(pages: { page: PdfPageData; rows: Row[] }[]) {
  const zone = (p: PdfPageData, r: Row) => (r.y < p.height * 0.1 ? 'top' : r.y > p.height * 0.9 ? 'bottom' : null);
  // Distance from the page edge, which is the same on every page for a running header or footer.
  const edge = (p: PdfPageData, r: Row) => (r.y < p.height / 2 ? r.y : p.height - r.y);
  const key = (zone: string, edge: number, text: string) => `${zone}\u0000${edge}\u0000${text}`;
  const seen = new Map<string, number[]>();
  for (const { page, rows } of pages) {
    const keys = new Set<string>();
    for (const r of rows) {
      const z = zone(page, r);
      if (z) keys.add(key(z, Math.round(edge(page, r) / 6), normalizeRepeat(rowText(r.segs))));
    }
    for (const k of keys) seen.set(k, [...(seen.get(k) ?? []), page.index]);
  }
  const n = pages.length;
  const repeated = (z: string, e: number, text: string) => {
    // Allow a little drift in position (the slots either side).
    const count = new Set([-1, 0, 1].flatMap((d) => seen.get(key(z, e + d, text)) ?? [])).size;
    return n >= 2 && count >= Math.max(2, Math.ceil(n * 0.5));
  };
  for (const entry of pages) {
    entry.rows = entry.rows.filter((r) => {
      const z = zone(entry.page, r);
      if (!z) return true;
      const text = normalizeRepeat(rowText(r.segs));
      return !PAGE_NUMBER.test(text) && !repeated(z, Math.round(edge(entry.page, r) / 6), text);
    });
  }
}

interface Gutter {
  x: number;
  /** Indexes of the rows that are read as two columns. */
  rows: Set<number>;
}

/**
 * Find a column gutter: an x that runs of rows do not cross, with prose on both sides (one segment
 * per row, wide). Tables also leave gaps between their columns, but their rows have several segments.
 */
function findGutter(rows: Row[]): Gutter | null {
  if (rows.length < 4) return null;
  const left = Math.min(...rows.map((r) => r.segs[0].x0));
  const right = Math.max(...rows.map((r) => r.segs[r.segs.length - 1].x1));
  const width = right - left;
  if (width < 200) return null;
  let best: (Gutter & { score: number }) | null = null;
  for (let gx = left + width * 0.3; gx <= left + width * 0.7; gx += 2) {
    let score = 0;
    const picked = new Set<number>();
    let run: number[] = [];
    const flush = () => {
      const sides = [run.map((i) => rows[i].segs.filter((s) => s.x1 <= gx)), run.map((i) => rows[i].segs.filter((s) => s.x0 >= gx))].map((side) =>
        side.filter((segs) => segs.length),
      );
      const prose = (side: Segment[][]) =>
        side.length >= 2 &&
        side.filter((segs) => segs.length === 1 || justified(segs)).length >= side.length * 0.75 &&
        median(side.map((segs) => segs[segs.length - 1].x1 - segs[0].x0)) >= width * 0.3;
      if (sides[0].length + sides[1].length >= 4 && prose(sides[0]) && prose(sides[1])) {
        score += sides[0].length + sides[1].length;
        for (const i of run) picked.add(i);
      }
      run = [];
    };
    rows.forEach((r, i) => {
      if (r.segs.some((s) => s.x0 < gx - 1 && s.x1 > gx + 1)) flush();
      else run.push(i);
    });
    flush();
    if (score > 0 && (!best || score > best.score)) best = { x: gx, rows: picked, score };
  }
  return best;
}

function makeLine(page: number, region: string, segs: Segment[], left: number, right: number): Line {
  const runs = segs.flatMap((s) => s.runs);
  const size = rowSize(runs);
  const main = runs.filter((r) => !r.script && Math.abs(r.size - size) < 0.5);
  const y = main.length ? median(main.map((r) => r.y)) : runs[0].y;
  const chars = (pred: (r: Run) => boolean) => runs.filter(pred).reduce((n, r) => n + lettersOf(r.str).length, 0);
  const total = Math.max(
    1,
    chars(() => true),
  );
  return {
    page,
    region,
    y,
    size,
    x0: segs[0].x0,
    x1: segs[segs.length - 1].x1,
    segs,
    text: rowText(segs),
    bold: chars((r) => r.bold) / total >= 0.9,
    italic: chars((r) => r.italic) / total >= 0.9,
    left,
    right,
  };
}

/** Rows of a page in reading order, as lines; two-column parts are read column by column. */
function pageLines(page: PdfPageData, rows: Row[]): Line[] {
  if (!rows.length) return [];
  const gutter = findGutter(rows);
  const left = Math.min(...rows.map((r) => r.segs[0].x0));
  const right = Math.max(...rows.map((r) => r.segs[r.segs.length - 1].x1));
  const out: Line[] = [];
  let run: Row[] = [];
  let k = 0;
  const flush = () => {
    if (!run.length || !gutter) return;
    const gx = gutter.x;
    const ls = run.map((r) => r.segs.filter((s) => s.x1 <= gx)).filter((x) => x.length);
    const rs = run.map((r) => r.segs.filter((s) => s.x0 >= gx)).filter((x) => x.length);
    const lLeft = Math.min(...ls.map((x) => x[0].x0));
    const rLeft = Math.min(...rs.map((x) => x[0].x0));
    for (const segs of ls) out.push(makeLine(page.index, `${page.index}c${k}L`, segs, lLeft, gx));
    for (const segs of rs) out.push(makeLine(page.index, `${page.index}c${k}R`, segs, rLeft, right));
    run = [];
    k++;
  };
  rows.forEach((r, i) => {
    if (gutter?.rows.has(i)) run.push(r);
    else {
      flush();
      out.push(makeLine(page.index, `${page.index}`, r.segs, left, right));
    }
  });
  flush();
  return out;
}

// ───────────────────────────── figures ─────────────────────────────

function pageFigures(pages: PdfPageData[], textChars: number[]): Figure[] {
  const figures: Figure[] = [];
  const key = (b: Box) => [b.x0, b.y0, b.x1, b.y1].map((v) => Math.round(v / 4)).join(',');
  const repeats = new Map<string, number>();
  for (const p of pages) for (const k of new Set(p.images.map(key))) repeats.set(k, (repeats.get(k) ?? 0) + 1);
  for (const p of pages) {
    const area = p.width * p.height;
    const covers = (b: Box) => ((b.x1 - b.x0) * (b.y1 - b.y0)) / area;
    if (textChars[p.index] < 15 && p.images.some((b) => covers(b) > 0.4)) {
      figures.push({ id: `p${p.index + 1}`, page: p.index, box: { x0: 0, y0: 0, x1: p.width, y1: p.height }, wholePage: true });
      continue;
    }
    // Merge images that touch (tiles, image + mask), then keep the ones that look like figures.
    const boxes: Box[] = [];
    for (const img of p.images) {
      const b = {
        x0: Math.max(0, img.x0),
        y0: Math.max(0, img.y0),
        x1: Math.min(p.width, img.x1),
        y1: Math.min(p.height, img.y1),
      };
      if (b.x1 - b.x0 < 4 || b.y1 - b.y0 < 4) continue;
      if (pages.length >= 2 && (repeats.get(key(img)) ?? 0) >= Math.max(2, pages.length * 0.5)) continue;
      const hit = boxes.find((o) => b.x0 <= o.x1 + 4 && b.x1 >= o.x0 - 4 && b.y0 <= o.y1 + 4 && b.y1 >= o.y0 - 4);
      if (hit) Object.assign(hit, { x0: Math.min(hit.x0, b.x0), y0: Math.min(hit.y0, b.y0), x1: Math.max(hit.x1, b.x1), y1: Math.max(hit.y1, b.y1) });
      else boxes.push(b);
    }
    let n = 0;
    for (const b of boxes) {
      const w = b.x1 - b.x0;
      const h = b.y1 - b.y0;
      if (w < 36 || h < 36 || w * h < 2500) continue;
      // Backgrounds and watermarks behind text.
      if (covers(b) > 0.7 && textChars[p.index] > 200) continue;
      // Small logos in the header or footer.
      if ((b.y1 < p.height * 0.12 || b.y0 > p.height * 0.88) && w < p.width * 0.35) continue;
      figures.push({ id: `p${p.index + 1}-${++n}`, page: p.index, box: b });
    }
  }
  return figures;
}

// ───────────────────────────── lists ─────────────────────────────

type ListKind = 'bullet' | 'ordered' | 'task';
interface Marker {
  kind: ListKind;
  /** Ordered lists: the number, letter (a = 1) or roman numeral value. */
  n?: number;
  style?: 'decimal' | 'alpha' | 'roman';
  checked?: boolean;
  /** Characters to strip from the start of the line. */
  length: number;
}

const BULLETS = '•●○◦▪▫■‣⁃∙·◆◇❖➢➤►▸▶→⇨✓✔✗➔';
const BOXES = '☐□❑❒◻▢';
const CHECKED = '☑☒';
const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };

function listMarker(text: string): Marker | null {
  let m: RegExpMatchArray | null;
  if ((m = text.match(new RegExp(`^([${BULLETS}])\\s*(?=\\S)`, 'u')))) return { kind: 'bullet', length: m[0].length };
  if ((m = text.match(/^[-–—*]\s+(?=\S)/))) return { kind: 'bullet', length: m[0].length };
  if ((m = text.match(new RegExp(`^([${BOXES}${CHECKED}])\\s*(?=\\S)`, 'u'))))
    return { kind: 'task', checked: CHECKED.includes(m[1]), length: m[0].length };
  if ((m = text.match(/^(\d{1,3})[.)](?=\s)\s*(?=\S)/))) return { kind: 'ordered', n: Number(m[1]), style: 'decimal', length: m[0].length };
  if ((m = text.match(/^\((\d{1,3})\)\s*(?=\S)/))) return { kind: 'ordered', n: Number(m[1]), style: 'decimal', length: m[0].length };
  if ((m = text.match(/^step\s+(\d{1,3})\s*[:.)–-]?\s+(?=\S)/i))) return { kind: 'ordered', n: Number(m[1]), style: 'decimal', length: m[0].length };
  if ((m = text.match(/^(i{1,3}|iv|vi{0,3}|ix|xi{0,2})[.)]\s+(?=\S)/)))
    return { kind: 'ordered', n: ROMAN[m[1]], style: 'roman', length: m[0].length };
  if ((m = text.match(/^\(?([a-z])[.)]\s+(?=\S)/))) return { kind: 'ordered', n: m[1].charCodeAt(0) - 96, style: 'alpha', length: m[0].length };
  return null;
}

// ───────────────────────────── inline content ─────────────────────────────

type Mark = { type: string; attrs?: Record<string, unknown> };

function runMarks(r: Run, plainBold: boolean, plainItalic: boolean, bodyMono: boolean): Mark[] {
  const marks: Mark[] = [];
  if (r.bold && !plainBold) marks.push({ type: 'bold' });
  if (r.italic && !plainItalic) marks.push({ type: 'italic' });
  if (r.mono && !bodyMono) marks.push({ type: 'code' });
  if (r.script === 1) marks.push({ type: 'superscript' });
  if (r.script === -1) marks.push({ type: 'subscript' });
  if (r.href) marks.push({ type: 'link', attrs: { href: r.href } });
  return marks;
}

const sameMarks = (a: Mark[] = [], b: Mark[] = []) =>
  a.length === b.length && a.every((m, i) => m.type === b[i].type && m.attrs?.href === b[i].attrs?.href);

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?'"’”]/g;

/** Merge text nodes with the same marks, trim, and turn bare URLs into links. */
function tidyInline(nodes: JSONContent[]): JSONContent[] {
  const merged: JSONContent[] = [];
  for (const n of nodes) {
    const last = merged[merged.length - 1];
    if (last && sameMarks(last.marks as Mark[], n.marks as Mark[])) last.text = (last.text ?? '') + (n.text ?? '');
    else merged.push({ ...n });
  }
  for (const n of merged) n.text = (n.text ?? '').replace(/\s+/g, ' ');
  // "code" " " "code" → one code span (words drawn as separate runs).
  for (let k = merged.length - 2; k >= 1; k--) {
    const [a, gap, b] = [merged[k - 1], merged[k], merged[k + 1]];
    if (a.marks?.length && !gap.marks?.length && !gap.text!.trim() && sameMarks(a.marks as Mark[], b.marks as Mark[])) {
      a.text = a.text! + gap.text! + b.text!;
      merged.splice(k, 2);
    }
  }
  if (merged.length) {
    merged[0].text = merged[0].text!.replace(/^\s+/, '');
    merged[merged.length - 1].text = merged[merged.length - 1].text!.replace(/\s+$/, '');
  }
  // Keep spaces outside of marks, so "**Note:** text" stays tidy.
  const out: JSONContent[] = [];
  for (const n of merged) {
    if (!n.text) continue;
    if (n.marks?.length) {
      const lead = n.text.match(/^\s+/)?.[0] ?? '';
      const trail = n.text.match(/\s+$/)?.[0] ?? '';
      if (lead) out.push({ type: 'text', text: lead });
      const core = n.text.slice(lead.length, n.text.length - trail.length);
      if (core) out.push({ ...n, text: core });
      if (trail) out.push({ type: 'text', text: trail });
    } else out.push(n);
  }
  const linked: JSONContent[] = [];
  for (const n of out) {
    if (n.marks?.some((m) => m.type === 'link' || m.type === 'code')) {
      linked.push(n);
      continue;
    }
    let last = 0;
    const text = n.text!;
    for (const m of text.matchAll(URL_RE)) {
      if (m.index! > last) linked.push({ ...n, text: text.slice(last, m.index) });
      const href = m[0].startsWith('www.') ? `https://${m[0]}` : m[0];
      linked.push({ ...n, text: m[0], marks: [...((n.marks as Mark[]) ?? []), { type: 'link', attrs: { href } }] });
      last = m.index! + m[0].length;
    }
    if (last < text.length) linked.push({ ...n, text: text.slice(last) });
  }
  const final: JSONContent[] = [];
  for (const n of linked) {
    const prev = final[final.length - 1];
    if (prev && sameMarks(prev.marks as Mark[], n.marks as Mark[])) prev.text += n.text!;
    else final.push(n);
  }
  return final.filter((n) => n.text);
}

// ───────────────────────────── the converter ─────────────────────────────

const meaningfulTitle = (t: string | undefined) => {
  if (!t) return '';
  let s = t.replace(/^microsoft (word|powerpoint|excel) - /i, '').trim();
  if (/^(untitled|document\d*|slide \d+|\(?unspecified\)?|title|presentation\d*)$/i.test(s) || s.length < 3) return '';
  s = s.replace(/\.(docx?|pdf|indd|tex|pages|odt|rtf)$/i, '');
  if (/[_]/.test(s) && !/\s/.test(s)) s = s.replace(/_+/g, ' ');
  return s.length > 150 ? '' : s.trim();
};

export function titleFromFileName(name: string) {
  return (
    name
      .replace(/\.pdf$/i, '')
      .replace(/[_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Imported protocol'
  );
}

export function pdfToDoc(pages: PdfPageData[], info: Partial<PdfInfo> = {}, fileName = ''): PdfConversion {
  // 1. Rows per page, without running headers and footers.
  const perPage = pages.map((page) => ({ page, rows: buildRows(page) }));
  dropHeadersFooters(perPage);
  const textChars = pages.map((_, i) => perPage[i].rows.reduce((n, r) => n + lettersOf(rowText(r.segs)).length, 0));
  const totalChars = textChars.reduce((a, b) => a + b, 0);

  // 2. Lines in reading order, figures, and bullets drawn as shapes.
  const figures = pageFigures(pages, textChars);
  const stream: Line[] = [];
  for (const { page, rows } of perPage) {
    const lines = pageLines(page, rows);
    for (const line of lines) {
      line.dot = page.dots.find((d) => {
        const cy = (d.y0 + d.y1) / 2;
        return d.x1 <= line.x0 + 0.5 && line.x0 - d.x1 <= line.size * 2.6 && cy >= line.y - line.size * 0.85 && cy <= line.y + line.size * 0.1;
      });
    }
    const pageFigs = figures.filter((f) => f.page === page.index);
    for (const fig of pageFigs) {
      const b = fig.box;
      const at = lines.findIndex((l) => l.x0 < b.x1 && l.x1 > b.x0 && l.y - l.size * 0.8 >= b.y0 + (b.y1 - b.y0) * 0.5);
      const figLine: Line = { ...(lines[0] ?? makeEmptyLine(page.index)), figure: fig, text: '', segs: [], y: b.y1, x0: b.x0, x1: b.x1 };
      if (at < 0) lines.push(figLine);
      else lines.splice(at, 0, figLine);
    }
    stream.push(...lines);
  }

  // Table-of-contents lines ("Storage ........ 3") mean nothing without the page numbers.
  for (let i = stream.length - 1; i >= 0; i--) if (isTocLine(stream[i])) stream.splice(i, 1);
  const textLines = stream.filter((l) => !l.figure);
  const scanned = pages.length > 0 && totalChars < 25 * pages.length && figures.some((f) => f.wholePage);
  const bodySize =
    modeOf(
      textLines.map((l) => Math.round(l.size * 2) / 2),
      textLines.map((l) => l.text.length),
    ) || 10;
  const gaps: number[] = [];
  for (let i = 1; i < textLines.length; i++) {
    const a = textLines[i - 1];
    const b = textLines[i];
    if (a.region === b.region && Math.abs(a.size - bodySize) < 1 && Math.abs(b.size - bodySize) < 1 && b.y > a.y && b.y - a.y < bodySize * 2.2)
      gaps.push(b.y - a.y);
  }
  const lineGap = gaps.length ? Math.min(...gaps.sort((a, b) => a - b).slice(0, Math.max(1, Math.ceil(gaps.length * 0.6)))) : bodySize * 1.2;
  const typicalGap = gaps.length ? median(gaps) : bodySize * 1.2;
  const leading = Math.max(lineGap, Math.min(typicalGap, bodySize * 1.6));
  const bodyMono = textLines.filter((l) => l.segs.every((s) => s.runs.every((r) => r.mono))).length > textLines.length * 0.6;

  // 3. Title: the biggest text on the first page (the cover, for manuals); a subtitle under it is the description.
  let title = '';
  let subtitle = '';
  const first = textLines.filter((l) => l.page === textLines[0]?.page && lettersOf(l.text).length >= 3);
  if (first.length) {
    const max = Math.max(...first.map((l) => l.size));
    if (max >= bodySize * 1.25) {
      const i = stream.indexOf(first.find((l) => l.size === max)!);
      const parts = [stream[i]];
      for (let j = i + 1; j < stream.length && stream[j].page === stream[i].page && !stream[j].figure; j++) {
        const l = stream[j];
        if (Math.abs(l.size - max) > 0.6 || l.y - parts[parts.length - 1].y > max * 1.7 || parts.length >= 3) break;
        parts.push(l);
      }
      title = parts
        .map((l) => l.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (title.length > 180) title = '';
      else {
        const last = parts[parts.length - 1];
        const after = stream[stream.indexOf(last) + 1];
        for (const l of parts) stream.splice(stream.indexOf(l), 1);
        if (
          after &&
          !after.figure &&
          after.page === last.page &&
          after.y - last.y < max * 3 &&
          after.size >= bodySize * 1.1 &&
          after.size < max - 0.5 &&
          !after.bold &&
          after.text.length <= 200
        ) {
          subtitle = after.text;
          stream.splice(stream.indexOf(after), 1);
        }
      }
    }
  }
  title ||= meaningfulTitle(info.title) || titleFromFileName(fileName);

  // 4. Tables: runs of rows with two or more aligned segments.
  const tables = findTables(stream, leading, pages);

  // 5. Headings: bigger or bold short lines. Levels follow the sizes.
  const headingStyle = (l: Line, i: number): string | null => {
    if (l.figure || tables.has(l)) return null;
    const t = l.text;
    const letters = lettersOf(t);
    if (letters.length < 2 || t.length > 160 || !/\p{L}/u.test(t)) return null;
    const caps = letters.length >= 4 && t === t.toUpperCase() && /\p{Lu}/u.test(t);
    const big = l.size >= bodySize * 1.12;
    const next = stream[i + 1];
    const prev = stream[i - 1];
    const sameStyle = (o: Line | undefined) => !!o && !o.figure && Math.abs(o.size - l.size) < 0.5 && o.bold === l.bold && o.region === l.region;
    // A block of 4+ lines in the same style is a paragraph, not a heading.
    let block = 1;
    for (let j = i + 1; sameStyle(stream[j]) && stream[j].y - stream[j - 1].y < l.size * 1.8 && block < 5; j++) block++;
    for (let j = i - 1; sameStyle(stream[j]) && stream[j + 1].y - stream[j].y < l.size * 1.8 && block < 5; j--) block++;
    if (big && block <= 3) return `${Math.round(l.size * 2) / 2}${l.bold ? 'b' : ''}`;
    const short = t.length <= 90 && t.split(/\s+/).length <= 12 && !/[.,;]$/.test(t);
    if (l.bold && l.size >= bodySize * 0.95 && short && block <= 2 && !(listMarker(t) && !next?.bold)) return `${Math.round(l.size * 2) / 2}b`;
    if (caps && short && l.size >= bodySize * 0.95 && block <= 2 && (!prev || prev.page !== l.page || l.y - prev.y > leading * 1.3))
      return `${Math.round(l.size * 2) / 2}c`;
    return null;
  };
  const styles = new Map<Line, string>();
  stream.forEach((l, i) => {
    const s = headingStyle(l, i);
    if (s) styles.set(l, s);
  });
  const order = [...new Set(styles.values())].sort((a, b) => parseFloat(b) - parseFloat(a) || rankSuffix(a) - rankSuffix(b));
  const levelOf = (style: string) => Math.min(4, 2 + order.indexOf(style));

  // 6. Blocks.
  const blocks: JSONContent[] = [];
  const stats = { pages: pages.length, headings: 0, steps: 0, lists: 0, tables: 0, figures: 0, words: 0 };
  interface Level {
    kind: ListKind;
    indent: number;
    textX: number;
    node: JSONContent;
    style?: string;
  }
  const lists: Level[] = [];
  let para: { lines: Line[]; strip: number; target: JSONContent[]; level: Level | null } | null = null;

  const flush = () => {
    if (!para) return;
    const content = inlineFromLines(para.lines, para.strip, bodyMono);
    if (content.length) para.target.push({ type: 'paragraph', content });
    else if (para.level) para.target.push({ type: 'paragraph' });
    para = null;
  };
  const closeLists = () => {
    flush();
    lists.length = 0;
  };
  const lastItem = (lv: Level) => lv.node.content![lv.node.content!.length - 1];
  const out = (node: JSONContent) => {
    closeLists();
    blocks.push(node);
  };

  const shortLine = (l: Line) => l.x1 < l.right - Math.max(l.size * 4, (l.right - l.left) * 0.12);
  const gapBetween = (a: Line, b: Line) => (a.region === b.region && a.page === b.page ? b.y - a.y : null);
  const terminal = (l: Line) => /[.!?:]["”’)]?$/.test(l.text);

  const joins = (a: Line, b: Line, indentOk: (x: number) => boolean) => {
    if (Math.abs(a.size - b.size) > Math.max(0.6, a.size * 0.12)) return false;
    if (a.italic !== b.italic && lettersOf(b.text).length > 3) return false;
    const gap = gapBetween(a, b);
    if (gap === null) return !shortLine(a) && !terminal(a);
    if (gap <= 0 || gap > leading * 1.45 + 0.5) return false;
    if (!indentOk(b.x0)) return false;
    if (shortLine(a)) return (/^[\p{Ll}\d(]/u.test(b.text) && !terminal(a)) || /[\p{L}\d][-\u2010\u00AD]$/u.test(a.text);
    return true;
  };

  for (let i = 0; i < stream.length; i++) {
    const line = stream[i];
    if (line.figure) {
      out({ type: 'image', attrs: { src: FIGURE_SRC + line.figure.id, alt: line.figure.wholePage ? `Page ${line.figure.page + 1}` : '' } });
      stats.figures++;
      continue;
    }
    const table = tables.get(line);
    if (table) {
      if (table.first === line) {
        out({ type: 'spreadsheet', attrs: { data: { rows: table.rows, widths: table.widths } } });
        stats.tables++;
      }
      continue;
    }
    const style = styles.get(line);
    if (style) {
      const parts = [line];
      while (
        i + 1 < stream.length &&
        styles.get(stream[i + 1]) === style &&
        (gapBetween(stream[i], stream[i + 1]) ?? 99) < line.size * 1.6 &&
        parts.length < 3
      )
        parts.push(stream[++i]);
      const content = inlineFromLines(parts, 0, bodyMono, true);
      if (!content.length) continue;
      if (/^(table of )?contents$/i.test(parts.map((p) => p.text).join(' '))) continue;
      out({ type: 'heading', attrs: { level: levelOf(style) }, content });
      stats.headings++;
      continue;
    }

    const marker = listMarker(line.text);
    const dotted = !marker && line.dot ? line.dot : undefined;
    if (marker || dotted) {
      flush();
      const kind: ListKind = marker?.kind ?? 'bullet';
      const indent = dotted ? dotted.x0 : line.x0;
      const strip = marker?.length ?? 0;
      const textX = marker ? xAfter(line, strip) : line.x0;
      const tol = line.size * 0.6;
      while (lists.length && lists[lists.length - 1].indent > indent + tol) lists.pop();
      let lv = lists[lists.length - 1];
      const compatible = lv && lv.kind === kind && (kind !== 'ordered' || lv.style === marker?.style);
      if (lv && Math.abs(lv.indent - indent) <= tol && !compatible) {
        lists.pop();
        lv = lists[lists.length - 1];
      }
      if (!lv || indent > lv.indent + tol || !compatible || Math.abs(lv.indent - indent) > tol) {
        const type = kind === 'bullet' ? 'bulletList' : kind === 'task' ? 'taskList' : 'orderedList';
        const node: JSONContent = { type, content: [] };
        if (kind === 'ordered' && marker?.n && marker.n !== 1) node.attrs = { start: marker.n };
        const parent = lv && indent > lv.indent + tol ? lastItem(lv) : null;
        if (parent) parent.content!.push(node);
        else {
          lists.length = 0;
          blocks.push(node);
        }
        lv = { kind, indent, textX, node, style: marker?.style };
        lists.push(lv);
        stats.lists++;
      }
      const item: JSONContent =
        kind === 'task' ? { type: 'taskItem', attrs: { checked: !!marker?.checked }, content: [] } : { type: 'listItem', content: [] };
      lv.node.content!.push(item);
      lv.textX = textX;
      if (kind === 'ordered') stats.steps++;
      para = { lines: [line], strip, target: item.content!, level: lv };
      continue;
    }

    // Continuation of a paragraph or of a list item.
    const lv = lists[lists.length - 1];
    if (para) {
      const p = para as { lines: Line[]; level: Level | null };
      const prev = p.lines[p.lines.length - 1];
      const indentOk = p.level
        ? (x: number) => x >= p.level!.textX - line.size * 0.8 || (x >= p.level!.indent - line.size * 0.5 && !shortLine(prev))
        : (x: number) => x <= p.lines[0].x0 + line.size * 1.2 || p.lines.length > 1;
      if (joins(prev, line, indentOk)) {
        p.lines.push(line);
        continue;
      }
    }
    if (lv && line.x0 >= lv.textX - line.size * 0.8 && line.x0 > lists[0].indent + line.size * 0.4) {
      const prev = para ? (para as { lines: Line[] }).lines.slice(-1)[0] : stream[i - 1];
      const gap = prev ? gapBetween(prev, line) : null;
      if (gap === null || gap <= leading * 3) {
        flush();
        para = { lines: [line], strip: 0, target: lastItem(lv).content!, level: lv };
        continue;
      }
    }
    closeLists();
    para = { lines: [line], strip: 0, target: blocks, level: null };
  }
  flush();

  if (scanned) {
    blocks.unshift({
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'This PDF has no text to extract (it is probably a scan), so its pages were added as images. Type or paste the steps below them to make the protocol searchable.',
          marks: [{ type: 'italic' }],
        },
      ],
    });
  }
  const doc: JSONContent = { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] };
  stats.words = countWords(doc);
  const subject = meaningfulTitle(info.subject) || subtitle;
  return {
    title,
    description: subject && subject !== title && subject.length <= 300 ? subject : undefined,
    doc,
    figures: figures.filter((f) => JSON.stringify(doc).includes(FIGURE_SRC + f.id + '"')),
    scanned,
    stats,
  };
}

const isTocLine = (l: Line) => /(\.\s?){4,}\s*\d+$|…{2,}\s*\d+$/.test(l.text);

const rankSuffix = (s: string) => (s.endsWith('b') ? 0 : s.endsWith('c') ? 1 : 2);

function makeEmptyLine(page: number): Line {
  return { page, region: `${page}`, y: 0, size: 10, x0: 0, x1: 0, segs: [], text: '', bold: false, italic: false, left: 0, right: 0 };
}

/** x where the text after the first `chars` characters of the line starts. */
function xAfter(line: Line, chars: number): number {
  let left = chars;
  for (const s of line.segs) {
    for (const r of s.runs) {
      const len = r.str.length;
      if (left < len) {
        const trimmed = r.str.slice(left).match(/^\s*/)![0].length;
        return r.x + ((r.x1 - r.x) * (left + trimmed)) / Math.max(1, len);
      }
      left -= len;
      // segmentText adds a space between runs and segments.
      if (left > 0) left = Math.max(0, left - 1);
      else return r.x1;
    }
  }
  return line.x0;
}

function countWords(node: JSONContent): number {
  if (node.type === 'text') return (node.text ?? '').split(/\s+/).filter(Boolean).length;
  if (node.type === 'spreadsheet') return (node.attrs?.data as { rows: string[][] }).rows.flat().join(' ').split(/\s+/).filter(Boolean).length;
  return (node.content ?? []).reduce((n, c) => n + countWords(c), 0);
}

/** Words often written with a hyphen, kept when they are split at the end of a line. */
const COMPOUND_PREFIX =
  /^(self|non|anti|double|single|well|ice|room|cross|half|semi|multi|high|low|long|short|post|pre|wild|dry|heat|cold|gel|DNA|RNA)$/i;

/** Inline content of joined lines: marks per run, words rejoined across line-end hyphens. */
function inlineFromLines(lines: Line[], strip: number, bodyMono: boolean, heading = false): JSONContent[] {
  const runs: { r: Run; lineStart: boolean }[] = [];
  lines.forEach((line, li) => {
    let skip = li === 0 ? strip : 0;
    let first = true;
    for (const s of line.segs) {
      for (const r of s.runs) {
        let str = r.str;
        if (skip > 0) {
          const cut = Math.min(skip, str.length);
          str = str.slice(cut);
          skip -= cut;
          if (skip > 0) skip = Math.max(0, skip - 1);
          if (!str.trim()) continue;
        }
        runs.push({ r: { ...r, str }, lineStart: first });
        first = false;
      }
    }
  });
  if (!runs.length) return [];
  const letters = (pred: (r: Run) => boolean) => runs.filter((x) => pred(x.r)).reduce((n, x) => n + lettersOf(x.r.str).length, 0);
  const total = Math.max(
    1,
    letters(() => true),
  );
  const allBold = heading || letters((r) => r.bold) / total > 0.95;
  const allItalic = !heading && letters((r) => r.italic) / total > 0.95 && total < 400 ? false : letters((r) => r.italic) / total > 0.95;
  const plainBold = heading || (allBold && total > 400);
  const words = new Set<string>();
  for (const { r } of runs)
    for (const w of r.str
      .replace(/\u00AD/g, '')
      .toLowerCase()
      .match(/[\p{L}-]+/gu) ?? [])
      words.add(w);
  const nodes: JSONContent[] = [];
  let prev: Run | null = null;
  let prevText = '';
  // The end of the text so far, with soft hyphens (the hyphen at a line end can be a run of its own).
  let tail = '';
  for (const { r, lineStart } of runs) {
    const raw = r.str;
    const text = raw.replace(/\u00AD/g, '');
    if (prev) {
      if (lineStart) {
        const m = tail.replace(/\u00AD/g, '').match(/([\p{L}\d]+)[-\u2010]$/u);
        const last = nodes[nodes.length - 1];
        if (/\u00AD[-\u2010]?\s*$/.test(tail)) {
          // Broken at a soft hyphen: the word continues.
          for (let k = nodes.length - 1; k >= 0; k--) {
            const t = nodes[k].text!;
            nodes[k].text = t.replace(/[-\u2010]\s*$/, '');
            if (nodes[k].text || !t) break;
          }
        } else if (m && /^\p{Ll}/u.test(text)) {
          // A word split at the end of the line: keep the hyphen if the word is spelt with one elsewhere,
          // or looks like a compound ("DNA-binding", "double-stranded").
          const n = text.match(/^\p{L}+/u)![0];
          const joined = (m[1] + n).toLowerCase();
          const keep = words.has(`${m[1]}-${n}`.toLowerCase()) || (!words.has(joined) && (/\p{Lu}{2,}|\d/u.test(m[1]) || COMPOUND_PREFIX.test(m[1])));
          if (!keep) last.text = last.text!.replace(/[-\u2010]$/, '');
        } else if (!(m && /^[\p{Lu}\d]/u.test(text)) && !/\s$/.test(prevText)) {
          // ("Tris-" + "HCl" is a compound that wraps after its hyphen: no space.)
          nodes.push({ type: 'text', text: ' ' });
        }
      } else if (!r.joinLeft && !/\s$/.test(prevText) && !/^\s/.test(text) && r.x - prev.x1 > 0.15 * Math.min(r.size, prev.size)) {
        nodes.push({ type: 'text', text: ' ' });
      }
    }
    nodes.push(node(text, r));
    prevText = text;
    tail = (tail + raw).slice(-80);
    prev = r;
  }
  return tidyInline(nodes);

  function node(text: string, r: Run): JSONContent {
    const marks = runMarks(r, plainBold, allItalic && heading, bodyMono);
    return marks.length ? { type: 'text', text, marks } : { type: 'text', text };
  }
}

// ───────────────────────────── tables ─────────────────────────────

interface TableInfo {
  first: Line;
  rows: string[][];
  /** Column widths in px, in the proportions of the PDF. */
  widths: number[];
}

/** Column widths in px from the PDF's columns, scaled to fit a page (about 760 px). */
function bandWidths(bands: Band[], right: number): number[] {
  const ws = bands.map((b, k) => (k + 1 < bands.length ? bands[k + 1][0] : Math.max(right, b[1] + 6)) - b[0]);
  const scale = Math.min(
    1.5,
    760 /
      Math.max(
        1,
        ws.reduce((a, b) => a + b, 0),
      ),
  );
  return ws.map((w) => Math.round(Math.max(72, Math.min(440, w * scale))));
}

type Band = [number, number];

/** Borders are often drawn cell by cell: join the pieces of each horizontal line. */
function joinRules(rules: Box[]): Box[] {
  const joined: Box[] = [];
  for (const r of [...rules].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const hit = joined.find((o) => Math.abs((o.y0 + o.y1) / 2 - (r.y0 + r.y1) / 2) < 1 && r.x0 <= o.x1 + 3 && r.x1 >= o.x0 - 3);
    if (hit) Object.assign(hit, { x0: Math.min(hit.x0, r.x0), x1: Math.max(hit.x1, r.x1) });
    else joined.push({ ...r });
  }
  return joined;
}

/** Column bands: the union of overlapping segment extents (of lines with 2+ segments, when there are some). */
function columnBands(lines: Line[]): Band[] {
  const multi = lines.filter((l) => l.segs.length >= 2);
  const spans = (multi.length ? multi : lines).flatMap((l) => l.segs.map((s) => [s.x0, s.x1] as Band)).sort((a, b) => a[0] - b[0]);
  const bands: Band[] = [];
  for (const [a, b] of spans) {
    const last = bands[bands.length - 1];
    if (last && a <= last[1] + 1.5) last[1] = Math.max(last[1], b);
    else bands.push([a, b]);
  }
  return bands;
}

function cellsOf(l: Line, bands: Band[]): string[] {
  const cells = new Array<string>(bands.length).fill('');
  for (const s of l.segs) {
    const mid = (s.x0 + s.x1) / 2;
    let best = 0;
    let bestD = Infinity;
    bands.forEach(([a, b], k) => {
      const d = mid < a ? a - mid : mid > b ? mid - b : 0;
      if (d < bestD) [best, bestD] = [k, d];
    });
    const text = segmentText(s);
    cells[best] = cells[best] ? `${cells[best]} ${text}` : text;
  }
  return cells;
}

const appendCells = (row: string[], cells: string[]) =>
  cells.forEach((c, k) => {
    if (c) row[k] = row[k] ? `${row[k]} ${c}` : c;
  });

/**
 * Rows from lines without borders between them: a line starts a new row unless it only fills some
 * columns and either leaves the first column empty or follows at the spacing of wrapped text.
 */
function rowsFromLines(lines: Line[], bands: Band[], ruleBetween?: (a: Line, b: Line) => boolean): string[][] {
  const rows: string[][] = [];
  let tightGap = Infinity;
  for (let k = 1; k < lines.length; k++) tightGap = Math.min(tightGap, lines[k].y - lines[k - 1].y);
  let prev: Line | null = null;
  for (const l of lines) {
    const cells = cellsOf(l, bands);
    const filled = cells.filter(Boolean).length;
    const continues =
      prev &&
      rows.length &&
      (ruleBetween
        ? !ruleBetween(prev, l)
        : filled < bands.length && (!cells[0] || l.y - prev.y <= tightGap * 1.15) && l.y - prev.y < prev.size * 1.9);
    if (continues) appendCells(rows[rows.length - 1], cells);
    else rows.push(cells);
    prev = l;
  }
  return rows;
}

function finishRows(rows: string[][]): string[][] | null {
  if (rows.length < 2) return null;
  // Most rows need at least two cells, or it is just indented text.
  if (rows.filter((r) => r.filter(Boolean).length >= 2).length < rows.length * 0.6) return null;
  if (!(rows.length >= 3 || rows[0].length >= 3)) return null;
  return rows.map((r) => r.map((c) => c.replace(/\s+/g, ' ').trim()).map((c) => (c.startsWith('=') ? ` ${c}` : c)));
}

/** Tables drawn with horizontal borders: three or more stacked rules of the same width, with text between them. */
function ruledTables(stream: Line[], pages: PdfPageData[], result: Map<Line, TableInfo>) {
  for (const page of pages) {
    const rules = joinRules(page.rules).filter((r) => r.x1 - r.x0 >= 60);
    const groups: Box[][] = [];
    for (const r of rules) {
      const g = groups.find((g) => Math.abs(g[0].x0 - r.x0) < 6 && Math.abs(g[0].x1 - r.x1) < 6 && r.y0 - g[g.length - 1].y1 < 160);
      if (g) g.push(r);
      else groups.push([r]);
    }
    for (const g of groups.flatMap((g) => splitRuleGroup(g, stream, page))) {
      const ys: number[] = [];
      for (const r of g) {
        const y = (r.y0 + r.y1) / 2;
        if (!ys.length || y - ys[ys.length - 1] > 3) ys.push(y);
      }
      if (ys.length < 2) continue;
      const x0 = Math.min(...g.map((r) => r.x0));
      const x1 = Math.max(...g.map((r) => r.x1));
      const mid = (l: Line) => l.y - l.size * 0.35;
      const candidates = stream.filter((l) => !l.figure && l.page === page.index && !result.has(l) && l.x0 >= x0 - 4 && l.x1 <= x1 + 4);
      // Borders under each row (no top border) or over each row (no bottom border): take in the row beyond the first or last rule.
      const above = candidates.filter((l) => mid(l) < ys[0] && ys[0] - mid(l) < l.size * 2.2 && l.segs.length >= 2);
      if (above.length) ys.unshift(Math.min(...above.map((l) => l.y - l.size * 1.3)));
      const below = candidates.filter((l) => mid(l) > ys[ys.length - 1] && mid(l) - ys[ys.length - 1] < l.size * 2.2 && l.segs.length >= 2);
      if (below.length) ys.push(Math.max(...below.map((l) => l.y + l.size * 0.5)));
      if (ys.length < 3) continue;
      const lines = candidates.filter((l) => mid(l) > ys[0] && mid(l) < ys[ys.length - 1]);
      if (lines.length < 2) continue;
      const bands = columnBands(lines);
      if (bands.length < 2 || bands.length > 12) continue;
      const byRow: Line[][] = [];
      for (let k = 1; k < ys.length; k++) {
        const inRow = lines.filter((l) => mid(l) > ys[k - 1] && mid(l) < ys[k]);
        if (inRow.length) byRow.push(inRow);
      }
      // A border between every row, or only around the header and the whole table (booktabs: many lines between two rules).
      const perRow = byRow.length >= 3 || lines.length / byRow.length <= 2.5;
      const rows = perRow
        ? byRow.map((ls) => {
            const row = new Array<string>(bands.length).fill('');
            for (const l of ls) appendCells(row, cellsOf(l, bands));
            return row;
          })
        : byRow.flatMap((ls) => rowsFromLines(ls, bands));
      const done = finishRows(rows);
      if (!done) continue;
      const first = lines.reduce((a, b) => (stream.indexOf(a) < stream.indexOf(b) ? a : b));
      const widths = bandWidths(bands, x1);
      for (const l of lines) result.set(l, { first, rows: done, widths });
    }
  }
}

/**
 * Rules of the same width can belong to two tables with text in between: split where the space between
 * two rules is not a table row (no vertical cell borders in a grid table; headings, list items or prose).
 */
function splitRuleGroup(g: Box[], stream: Line[], page: PdfPageData): Box[][] {
  const x0 = Math.min(...g.map((r) => r.x0));
  const x1 = Math.max(...g.map((r) => r.x1));
  const width = x1 - x0;
  const vr = page.vrules.filter((v) => v.x0 >= x0 - 3 && v.x1 <= x1 + 3);
  const lines = stream.filter((l) => !l.figure && l.page === page.index && l.x0 >= x0 - 4 && l.x1 <= x1 + 4);
  const size = median(lines.map((l) => l.size)) || 10;
  const out: Box[][] = [[g[0]]];
  for (let k = 1; k < g.length; k++) {
    const top = (g[k - 1].y0 + g[k - 1].y1) / 2;
    const bottom = (g[k].y0 + g[k].y1) / 2;
    const inside = lines.filter((l) => l.y - l.size * 0.35 > top && l.y - l.size * 0.35 < bottom);
    const covered = vr.some((v) => Math.min(v.y1, bottom) - Math.max(v.y0, top) >= (bottom - top) * 0.6);
    const separator =
      bottom - top > 3 &&
      (vr.length
        ? !covered
        : inside.some((l) => Math.abs(l.size - size) > size * 0.15 || !!listMarker(l.text)) ||
          inside.filter((l) => l.segs.length === 1 && l.x1 - l.x0 >= width * 0.7).length >= 3);
    if (separator) out.push([g[k]]);
    else out[out.length - 1].push(g[k]);
  }
  return out;
}

/** Detect tables: bordered ones, then runs of lines with 2+ segments whose positions line up in columns. */
function findTables(stream: Line[], leading: number, pages: PdfPageData[]): Map<Line, TableInfo> {
  const result = new Map<Line, TableInfo>();
  ruledTables(stream, pages, result);
  let i = 0;
  while (i < stream.length) {
    const start = stream[i];
    if (start.figure || result.has(start) || start.segs.length < 2 || listMarker(start.text) || isSentenceWithGaps(start)) {
      i++;
      continue;
    }
    // Grow the run: multi-segment lines, plus continuation lines in between.
    const run: Line[] = [start];
    let multi = 1;
    for (let j = i + 1; j < stream.length; j++) {
      const l = stream[j];
      const prev = run[run.length - 1];
      if (l.figure || result.has(l) || l.page !== prev.page || l.region !== prev.region || l.y - prev.y > leading * 2.6 || l.y <= prev.y) break;
      if (l.x0 < start.x0 - start.size * 3) break;
      if (l.segs.length >= 2) {
        if (listMarker(l.text) || isSentenceWithGaps(l)) break;
        multi++;
      } else if (l.y - prev.y > leading * 1.5 || l.x1 > Math.max(...run.map((r) => r.x1)) + start.size * 2) break;
      run.push(l);
    }
    while (run.length && run[run.length - 1].segs.length < 2) run.pop();
    const table = run.length >= 2 && multi >= 2 ? buildTable(run, pages[start.page]) : null;
    if (table) {
      for (const l of run) result.set(l, { first: run[0], ...table });
      i += run.length;
    } else i++;
  }
  return result;
}

/** A justified line of prose whose word gaps happen to be wide: three or more pieces, evenly spaced. */
function justified(segs: Segment[]) {
  if (segs.length < 3) return false;
  const size = segs[0].runs[0]?.size ?? 10;
  const gaps = segs.slice(1).map((s, k) => s.x0 - segs[k].x1);
  return gaps.every((g) => g < size * 2) && Math.max(...gaps) - Math.min(...gaps) < size * 0.35;
}

const isSentenceWithGaps = (l: Line) => justified(l.segs);

function buildTable(lines: Line[], page: PdfPageData): { rows: string[][]; widths: number[] } | null {
  const bands = columnBands(lines);
  if (bands.length < 2 || bands.length > 12) return null;
  const width = bands[bands.length - 1][1] - bands[0][0];
  const hRules = joinRules(page.rules).filter((r) => r.x1 - r.x0 >= width * 0.5);
  const ruleBetween = (a: Line, b: Line) => hRules.some((r) => r.y0 > a.y + a.size * 0.1 && r.y1 < b.y - b.size * 0.6 && r.x0 < bands[0][0] + 4);
  const anyRules = lines.slice(1).some((l, k) => ruleBetween(lines[k], l));
  const rows = finishRows(rowsFromLines(lines, bands, anyRules ? ruleBetween : undefined));
  return rows ? { rows, widths: bandWidths(bands, bands[bands.length - 1][1] + 12) } : null;
}
