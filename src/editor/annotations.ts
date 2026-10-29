/** Notes drawn on an image, as saved in the page: see editor/annotate.tsx. */
export type AnnotationColor = 'red' | 'yellow' | 'green' | 'blue' | 'white' | 'black';
export type AnnotationKind = 'line' | 'arrow' | 'box' | 'text';
export interface Annotation {
  t: AnnotationKind;
  /** Line, arrow and box: x1, y1, x2, y2; text: x, y (its baseline's start). All 0–1. */
  a: number[];
  c: AnnotationColor;
  /** Text. */
  s?: string;
}

export const ANNOTATION_COLORS: AnnotationColor[] = ['red', 'yellow', 'green', 'blue', 'white', 'black'];
const round = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;
/** Marks as read from a page: anything malformed is left out. */
export function normalizeAnnotations(input: unknown): Annotation[] {
  if (!Array.isArray(input)) return [];
  const out: Annotation[] = [];
  for (const m of input) {
    if (!m || typeof m !== 'object') continue;
    const o = m as Record<string, unknown>;
    const t = String(o.t) as AnnotationKind;
    if (!['line', 'arrow', 'box', 'text'].includes(t)) continue;
    const a = Array.isArray(o.a) ? o.a.map(Number) : [];
    if (a.length < (t === 'text' ? 2 : 4) || a.some((n) => !Number.isFinite(n))) continue;
    const c = (ANNOTATION_COLORS as string[]).includes(String(o.c)) ? (o.c as AnnotationColor) : 'red';
    if (t === 'text') {
      const s = typeof o.s === 'string' ? o.s.slice(0, 200) : '';
      if (s.trim()) out.push({ t, a: a.slice(0, 2).map(round), c, s });
    } else out.push({ t, a: a.slice(0, 4).map(round), c });
  }
  return out;
}
