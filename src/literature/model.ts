/**
 * Literature: one Markdown file per paper in Literature/, named "<citation key> <title>.md", with the
 * reference in its front matter (authors, year, journal, DOI…) and your reading notes as its body.
 * Entries and notes cite a paper with an ordinary link to that file, so "Cited in" works like any
 * other backlink.
 */
import type { ColorName, DocMeta } from '../notebook/model';

export interface RefInfo {
  title: string;
  /** "Family, Given", in order. */
  authors: string[];
  year?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  pmid?: string;
  url?: string;
  abstract?: string;
  /** The key it had where it came from (a BibTeX key), used when it is free. */
  key?: string;
}

const clean = (s: unknown): string => (typeof s === 'string' || typeof s === 'number' ? String(s).replace(/\s+/g, ' ').trim() : '');

/** "Jinek, Martin", "Martin Jinek", "Jinek M" → "Family, Given". */
export function normalizeAuthor(name: string): string {
  const n = clean(name).replace(/[{}]/g, '');
  if (!n) return '';
  if (n.includes(',')) return n;
  const parts = n.split(' ');
  if (parts.length === 1) return n;
  // PubMed style: "Jinek M", "Doudna JA" (initials last).
  const last = parts[parts.length - 1];
  if (/^[A-Z]{1,3}$/.test(last)) return `${parts.slice(0, -1).join(' ')}, ${last}`;
  return `${last}, ${parts.slice(0, -1).join(' ')}`;
}

export const familyName = (author: string) => author.split(',')[0].trim();

/** "Jinek, Martin" → "Jinek M". */
function shortAuthor(author: string): string {
  const [family, given = ''] = author.split(',').map((s) => s.trim());
  const initials = given
    .split(/[\s.-]+/)
    .filter(Boolean)
    .map((g) => (/^[A-Z]{1,3}$/.test(g) ? g : g[0].toUpperCase()))
    .join('');
  return initials ? `${family} ${initials}` : family;
}

/** How a paper is cited in the text: "Jinek et al., 2012", "Jinek & Doudna, 2012", "Jinek, 2012". */
export function shortCitation(info: Pick<RefInfo, 'authors' | 'year' | 'title'>): string {
  const names = info.authors.map(familyName).filter(Boolean);
  const who =
    names.length === 0
      ? info.title.split(' ').slice(0, 3).join(' ')
      : names.length === 1
        ? names[0]
        : names.length === 2
          ? `${names[0]} & ${names[1]}`
          : `${names[0]} et al.`;
  return info.year ? `${who}, ${info.year}` : who;
}

/** The full reference, in the usual journal style: "Jinek M, … Title. Science. 2012;337(6096):816–821. doi:…". */
export function fullCitation(info: RefInfo): string {
  const authors = info.authors.length > 6 ? [...info.authors.slice(0, 6).map(shortAuthor), 'et al'] : info.authors.map(shortAuthor);
  let when = [info.year, info.volume && `${info.volume}${info.issue ? `(${info.issue})` : ''}`].filter(Boolean).join(';');
  if (info.pages) when += `${when ? ':' : ''}${info.pages}`;
  const parts = [authors.join(', '), info.title.replace(/\.$/, ''), info.journal, when, info.doi && `doi:${info.doi}`];
  return parts.filter(Boolean).join('. ') + '.';
}

const asciiFold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[øØ]/g, 'o').replace(/[łŁ]/g, 'l');

/** A citation key such as "Jinek2012", made unique with a letter: "Jinek2012b". */
export function citationKey(info: Pick<RefInfo, 'authors' | 'year' | 'title' | 'key'>, taken: Set<string>): string {
  const ok = (k: string) => !taken.has(k.toLowerCase());
  const own = clean(info.key).replace(/[^A-Za-z0-9_-]/g, '');
  if (own && /^[A-Za-z]/.test(own) && ok(own)) return own;
  const first = info.authors[0] ? familyName(info.authors[0]) : info.title.split(' ').find((w) => w.length > 3) || 'Ref';
  const stem = asciiFold(first).replace(/[^A-Za-z]/g, '') || 'Ref';
  const base = `${stem[0].toUpperCase()}${stem.slice(1)}${info.year ?? ''}`;
  if (ok(base)) return base;
  for (let i = 1; i < 26 * 26; i++) {
    const suffix = i < 26 ? String.fromCharCode(97 + i) : String.fromCharCode(96 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));
    if (ok(base + suffix)) return base + suffix;
  }
  return `${base}-${Date.now()}`;
}

