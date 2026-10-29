/**
 * Stocks: collections of primers, plasmids, glycerol stocks, seeds… Each collection is one Markdown
 * file in Stocks/ holding a plain table, one row per stock, with an ID in the first column (PR-0001)
 * so entries can link to a single row: [PR-0001 EGFP-fwd](../../Stocks/Primers.md#PR-0001).
 */

export interface StockType {
  id: string;
  name: string;
  /** What one row is called ("primer"). */
  item: string;
  prefix: string;
  columns: string[];
  description: string;
}

export const STOCK_TYPES: StockType[] = [
  {
    id: 'primer',
    name: 'Primers',
    item: 'primer',
    prefix: 'PR-',
    columns: ['ID', 'Name', 'Sequence (5′→3′)', 'Length (nt)', 'GC %', 'Tm (°C)', 'Target', 'Location', 'Date', 'Notes'],
    description: 'Oligos with their sequence; length, GC % and Tm are worked out for you.',
  },
  {
    id: 'plasmid',
    name: 'Plasmids',
    item: 'plasmid',
    prefix: 'PL-',
    columns: ['ID', 'Name', 'Backbone', 'Insert', 'Resistance', 'Concentration', 'Location', 'Date', 'Notes'],
    description: 'Constructs, their backbone, insert and resistance.',
  },
  {
    id: 'glycerol',
    name: 'Glycerol stocks',
    item: 'glycerol stock',
    prefix: 'GS-',
    columns: ['ID', 'Name', 'Strain', 'Plasmid', 'Resistance', 'Location', 'Date', 'Notes'],
    description: 'Bacterial or yeast stocks in the −80 °C freezer.',
  },
  {
    id: 'seed',
    name: 'Seeds',
    item: 'seed stock',
    prefix: 'SD-',
    columns: ['ID', 'Name', 'Species', 'Genotype', 'Generation', 'Harvest date', 'Location', 'Notes'],
    description: 'Seed batches: line, genotype, generation and harvest.',
  },
  {
    id: 'antibody',
    name: 'Antibodies',
    item: 'antibody',
    prefix: 'AB-',
    columns: ['ID', 'Name', 'Target', 'Host', 'Clone', 'Dilution', 'Supplier', 'Location', 'Notes'],
    description: 'Primary and secondary antibodies with their working dilution.',
  },
  {
    id: 'cell-line',
    name: 'Cell lines',
    item: 'cell line',
    prefix: 'CL-',
    columns: ['ID', 'Name', 'Species', 'Passage', 'Medium', 'Location', 'Date', 'Notes'],
    description: 'Cryo-stocks of cell lines and their passage.',
  },
  {
    id: 'other',
    name: 'Other',
    item: 'item',
    prefix: 'ST-',
    columns: ['ID', 'Name', 'Description', 'Location', 'Date', 'Notes'],
    description: 'Anything else: chemicals, enzymes, strains… Add the columns you need.',
  },
];

export const stockType = (id: string | undefined): StockType => STOCK_TYPES.find((t) => t.id === id) ?? STOCK_TYPES[STOCK_TYPES.length - 1];

// ───────────── Columns ─────────────

export type ColumnRole = 'id' | 'name' | 'sequence' | 'length' | 'gc' | 'tm' | 'notes' | 'text';

/** What a column holds, from its name. Length, GC % and Tm are computed only next to a Sequence column. */
export function columnRole(header: string, hasSequence: boolean): ColumnRole {
  const h = header.trim().toLowerCase();
  if (h === 'id') return 'id';
  if (h === 'name') return 'name';
  if (/^(sequence|seq\b|oligo)/.test(h)) return 'sequence';
  if (hasSequence) {
    if (/^(length|len\b)/.test(h)) return 'length';
    if (/^gc\b|^gc\s*%|^gc content/.test(h)) return 'gc';
    if (/^tm\b|melting/.test(h)) return 'tm';
  }
  if (/^(notes?|comments?|description)$/.test(h)) return 'notes';
  return 'text';
}

export function columnRoles(columns: string[]): ColumnRole[] {
  const hasSequence = columns.some((c) => columnRole(c, false) === 'sequence');
  return columns.map((c) => columnRole(c, hasSequence));
}

export const isComputed = (role: ColumnRole) => role === 'length' || role === 'gc' || role === 'tm';

// ───────────── Sequences ─────────────

/** Only the bases: spaces, numbers and dashes are ignored, RNA U reads as T. */
export function cleanSequence(seq: string): string {
  return seq
    .toUpperCase()
    .replace(/U/g, 'T')
    .replace(/[^ACGTNRYSWKMBDHV]/g, '');
}

// SantaLucia (1998) unified nearest-neighbor parameters: ΔH (kcal/mol), ΔS (cal/K·mol).
const NN: Record<string, [number, number]> = {
  AA: [-7.9, -22.2],
  TT: [-7.9, -22.2],
  AT: [-7.2, -20.4],
  TA: [-7.2, -21.3],
  CA: [-8.5, -22.7],
  TG: [-8.5, -22.7],
  GT: [-8.4, -22.4],
  AC: [-8.4, -22.4],
  CT: [-7.8, -21.0],
  AG: [-7.8, -21.0],
  GA: [-8.2, -22.2],
  TC: [-8.2, -22.2],
  CG: [-10.6, -27.2],
  GC: [-9.8, -24.4],
  GG: [-8.0, -19.9],
  CC: [-8.0, -19.9],
};

const COMPLEMENT: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };
const reverseComplement = (s: string) =>
  [...s]
    .reverse()
    .map((b) => COMPLEMENT[b])
    .join('');

