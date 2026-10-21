/**
 * A small spreadsheet formula engine with Excel-compatible syntax:
 * =A1*2, =SUM(B2:B9), =ROUND(AVERAGE(C2:C4)/1000, 2), =IF(D2>0.5,"ok","low")
 */
import { parseRef, formatRef, type CellRef } from './refs';

export type ErrCode = '#DIV/0!' | '#VALUE!' | '#REF!' | '#NAME?' | '#N/A' | '#NUM!' | '#CYCLE!' | '#ERROR!';

export class FErr {
  readonly code: ErrCode;
  constructor(code: ErrCode) {
    this.code = code;
  }
  toString() {
    return this.code;
  }
}

export type Scalar = number | string | boolean | FErr;
type Val = Scalar | Scalar[][];

// ───────────────────────────── Tokenizer ─────────────────────────────

type Tok =
  | { t: 'num'; v: number; s: number; e: number }
  | { t: 'str'; v: string; s: number; e: number }
  | { t: 'ref'; text: string; s: number; e: number }
  | { t: 'name'; v: string; s: number; e: number }
  | { t: 'err'; v: ErrCode; s: number; e: number }
  | { t: 'op'; v: string; s: number; e: number };

export class FormulaSyntaxError extends Error {}

const NUM_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const REF_TOKEN_RE = /^\$?[A-Za-z]{1,3}\$?\d{1,7}(?![A-Za-z0-9_(.])/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]*/;
const ERR_RE = /^#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|CYCLE!|ERROR!)/;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    const rest = src.slice(i);
    if (ch === '"') {
      let j = i + 1;
      let v = '';
      for (;;) {
        if (j >= src.length) throw new FormulaSyntaxError('Unterminated string');
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            v += '"';
            j += 2;
            continue;
          }
          break;
        }
        v += src[j++];
      }
      out.push({ t: 'str', v, s: i, e: j + 1 });
      i = j + 1;
      continue;
    }
    let m: RegExpExecArray | null;
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      m = NUM_RE.exec(rest);
      if (!m) throw new FormulaSyntaxError(`Unexpected "${ch}"`);
      out.push({ t: 'num', v: parseFloat(m[0]), s: i, e: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (ch === '#') {
      m = ERR_RE.exec(rest);
      if (!m) throw new FormulaSyntaxError('Unexpected "#"');
      out.push({ t: 'err', v: m[0] as ErrCode, s: i, e: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (ch === '$' || /[A-Za-z_]/.test(ch)) {
      m = REF_TOKEN_RE.exec(rest);
      if (m) {
        out.push({ t: 'ref', text: m[0], s: i, e: i + m[0].length });
        i += m[0].length;
        continue;
      }
      m = NAME_RE.exec(rest);
      if (!m) throw new FormulaSyntaxError(`Unexpected "${ch}"`);
      out.push({ t: 'name', v: m[0].toUpperCase(), s: i, e: i + m[0].length });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') {
      out.push({ t: 'op', v: two, s: i, e: i + 2 });
      i += 2;
      continue;
    }
    if ('+-*/^&=<>%:(),;'.includes(ch)) {
      out.push({ t: 'op', v: ch === ';' ? ',' : ch, s: i, e: i + 1 });
      i++;
      continue;
    }
    throw new FormulaSyntaxError(`Unexpected "${ch}"`);
  }
  return out;
}

// ───────────────────────────── Parser ─────────────────────────────

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'err'; v: ErrCode }
  | { k: 'ref'; r: number; c: number }
  | { k: 'range'; r1: number; c1: number; r2: number; c2: number }
  | { k: 'fn'; name: string; args: Node[] }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'neg'; e: Node }
  | { k: 'pct'; e: Node };

class Parser {
  private i = 0;
  private toks: Tok[];
  constructor(toks: Tok[]) {
    this.toks = toks;
  }

  parse(): Node {
    if (!this.toks.length) throw new FormulaSyntaxError('Empty formula');
    const n = this.comparison();
    if (this.i < this.toks.length) throw new FormulaSyntaxError('Unexpected input');
    return n;
  }

  private peekOp(...ops: string[]): string | null {
    const t = this.toks[this.i];
    return t && t.t === 'op' && ops.includes(t.v) ? t.v : null;
  }

  private comparison(): Node {
    let a = this.concat();
    for (let op; (op = this.peekOp('=', '<>', '<', '>', '<=', '>='));) {
      this.i++;
      a = { k: 'bin', op, a, b: this.concat() };
    }
    return a;
  }

  private concat(): Node {
    let a = this.additive();
    while (this.peekOp('&')) {
      this.i++;
      a = { k: 'bin', op: '&', a, b: this.additive() };
    }
    return a;
  }

  private additive(): Node {
    let a = this.multiplicative();
    for (let op; (op = this.peekOp('+', '-'));) {
      this.i++;
      a = { k: 'bin', op, a, b: this.multiplicative() };
    }
    return a;
  }

  private multiplicative(): Node {
    let a = this.power();
    for (let op; (op = this.peekOp('*', '/'));) {
      this.i++;
      a = { k: 'bin', op, a, b: this.power() };
    }
    return a;
  }

  private power(): Node {
    let a = this.percent();
    while (this.peekOp('^')) {
      this.i++;
      a = { k: 'bin', op: '^', a, b: this.percent() };
    }
    return a;
  }

  private percent(): Node {
    let e = this.unary();
    while (this.peekOp('%')) {
      this.i++;
      e = { k: 'pct', e };
    }
    return e;
  }

  private unary(): Node {
    if (this.peekOp('-')) {
      this.i++;
      return { k: 'neg', e: this.unary() };
    }
    if (this.peekOp('+')) {
      this.i++;
      return this.unary();
    }
    return this.primary();
  }

  private primary(): Node {
    const t = this.toks[this.i++];
    if (!t) throw new FormulaSyntaxError('Unexpected end of formula');
    switch (t.t) {
      case 'num':
        return { k: 'num', v: t.v };
      case 'str':
        return { k: 'str', v: t.v };
      case 'err':
        if (this.peekOp(':')) {
          this.i++;
          this.i++; // skip the other end of a broken range
        }
        return { k: 'err', v: t.v };
      case 'ref': {
        const a = parseRef(t.text)!;
        if (this.peekOp(':')) {
          this.i++;
          const u = this.toks[this.i++];
          if (u?.t === 'err') return { k: 'err', v: u.v };
          if (!u || u.t !== 'ref') throw new FormulaSyntaxError('Expected a cell after ":"');
          const b = parseRef(u.text)!;
          return { k: 'range', r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
        }
        return { k: 'ref', r: a.r, c: a.c };
      }
      case 'name': {
        if (this.peekOp('(')) {
          this.i++;
          const args: Node[] = [];
          if (!this.peekOp(')')) {
            for (;;) {
              args.push(this.comparison());
              if (this.peekOp(',')) {
                this.i++;
                continue;
              }
              break;
            }
          }
          if (!this.peekOp(')')) throw new FormulaSyntaxError('Expected ")"');
          this.i++;
          return { k: 'fn', name: t.v, args };
        }
        if (t.v === 'TRUE') return { k: 'bool', v: true };
        if (t.v === 'FALSE') return { k: 'bool', v: false };
        return { k: 'err', v: '#NAME?' };
      }
      case 'op':
        if (t.v === '(') {
          const e = this.comparison();
          if (!this.peekOp(')')) throw new FormulaSyntaxError('Expected ")"');
          this.i++;
          return e;
        }
        throw new FormulaSyntaxError(`Unexpected "${t.v}"`);
    }
  }
}

const astCache = new Map<string, Node | FormulaSyntaxError>();

function parseFormula(body: string): Node | FormulaSyntaxError {
  let n = astCache.get(body);
  if (n) return n;
  try {
    n = new Parser(tokenize(body)).parse();
  } catch (e) {
    n = e instanceof FormulaSyntaxError ? e : new FormulaSyntaxError(String(e));
  }
  if (astCache.size > 5000) astCache.clear();
  astCache.set(body, n);
  return n;
}

// ───────────────────────────── Values ─────────────────────────────

const LITERAL_NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Interpret what the user typed in a (non-formula) cell. */
export function parseLiteral(raw: string): Scalar {
  const s = raw.trim();
  if (s === '') return '';
  if (LITERAL_NUM_RE.test(s)) return parseFloat(s);
  if (s.endsWith('%') && LITERAL_NUM_RE.test(s.slice(0, -1).trim())) return parseFloat(s) / 100;
  const up = s.toUpperCase();
  if (up === 'TRUE') return true;
  if (up === 'FALSE') return false;
  return raw;
}

export function isFormula(raw: string | undefined | null): boolean {
  return !!raw && raw.length > 1 && raw[0] === '=';
}

function toNumber(v: Scalar): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof FErr) throw v;
  if (v === '') return 0;
  const p = parseLiteral(v);
  if (typeof p === 'number') return p;
  throw new FErr('#VALUE!');
}

