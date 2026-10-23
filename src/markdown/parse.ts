/**
 * Markdown → editor document.
 *
 * Assaycraft's Markdown is plain GFM so files read well anywhere (GitHub, Obsidian, VS Code):
 *  - every table is an Excel-like spreadsheet; formulas/column widths live in an HTML comment
 *    right above it: <!-- gc:table {"f":{"D2":"=B2*C2"}} -->
 *  - a buffer is a table of components under <!-- gc:buffer {"volume":"50 mL","solvent":"Water"} -->
 *  - a plate layout is a table of wells (rows A, B…, columns 1, 2…) under <!-- gc:plate {"format":96,"samples":[…]} -->
 *  - a flow is a numbered list of steps (titles, or links to their entries) under <!-- gc:flow -->
 *  - a paragraph that is just a link to a local file is a file attachment
 *  - <sub>, <sup>, <mark>, <u> are used for sub/superscript, highlight and underline
 *  - sub-template references (templates only): <!-- gc:include {"id":"…","name":"…"} -->
 *  - anything else that is raw HTML is preserved verbatim
 */
import MarkdownIt, { type StateCore, type Token } from 'markdown-it';
import { MarkdownParser } from 'prosemirror-markdown';
import type { Node as PMNode } from '@tiptap/pm/model';
import { docSchema } from '../editor/schema';
import { parseRef } from '../sheet/refs';
import { normalizeSheet, type SheetData } from '../sheet/model';
import { extname, isRelativeFileLink, safeDecode } from '../lib/path';
import { bufferFromTable } from '../buffer/calc';
import { normalizePlate, plateFromTable } from '../plate/model';
import { flowFromItems } from '../flow/model';

const GC_COMMENT_RE = /^<!--\s*gc:([a-z][a-z0-9-]*)\s*([\s\S]*?)\s*-->\s*$/i;
const TASK_RE = /^\[([ xX])\](?:[ \t]+|$)/;
const IMG_BLOCK_RE = /^(?:\s*<img\b[^>]*>\s*)+$/i;
const IMG_TAG_RE = /<img\b([^>]*)>/gi;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

const INLINE_TAGS: Record<string, string> = {
  sub: 'sub',
  sup: 'sup',
  mark: 'mark',
  u: 'u',
  ins: 'u',
  s: 's',
  del: 's',
  strike: 's',
  b: 'strong',
  strong: 'strong',
  i: 'em',
  em: 'em',
};

export function parseGcComment(content: string): { type: string; data: Record<string, unknown> } | null {
  const m = GC_COMMENT_RE.exec(content.trim());
  if (!m) return null;
  let data: Record<string, unknown> = {};
  if (m[2]) {
    try {
      const parsed: unknown = JSON.parse(m[2]);
      if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
    } catch {
      /* ignore malformed metadata */
    }
  }
  return { type: m[1].toLowerCase(), data };
}

function htmlAttrs(attrText: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of attrText.matchAll(ATTR_RE)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e] ?? _);
}

function localSrc(src: string): string {
  return isRelativeFileLink(src) ? safeDecode(src) : src;
}

/** Like localSrc, for links: in Markdown a literal "#" starts the fragment (a "#" in a file name is written %23). */
function localHref(href: string): string {
  if (!isRelativeFileLink(href)) return href;
  const i = href.indexOf('#');
  return i < 0 ? safeDecode(href) : safeDecode(href.slice(0, i)) + href.slice(i);
}

class Builder {
  private state: StateCore;
  constructor(state: StateCore) {
    this.state = state;
  }
  token(type: string, meta: unknown, content = ''): Token {
    const t = new this.state.Token(type, '', 0);
    t.meta = meta;
    t.content = content;
    t.block = true;
    return t;
  }
}

function sheetFromRows(rows: string[][], meta: Record<string, unknown> | null): SheetData {
  const f = (meta?.f ?? {}) as Record<string, unknown>;
  for (const [key, formula] of Object.entries(f)) {
    const ref = parseRef(key);
    if (!ref || typeof formula !== 'string') continue;
    if (ref.r < rows.length && ref.c < (rows[ref.r]?.length ?? 0)) rows[ref.r][ref.c] = formula;
  }
  const w = meta?.w;
  const widths = Array.isArray(w) ? w.map((x) => (typeof x === 'number' && x > 0 ? x : null)) : undefined;
  return normalizeSheet({ rows, ...(widths ? { widths } : {}) });
}

