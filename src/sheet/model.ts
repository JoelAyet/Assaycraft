import { adjustFormula, isFormula, parseLiteral } from './formula';
import { cellName, parseRef } from './refs';

/**
 * A spreadsheet block. `rows[r][c]` holds exactly what the user typed
 * (a formula when it starts with "="). Row 0 is the header row.
 */
export interface SheetData {
  rows: string[][];
  /** Column widths in px (null = automatic). */
  widths?: (number | null)[];
  /** Cell background colours, by cell ("B2": "yellow"), from the notebook's palette. */
  colors?: Record<string, string>;
  /** How many columns from the left stay in view when the table scrolls sideways. */
  freeze?: number;
}

/** Colours a cell can be filled with. */
export const CELL_COLORS = ['yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'red', 'orange', 'gray'] as const;

/** Move cell colours with their cells when rows or columns are inserted, deleted or reordered. */
function remapColors(
  colors: Record<string, string> | undefined,
  fn: (r: number, c: number) => { r: number; c: number } | null,
): Record<string, string> | undefined {
  if (!colors) return colors;
  const out: Record<string, string> = {};
  for (const [key, color] of Object.entries(colors)) {
    const ref = parseRef(key);
    if (!ref) continue;
    const to = fn(ref.r, ref.c);
    if (to) out[cellName(to.r, to.c)] = color;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Fill a block of cells with a colour (or clear it). */
export function setCellColor(d: SheetData, rect: { r1: number; c1: number; r2: number; c2: number }, color: string | null): SheetData {
  const colors = { ...d.colors };
  for (let r = rect.r1; r <= rect.r2; r++)
    for (let c = rect.c1; c <= rect.c2; c++) {
      if (color) colors[cellName(r, c)] = color;
      else delete colors[cellName(r, c)];
    }
  return { ...d, colors: Object.keys(colors).length ? colors : undefined };
}

/** Keep the first `count` columns in view (0: none). */
export function setFreeze(d: SheetData, count: number): SheetData {
  return { ...d, freeze: count > 0 ? count : undefined };
}

export const DEFAULT_COL_WIDTH = 120;

export function emptySheet(rows = 4, cols = 3, header?: string[]): SheetData {
  const data: string[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''));
  if (header) header.forEach((h, i) => (data[0][i] = h));
  return { rows: data };
}

/** Make the grid rectangular and non-empty. Returns the same object when nothing changes. */
export function normalizeSheet(input: SheetData | null | undefined): SheetData {
  if (!input || !Array.isArray(input.rows) || !input.rows.length) return emptySheet();
  const cols = Math.max(1, ...input.rows.map((r) => (Array.isArray(r) ? r.length : 0)));
  let changed = false;
  const rows = input.rows.map((r) => {
    const row = Array.isArray(r) ? r.map((v) => (v == null ? '' : String(v))) : [];
    if (row.length < cols || !Array.isArray(r) || r.some((v) => typeof v !== 'string')) changed = true;
    while (row.length < cols) row.push('');
    return row;
  });
  if (!changed) return input;
  return { ...input, rows };
}

export function sheetSize(d: SheetData) {
  return { rows: d.rows.length, cols: d.rows[0]?.length ?? 0 };
}

function mapFormulas(rows: string[][], fn: (f: string) => string): string[][] {
  return rows.map((row) => row.map((v) => (isFormula(v) ? fn(v) : v)));
}

export function insertRows(d: SheetData, at: number, count = 1): SheetData {
  const cols = sheetSize(d).cols;
  const rows = mapFormulas(d.rows, (f) => adjustFormula(f, 'row', at, count));
  rows.splice(at, 0, ...Array.from({ length: count }, () => Array.from({ length: cols }, () => '')));
  return { ...d, rows, colors: remapColors(d.colors, (r, c) => ({ r: r >= at ? r + count : r, c })) };
}

export function deleteRows(d: SheetData, at: number, count = 1): SheetData {
  if (d.rows.length - count < 1) return d;
  const rows = d.rows.filter((_, i) => i < at || i >= at + count);
  const colors = remapColors(d.colors, (r, c) => (r >= at && r < at + count ? null : { r: r >= at + count ? r - count : r, c }));
  return { ...d, rows: mapFormulas(rows, (f) => adjustFormula(f, 'row', at, -count)), colors };
}

export function insertCols(d: SheetData, at: number, count = 1): SheetData {
  const rows = mapFormulas(d.rows, (f) => adjustFormula(f, 'col', at, count)).map((row) => {
    const r = [...row];
    r.splice(at, 0, ...Array.from({ length: count }, () => ''));
    return r;
  });
  const widths = d.widths ? [...d.widths] : undefined;
  widths?.splice(at, 0, ...Array.from({ length: count }, () => null));
  const freeze = d.freeze && at < d.freeze ? d.freeze + count : d.freeze;
  return { ...d, rows, widths, freeze, colors: remapColors(d.colors, (r, c) => ({ r, c: c >= at ? c + count : c })) };
}

export function deleteCols(d: SheetData, at: number, count = 1): SheetData {
  if (sheetSize(d).cols - count < 1) return d;
  const rows = d.rows.map((row) => row.filter((_, i) => i < at || i >= at + count));
  const widths = d.widths?.filter((_, i) => i < at || i >= at + count);
  const freeze = d.freeze && at < d.freeze ? Math.max(at, d.freeze - count) || undefined : d.freeze;
  const colors = remapColors(d.colors, (r, c) => (c >= at && c < at + count ? null : { r, c: c >= at + count ? c - count : c }));
  return { ...d, rows: mapFormulas(rows, (f) => adjustFormula(f, 'col', at, -count)), widths, freeze, colors };
}

/** Grow the grid so that (rows × cols) fits. */
export function ensureSize(d: SheetData, rows: number, cols: number): SheetData {
  const size = sheetSize(d);
  if (rows <= size.rows && cols <= size.cols) return d;
  const C = Math.max(cols, size.cols);
  const out = d.rows.map((r) => (r.length < C ? [...r, ...Array.from({ length: C - r.length }, () => '')] : r));
  while (out.length < rows) out.push(Array.from({ length: C }, () => ''));
  return { ...d, rows: out };
}

export function setCells(d: SheetData, updates: { r: number; c: number; v: string }[]): SheetData {
  if (!updates.length) return d;
  let maxR = 0;
  let maxC = 0;
  for (const u of updates) {
    maxR = Math.max(maxR, u.r + 1);
    maxC = Math.max(maxC, u.c + 1);
  }
  const grown = ensureSize(d, maxR, maxC);
  const rows = grown.rows.map((r) => [...r]);
  for (const u of updates) rows[u.r][u.c] = u.v;
  return { ...grown, rows };
}

/** Sort data rows (not the header) by a column. Formulas are left untouched relative to their row. */
export function sortByColumn(d: SheetData, col: number, dir: 1 | -1, display: string[][]): SheetData {
  const [header, ...body] = d.rows.map((r, i) => ({ r, i, key: display[i]?.[col] ?? '' }));
  body.sort((a, b) => {
    const av = parseLiteral(a.key);
    const bv = parseLiteral(b.key);
    if (a.key === '' && b.key !== '') return 1;
    if (b.key === '' && a.key !== '') return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: 'base' }) * dir;
  });
  // Cell colours go with their rows.
  const to = new Map(body.map((x, k) => [x.i, k + 1]));
  return { ...d, rows: [header.r, ...body.map((x) => x.r)], colors: remapColors(d.colors, (r, c) => ({ r: to.get(r) ?? r, c })) };
}

export function isNumericText(s: string): boolean {
  return typeof parseLiteral(s) === 'number';
}