function toText(v: Scalar): string {
  if (v instanceof FErr) throw v;
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v;
}

function toBool(v: Scalar): boolean {
  if (v instanceof FErr) throw v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v === '') return false;
  const up = v.toUpperCase();
  if (up === 'TRUE') return true;
  if (up === 'FALSE') return false;
  throw new FErr('#VALUE!');
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '#NUM!';
  if (n === 0) return '0';
  return String(Number(n.toPrecision(12)));
}

export function formatValue(v: Scalar): string {
  if (v instanceof FErr) return v.code;
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v;
}

function scalarOf(v: Val): Scalar {
  if (!Array.isArray(v)) return v;
  if (v.length === 1 && v[0].length === 1) return v[0][0];
  throw new FErr('#VALUE!');
}

function compare(a: Scalar, b: Scalar): number {
  if (a instanceof FErr) throw a;
  if (b instanceof FErr) throw b;
  const an = a === '' && typeof b === 'number' ? 0 : a;
  const bn = b === '' && typeof a === 'number' ? 0 : b;
  if (typeof an === 'number' && typeof bn === 'number') return an - bn;
  if (typeof an === 'boolean' && typeof bn === 'boolean') return Number(an) - Number(bn);
  // Excel orders numbers < text < booleans
  const rank = (x: Scalar) => (typeof x === 'number' ? 0 : typeof x === 'string' ? 1 : 2);
  if (rank(an) !== rank(bn)) return rank(an) - rank(bn);
  return String(an).toLowerCase().localeCompare(String(bn).toLowerCase());
}

