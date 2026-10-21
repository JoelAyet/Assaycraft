/**
 * Plate layouts: which sample goes in which well of a 24-, 48-, 96- or 384-well plate.
 *
 * In the file a plate is a comment with its name, format and samples (their colour and the stock or
 * entry each one is linked to), then an ordinary table of the plate, one cell per well:
 *
 *   <!-- gc:plate {"name":"ELISA 1","format":96,"samples":[{"name":"WT","color":"blue","ref":"GS-0001"}]} -->
 *
 *   |   | 1 | 2 | 3 | … |
 *   | A | WT | WT | Blank | … |
 */

export interface PlateFormat {
  wells: number;
  rows: number;
  cols: number;
}

export const PLATE_FORMATS: PlateFormat[] = [
  { wells: 6, rows: 2, cols: 3 },
  { wells: 12, rows: 3, cols: 4 },
  { wells: 24, rows: 4, cols: 6 },
  { wells: 48, rows: 6, cols: 8 },
  { wells: 96, rows: 8, cols: 12 },
  { wells: 384, rows: 16, cols: 24 },
];

/** Colours a sample can have (the app's own, readable in light and dark). */
export const SAMPLE_COLORS = ['blue', 'orange', 'green', 'purple', 'pink', 'teal', 'yellow', 'red', 'brown', 'gray'] as const;
export type SampleColor = (typeof SAMPLE_COLORS)[number];

export interface PlateSample {
  name: string;
  color: SampleColor;
  /** The ID of what it is: a stock (GS-0001) or an entry (EXP-0012). */
  ref?: string;
}

export interface PlateData {
  name: string;
  /** Number of wells: one of PLATE_FORMATS. */
  format: number;
  samples: PlateSample[];
  /** Well ("B7") → sample name. */
  wells: Record<string, string>;
}

export const formatOf = (wells: number): PlateFormat => PLATE_FORMATS.find((f) => f.wells === wells) ?? PLATE_FORMATS[4];

export const rowLabel = (r: number) => String.fromCharCode(65 + r);
export const wellName = (r: number, c: number) => `${rowLabel(r)}${c + 1}`;

/** "B7" → [1, 6]; null when it is not a well of this format. */
export function wellIndex(well: string, format: PlateFormat): [number, number] | null {
  const m = /^([A-Z])(\d{1,2})$/.exec(well.trim().toUpperCase());
  if (!m) return null;
  const r = m[1].charCodeAt(0) - 65;
  const c = Number(m[2]) - 1;
  return r < format.rows && c >= 0 && c < format.cols ? [r, c] : null;
}

/** The next colour not yet used (or used least). */
export function nextColor(samples: PlateSample[]): SampleColor {
  const uses = (c: SampleColor) => samples.filter((s) => s.color === c).length;
  return [...SAMPLE_COLORS].sort((a, b) => uses(a) - uses(b) || SAMPLE_COLORS.indexOf(a) - SAMPLE_COLORS.indexOf(b))[0];
}

/** Blanks and no-template controls start grey, as on most plate maps; other samples take the next colour. */
export function colorFor(name: string, samples: PlateSample[]): SampleColor {
  const blank = /^(blank|empty|ntc|no[ -]?template|mock|buffer only|medium only|media only)\b/i.test(name.trim());
  return blank && !samples.some((s) => s.color === 'gray') ? 'gray' : nextColor(samples);
}

export function newPlate(format = 96): PlateData {
  return { name: '', format, samples: [], wells: {} };
}

export function normalizePlate(input: Partial<PlateData> | null | undefined): PlateData {
  const d = input ?? {};
  const format = formatOf(Number(d.format)).wells;
  const samples: PlateSample[] = [];
  for (const s of Array.isArray(d.samples) ? d.samples : []) {
    const name = typeof s?.name === 'string' ? s.name.trim() : '';
    if (!name || samples.some((x) => x.name === name)) continue;
    const color = SAMPLE_COLORS.includes(s.color as SampleColor) ? (s.color as SampleColor) : colorFor(name, samples);
    samples.push({ name, color, ...(typeof s.ref === 'string' && s.ref.trim() ? { ref: s.ref.trim() } : {}) });
  }
  const wells: Record<string, string> = {};
  const f = formatOf(format);
  for (const [well, name] of Object.entries(d.wells && typeof d.wells === 'object' ? d.wells : {})) {
    const at = wellIndex(well, f);
    if (!at || typeof name !== 'string' || !name.trim()) continue;
    const n = name.trim();
    if (!samples.some((s) => s.name === n)) samples.push({ name: n, color: colorFor(n, samples) });
    wells[wellName(at[0], at[1])] = n;
  }
  return { name: typeof d.name === 'string' ? d.name : '', format, samples, wells };
}

/** The plate as table rows: a header of column numbers, then one row per plate row. */
export function plateTable(d: PlateData): string[][] {
  const f = formatOf(d.format);
  const out = [['', ...Array.from({ length: f.cols }, (_, c) => String(c + 1))]];
  for (let r = 0; r < f.rows; r++) out.push([rowLabel(r), ...Array.from({ length: f.cols }, (_, c) => d.wells[wellName(r, c)] ?? '')]);
  return out;
}