function collectTable(tokens: Token[], start: number): { rows: string[][]; end: number } {
  const rows: string[][] = [];
  let row: string[] | null = null;
  let j = start + 1;
  for (; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.type === 'table_close') break;
    if (t.type === 'tr_open') row = [];
    else if (t.type === 'tr_close') {
      if (row) rows.push(row);
      row = null;
    } else if (t.type === 'inline' && row) row.push(t.content.replace(/<br\s*\/?>/gi, '\n'));
  }
  return { rows, end: j };
}

function isBlank(t: Token) {
  return (t.type === 'text' && !t.content.trim()) || t.type === 'softbreak' || t.type === 'hardbreak';
}

function inlineText(tokens: Token[]): string {
  return tokens.map((t) => (t.type === 'text' || t.type === 'code_inline' || t.type === 'html_inline' ? t.content : isBlank(t) ? ' ' : '')).join('');
}

/** The items of a list (the text of each one's first paragraph, and its link if that is all there is). */
function collectListItems(tokens: Token[], start: number): { items: { text: string; href?: string }[]; end: number } {
  const items: { text: string; href?: string }[] = [];
  const level = tokens[start].level;
  let j = start + 1;
  for (; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.type === tokens[start].type.replace('_open', '_close') && t.level === level) break;
    if (t.type !== 'list_item_open' || t.level !== level + 1) continue;
    const inline = tokens[j + 2]?.type === 'inline' && tokens[j + 1]?.type === 'paragraph_open' ? tokens[j + 2] : null;
    const kids = (inline?.children ?? []).filter((k) => !isBlank(k));
    const linked =
      kids.length >= 2 &&
      kids[0].type === 'link_open' &&
      kids[kids.length - 1].type === 'link_close' &&
      !kids.slice(1, -1).some((k) => k.type === 'link_open');
    items.push(linked ? { text: inlineText(kids.slice(1, -1)), href: kids[0].attrGet('href') ?? '' } : { text: inlineText(inline?.children ?? []) });
  }
  return { items, end: j };
}

/** A paragraph consisting only of a local file link or only of images becomes block nodes. */
function paragraphBlocks(b: Builder, inline: Token): Token[] | null {
  const kids = (inline.children ?? []).filter((t) => !isBlank(t));
  if (!kids.length) return null;
  if (kids.every((t) => t.type === 'image')) {
    return kids.map((t) =>
      b.token('image_block', {
        src: localSrc(t.attrGet('src') ?? ''),
        alt: t.content ?? '',
        title: t.attrGet('title') || null,
        width: null,
      }),
    );
  }
  if (kids[0].type === 'link_open' && kids[kids.length - 1].type === 'link_close') {
    const inner = kids.slice(1, -1);
    if (inner.some((t) => t.type === 'link_open' || t.type === 'image')) return null;
    const href = kids[0].attrGet('href') ?? '';
    if (!isRelativeFileLink(href) || extname(safeDecode(href.split('#')[0])) === '.md') return null;
    const name = inner.map((t) => t.content).join('');
    return [b.token('attachment', { src: safeDecode(href), name })];
  }
  return null;
}

function imagesFromHtml(b: Builder, html: string): Token[] | null {
  if (!IMG_BLOCK_RE.test(html.trim())) return null;
  const out: Token[] = [];
  for (const m of html.matchAll(IMG_TAG_RE)) {
    const a = htmlAttrs(m[1]);
    out.push(
      b.token('image_block', {
        src: localSrc(decodeEntities(a.src ?? '')),
        alt: decodeEntities(a.alt ?? ''),
        title: a.title ? decodeEntities(a.title) : null,
        width: a.width ?? null,
      }),
    );
  }
  return out;
}

/** Map inline HTML to marks where possible, keep the rest verbatim. */
function transformInline(state: StateCore, children: Token[]): Token[] {
  const tagOf = (t: Token): { name: string; close: boolean } | null => {
    if (t.type !== 'html_inline') return null;
    const m = /^<(\/?)([a-z]+)\s*>$/i.exec(t.content.trim());
    if (!m) return null;
    const name = INLINE_TAGS[m[2].toLowerCase()];
    return name ? { name, close: m[1] === '/' } : null;
  };
  // Pair up open/close tags so unbalanced HTML stays as text.
  const paired = new Set<number>();
  const stack: { name: string; i: number }[] = [];
  children.forEach((t, i) => {
    const tag = tagOf(t);
    if (!tag) return;
    if (!tag.close) stack.push({ name: tag.name, i });
    else {
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name === tag.name) {
          paired.add(stack[k].i);
          paired.add(i);
          stack.splice(k);
          break;
        }
      }
    }
  });

  const out: Token[] = [];
  children.forEach((t, i) => {
    if (t.type === 'html_inline') {
      if (/^<br\s*\/?>$/i.test(t.content.trim())) {
        out.push(new state.Token('hardbreak', 'br', 0));
        return;
      }
      const tag = tagOf(t);
      if (tag && paired.has(i)) {
        out.push(new state.Token(`${tag.name}_${tag.close ? 'close' : 'open'}`, tag.name, tag.close ? -1 : 1));
        return;
      }
      const raw = new state.Token('raw_inline', '', 0);
      raw.content = t.content;
      out.push(raw);
      return;
    }
    if (t.type === 'image') {
      // Images inside running text become links (images are block-level in Assaycraft).
      const open = new state.Token('link_open', 'a', 1);
      open.attrs = [['href', t.attrGet('src') ?? '']];
      const text = new state.Token('text', '', 0);
      text.content = t.content || 'image';
      out.push(open, text, new state.Token('link_close', 'a', -1));
      return;
    }
    out.push(t);
  });
  return out;
}

