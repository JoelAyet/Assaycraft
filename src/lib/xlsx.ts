/**
 * Reads the cells of an Excel workbook (.xlsx, .xlsm) for a preview: sheet names, and each
 * sheet's values as text, the way Excel shows them (dates as dates, percentages as %, formulas
 * by their last result). Formatting, charts and pictures are left out.
 */
import { strFromU8, unzipSync } from 'fflate';

export interface XlsxSheet {
  name: string;
  /** Cell text, row by row, without trailing empty rows and columns. */
  rows: string[][];
  /** Which cells hold numbers (to align them right). */
  numeric: boolean[][];
  /** More rows or columns than were read. */
  truncated: boolean;
  /** Too big to read in the browser. */
  tooLarge?: boolean;
}

export interface XlsxBook {
  sheets: { name: string }[];
  read(index: number): XlsxSheet;
}

export const XLSX_MAX_ROWS = 5000;
export const XLSX_MAX_COLS = 200;
const MAX_XML_BYTES = 40 * 1024 * 1024;

export function isXlsxName(name: string): boolean {
  return /\.(xlsx|xlsm)$/i.test(name);
}

function xml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('The workbook is damaged');
  return doc;
}

/** Elements by local name, whatever prefix the file gives them (x:sheet, sheet). */
const all = (root: Document | Element, name: string) => Array.from(root.getElementsByTagNameNS('*', name));

function attr(el: Element, name: string): string | null {
  for (const a of Array.from(el.attributes)) if (a.localName === name) return a.value;
  return null;
}

/** Text of an <si> or <is>: its runs, without the phonetic guides (<rPh>) Japanese files carry. */
function richText(el: Element): string {
  let out = '';
  for (const t of all(el, 't')) {
    let p = t.parentElement;
    let phonetic = false;
    while (p && p !== el) {
      if (p.localName === 'rPh') phonetic = true;
      p = p.parentElement;
    }
    if (!phonetic) out += t.textContent ?? '';
  }
  return out;
}

/** "BC12" → [11, 54] (row, column, from 0). */
export function cellIndex(ref: string): [number, number] | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [Number(m[2]) - 1, col - 1];
}

/** Excel's column letters: 0 → A, 26 → AA. */
export function columnName(index: number): string {
  let s = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const BUILTIN_DATE = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 57, 58]);
const BUILTIN_TIME = new Set([18, 19, 20, 21, 32, 33, 45, 46, 47, 55, 56]);
const BUILTIN_PERCENT = new Set([9, 10]);

type Kind = 'date' | 'time' | 'datetime' | 'percent' | null;

/** What a number format shows: a date, a time, both, a percentage, or a plain number. */
export function formatKind(id: number, code: string | undefined): Kind {
  if (BUILTIN_DATE.has(id)) return id === 22 ? 'datetime' : 'date';
  if (BUILTIN_TIME.has(id)) return 'time';
  if (BUILTIN_PERCENT.has(id)) return 'percent';
  if (!code) return null;
  // Quoted text, escaped characters and [colors] / [conditions] are not part of the pattern.
  const bare = code
    .split(';')[0]
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/[_*]./g, '')
    .replace(/\[(?!h\]|hh\]|m\]|mm\]|s\]|ss\])[^\]]*\]/gi, '');
  if (/%/.test(bare)) return 'percent';
  const date = /[dy]/i.test(bare) || /(^|[^h:])m{3,}/i.test(bare);
  const time = /[hs]/i.test(bare) || /am\/pm/i.test(bare);
  if (date && time) return 'datetime';
  if (date) return 'date';
  if (time) return 'time';
  // "m" or "mm" alone (no hours or seconds nearby) is a month.
  if (/m/i.test(bare)) return 'date';
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A serial date (days since 1900, or 1904 on old Macs) as Excel would show it, in ISO order. */
export function serialToText(serial: number, kind: 'date' | 'time' | 'datetime', date1904 = false): string {
  let days = serial;
  // Excel counts 29 February 1900, which did not exist.
  if (!date1904 && days < 60) days += 1;
  const ms = Math.round(((date1904 ? days + 1462 : days) - 25569) * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(serial);
  const ymd = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const sec = d.getUTCSeconds() ? `:${pad(d.getUTCSeconds())}` : '';
  if (kind === 'time') return hm + sec;
  if (kind === 'datetime' && serial % 1 !== 0) return `${ymd} ${hm}${sec}`;
  return ymd;
}

/** A number without floating-point noise (0.1 + 0.2 shows as 0.3). */
function plainNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return String(Number(n.toPrecision(12)));
}

