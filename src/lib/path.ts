/**
 * POSIX-style path helpers for paths inside a notebook ("vault").
 * Vault paths never start with a slash: "Projects/CRISPR/EXP-0001 Title.md".
 */

export function splitPath(path: string): string[] {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out;
}

export function normalize(path: string): string {
  return splitPath(path).join('/');
}

export function join(...parts: (string | undefined | null)[]): string {
  return normalize(parts.filter((p) => p != null && p !== '').join('/'));
}

export function dirname(path: string): string {
  const parts = splitPath(path);
  parts.pop();
  return parts.join('/');
}

export function basename(path: string): string {
  const parts = splitPath(path);
  return parts[parts.length - 1] ?? '';
}

/** Extension including the dot, lower-cased: ".md" */
export function extname(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i).toLowerCase() : '';
}

/** File name without extension. */
export function stem(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(0, i) : base;
}

/** True when `path` equals `dir` or is inside it. */
export function isInside(path: string, dir: string): boolean {
  const p = normalize(path);
  const d = normalize(dir);
  if (!d) return true;
  return p === d || p.startsWith(d + '/');
}

/** Resolve a relative link (as written in a Markdown file) against the file's folder. */
export function resolveLink(fromDir: string, href: string): string {
  return join(fromDir, safeDecode(href));
}

/** Relative path from directory `fromDir` to `to`. */
export function relative(fromDir: string, to: string): string {
  const a = splitPath(fromDir);
  const b = splitPath(to);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

export function safeDecode(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

/** Encode a vault-relative path for use as a Markdown link destination. */
export function encodeLinkPath(path: string): string {
  return path
    .split('/')
    .map((seg) =>
      encodeURI(seg)
        .replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29'))
        .replace(/#/g, '%23')
        .replace(/\?/g, '%3F'),
    )
    .join('/');
}

/** Split a stored (decoded) link into its file path and "#fragment". A "#" inside a file name stays in the path. */
export function splitFragment(href: string): [string, string] {
  const m = /^(.*\.[A-Za-z0-9]+)(#[^/]*)$/.exec(href);
  return m ? [m[1], m[2]] : [href, ''];
}

/** True for links that point to another file in the notebook (not a URL). */
export function isRelativeFileLink(href: string): boolean {
  if (!href) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false; // http:, mailto:, data:, …
  if (href.startsWith('/') || href.startsWith('#') || href.startsWith('?')) return false;
  return true;
}

const RESERVED = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

const GREEK: Record<string, string> = {
  α: 'alpha',
  β: 'beta',
  γ: 'gamma',
  δ: 'delta',
  Δ: 'Delta',
  ε: 'epsilon',
  κ: 'kappa',
  λ: 'lambda',
  μ: 'u',
  µ: 'u',
  σ: 'sigma',
  τ: 'tau',
  ω: 'omega',
  ß: 'ss',
};

/** Closest ASCII spelling: "CaCl₂ 10 µM α-tubulin" → "CaCl2 10 uM alpha-tubulin". */
export function asciiFold(s: string): string {
  return s
    .replace(/[αβγδΔεκλμµστωß]/g, (c) => GREEK[c])
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '');
}

let asciiOnly = false;

/**
 * Some systems cannot store non-ASCII file names (e.g. Chrome on Linux with a POSIX locale).
 * When the notebook folder is on one, new file names are spelled in ASCII.
 */
export function setAsciiFileNames(on: boolean) {
  asciiOnly = on;
}

/** Make a string safe to use as a file or folder name on every OS. */
export function sanitizeFileName(name: string, fallback = 'Untitled'): string {
  let s = (asciiOnly ? asciiFold(name) : name).normalize('NFC').replace(RESERVED, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (s.length > 120) s = s.slice(0, 120).trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = '_' + s;
  return s || fallback;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}
