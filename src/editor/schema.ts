/**
 * Document schema shared by the editor and the Markdown converter.
 * Node views (React UI) are attached separately in editor/extensions.ts.
 */
import { Node, getSchema, type Extensions, type NodeViewRenderer } from '@tiptap/core';
import type { DOMOutputSpec } from '@tiptap/pm/model';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { Highlight } from '@tiptap/extension-highlight';
import { evaluateSheet } from '../sheet/formula';
import { normalizeSheet, type SheetData } from '../sheet/model';
import { toDelimited } from '../sheet/tsv';
import { bufferTable, normalizeBuffer, type BufferData } from '../buffer/calc';
import { normalizePlate, plateTable, type PlateData } from '../plate/model';
import { normalizeFlow, type FlowData } from '../flow/model';

// ───────────── Spreadsheet (Excel-like table) ─────────────

function tableElementToSheet(table: HTMLElement): SheetData {
  const json = table.getAttribute('data-sheet');
  if (json) {
    try {
      return normalizeSheet(JSON.parse(json) as SheetData);
    } catch {
      /* fall through */
    }
  }
  const rows: string[][] = [];
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    if (tr.closest('table') !== table) continue;
    const row: string[] = [];
    for (const cell of Array.from(tr.children)) {
      if (cell.tagName !== 'TD' && cell.tagName !== 'TH') continue;
      cell.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
      row.push((cell.textContent ?? '').replace(/ /g, ' ').trim());
      const span = Math.min(50, parseInt(cell.getAttribute('colspan') || '1', 10) || 1);
      for (let i = 1; i < span; i++) row.push('');
    }
    rows.push(row);
  }
  return normalizeSheet({ rows });
}

function sheetToDom(data: SheetData): DOMOutputSpec {
  const d = normalizeSheet(data);
  const display = evaluateSheet(d.rows);
  const body = display.map((row, r) => ['tr', {}, ...row.map((v) => [r === 0 ? 'th' : 'td', {}, v])]);
  return ['table', { 'data-type': 'spreadsheet', 'data-sheet': JSON.stringify(d) }, ['tbody', {}, ...body]] as DOMOutputSpec;
}

export const Spreadsheet = Node.create({
  name: 'spreadsheet',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  isolating: true,
  addAttributes() {
    return {
      data: {
        default: null,
        parseHTML: (el) => tableElementToSheet(el as HTMLElement),
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'table', priority: 60 }];
  },
  renderHTML({ node }) {
    return sheetToDom(node.attrs.data as SheetData);
  },
  renderText({ node }) {
    const d = normalizeSheet(node.attrs.data as SheetData);
    return toDelimited(evaluateSheet(d.rows));
  },
});

// ───────────── Buffer / dilution calculator ─────────────

export const Buffer = Node.create({
  name: 'buffer',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  isolating: true,
  addAttributes() {
    return {
      data: {
        default: null,
        parseHTML: (el) => {
          try {
            return normalizeBuffer(JSON.parse((el as HTMLElement).getAttribute('data-buffer') || 'null') as BufferData);
          } catch {
            return normalizeBuffer(null);
          }
        },
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-buffer]' }];
  },
  renderHTML({ node }) {
    const d = normalizeBuffer(node.attrs.data as BufferData);
    const rows = bufferTable(d).map((row, r) => ['tr', {}, ...row.map((v) => [r === 0 ? 'th' : 'td', {}, v])]);
    return ['div', { 'data-buffer': JSON.stringify(d) }, ['table', {}, ['tbody', {}, ...rows]]] as DOMOutputSpec;
  },
  renderText({ node }) {
    return toDelimited(bufferTable(normalizeBuffer(node.attrs.data as BufferData)));
  },
});

// ───────────── Plate layout (which sample is in which well) ─────────────

export const Plate = Node.create({
  name: 'plate',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  isolating: true,
  addAttributes() {
    return {
      data: {
        default: null,
        parseHTML: (el) => {
          try {
            return normalizePlate(JSON.parse((el as HTMLElement).getAttribute('data-plate') || 'null') as PlateData);
          } catch {
            return normalizePlate(null);
          }
        },
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-plate]' }];
  },
  renderHTML({ node }) {
    const d = normalizePlate(node.attrs.data as PlateData);
    const rows = plateTable(d).map((row, r) => ['tr', {}, ...row.map((v, c) => [r === 0 || c === 0 ? 'th' : 'td', {}, v])]);
    return ['div', { 'data-plate': JSON.stringify(d) }, ['table', {}, ['tbody', {}, ...rows]]] as DOMOutputSpec;
  },
  renderText({ node }) {
    return toDelimited(plateTable(normalizePlate(node.attrs.data as PlateData)));
  },
});

// ───────────── Flow (a planned series of experiments) ─────────────

export const Flow = Node.create({
  name: 'flow',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  isolating: true,
  addAttributes() {
    return {
      data: {
        default: null,
        parseHTML: (el) => {
          try {
            return normalizeFlow(JSON.parse((el as HTMLElement).getAttribute('data-flow') || 'null') as FlowData);
          } catch {
            return normalizeFlow(null);
          }
        },
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-flow]' }];
  },
  renderHTML({ node }) {
    const d = normalizeFlow(node.attrs.data as FlowData);
    const items = d.steps.map((s) => ['li', {}, s.ref ? `${s.ref} ${s.title}` : s.title || 'Untitled step']);
    return ['div', { 'data-flow': JSON.stringify(d) }, ['ol', {}, ...items]] as DOMOutputSpec;
  },
  renderText({ node }) {
    return normalizeFlow(node.attrs.data as FlowData)
      .steps.map((s, i) => `${i + 1}. ${s.ref ? `${s.ref} ` : ''}${s.title}`)
      .join('\n');
  },
});

// ───────────── File attachment ─────────────

export const Attachment = Node.create({
  name: 'attachment',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: '' },
      name: { default: '' },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-attachment]',
        getAttrs: (el) => ({ src: (el as HTMLElement).getAttribute('data-src') ?? '', name: (el as HTMLElement).getAttribute('data-name') ?? '' }),
      },
    ];
  },
  renderHTML({ node }) {
    const { src, name } = node.attrs as { src: string; name: string };
    return ['div', { 'data-attachment': '', 'data-src': src, 'data-name': name }, ['a', { href: src }, name || src]];
  },
  renderText({ node }) {
    return `[${node.attrs.name || node.attrs.src}]`;
  },
});

