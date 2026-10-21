/**
 * Small diffing toolkit for version history: Myers' O(ND) diff over arrays (lines or words),
 * compact patches between texts, and the pieces the history window shows.
 */

export type Op<T> = { type: 'eq' | 'del' | 'ins'; items: T[] };

/** Shortest edit script from `a` to `b` (Myers 1986), as runs of equal, deleted and inserted items. */
export function diffArrays<T>(a: readonly T[], b: readonly T[]): Op<T>[] {
  // Common prefix and suffix first: most edits touch a small part of a long document.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const A = a.slice(start, endA);
  const B = b.slice(start, endB);
  const middle = myers(A, B);
  const out: Op<T>[] = [];
  const push = (type: Op<T>['type'], items: T[]) => {
    if (!items.length) return;
    const last = out[out.length - 1];
    if (last && last.type === type) last.items.push(...items);
    else out.push({ type, items: [...items] });
  };
  push('eq', a.slice(0, start) as T[]);
  for (const op of middle) push(op.type, op.items);
  push('eq', a.slice(endA) as T[]);
  return out;
}

const MAX_EDITS = 3000;

function myers<T>(a: T[], b: T[]): Op<T>[] {
  const n = a.length;
  const m = b.length;
  if (!n && !m) return [];
  if (!n) return [{ type: 'ins', items: b }];
  if (!m) return [{ type: 'del', items: a }];
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 4);
  // Only the diagonals step d can reach are kept for the walk back: trace[d][k + d + 1] = v[k].
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    // A rewrite of most of a long text: not worth the memory, say it was all replaced.
    if (d > MAX_EDITS)
      return [
        { type: 'del', items: a },
        { type: 'ins', items: b },
      ];
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  // Walk back through the trace to recover the path.
  const steps: Op<T>['type'][] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const vd = trace[d];
    const at = (k: number) => vd[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      steps.push('eq');
      x--;
      y--;
    }
    steps.push(prevK === k + 1 ? 'ins' : 'del');
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    steps.push('eq');
    x--;
    y--;
  }
  steps.reverse();
  const ops: Op<T>[] = [];
  let i = 0;
  let j = 0;
  for (const s of steps) {
    const item = s === 'ins' ? b[j++] : a[i++];
    if (s === 'eq') j++;
    const last = ops[ops.length - 1];
    if (last && last.type === s) last.items.push(item);
    else ops.push({ type: s, items: [item] });
  }
  return ops;
}

// ───────────── Patches between texts ─────────────

/** [line in the source, lines removed, lines put in their place]. */
export type Hunk = [number, number, string[]];
export type Patch = Hunk[];

const lines = (text: string) => text.split('\n');

/** The changes that turn `from` into `to`, line by line. */
export function makePatch(from: string, to: string): Patch {
  const patch: Patch = [];
  let pos = 0;
  let hunk: Hunk | null = null;
  for (const op of diffArrays(lines(from), lines(to))) {
    if (op.type === 'eq') {
      if (hunk) patch.push(hunk);
      hunk = null;
      pos += op.items.length;
      continue;
    }
    hunk ??= [pos, 0, []];
    if (op.type === 'del') {
      hunk[1] += op.items.length;
      pos += op.items.length;
    } else hunk[2].push(...op.items);
  }
  if (hunk) patch.push(hunk);
  return patch;
}

export function applyPatch(text: string, patch: Patch): string {
  const out = lines(text);
  // From the end, so earlier positions stay valid.
  for (let i = patch.length - 1; i >= 0; i--) {
    const [at, removed, added] = patch[i];
    out.splice(at, removed, ...added);
  }
  return out.join('\n');
}

// ───────────── What the history window shows ─────────────

export interface ChangeCount {
  added: number;
  removed: number;
}

const words = (ls: string[]) => ls.join('\n').split(/\s+/).filter(Boolean);
/** Markdown marks ("-", "[ ]", "|", "##") are not words. */
const isWord = (w: string) => /[\p{L}\p{N}]/u.test(w);

/** Words added and removed between two texts (in an edited line, only the words that changed). */
export function countChanges(from: string, to: string): ChangeCount {
  let added = 0;
  let removed = 0;
  const ops = diffArrays(lines(from), lines(to));
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.type === 'eq') continue;
    const del = op.type === 'del' ? op.items : [];
    const ins = op.type === 'ins' ? op.items : ops[i + 1]?.type === 'ins' ? ops[++i].items : [];
    for (const w of diffArrays(words(del), words(ins))) {
      if (w.type === 'ins') added += w.items.filter(isWord).length;
      else if (w.type === 'del') removed += w.items.filter(isWord).length;
    }
  }
  return { added, removed };
}

export type Segment = { type: 'eq' | 'del' | 'ins'; text: string };
export type DiffLine = { kind: 'eq' | 'del' | 'ins' | 'mod'; segments: Segment[] } | { kind: 'skip'; count: number; lines: string[] };

const tokens = (s: string) => s.match(/\s+|[^\s]+/g) ?? [];

/** Word-level changes inside a line that was edited. */
function wordSegments(from: string, to: string): Segment[] {
  return diffArrays(tokens(from), tokens(to)).map((op) => ({ type: op.type, text: op.items.join('') }));
}

/**
 * Lines to show between two versions: changed lines (edited ones with their changed words), a few
 * lines of context around them, and the long unchanged stretches folded.
 */
export function diffLines(from: string, to: string, context = 2): DiffLine[] {
  const raw: DiffLine[] = [];
  const ops = diffArrays(lines(from), lines(to));
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.type === 'eq') {
      for (const l of op.items) raw.push({ kind: 'eq', segments: [{ type: 'eq', text: l }] });
      continue;
    }
    // A run of removed lines followed by added ones: pair them up as edits.
    if (op.type === 'del' && ops[i + 1]?.type === 'ins') {
      const del = op.items;
      const ins = ops[i + 1].items;
      const pairs = Math.min(del.length, ins.length);
      for (let k = 0; k < pairs; k++) raw.push({ kind: 'mod', segments: wordSegments(del[k], ins[k]) });
      for (const l of del.slice(pairs)) raw.push({ kind: 'del', segments: [{ type: 'del', text: l }] });
      for (const l of ins.slice(pairs)) raw.push({ kind: 'ins', segments: [{ type: 'ins', text: l }] });
      i++;
      continue;
    }
    for (const l of op.items) raw.push({ kind: op.type, segments: [{ type: op.type, text: l }] });
  }
  const changed = raw.map((l) => l.kind !== 'eq');
  const near = raw.map((_, i) => changed.slice(Math.max(0, i - context), i + context + 1).some(Boolean));
  const out: DiffLine[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (near[i]) {
      out.push(raw[i]);
      continue;
    }
    const text = (raw[i] as { segments: Segment[] }).segments[0].text;
    const last = out[out.length - 1];
    if (last?.kind === 'skip') {
      last.count++;
      last.lines.push(text);
    } else out.push({ kind: 'skip', count: 1, lines: [text] });
  }
  return out;
}