function stripLeadingText(children: Token[], n: number) {
  let remaining = n;
  while (remaining > 0 && children.length && children[0].type === 'text') {
    const c = children[0];
    if (c.content.length <= remaining) {
      remaining -= c.content.length;
      children.shift();
    } else {
      c.content = c.content.slice(remaining);
      remaining = 0;
    }
  }
  if (children[0]?.type === 'softbreak') children.shift();
}

function convertTaskLists(tokens: Token[]) {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'bullet_list_open') continue;
    const level = tokens[i].level;
    const items: number[] = [];
    let close = -1;
    for (let j = i + 1; j < tokens.length; j++) {
      const t = tokens[j];
      if (t.type === 'bullet_list_close' && t.level === level) {
        close = j;
        break;
      }
      if (t.type === 'list_item_open' && t.level === level + 1) items.push(j);
    }
    if (close < 0 || !items.length) continue;
    const isTask = items.every(
      (j) => tokens[j + 1]?.type === 'paragraph_open' && tokens[j + 2]?.type === 'inline' && TASK_RE.test(tokens[j + 2].content),
    );
    if (!isTask) continue;
    tokens[i].type = 'task_list_open';
    tokens[close].type = 'task_list_close';
    for (const j of items) {
      const item = tokens[j];
      const inline = tokens[j + 2];
      const m = TASK_RE.exec(inline.content)!;
      item.type = 'task_item_open';
      item.meta = { checked: m[1] !== ' ' };
      inline.content = inline.content.slice(m[0].length);
      stripLeadingText(inline.children ?? [], m[0].length);
      for (let k = j + 1; k < close; k++) {
        if (tokens[k].type === 'list_item_close' && tokens[k].level === item.level) {
          tokens[k].type = 'task_item_close';
          break;
        }
      }
    }
  }
}

function assaycraftRule(state: StateCore) {
  const b = new Builder(state);
  const src = state.tokens;
  const out: Token[] = [];
  let tableMeta: Record<string, unknown> | null = null;
  let bufferMeta: Record<string, unknown> | null = null;
  let plateMeta: Record<string, unknown> | null = null;

  for (let i = 0; i < src.length; i++) {
    const t = src[i];
    if (t.type === 'html_block') {
      const gc = parseGcComment(t.content);
      if (gc?.type === 'table') {
        tableMeta = gc.data;
        continue;
      }
      if (gc?.type === 'buffer') {
        bufferMeta = gc.data;
        continue;
      }
      if (gc?.type === 'plate') {
        // Its table follows; a plate without one (cut off by hand) is still a plate.
        if (src[i + 1]?.type === 'table_open') plateMeta = gc.data;
        else out.push(b.token('plate', normalizePlate({ ...gc.data, wells: {} })));
        continue;
      }
      if (gc?.type === 'flow') {
        tableMeta = null;
        bufferMeta = null;
        if (src[i + 1]?.type === 'ordered_list_open') {
          const { items, end } = collectListItems(src, i + 1);
          out.push(b.token('flow', flowFromItems(items, gc.data)));
          i = end;
        } else out.push(b.token('flow', flowFromItems([], gc.data)));
        continue;
      }
      if (gc?.type === 'include') {
        const ref = String(gc.data.id ?? gc.data.ref ?? '');
        out.push(b.token('include', { ref, name: String(gc.data.name ?? ref) }));
        tableMeta = null;
        continue;
      }
      // An empty line kept by the serializer.
      if (/^<br\s*\/?>$/i.test(t.content.trim())) {
        out.push(new state.Token('paragraph_open', 'p', 1), new state.Token('paragraph_close', 'p', -1));
        tableMeta = null;
        bufferMeta = null;
        continue;
      }
      const imgs = imagesFromHtml(b, t.content);
      if (imgs) out.push(...imgs);
      else out.push(b.token('raw_block', null, t.content.replace(/\s+$/, '')));
      tableMeta = null;
      bufferMeta = null;
      continue;
    }
    if (t.type === 'table_open') {
      const { rows, end } = collectTable(src, i);
      out.push(
        plateMeta
          ? b.token('plate', plateFromTable(rows, plateMeta))
          : bufferMeta
            ? b.token('buffer', bufferFromTable(rows, bufferMeta))
            : b.token('spreadsheet', sheetFromRows(rows, tableMeta)),
      );
      tableMeta = null;
      bufferMeta = null;
      plateMeta = null;
      i = end;
      continue;
    }
    tableMeta = null;
    bufferMeta = null;
    if (t.type === 'paragraph_open' && !t.hidden && src[i + 1]?.type === 'inline' && src[i + 2]?.type === 'paragraph_close') {
      const blocks = paragraphBlocks(b, src[i + 1]);
      if (blocks) {
        out.push(...blocks);
        i += 2;
        continue;
      }
    }
    if (t.type === 'inline' && t.children) t.children = transformInline(state, t.children);
    out.push(t);
  }
  convertTaskLists(out);
  state.tokens = out;
}