export function openXlsx(data: Uint8Array): XlsxBook {
  const tooLarge = new Set<string>();
  const files = unzipSync(data, {
    filter: (f) => {
      if (!/\.(xml|rels)$/i.test(f.name) || /^xl\/(media|drawings|charts|printerSettings)\//i.test(f.name)) return false;
      if (f.originalSize > MAX_XML_BYTES) {
        tooLarge.add(f.name);
        return false;
      }
      return true;
    },
  });
  const text = (path: string) => (files[path] ? strFromU8(files[path]) : null);
  const workbookXml = text('xl/workbook.xml');
  if (!workbookXml) throw new Error('This is not an Excel workbook');
  const workbook = xml(workbookXml);
  const date1904 = all(workbook, 'workbookPr').some((el) => /^(1|true)$/i.test(attr(el, 'date1904') ?? ''));

  const targets = new Map<string, string>();
  const relsXml = text('xl/_rels/workbook.xml.rels');
  if (relsXml) {
    for (const rel of all(xml(relsXml), 'Relationship')) {
      const target = attr(rel, 'Target') ?? '';
      const id = attr(rel, 'Id');
      if (id) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`.replace(/\/\.\//g, '/'));
    }
  }
  const sheets = all(workbook, 'sheet').map((el, i) => {
    const rid = attr(el, 'id');
    return { name: attr(el, 'name') ?? `Sheet ${i + 1}`, path: (rid && targets.get(rid)) || `xl/worksheets/sheet${i + 1}.xml` };
  });

  const ssXml = text('xl/sharedStrings.xml');
  const shared = ssXml ? all(xml(ssXml), 'si').map(richText) : [];

  // Number formats of each cell style.
  const kinds: Kind[] = [];
  const stylesXml = text('xl/styles.xml');
  if (stylesXml) {
    const styles = xml(stylesXml);
    const codes = new Map<number, string>();
    for (const f of all(styles, 'numFmt')) codes.set(Number(attr(f, 'numFmtId')), attr(f, 'formatCode') ?? '');
    const cellXfs = all(styles, 'cellXfs')[0];
    if (cellXfs) {
      for (const xf of Array.from(cellXfs.children).filter((c) => c.localName === 'xf')) {
        const id = Number(attr(xf, 'numFmtId') ?? 0);
        kinds.push(formatKind(id, codes.get(id)));
      }
    }
  }

  const read = (index: number): XlsxSheet => {
    const info = sheets[index];
    if (!info) throw new Error('No such sheet');
    if (tooLarge.has(info.path)) return { name: info.name, rows: [], numeric: [], truncated: true, tooLarge: true };
    const sheetXml = text(info.path);
    if (sheetXml == null) return { name: info.name, rows: [], numeric: [], truncated: false };
    const doc = xml(sheetXml);
    const rows: string[][] = [];
    const numeric: boolean[][] = [];
    let truncated = false;
    let nextRow = 0;
    for (const rowEl of all(doc, 'row')) {
      const r = Number(attr(rowEl, 'r') ?? nextRow + 1) - 1;
      nextRow = r + 1;
      if (r >= XLSX_MAX_ROWS) {
        truncated = true;
        break;
      }
      let nextCol = 0;
      for (const c of Array.from(rowEl.children).filter((e) => e.localName === 'c')) {
        const at = cellIndex(attr(c, 'r') ?? '');
        const col = at ? at[1] : nextCol;
        nextCol = col + 1;
        if (col >= XLSX_MAX_COLS) {
          truncated = true;
          continue;
        }
        const type = attr(c, 't') ?? 'n';
        const v = Array.from(c.children).find((e) => e.localName === 'v')?.textContent ?? null;
        const f = Array.from(c.children).find((e) => e.localName === 'f')?.textContent ?? null;
        let shown = '';
        let isNum = false;
        if (type === 's') shown = v != null ? (shared[Number(v)] ?? '') : '';
        else if (type === 'inlineStr') {
          const is = Array.from(c.children).find((e) => e.localName === 'is');
          shown = is ? richText(is) : '';
        } else if (type === 'b') shown = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : (v ?? '');
        else if (type === 'str' || type === 'e' || type === 'd') shown = v ?? '';
        else if (v != null && v !== '') {
          const n = Number(v);
          const kind = kinds[Number(attr(c, 's') ?? 0)] ?? null;
          if (Number.isNaN(n)) shown = v;
          else if (kind === 'percent') shown = `${plainNumber(n * 100)}%`;
          else if (kind) shown = serialToText(n, kind, date1904);
          else shown = plainNumber(n);
          isNum = !Number.isNaN(n);
        }
        if (!shown && f) shown = `=${f}`;
        if (!shown) continue;
        while (rows.length <= r) {
          rows.push([]);
          numeric.push([]);
        }
        rows[r][col] = shown;
        numeric[r][col] = isNum;
      }
    }
    const width = rows.reduce((w, row) => Math.max(w, row.length), 0);
    return {
      name: info.name,
      rows: rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? '')),
      numeric: numeric.map((row) => Array.from({ length: width }, (_, i) => !!row[i])),
      truncated,
    };
  };

  return { sheets: sheets.map((s) => ({ name: s.name })), read };
}