// ───────────── Reading identifiers ─────────────

/** What was typed in "DOI or PubMed ID": a DOI (also inside a doi.org link) or a PMID (also a PubMed link). */
export function parseIdentifier(input: string): { kind: 'doi' | 'pmid'; value: string } | null {
  const t = input.trim();
  const doi = /(10\.\d{4,9}\/[^\s"<>]+)/i.exec(decodeURIComponent(t));
  if (doi) return { kind: 'doi', value: doi[1].replace(/[.,;]+$/, '') };
  const pubmed = /(?:pubmed\.ncbi\.nlm\.nih\.gov\/|pmid:?\s*)(\d{1,9})/i.exec(t) ?? /^(\d{1,9})$/.exec(t);
  if (pubmed) return { kind: 'pmid', value: pubmed[1] };
  return null;
}

// ───────────── Crossref and PubMed ─────────────

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const first = (v: unknown): string => clean(arr(v)[0] ?? v);

/** A work from api.crossref.org/works/<doi>. */
export function fromCrossref(json: unknown): RefInfo {
  const m = obj(obj(json).message ?? json);
  const year = arr(obj(m['published-print'] ?? m['published-online'] ?? m.issued)['date-parts'])
    .map((p) => arr(p)[0])
    .find(Boolean);
  return {
    title: first(m.title).replace(/<[^>]+>/g, ''),
    authors: arr(m.author)
      .map((a) => {
        const o = obj(a);
        return o.family ? `${clean(o.family)}${o.given ? `, ${clean(o.given)}` : ''}` : clean(o.name);
      })
      .filter(Boolean),
    year: year ? String(year) : undefined,
    journal: first(m['container-title']) || undefined,
    volume: clean(m.volume) || undefined,
    issue: clean(m.issue) || undefined,
    pages: clean(m.page).replace(/-/g, '–') || undefined,
    doi: clean(m.DOI) || undefined,
    url: clean(m.URL) || undefined,
    abstract:
      clean(m.abstract)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || undefined,
  };
}

/** A paper from eutils esummary (db=pubmed, retmode=json). */
export function fromPubmed(json: unknown, pmid: string): RefInfo {
  const r = obj(obj(obj(json).result)[pmid]);
  const ids = arr(r.articleids).map(obj);
  const doi = clean(ids.find((i) => i.idtype === 'doi')?.value);
  const year = /\d{4}/.exec(clean(r.pubdate) || clean(r.sortpubdate))?.[0];
  return {
    title: clean(r.title).replace(/\.$/, ''),
    authors: arr(r.authors)
      .map((a) => obj(a))
      .filter((a) => !a.authtype || a.authtype === 'Author')
      .map((a) => normalizeAuthor(clean(a.name)))
      .filter(Boolean),
    year,
    journal: clean(r.source) || clean(r.fulljournalname) || undefined,
    volume: clean(r.volume) || undefined,
    issue: clean(r.issue) || undefined,
    pages: clean(r.pages).replace(/-/g, '–') || undefined,
    doi: doi || undefined,
    pmid,
  };
}

// ───────────── BibTeX and RIS ─────────────

/** LaTeX accent commands and the combining marks they stand for: \"u → ü. */
const ACCENTS: Record<string, string> = {
  '"': '\u0308',
  "'": '\u0301',
  '`': '\u0300',
  '^': '\u0302',
  '~': '\u0303',
  '=': '\u0304',
  '.': '\u0307',
  c: '\u0327',
  v: '\u030c',
  u: '\u0306',
  H: '\u030b',
};
const LETTERS: Record<string, string> = { ss: 'ß', o: 'ø', O: 'Ø', ae: 'æ', AE: 'Æ', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', i: 'ı' };

/** The text of a BibTeX value: accents turned into letters, other commands and braces taken out. */
function bibText(v: string): string {
  return clean(
    v
      .replace(
        /\\([cvuH])\s*\{([A-Za-z])\}|\\([cvuH])\s+([A-Za-z])|\\(["'`^~=.])\s*\{?\\?([A-Za-z])\}?/g,
        (_m, a1, l1, a2, l2, a3, l3) => `${l1 ?? l2 ?? l3}${ACCENTS[a1 ?? a2 ?? a3]}`,
      )
      .replace(/\\(ss|ae|AE|aa|AA|o|O|l|L|i)\b\s*/g, (_m, k: string) => LETTERS[k])
      .replace(/\\&/g, '&')
      .replace(/\\[a-zA-Z]+\s*/g, '')
      .replace(/[{}]/g, '')
      .normalize('NFC'),
  );
}

/** Entries of a BibTeX file (as exported by Zotero, Mendeley, Google Scholar…). */
export function parseBibtex(text: string): RefInfo[] {
  const out: RefInfo[] = [];
  const re = /@(\w+)\s*\{\s*([^,\s]*)\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (/^(comment|string|preamble)$/i.test(m[1])) continue;
    // Read fields until the brace that closes the entry.
    let i = re.lastIndex;
    let depth = 1;
    const fields: Record<string, string> = {};
    while (i < text.length && depth > 0) {
      const f = /\s*([A-Za-z][\w-]*)\s*=\s*/y;
      f.lastIndex = i;
      const name = f.exec(text);
      if (!name) {
        if (text[i] === '}') depth--;
        i++;
        continue;
      }
      i = f.lastIndex;
      let value = '';
      if (text[i] === '{') {
        let d = 0;
        const start = i;
        for (; i < text.length; i++) {
          if (text[i] === '{') d++;
          else if (text[i] === '}' && --d === 0) break;
        }
        value = text.slice(start + 1, i);
        i++;
      } else if (text[i] === '"') {
        // A quoted value ends at the first quote outside braces ("M{\"u}ller").
        let d = 0;
        let end = i + 1;
        for (; end < text.length; end++) {
          if (text[end] === '{') d++;
          else if (text[end] === '}') d--;
          else if (text[end] === '"' && d <= 0 && text[end - 1] !== '\\') break;
        }
        value = text.slice(i + 1, end);
        i = end + 1;
      } else {
        const bare = /[^,}\s]+/y;
        bare.lastIndex = i;
        value = bare.exec(text)?.[0] ?? '';
        i = bare.lastIndex || i + 1;
      }
      fields[name[1].toLowerCase()] = value;
    }
    re.lastIndex = i;
    const authors = (fields.author ?? '')
      .split(/\s+and\s+/i)
      .map((a) => normalizeAuthor(bibText(a)))
      .filter(Boolean);
    out.push({
      key: m[2],
      title: bibText(fields.title ?? ''),
      authors,
      year: /\d{4}/.exec(fields.year ?? fields.date ?? '')?.[0],
      journal: bibText(fields.journal ?? fields.journaltitle ?? fields.booktitle ?? '') || undefined,
      volume: bibText(fields.volume ?? '') || undefined,
      issue: bibText(fields.number ?? fields.issue ?? '') || undefined,
      pages: bibText(fields.pages ?? '').replace(/-+/g, '–') || undefined,
      doi: bibText(fields.doi ?? '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') || undefined,
      pmid: bibText(fields.pmid ?? '') || undefined,
      url: bibText(fields.url ?? '') || undefined,
      abstract: bibText(fields.abstract ?? '') || undefined,
    });
  }
  return out.filter((r) => r.title || r.authors.length);
}

/** Records of a RIS file (EndNote, Zotero, publishers' "Download citation"). */
export function parseRis(text: string): RefInfo[] {
  const out: RefInfo[] = [];
  let cur: Record<string, string[]> | null = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9])\s{1,2}-\s?(.*)$/.exec(line);
    if (!m) continue;
    const [, tag, value] = m;
    if (tag === 'TY') cur = {};
    else if (tag === 'ER') {
      if (cur) {
        const g = (...tags: string[]) => tags.map((t) => cur![t]?.[0]).find(Boolean) ?? '';
        const start = g('SP');
        const end = g('EP');
        out.push({
          title: clean(g('TI', 'T1', 'CT')),
          authors: [...(cur.AU ?? []), ...(cur.A1 ?? [])].map(normalizeAuthor).filter(Boolean),
          year: /\d{4}/.exec(g('PY', 'Y1', 'DA'))?.[0],
          journal: clean(g('JO', 'JF', 'T2', 'JA')) || undefined,
          volume: clean(g('VL')) || undefined,
          issue: clean(g('IS')) || undefined,
          pages: clean(start && end ? `${start}–${end}` : start) || undefined,
          doi: clean(g('DO')).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') || undefined,
          url: clean(g('UR')) || undefined,
          abstract: clean(g('AB', 'N2')) || undefined,
        });
      }
      cur = null;
    } else if (cur) (cur[tag] ??= []).push(value);
  }
  return out.filter((r) => r.title || r.authors.length);
}

/** The BibTeX entries and RIS records in a text (a file can hold either, or a paste both). */
export function parseReferences(text: string): RefInfo[] {
  return [...parseBibtex(text), ...parseRis(text)];
}

// ───────────── In the notebook ─────────────

/** The reference kept in a paper's front matter. */
export function refFromMeta(meta: Pick<DocMeta, 'title' | 'extra'>): RefInfo {
  const e = meta.extra;
  const s = (k: string) => clean(e[k]) || undefined;
  const authors = Array.isArray(e.authors) ? e.authors.map((a) => clean(a)).filter(Boolean) : clean(e.authors) ? [clean(e.authors)] : [];
  return {
    title: meta.title,
    authors,
    year: s('year'),
    journal: s('journal'),
    volume: s('volume'),
    issue: s('issue'),
    pages: s('pages'),
    doi: s('doi'),
    pmid: s('pmid'),
    url: s('url'),
  };
}

/** Front matter for a paper (besides its title). */
export function refExtra(info: RefInfo): Record<string, unknown> {
  const out: Record<string, unknown> = { authors: info.authors.length ? info.authors : undefined };
  for (const k of ['year', 'journal', 'volume', 'issue', 'pages', 'doi', 'pmid', 'url'] as const) {
    const v = clean(info[k]);
    // Plain numbers (year, volume, PubMed ID) are written unquoted.
    out[k] = /^[1-9]\d{0,14}$/.test(v) && k !== 'pages' ? Number(v) : v || undefined;
  }
  return out;
}

export function toBibtex(info: RefInfo, key: string): string {
  const esc = (s: string) => s.replace(/[{}]/g, '');
  const fields: [string, string | undefined][] = [
    ['title', info.title],
    ['author', info.authors.join(' and ')],
    ['journal', info.journal],
    ['year', info.year],
    ['volume', info.volume],
    ['number', info.issue],
    ['pages', info.pages?.replace(/–/g, '--')],
    ['doi', info.doi],
    ['pmid', info.pmid],
    ['url', info.url],
  ];
  const body = fields
    .filter(([, v]) => v)
    .map(([k, v]) => `  ${k} = {${esc(v!)}}`)
    .join(',\n');
  return `@article{${key},\n${body}\n}\n`;
}

/** Where a paper is in your reading, the columns of the Literature board. A paper with none is still to read. */
export const READING_STATUSES: { id: string; name: string; color: ColorName }[] = [
  { id: 'to-read', name: 'To read', color: 'gray' },
  { id: 'reading', name: 'Reading', color: 'blue' },
  { id: 'read', name: 'Read', color: 'green' },
];

export function readingStatus(meta: Pick<DocMeta, 'status'>): string {
  return READING_STATUSES.some((s) => s.id === meta.status) ? meta.status! : 'to-read';
}