export function createMarkdownIt(): MarkdownIt {
  const md = new MarkdownIt('default', { html: true, linkify: false, typographer: false });
  md.core.ruler.push('assaycraft', assaycraftRule);
  return md;
}

let parser: MarkdownParser | null = null;

function getParser(): MarkdownParser {
  if (parser) return parser;
  const schema = docSchema();
  parser = new MarkdownParser(schema, createMarkdownIt(), {
    blockquote: { block: 'blockquote' },
    paragraph: { block: 'paragraph' },
    list_item: { block: 'listItem' },
    bullet_list: { block: 'bulletList' },
    ordered_list: { block: 'orderedList', getAttrs: (tok) => ({ start: Number(tok.attrGet('start')) || 1 }) },
    task_list: { block: 'taskList' },
    task_item: { block: 'taskItem', getAttrs: (tok) => ({ checked: (tok.meta as { checked?: boolean } | null)?.checked === true }) },
    heading: { block: 'heading', getAttrs: (tok) => ({ level: Math.min(6, Number(tok.tag.slice(1)) || 1) }) },
    code_block: { block: 'codeBlock', noCloseToken: true },
    fence: { block: 'codeBlock', getAttrs: (tok) => ({ language: tok.info.trim().split(/\s+/)[0] || null }), noCloseToken: true },
    hr: { node: 'horizontalRule' },
    hardbreak: { node: 'hardBreak' },
    image_block: { node: 'image', getAttrs: (tok) => tok.meta as Record<string, unknown> },
    spreadsheet: { node: 'spreadsheet', getAttrs: (tok) => ({ data: tok.meta }) },
    buffer: { node: 'buffer', getAttrs: (tok) => ({ data: tok.meta }) },
    plate: { node: 'plate', getAttrs: (tok) => ({ data: tok.meta }) },
    flow: { node: 'flow', getAttrs: (tok) => ({ data: tok.meta }) },
    attachment: { node: 'attachment', getAttrs: (tok) => tok.meta as Record<string, unknown> },
    include: { node: 'include', getAttrs: (tok) => tok.meta as Record<string, unknown> },
    raw_block: { node: 'rawBlock', getAttrs: (tok) => ({ content: tok.content }) },
    raw_inline: { node: 'rawInline', getAttrs: (tok) => ({ content: tok.content }) },
    em: { mark: 'italic' },
    strong: { mark: 'bold' },
    s: { mark: 'strike' },
    sub: { mark: 'subscript' },
    sup: { mark: 'superscript' },
    mark: { mark: 'highlight' },
    u: { mark: 'underline' },
    // Notebook-relative hrefs are kept decoded (like image sources); the serializer encodes them again.
    link: { mark: 'link', getAttrs: (tok) => ({ href: localHref(tok.attrGet('href') ?? ''), title: tok.attrGet('title') || null }) },
    code_inline: { mark: 'code', noCloseToken: true },
  });
  return parser;
}

/** Parse a Markdown body (without front matter) into a ProseMirror document. */
export function parseMarkdown(markdown: string): PMNode {
  const doc = getParser().parse(markdown);
  return doc ?? docSchema().topNodeType.createAndFill()!;
}