/** What goes in the comment above the table. */
export function plateMeta(d: PlateData): Record<string, unknown> {
  return {
    ...(d.name.trim() ? { name: d.name.trim() } : {}),
    format: d.format,
    samples: d.samples.map((s) => ({ name: s.name, color: s.color, ...(s.ref ? { ref: s.ref } : {}) })),
  };
}

const unescapeCell = (s: string) => s.replace(/\\\|/g, '|').trim();

/** A plate read back from its comment and table (also a table edited by hand, or pasted from Excel). */
export function plateFromTable(rows: string[][], meta: Record<string, unknown> | null): PlateData {
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  // The format the comment says, else the smallest one the table fits in.
  const cols = Math.max(0, header.length - 1);
  const fitted = PLATE_FORMATS.find((f) => f.rows >= body.length && f.cols >= cols) ?? PLATE_FORMATS[PLATE_FORMATS.length - 1];
  const format = PLATE_FORMATS.some((f) => f.wells === Number(meta?.format)) ? Number(meta?.format) : fitted.wells;
  const wells: Record<string, string> = {};
  body.forEach((row, i) => {
    const label = unescapeCell(row[0] ?? '') || rowLabel(i);
    for (let c = 1; c < row.length; c++) {
      const name = unescapeCell(row[c] ?? '');
      const col = unescapeCell(header[c] ?? '') || String(c);
      if (name) wells[`${label.toUpperCase()}${col}`] = name;
    }
  });
  return normalizePlate({
    name: typeof meta?.name === 'string' ? meta.name : '',
    format,
    samples: Array.isArray(meta?.samples) ? (meta.samples as PlateSample[]) : [],
    wells,
  });
}

/** The wells from one corner to the other (in any direction). */
export function wellsBetween(a: [number, number], b: [number, number]): string[] {
  const out: string[] = [];
  for (let r = Math.min(a[0], b[0]); r <= Math.max(a[0], b[0]); r++)
    for (let c = Math.min(a[1], b[1]); c <= Math.max(a[1], b[1]); c++) out.push(wellName(r, c));
  return out;
}

/** Put a sample in these wells, or empty them (sample null). */
export function assignWells(d: PlateData, wells: string[], sample: string | null): PlateData {
  const next = { ...d.wells };
  for (const w of wells) {
    if (sample) next[w] = sample;
    else delete next[w];
  }
  return { ...d, wells: next };
}

/** How many wells each sample has, and how many are used. */
export function plateCounts(d: PlateData): { bySample: Record<string, number>; used: number } {
  const bySample: Record<string, number> = {};
  for (const s of Object.values(d.wells)) bySample[s] = (bySample[s] ?? 0) + 1;
  return { bySample, used: Object.keys(d.wells).length };
}

export function renameSample(d: PlateData, from: string, to: string): PlateData {
  const name = to.trim();
  if (!name || name === from || d.samples.some((s) => s.name === name)) return d;
  const wells: Record<string, string> = {};
  for (const [w, s] of Object.entries(d.wells)) wells[w] = s === from ? name : s;
  return { ...d, samples: d.samples.map((s) => (s.name === from ? { ...s, name } : s)), wells };
}

export function removeSample(d: PlateData, name: string): PlateData {
  const wells: Record<string, string> = {};
  for (const [w, s] of Object.entries(d.wells)) if (s !== name) wells[w] = s;
  return { ...d, samples: d.samples.filter((s) => s.name !== name), wells };
}

/** A smaller plate keeps only the wells that still exist. */
export function changeFormat(d: PlateData, wells: number): PlateData {
  const f = formatOf(wells);
  const kept: Record<string, string> = {};
  for (const [w, s] of Object.entries(d.wells)) if (wellIndex(w, f)) kept[w] = s;
  return { ...d, format: f.wells, wells: kept };
}

/** Wells that a smaller format would drop. */
export function wellsOutside(d: PlateData, wells: number): number {
  const f = formatOf(wells);
  return Object.keys(d.wells).filter((w) => !wellIndex(w, f)).length;
}

/** The plate as a list, one well per line, in plate-reader order (A1, A2 … H12): for Excel or an instrument. */
export function wellList(d: PlateData, labelOf: (ref: string) => string = (r) => r): string[][] {
  const f = formatOf(d.format);
  const out = [['Well', 'Sample', 'Linked to']];
  for (let r = 0; r < f.rows; r++)
    for (let c = 0; c < f.cols; c++) {
      const w = wellName(r, c);
      const s = d.wells[w];
      const ref = s ? d.samples.find((x) => x.name === s)?.ref : undefined;
      out.push([w, s ?? '', ref ? labelOf(ref) : '']);
    }
  return out;
}

const PLATE_RE = /<!--\s*gc:plate\s+(\{[\s\S]*?\})\s*-->/g;

/** IDs of the stocks and entries the plates in a body are linked to (so those list this page as using them). */
export function plateRefs(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(PLATE_RE)) {
    try {
      const data = JSON.parse(m[1]) as { samples?: { ref?: unknown }[] };
      for (const s of data.samples ?? []) if (typeof s?.ref === 'string' && s.ref) out.add(s.ref);
    } catch {
      /* ignore */
    }
  }
  return [...out];
}