// ───────────── Image (block) ─────────────

export const ImageBlock = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
      title: { default: null },
      width: { default: null },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'img[src]',
        getAttrs: (el) => {
          const img = el as HTMLImageElement;
          const src = img.getAttribute('data-src') || img.getAttribute('src') || '';
          return { src, alt: img.getAttribute('alt') ?? '', title: img.getAttribute('title'), width: img.getAttribute('width') };
        },
      },
    ];
  },
  renderHTML({ node }) {
    const { src, alt, title, width } = node.attrs as Record<string, string | null>;
    const attrs: Record<string, string> = { src: src ?? '', 'data-src': src ?? '', alt: alt ?? '' };
    if (title) attrs.title = title;
    if (width) attrs.width = width;
    return ['img', attrs];
  },
  renderText({ node }) {
    return node.attrs.alt ? `[image: ${node.attrs.alt}]` : '[image]';
  },
});

// ───────────── Sub-template reference (only meaningful inside templates) ─────────────

export const Include = Node.create({
  name: 'include',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      ref: { default: '' },
      name: { default: '' },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-include]',
        getAttrs: (el) => ({
          ref: (el as HTMLElement).getAttribute('data-include') ?? '',
          name: (el as HTMLElement).getAttribute('data-name') ?? '',
        }),
      },
    ];
  },
  renderHTML({ node }) {
    return ['div', { 'data-include': node.attrs.ref, 'data-name': node.attrs.name }, `Sub-template: ${node.attrs.name}`];
  },
  renderText({ node }) {
    return `[Sub-template: ${node.attrs.name}]`;
  },
});

// ───────────── Raw HTML / unknown Markdown, kept verbatim ─────────────

export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { content: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-raw-block]', getAttrs: (el) => ({ content: (el as HTMLElement).getAttribute('data-content') ?? '' }) }];
  },
  renderHTML({ node }) {
    return ['div', { 'data-raw-block': '', 'data-content': node.attrs.content }, ['pre', {}, node.attrs.content]];
  },
  renderText({ node }) {
    return node.attrs.content;
  },
});

export const RawInline = Node.create({
  name: 'rawInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { content: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-raw-inline]', getAttrs: (el) => ({ content: (el as HTMLElement).getAttribute('data-content') ?? '' }) }];
  },
  renderHTML({ node }) {
    return ['span', { 'data-raw-inline': '', 'data-content': node.attrs.content, class: 'raw-inline' }, node.attrs.content];
  },
  renderText({ node }) {
    return node.attrs.content;
  },
});

export type NodeViewKey = 'spreadsheet' | 'buffer' | 'plate' | 'flow' | 'attachment' | 'image' | 'include' | 'rawBlock';
export type NodeViews = Partial<Record<NodeViewKey, () => NodeViewRenderer>>;

/** Extensions that define the document schema. Node views (UI) can be attached by the editor. */
export function schemaExtensions(views: NodeViews = {}): Extensions {
  const v = <T extends Node>(node: T, key: NodeViewKey): T => {
    const view = views[key];
    return view ? (node.extend({ addNodeView: view }) as T) : node;
  };
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      },
      codeBlock: { HTMLAttributes: { spellcheck: 'false' } },
      dropcursor: { color: 'var(--accent)', width: 2 },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Subscript,
    Superscript,
    Highlight,
    v(Spreadsheet, 'spreadsheet'),
    v(Buffer, 'buffer'),
    v(Plate, 'plate'),
    v(Flow, 'flow'),
    v(Attachment, 'attachment'),
    v(ImageBlock, 'image'),
    v(Include, 'include'),
    v(RawBlock, 'rawBlock'),
    RawInline,
  ];
}

let cachedSchema: ReturnType<typeof getSchema> | null = null;
export function docSchema() {
  cachedSchema ??= getSchema(schemaExtensions());
  return cachedSchema;
}
