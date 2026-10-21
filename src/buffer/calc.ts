/**
 * Buffers and dilutions: how much of each stock to add (C1·V1 = C2·V2), or how much of a powder to
 * weigh (mass = C · V · MW), and how much solvent brings it up to the final volume.
 */

export type UnitFamily = 'molar' | 'mass' | 'percent' | 'fold' | 'activity' | 'mw';

export interface ConcUnit {
  id: string;
  family: UnitFamily;
  /** Multiplier to the family's base unit: M, g/L, %, X, U/mL, g/mol. */
  factor: number;
}

export const CONC_UNITS: ConcUnit[] = [
  { id: 'M', family: 'molar', factor: 1 },
  { id: 'mM', family: 'molar', factor: 1e-3 },
  { id: 'µM', family: 'molar', factor: 1e-6 },
  { id: 'nM', family: 'molar', factor: 1e-9 },
  { id: 'pM', family: 'molar', factor: 1e-12 },
  { id: 'g/L', family: 'mass', factor: 1 },
  { id: 'mg/mL', family: 'mass', factor: 1 },
  { id: 'µg/mL', family: 'mass', factor: 1e-3 },
  { id: 'ng/µL', family: 'mass', factor: 1e-3 },
  { id: 'ng/mL', family: 'mass', factor: 1e-6 },
  { id: '%', family: 'percent', factor: 1 },
  { id: 'X', family: 'fold', factor: 1 },
  { id: 'U/mL', family: 'activity', factor: 1 },
  { id: 'U/µL', family: 'activity', factor: 1e3 },
  { id: 'g/mol', family: 'mw', factor: 1 },
];

/** Grouped for the dropdowns. "g/mol" (a powder, given by its molar mass) is only a stock. */
export const UNIT_GROUPS: { label: string; ids: string[] }[] = [
  { label: 'Molar', ids: ['M', 'mM', 'µM', 'nM', 'pM'] },
  { label: 'Mass / volume', ids: ['g/L', 'mg/mL', 'µg/mL', 'ng/µL', 'ng/mL'] },
  { label: 'Other', ids: ['%', 'X', 'U/mL', 'U/µL'] },
  { label: 'Powder (weigh it)', ids: ['g/mol'] },
];

export const VOLUME_UNITS = ['L', 'mL', 'µL'] as const;
const VOLUME_FACTOR: Record<string, number> = { L: 1, mL: 1e-3, µL: 1e-6, nL: 1e-9 };

export interface BufferRow {
  name: string;
  stock: string;
  stockUnit: string;
  final: string;
  finalUnit: string;
}

export interface BufferData {
  name: string;
  volume: string;
  volumeUnit: string;
  /** What fills it up to the final volume ("Water", "PBS"…). Empty: no fill row. */
  solvent: string;
  rows: BufferRow[];
}

export const emptyRow = (): BufferRow => ({ name: '', stock: '', stockUnit: 'M', final: '', finalUnit: 'mM' });

export function newBuffer(): BufferData {
  return { name: '', volume: '50', volumeUnit: 'mL', solvent: 'Water', rows: [emptyRow(), emptyRow(), emptyRow()] };
}

export function normalizeBuffer(input: Partial<BufferData> | null | undefined): BufferData {
  const d = input ?? {};
  const s = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
  const rows = Array.isArray(d.rows)
    ? d.rows.map((r) => ({
        name: s(r?.name),
        stock: s(r?.stock),
        stockUnit: s(r?.stockUnit, 'M'),
        final: s(r?.final),
        finalUnit: s(r?.finalUnit, 'mM'),
      }))
    : [];
  return {
    name: s(d.name),
    volume: s(d.volume),
    volumeUnit: VOLUME_FACTOR[s(d.volumeUnit)] ? s(d.volumeUnit) : 'mL',
    solvent: s(d.solvent, 'Water'),
    rows: rows.length ? rows : [emptyRow()],
  };
}

// ───────────── Parsing ─────────────

/** "1.5", "1,5" (decimal comma), "2e-3". NaN when it is not a number. */
export function parseNumber(text: string): number {
  let t = text.trim().replace(/\s/g, '');
  if (!t) return NaN;
  if (t.includes(',') && !t.includes('.')) t = t.replace(',', '.');
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t) ? Number(t) : NaN;
}

/** Find a unit however it was typed: "uM", "μM", "mg/ml", "x", "×"… */
export function unitId(text: string): string | null {
  const t = text
    .trim()
    .replace(/(^|\/)[uμ](?=[a-zA-Z])/g, '$1µ')
    .replace(/^×$/, 'X');
  if (!t) return null;
  const exact = CONC_UNITS.find((u) => u.id === t);
  if (exact) return exact.id;
  const loose = CONC_UNITS.filter((u) => u.id.toLowerCase() === t.toLowerCase());
  return loose.length === 1 ? loose[0].id : null;
}

