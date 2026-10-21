import { adjustFormula, isFormula, parseLiteral } from './formula';

/**
 * A spreadsheet block. `rows[r][c]` holds exactly what the user typed
 * (a formula when it starts with "="). Row 0 is the header row.
 */
export interface SheetData {
  rows: string[][];
  /** Column widths in px (null = automatic). */
  widths?: (number | null)[];
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
  return { ...d, rows };
}

export function deleteRows(d: SheetData, at: number, count = 1): SheetData {
  if (d.rows.length - count < 1) return d;
  const rows = d.rows.filter((_, i) => i < at || i >= at + count);
  return { ...d, rows: mapFormulas(rows, (f) => adjustFormula(f, 'row', at, -count)) };
}

export function insertCols(d: SheetData, at: number, count = 1): SheetData {
  const rows = mapFormulas(d.rows, (f) => adjustFormula(f, 'col', at, count)).map((row) => {
    const r = [...row];
    r.splice(at, 0, ...Array.from({ length: count }, () => ''));
    return r;
  });
  const widths = d.widths ? [...d.widths] : undefined;
  widths?.splice(at, 0, ...Array.from({ length: count }, () => null));
  return { ...d, rows, widths };
}

export function deleteCols(d: SheetData, at: number, count = 1): SheetData {
  if (sheetSize(d).cols - count < 1) return d;
  const rows = d.rows.map((row) => row.filter((_, i) => i < at || i >= at + count));
  const widths = d.widths?.filter((_, i) => i < at || i >= at + count);
  return { ...d, rows: mapFormulas(rows, (f) => adjustFormula(f, 'col', at, -count)), widths };
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
  const [header, ...body] = d.rows.map((r, i) => ({ r, key: display[i]?.[col] ?? '' }));
  body.sort((a, b) => {
    const av = parseLiteral(a.key);
    const bv = parseLiteral(b.key);
    if (a.key === '' && b.key !== '') return 1;
    if (b.key === '' && a.key !== '') return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: 'base' }) * dir;
  });
  return { ...d, rows: [header.r, ...body.map((x) => x.r)] };
}

export function isNumericText(s: string): boolean {
  return typeof parseLiteral(s) === 'number';
}