function roundTo(x: number, digits: number, mode: 'half' | 'up' | 'down'): number {
  const d = Math.trunc(digits);
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  const f = mode === 'half' ? Math.round : mode === 'up' ? Math.ceil : Math.floor;
  // Shift by exponent notation to avoid binary rounding surprises (1.005 → 1.01)
  const shifted = Number(`${abs}e${d}`);
  const v = Number.isFinite(shifted) ? Number(`${f(Number(shifted.toPrecision(15)))}e${-d}`) : abs;
  return sign * v;
}

// ───────────────────────────── Functions ─────────────────────────────

interface Ctx {
  ev: (n: Node) => Val;
  scalar: (n: Node) => Scalar;
}

type FnImpl = (args: Node[], ctx: Ctx) => Scalar;

function* scalarsOf(args: Node[], ctx: Ctx): Generator<{ v: Scalar; fromRef: boolean }> {
  for (const a of args) {
    const v = ctx.ev(a);
    if (Array.isArray(v)) {
      for (const row of v) for (const x of row) yield { v: x, fromRef: true };
    } else yield { v, fromRef: a.k === 'ref' };
  }
}

/** Numbers for aggregate functions: text/booleans in references are skipped, like Excel. */
function numbers(args: Node[], ctx: Ctx): number[] {
  const out: number[] = [];
  for (const { v, fromRef } of scalarsOf(args, ctx)) {
    if (v instanceof FErr) throw v;
    if (fromRef) {
      if (typeof v === 'number') out.push(v);
    } else if (v !== '') out.push(toNumber(v));
  }
  return out;
}

function rangeValues(n: Node, ctx: Ctx): Scalar[] {
  const v = ctx.ev(n);
  return Array.isArray(v) ? v.flat() : [v];
}