export function volumeUnitId(text: string): string | null {
  const t = text.trim().replace(/^[uμ]/, 'µ').toLowerCase();
  return ['l', 'ml', 'µl'].includes(t) ? (t === 'l' ? 'L' : t === 'ml' ? 'mL' : 'µL') : null;
}

/** "50 mM" → { value: "50", unit: "mM" }; in a template the value can be a variable: "{{Salt|150}} mM". */
export function splitQuantity(text: string): { value: string; unit: string } {
  const m = /^\s*(\{\{[^}]*\}\}|[-+]?(?:\d[\d.,]*|[.,]\d+)(?:e[-+]?\d+)?)\s*(.*?)\s*$/i.exec(text);
  return m ? { value: m[1], unit: m[2] } : { value: '', unit: text.trim() };
}

// ───────────── Calculation ─────────────

export type RowResult =
  | { kind: 'empty' }
  | { kind: 'volume'; liters: number; text: string }
  | { kind: 'mass'; grams: number; text: string }
  | { kind: 'error'; message: string };

export interface BufferResult {
  /** Final volume in litres, or null when it is not set. */
  liters: number | null;
  rows: RowResult[];
  /** Solvent that brings it up to volume; null without a final volume. */
  fill: { liters: number; text: string } | null;
  /** Something about the whole buffer, e.g. the components add up to more than the final volume. */
  error: string | null;
}

/** 4 significant figures, without trailing zeros: 2.5, 100, 33.33, 0.1234. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  const s = abs >= 1e4 ? String(Math.round(n)) : Number(n.toPrecision(4)).toString();
  return s.includes('e') ? n.toPrecision(3) : s;
}

/** Rounding can leave 1 µL as 0.99999…e-6 L: it still counts as 1 µL, not 1000 nL. */
const EPS = 1 + 1e-9;

/**
 * In the unit you would pipette with: µL down to 0.1 µL (about the least a pipette takes); less is shown
 * in nL, a sign to dilute the stock first.
 */
export function formatVolume(liters: number): string {
  const abs = Math.abs(liters) * EPS;
  const [unit, f] = abs >= 1 ? ['L', 1] : abs >= 1e-3 ? ['mL', 1e-3] : abs >= 1e-7 ? ['µL', 1e-6] : ['nL', 1e-9];
  return `${formatNumber(liters / f)} ${unit}`;
}

export function formatMass(grams: number): string {
  const abs = Math.abs(grams) * EPS;
  const [unit, f] = abs >= 1e3 ? ['kg', 1e3] : abs >= 1 ? ['g', 1] : abs >= 1e-3 ? ['mg', 1e-3] : abs >= 1e-6 ? ['µg', 1e-6] : ['ng', 1e-9];
  return `${formatNumber(grams / f)} ${unit}`;
}

export function finalLiters(d: Pick<BufferData, 'volume' | 'volumeUnit'>): number | null {
  const v = parseNumber(d.volume);
  const f = VOLUME_FACTOR[d.volumeUnit];
  return Number.isFinite(v) && v > 0 && f ? v * f : null;
}

const unitById = (id: string) => CONC_UNITS.find((u) => u.id === id) ?? null;

/** Concentration in the stock's family, so the two can be compared. % w/v is 10 g/L. */
function inFamily(value: number, unit: ConcUnit, family: UnitFamily): number | null {
  if (unit.family === family) return value * unit.factor;
  if (unit.family === 'percent' && family === 'mass') return value * 10;
  if (unit.family === 'mass' && family === 'percent') return (value * unit.factor) / 10;
  return null;
}

export function computeRow(row: BufferRow, liters: number | null): RowResult {
  const stockText = row.stock.trim();
  const finalText = row.final.trim();
  if (!stockText || !finalText) return { kind: 'empty' };
  const stock = parseNumber(stockText);
  const final = parseNumber(finalText);
  if (!Number.isFinite(stock)) return { kind: 'error', message: 'The stock is not a number' };
  if (!Number.isFinite(final)) return { kind: 'error', message: 'The final concentration is not a number' };
  const s = unitById(row.stockUnit);
  const f = unitById(row.finalUnit);
  if (!s || !f || f.family === 'mw') return { kind: 'error', message: 'Choose a unit' };
  if (stock <= 0) return { kind: 'error', message: 'The stock must be above 0' };
  if (final < 0) return { kind: 'error', message: 'The final concentration can’t be negative' };
  if (liters == null) return { kind: 'empty' };

  // A powder, given by its molar mass: weigh it.
  if (s.family === 'mw') {
    const mw = stock;
    let grams: number | null = null;
    if (f.family === 'molar') grams = final * f.factor * liters * mw;
    else if (f.family === 'mass') grams = final * f.factor * liters;
    else if (f.family === 'percent') grams = final * 10 * liters;
    if (grams == null) return { kind: 'error', message: `A powder can’t be dosed in ${f.id}` };
    return { kind: 'mass', grams, text: formatMass(grams) };
  }

  const finalInStock = inFamily(final, f, s.family);
  if (finalInStock == null) return { kind: 'error', message: `${s.id} and ${f.id} don’t convert` };
  const stockBase = stock * s.factor;
  if (finalInStock > stockBase * (1 + 1e-9)) return { kind: 'error', message: 'The final concentration is above the stock' };
  const add = (liters * finalInStock) / stockBase;
  return { kind: 'volume', liters: add, text: formatVolume(add) };
}

