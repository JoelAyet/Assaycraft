/** A1-style cell reference helpers. Rows and columns are 0-based internally. */

export function colName(c: number): string {
  let s = '';
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function colIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function cellName(r: number, c: number): string {
  return `${colName(c)}${r + 1}`;
}

export interface CellRef {
  r: number;
  c: number;
  absR: boolean;
  absC: boolean;
}

const REF_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/;

export function parseRef(text: string): CellRef | null {
  const m = REF_RE.exec(text);
  if (!m) return null;
  const r = parseInt(m[4], 10) - 1;
  if (r < 0) return null;
  return { absC: m[1] === '$', c: colIndex(m[2]), absR: m[3] === '$', r };
}

export function formatRef(ref: CellRef): string {
  return `${ref.absC ? '$' : ''}${colName(ref.c)}${ref.absR ? '$' : ''}${ref.r + 1}`;
}

export interface Rect {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export function rectOf(a: { r: number; c: number }, b: { r: number; c: number }): Rect {
  return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
}

export function inRect(rect: Rect, r: number, c: number): boolean {
  return r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2;
}