/** Conditions of the Tm: 50 mM Na⁺ and 250 nM primer, like most primer calculators. */
export const TM_CONDITIONS = { sodium: 0.05, primer: 250e-9 };

/**
 * Melting temperature (°C) by nearest neighbors (SantaLucia 1998, with its salt correction).
 * Null for sequences under 8 bases or with ambiguous bases (N, R, Y…).
 */
export function meltingTemp(sequence: string, { sodium, primer } = TM_CONDITIONS): number | null {
  const s = cleanSequence(sequence);
  if (s.length < 8 || /[^ACGT]/.test(s)) return null;
  let dH = 0;
  let dS = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const [h, e] = NN[s.slice(i, i + 2)];
    dH += h;
    dS += e;
  }
  for (const end of [s[0], s[s.length - 1]]) {
    if (end === 'G' || end === 'C') {
      dH += 0.1;
      dS += -2.8;
    } else {
      dH += 2.3;
      dS += 4.1;
    }
  }
  const selfComplementary = s === reverseComplement(s);
  if (selfComplementary) dS += -1.4;
  dS += 0.368 * (s.length - 1) * Math.log(sodium);
  const R = 1.987;
  const ct = selfComplementary ? primer : primer / 4;
  return (dH * 1000) / (dS + R * Math.log(ct)) - 273.15;
}

export function sequenceStats(sequence: string): { length: number; gc: number | null; tm: number | null } {
  const s = cleanSequence(sequence);
  if (!s) return { length: 0, gc: null, tm: null };
  const gc = [...s].filter((b) => b === 'G' || b === 'C' || b === 'S').length;
  return { length: s.length, gc: (gc / s.length) * 100, tm: meltingTemp(s) };
}

const oneDecimal = (n: number | null) => (n == null ? '' : (Math.round(n * 10) / 10).toFixed(1));

/** A row with its Length, GC % and Tm filled in from its sequence. */
export function withComputed(row: string[], roles: ColumnRole[]): string[] {
  const seqCol = roles.indexOf('sequence');
  if (seqCol < 0 || !roles.some(isComputed)) return row;
  const stats = sequenceStats(row[seqCol] ?? '');
  return row.map((v, i) => {
    if (roles[i] === 'length') return stats.length ? String(stats.length) : '';
    if (roles[i] === 'gc') return oneDecimal(stats.gc);
    if (roles[i] === 'tm') return oneDecimal(stats.tm);
    return v;
  });
}

// ───────────── The table in the Markdown file ─────────────

export interface StockTable {
  columns: string[];
  rows: string[][];
  /** Markdown before and after the table, kept as written. */
  before: string;
  after: string;
}

function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (c === '|') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((c) => c.trim().replace(/<br\s*\/?>/gi, '\n'));
}

const SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

export function parseStockTable(body: string, fallbackColumns: string[] = STOCK_TYPES[STOCK_TYPES.length - 1].columns): StockTable {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((l, i) => l.trim().startsWith('|') && SEPARATOR.test(lines[i + 1] ?? ''));
  if (start < 0) return { columns: [...fallbackColumns], rows: [], before: body.trim(), after: '' };
  let end = start + 2;
  while (end < lines.length && lines[end].trim().startsWith('|')) end++;
  const columns = splitCells(lines[start]);
  const rows = lines
    .slice(start + 2, end)
    .map(splitCells)
    .map((r) => columns.map((_, i) => r[i] ?? ''))
    .filter((r) => r.some((c) => c));
  return {
    columns,
    rows,
    before: lines.slice(0, start).join('\n').trim(),
    after: lines.slice(end).join('\n').trim(),
  };
}

const escCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, '<br>').trim();

export function writeStockTable(t: StockTable): string {
  const roles = columnRoles(t.columns);
  const line = (cells: string[]) => '| ' + cells.map((c) => escCell(c) || ' ').join(' | ') + ' |';
  const table = [
    line(t.columns),
    '| ' + roles.map((r) => (isComputed(r) ? '---:' : '---')).join(' | ') + ' |',
    ...t.rows.filter((r) => r.some((c) => c.trim())).map((r) => line(withComputed(r, roles))),
  ].join('\n');
  return [t.before, table, t.after].filter(Boolean).join('\n\n') + '\n';
}

// ───────────── IDs and summaries ─────────────

export const STOCK_ID_RE = /^[A-Za-z]{1,6}-\d+$/;

export function nextStockId(prefix: string, ids: string[], digits = 4): string {
  let max = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return prefix + String(max + 1).padStart(digits, '0');
}

export interface StockItem {
  id: string;
  name: string;
  /** The other filled-in cells, for search and pickers. */
  summary: string;
}

/** The stocks of a collection, from its Markdown body. */
export function stockItems(body: string): StockItem[] {
  const t = parseStockTable(body);
  const roles = columnRoles(t.columns);
  const idCol = roles.indexOf('id');
  if (idCol < 0) return [];
  const nameCol = roles.indexOf('name') >= 0 ? roles.indexOf('name') : idCol === 0 ? 1 : 0;
  const out: StockItem[] = [];
  for (const raw of t.rows) {
    const id = raw[idCol]?.trim();
    if (!id || !STOCK_ID_RE.test(id)) continue;
    const row = withComputed(raw, roles);
    const summary = row
      .map((v, i) => {
        if (i === idCol || i === nameCol || !v.trim()) return '';
        if (roles[i] === 'tm') return `Tm ${v} °C`;
        if (roles[i] === 'gc') return `GC ${v} %`;
        if (roles[i] === 'length') return `${v} nt`;
        return v.replace(/\n/g, ' ');
      })
      .filter(Boolean)
      .join(' · ');
    out.push({ id, name: row[nameCol]?.trim() ?? '', summary });
  }
  return out;
}