export function computeBuffer(d: BufferData): BufferResult {
  const liters = finalLiters(d);
  const rows = d.rows.map((r) => computeRow(r, liters));
  if (liters == null) return { liters, rows, fill: null, error: null };
  const added = rows.reduce((sum, r) => sum + (r.kind === 'volume' ? r.liters : 0), 0);
  const rest = liters - added;
  if (rest < -liters * 1e-9) return { liters, rows, fill: null, error: 'The components add up to more than the final volume' };
  const fill = Math.max(0, rest);
  return { liters, rows, fill: { liters: fill, text: formatVolume(fill) }, error: null };
}

// ───────────── Markdown ─────────────

export const BUFFER_HEADER = ['Component', 'Stock', 'Final', 'Add'];

const quantity = (value: string, unit: string) => (value.trim() ? `${value.trim()} ${unit}`.trim() : '');

const hasContent = (r: BufferRow) => !!(r.name.trim() || r.stock.trim() || r.final.trim());

/** The table written to the Markdown file (the amounts to add are included so the file reads on its own). */
export function bufferTable(d: BufferData): string[][] {
  const result = computeBuffer(d);
  const out = [BUFFER_HEADER];
  d.rows.forEach((r, i) => {
    if (!hasContent(r)) return;
    const res = result.rows[i];
    out.push([
      r.name.trim(),
      quantity(r.stock, r.stockUnit),
      quantity(r.final, r.finalUnit),
      res.kind === 'volume' || res.kind === 'mass' ? res.text : '',
    ]);
  });
  if (d.solvent.trim() && result.liters != null) {
    const to = `to ${quantity(d.volume, d.volumeUnit)}`;
    out.push([d.solvent.trim(), '', '', result.fill ? `${to} (${result.fill.text})` : to]);
  }
  return out;
}

/** Metadata kept in the HTML comment above the table. */
export function bufferMeta(d: BufferData): Record<string, string> {
  const meta: Record<string, string> = {};
  if (d.name.trim()) meta.name = d.name.trim();
  meta.volume = quantity(d.volume, d.volumeUnit);
  meta.solvent = d.solvent.trim();
  return meta;
}

/** Read a buffer back from its table and comment (also works on a table edited by hand). */
export function bufferFromTable(rows: string[][], meta: Record<string, unknown> | null): BufferData {
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (names: string[], fallback: number) => {
    const i = header.findIndex((h) => names.some((n) => h.startsWith(n)));
    return i >= 0 ? i : fallback;
  };
  const cName = col(['component', 'reagent', 'name'], 0);
  const cStock = col(['stock'], 1);
  const cFinal = col(['final'], 2);
  const cAdd = col(['add', 'volume', 'amount'], 3);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');

  const volume = splitQuantity(str(meta?.volume));
  const solvent = meta && 'solvent' in meta ? str(meta.solvent) : 'Water';
  const out: BufferRow[] = [];
  for (const row of rows.slice(1)) {
    const cell = (i: number) => (row[i] ?? '').trim();
    const stock = splitQuantity(cell(cStock));
    const final = splitQuantity(cell(cFinal));
    // The fill row ("Water | | | to 50 mL") is computed, not a component.
    if (!stock.value && !final.value && /^to\b/i.test(cell(cAdd))) continue;
    if (!cell(cName) && !stock.value && !final.value) continue;
    out.push({
      name: cell(cName),
      stock: stock.value,
      stockUnit: unitId(stock.unit) ?? (stock.unit || 'M'),
      final: final.value,
      finalUnit: unitId(final.unit) ?? (final.unit || 'mM'),
    });
  }
  return normalizeBuffer({
    name: str(meta?.name),
    volume: volume.value,
    volumeUnit: volumeUnitId(volume.unit) ?? 'mL',
    solvent,
    rows: out,
  });
}