function argNum(args: Node[], i: number, ctx: Ctx, dflt?: number): number {
  if (i >= args.length) {
    if (dflt === undefined) throw new FErr('#VALUE!');
    return dflt;
  }
  return toNumber(ctx.scalar(args[i]));
}

function need(args: Node[], min: number, max = min) {
  if (args.length < min || args.length > max) throw new FErr('#VALUE!');
}

function mean(xs: number[]) {
  if (!xs.length) throw new FErr('#DIV/0!');
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function variance(xs: number[], sample: boolean) {
  const n = xs.length;
  if (n < (sample ? 2 : 1)) throw new FErr('#DIV/0!');
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (sample ? n - 1 : n);
}

/** COUNTIF-style criteria: 5, ">5", "<=2.5", "<>0", "=abc", "abc", "a*" */
function matcher(crit: Scalar): (v: Scalar) => boolean {
  if (crit instanceof FErr) throw crit;
  if (typeof crit === 'number' || typeof crit === 'boolean') return (v) => !(v instanceof FErr) && compare(v, crit) === 0;
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/s.exec(crit)!;
  const op = m[1] ?? '=';
  const target = parseLiteral(m[2]);
  if (typeof target === 'string' && (op === '=' || op === '<>') && /[*?]/.test(target)) {
    const re = new RegExp(
      '^' +
        target
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.') +
        '$',
      'i',
    );
    return (v) => !(v instanceof FErr) && re.test(formatValue(v)) === (op === '=');
  }
  return (v) => {
    if (v instanceof FErr) return false;
    if (typeof target === 'number' && typeof v !== 'number') return op === '<>';
    const c = compare(v, target);
    switch (op) {
      case '<':
        return c < 0;
      case '>':
        return c > 0;
      case '<=':
        return c <= 0;
      case '>=':
        return c >= 0;
      case '<>':
        return c !== 0;
      default:
        return c === 0;
    }
  };
}

const math1 =
  (f: (x: number) => number, check?: (x: number) => boolean): FnImpl =>
  (args, ctx) => {
    need(args, 1);
    const x = argNum(args, 0, ctx);
    if (check && !check(x)) throw new FErr('#NUM!');
    return f(x);
  };

const FUNCTIONS: Record<string, FnImpl> = {
  SUM: (a, c) => numbers(a, c).reduce((s, x) => s + x, 0),
  PRODUCT: (a, c) => numbers(a, c).reduce((s, x) => s * x, 1),
  AVERAGE: (a, c) => mean(numbers(a, c)),
  AVG: (a, c) => mean(numbers(a, c)),
  MEAN: (a, c) => mean(numbers(a, c)),
  MIN: (a, c) => {
    const xs = numbers(a, c);
    return xs.length ? Math.min(...xs) : 0;
  },
  MAX: (a, c) => {
    const xs = numbers(a, c);
    return xs.length ? Math.max(...xs) : 0;
  },
  MEDIAN: (a, c) => {
    const xs = numbers(a, c).sort((x, y) => x - y);
    if (!xs.length) throw new FErr('#NUM!');
    const mid = xs.length >> 1;
    return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  },
  COUNT: (a, c) => {
    let n = 0;
    for (const { v } of scalarsOf(a, c)) if (typeof v === 'number') n++;
    return n;
  },
  COUNTA: (a, c) => {
    let n = 0;
    for (const { v } of scalarsOf(a, c)) if (v !== '') n++;
    return n;
  },
  COUNTBLANK: (a, c) => {
    let n = 0;
    for (const { v } of scalarsOf(a, c)) if (v === '') n++;
    return n;
  },
  STDEV: (a, c) => Math.sqrt(variance(numbers(a, c), true)),
  'STDEV.S': (a, c) => Math.sqrt(variance(numbers(a, c), true)),
  STDEVP: (a, c) => Math.sqrt(variance(numbers(a, c), false)),
  'STDEV.P': (a, c) => Math.sqrt(variance(numbers(a, c), false)),
  VAR: (a, c) => variance(numbers(a, c), true),
  'VAR.S': (a, c) => variance(numbers(a, c), true),
  VARP: (a, c) => variance(numbers(a, c), false),
  'VAR.P': (a, c) => variance(numbers(a, c), false),
  SUMPRODUCT: (a, c) => {
    if (!a.length) throw new FErr('#VALUE!');
    const lists = a.map((n) => rangeValues(n, c));
    const len = lists[0].length;
    if (lists.some((l) => l.length !== len)) throw new FErr('#VALUE!');
    let s = 0;
    for (let i = 0; i < len; i++) {
      let p = 1;
      for (const l of lists) {
        const v = l[i];
        if (v instanceof FErr) throw v;
        p *= typeof v === 'number' ? v : 0;
      }
      s += p;
    }
    return s;
  },
  COUNTIF: (a, c) => {
    need(a, 2);
    const test = matcher(c.scalar(a[1]));
    return rangeValues(a[0], c).filter(test).length;
  },
  SUMIF: (a, c) => {
    need(a, 2, 3);
    const test = matcher(c.scalar(a[1]));
    const crit = rangeValues(a[0], c);
    const vals = a[2] ? rangeValues(a[2], c) : crit;
    let s = 0;
    crit.forEach((v, i) => {
      const x = vals[i];
      if (test(v) && typeof x === 'number') s += x;
    });
    return s;
  },
  AVERAGEIF: (a, c) => {
    need(a, 2, 3);
    const test = matcher(c.scalar(a[1]));
    const crit = rangeValues(a[0], c);
    const vals = a[2] ? rangeValues(a[2], c) : crit;
    const xs: number[] = [];
    crit.forEach((v, i) => {
      const x = vals[i];
      if (test(v) && typeof x === 'number') xs.push(x);
    });
    return mean(xs);
  },
  ROUND: (a, c) => {
    need(a, 1, 2);
    return roundTo(argNum(a, 0, c), argNum(a, 1, c, 0), 'half');
  },
  ROUNDUP: (a, c) => {
    need(a, 1, 2);
    return roundTo(argNum(a, 0, c), argNum(a, 1, c, 0), 'up');
  },
  ROUNDDOWN: (a, c) => {
    need(a, 1, 2);
    return roundTo(argNum(a, 0, c), argNum(a, 1, c, 0), 'down');
  },
  INT: math1(Math.floor),
  TRUNC: math1(Math.trunc),
  ABS: math1(Math.abs),
  SIGN: math1(Math.sign),
  SQRT: math1(Math.sqrt, (x) => x >= 0),
  EXP: math1(Math.exp),
  LN: math1(Math.log, (x) => x > 0),
  LOG10: math1(Math.log10, (x) => x > 0),
  LOG2: math1(Math.log2, (x) => x > 0),
  LOG: (a, c) => {
    need(a, 1, 2);
    const x = argNum(a, 0, c);
    const b = argNum(a, 1, c, 10);
    if (x <= 0 || b <= 0 || b === 1) throw new FErr('#NUM!');
    return Math.log(x) / Math.log(b);
  },
  POWER: (a, c) => {
    need(a, 2);
    const v = argNum(a, 0, c) ** argNum(a, 1, c);
    if (!Number.isFinite(v)) throw new FErr('#NUM!');
    return v;
  },
  MOD: (a, c) => {
    need(a, 2);
    const x = argNum(a, 0, c);
    const d = argNum(a, 1, c);
    if (d === 0) throw new FErr('#DIV/0!');
    return x - d * Math.floor(x / d);
  },
  CEILING: (a, c) => {
    need(a, 1, 2);
    const s = argNum(a, 1, c, 1);
    return s === 0 ? 0 : Math.ceil(argNum(a, 0, c) / s) * s;
  },
  FLOOR: (a, c) => {
    need(a, 1, 2);
    const s = argNum(a, 1, c, 1);
    if (s === 0) throw new FErr('#DIV/0!');
    return Math.floor(argNum(a, 0, c) / s) * s;
  },
  PI: (a) => {
    need(a, 0);
    return Math.PI;
  },
  IF: (a, c) => {
    need(a, 2, 3);
    const cond = toBool(c.scalar(a[0]));
    if (cond) return c.scalar(a[1]);
    return a[2] ? c.scalar(a[2]) : false;
  },
  IFERROR: (a, c) => {
    need(a, 2);
    try {
      const v = c.scalar(a[0]);
      if (v instanceof FErr) return c.scalar(a[1]);
      return v;
    } catch (e) {
      if (e instanceof FErr) return c.scalar(a[1]);
      throw e;
    }
  },
  AND: (a, c) => {
    if (!a.length) throw new FErr('#VALUE!');
    let r = true;
    for (const { v } of scalarsOf(a, c)) if (v !== '') r = toBool(v) && r;
    return r;
  },
  OR: (a, c) => {
    if (!a.length) throw new FErr('#VALUE!');
    let r = false;
    for (const { v } of scalarsOf(a, c)) if (v !== '') r = toBool(v) || r;
    return r;
  },
  NOT: (a, c) => {
    need(a, 1);
    return !toBool(c.scalar(a[0]));
  },
  TRUE: () => true,
  FALSE: () => false,
  ISBLANK: (a, c) => {
    need(a, 1);
    return c.scalar(a[0]) === '';
  },
  ISNUMBER: (a, c) => {
    need(a, 1);
    return typeof c.scalar(a[0]) === 'number';
  },
  ISTEXT: (a, c) => {
    need(a, 1);
    const v = c.scalar(a[0]);
    return typeof v === 'string' && v !== '';
  },
  ISERROR: (a, c) => {
    need(a, 1);
    try {
      return c.scalar(a[0]) instanceof FErr;
    } catch (e) {
      if (e instanceof FErr) return true;
      throw e;
    }
  },
  CONCAT: (a, c) => {
    let s = '';
    for (const { v } of scalarsOf(a, c)) s += toText(v);
    return s;
  },
  CONCATENATE: (a, c) => {
    let s = '';
    for (const { v } of scalarsOf(a, c)) s += toText(v);
    return s;
  },
  LEN: (a, c) => {
    need(a, 1);
    return toText(c.scalar(a[0])).length;
  },
  UPPER: (a, c) => {
    need(a, 1);
    return toText(c.scalar(a[0])).toUpperCase();
  },
  LOWER: (a, c) => {
    need(a, 1);
    return toText(c.scalar(a[0])).toLowerCase();
  },
  TRIM: (a, c) => {
    need(a, 1);
    return toText(c.scalar(a[0])).trim().replace(/\s+/g, ' ');
  },
  LEFT: (a, c) => {
    need(a, 1, 2);
    return toText(c.scalar(a[0])).slice(0, Math.max(0, argNum(a, 1, c, 1)));
  },
  RIGHT: (a, c) => {
    need(a, 1, 2);
    const s = toText(c.scalar(a[0]));
    const n = Math.max(0, argNum(a, 1, c, 1));
    return n === 0 ? '' : s.slice(-n);
  },
  MID: (a, c) => {
    need(a, 3);
    const s = toText(c.scalar(a[0]));
    const start = argNum(a, 1, c);
    if (start < 1) throw new FErr('#VALUE!');
    return s.substr(start - 1, Math.max(0, argNum(a, 2, c)));
  },
  VALUE: (a, c) => {
    need(a, 1);
    return toNumber(c.scalar(a[0]));
  },
  TEXT: (a, c) => {
    need(a, 1, 2);
    const v = c.scalar(a[0]);
    if (a.length < 2 || typeof v !== 'number') return toText(v);
    const fmt = toText(c.scalar(a[1]));
    const dec = /\.(0+)/.exec(fmt)?.[1].length ?? 0;
    const pct = fmt.includes('%');
    return (pct ? v * 100 : v).toFixed(dec) + (pct ? '%' : '');
  },
};

export const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort();

// ───────────────────────────── Evaluation ─────────────────────────────

/** Evaluates every cell of a sheet. Rows and columns are 0-based; row 0 is the header row. */
export class SheetEvaluator {
  private cells: string[][];
  private cache = new Map<number, Scalar>();
  private stack = new Set<number>();
  private rows: number;
  private cols: number;

  constructor(cells: string[][]) {
    this.cells = cells;
    this.rows = cells.length;
    this.cols = cells.reduce((m, r) => Math.max(m, r.length), 0);
  }

  value(r: number, c: number): Scalar {
    if (r < 0 || c < 0) return new FErr('#REF!');
    const raw = this.cells[r]?.[c];
    if (raw == null || raw === '') return '';
    if (!isFormula(raw)) return parseLiteral(raw);
    const key = r * 100000 + c;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    if (this.stack.has(key)) return new FErr('#CYCLE!');
    this.stack.add(key);
    let v: Scalar;
    try {
      const ast = parseFormula(raw.slice(1));
      if (ast instanceof FormulaSyntaxError) v = new FErr('#ERROR!');
      else v = scalarOf(this.ev(ast));
    } catch (e) {
      v = e instanceof FErr ? e : new FErr('#ERROR!');
    }
    if (typeof v === 'number' && !Number.isFinite(v)) v = new FErr('#NUM!');
    this.stack.delete(key);
    this.cache.set(key, v);
    return v;
  }

  display(r: number, c: number): string {
    return formatValue(this.value(r, c));
  }

  private ctx: Ctx = {
    ev: (n) => this.ev(n),
    scalar: (n) => {
      const v = scalarOf(this.ev(n));
      return v;
    },
  };

  private ev(n: Node): Val {
    switch (n.k) {
      case 'num':
        return n.v;
      case 'str':
        return n.v;
      case 'bool':
        return n.v;
      case 'err':
        return new FErr(n.v);
      case 'ref':
        return this.value(n.r, n.c);
      case 'range': {
        const r2 = Math.min(n.r2, this.rows - 1);
        const c2 = Math.min(n.c2, this.cols - 1);
        const out: Scalar[][] = [];
        for (let r = n.r1; r <= r2; r++) {
          const row: Scalar[] = [];
          for (let c = n.c1; c <= c2; c++) row.push(this.value(r, c));
          out.push(row);
        }
        return out.length ? out : [['']];
      }
      case 'neg':
        return -toNumber(scalarOf(this.ev(n.e)));
      case 'pct':
        return toNumber(scalarOf(this.ev(n.e))) / 100;
      case 'fn': {
        const f = FUNCTIONS[n.name];
        if (!f) return new FErr('#NAME?');
        return f(n.args, this.ctx);
      }
      case 'bin': {
        const a = scalarOf(this.ev(n.a));
        const b = scalarOf(this.ev(n.b));
        switch (n.op) {
          case '+':
            return toNumber(a) + toNumber(b);
          case '-':
            return toNumber(a) - toNumber(b);
          case '*':
            return toNumber(a) * toNumber(b);
          case '/': {
            const d = toNumber(b);
            const x = toNumber(a);
            if (d === 0) throw new FErr('#DIV/0!');
            return x / d;
          }
          case '^': {
            const v = toNumber(a) ** toNumber(b);
            if (!Number.isFinite(v)) throw new FErr('#NUM!');
            return v;
          }
          case '&':
            return toText(a) + toText(b);
          case '=':
            return compare(a, b) === 0;
          case '<>':
            return compare(a, b) !== 0;
          case '<':
            return compare(a, b) < 0;
          case '>':
            return compare(a, b) > 0;
          case '<=':
            return compare(a, b) <= 0;
          case '>=':
            return compare(a, b) >= 0;
        }
        return new FErr('#ERROR!');
      }
    }
  }
}

/** Computes display strings for a whole sheet. */
export function evaluateSheet(cells: string[][]): string[][] {
  const ev = new SheetEvaluator(cells);
  return cells.map((row, r) => row.map((raw, c) => (isFormula(raw) ? ev.display(r, c) : raw)));
}

// ───────────────────────────── Reference rewriting ─────────────────────────────

function rewriteRefs(formula: string, fn: (ref: CellRef) => string): string {
  if (!isFormula(formula)) return formula;
  const body = formula.slice(1);
  let toks: Tok[];
  try {
    toks = tokenize(body);
  } catch {
    return formula;
  }
  let out = '';
  let last = 0;
  for (const t of toks) {
    if (t.t !== 'ref') continue;
    out += body.slice(last, t.s) + fn(parseRef(t.text)!);
    last = t.e;
  }
  return '=' + out + body.slice(last);
}

/** Copy/fill semantics: shift relative references by (dr, dc); $-anchored parts stay. */
export function shiftFormula(formula: string, dr: number, dc: number): string {
  if (!dr && !dc) return formula;
  return rewriteRefs(formula, (ref) => {
    const r = ref.absR ? ref.r : ref.r + dr;
    const c = ref.absC ? ref.c : ref.c + dc;
    if (r < 0 || c < 0) return '#REF!';
    return formatRef({ ...ref, r, c });
  });
}

/**
 * Structural edit semantics (insert/delete rows or columns), like Excel:
 * references after the edit point move; references into deleted cells become #REF!.
 * `delta` > 0 inserts that many rows/columns before index `at`; < 0 deletes [at, at - delta).
 */
export function adjustFormula(formula: string, axis: 'row' | 'col', at: number, delta: number): string {
  if (!delta || !isFormula(formula)) return formula;
  const body = formula.slice(1);
  let toks: Tok[];
  try {
    toks = tokenize(body);
  } catch {
    return formula;
  }
  const get = (ref: CellRef) => (axis === 'row' ? ref.r : ref.c);
  const set = (ref: CellRef, v: number): CellRef => (axis === 'row' ? { ...ref, r: v } : { ...ref, c: v });
  const n = Math.abs(delta);
  const end = at + n; // for deletions: [at, end) is removed
  let out = '';
  let last = 0;
  const emit = (s: number, e: number, text: string) => {
    out += body.slice(last, s) + text;
    last = e;
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== 'ref') continue;
    const a = parseRef(t.text)!;
    const colon = toks[i + 1];
    const u = toks[i + 2];
    if (colon?.t === 'op' && colon.v === ':' && u?.t === 'ref') {
      const b = parseRef(u.text)!;
      const ai = get(a);
      const bi = get(b);
      if (delta > 0) {
        emit(t.s, t.e, formatRef(set(a, ai >= at ? ai + n : ai)));
        emit(u.s, u.e, formatRef(set(b, bi >= at ? bi + n : bi)));
      } else {
        const lo = Math.min(ai, bi);
        const hi = Math.max(ai, bi);
        if (lo >= at && hi < end) emit(t.s, u.e, '#REF!');
        else {
          const newLo = lo >= end ? lo - n : lo >= at ? at : lo;
          const newHi = hi >= end ? hi - n : hi >= at ? at - 1 : hi;
          const aIsLo = ai <= bi;
          emit(t.s, t.e, formatRef(set(a, aIsLo ? newLo : newHi)));
          emit(u.s, u.e, formatRef(set(b, aIsLo ? newHi : newLo)));
        }
      }
      i += 2;
      continue;
    }
    const idx = get(a);
    if (delta > 0) emit(t.s, t.e, formatRef(set(a, idx >= at ? idx + n : idx)));
    else if (idx >= at && idx < end) emit(t.s, t.e, '#REF!');
    else emit(t.s, t.e, formatRef(set(a, idx >= end ? idx - n : idx)));
  }
  return '=' + out + body.slice(last);
}

export interface RefSpan {
  start: number;
  end: number;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/** Locations of cell references in a formula (offsets include the leading "="), for highlighting. */
export function findRefs(formula: string): RefSpan[] {
  if (!formula.startsWith('=')) return [];
  let toks: Tok[];
  try {
    toks = tokenize(formula.slice(1));
  } catch {
    return [];
  }
  const out: RefSpan[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== 'ref') continue;
    const a = parseRef(t.text)!;
    const colon = toks[i + 1];
    const u = toks[i + 2];
    if (colon?.t === 'op' && colon.v === ':' && u?.t === 'ref') {
      const b = parseRef(u.text)!;
      out.push({ start: t.s + 1, end: u.e + 1, r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) });
      i += 2;
    } else out.push({ start: t.s + 1, end: t.e + 1, r1: a.r, c1: a.c, r2: a.r, c2: a.c });
  }
  return out;
}

/** Whether the caret position in a formula is a place where a cell reference may be inserted. */
export function canInsertRefAt(formula: string, caret: number): boolean {
  if (!formula.startsWith('=')) return false;
  const before = formula.slice(0, caret).trimEnd();
  if (before === '=') return true;
  const last = before[before.length - 1];
  return '+-*/^&=<>(,;:%'.includes(last) && last !== '%';
}
