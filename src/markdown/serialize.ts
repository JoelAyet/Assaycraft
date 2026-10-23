/** Editor document → Markdown (see parse.ts for the conventions). */
import { MarkdownSerializer, defaultMarkdownSerializer, type MarkdownSerializerState } from 'prosemirror-markdown';
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { evaluateSheet, isFormula } from '../sheet/formula';
import { cellName } from '../sheet/refs';
import { isNumericText, normalizeSheet, type SheetData } from '../sheet/model';
import { encodeLinkPath, isRelativeFileLink, splitFragment } from '../lib/path';
import { bufferMeta, bufferTable, normalizeBuffer, type BufferData } from '../buffer/calc';
import { normalizePlate, plateMeta, plateTable, type PlateData } from '../plate/model';
import { flowToMarkdown, type FlowData } from '../flow/model';

/** JSON that is safe inside an HTML comment (no "--"). */
export function commentJson(value: unknown): string {
  return JSON.stringify(value).replace(/--/g, '-\\u002d');
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escLinkText(s: string): string {
  return s.replace(/[\\[\]]/g, '\\$&');
}

function linkDest(src: string): string {
  if (isRelativeFileLink(src)) return encodeLinkPath(src);
  return src.replace(/[ <>]/g, (c) => encodeURIComponent(c)).replace(/[()]/g, '\\$&');
}

function hrefDest(href: string): string {
  if (!isRelativeFileLink(href)) return linkDest(href);
  const [path, fragment] = splitFragment(href);
  return encodeLinkPath(path) + fragment;
}

function escCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

export function sheetToMarkdown(input: SheetData): string {
  const data = normalizeSheet(input);
  const display = evaluateSheet(data.rows);
  const formulas: Record<string, string> = {};
  data.rows.forEach((row, r) =>
    row.forEach((raw, c) => {
      if (isFormula(raw)) formulas[cellName(r, c)] = raw;
    }),
  );
  const meta: Record<string, unknown> = {};
  if (Object.keys(formulas).length) meta.f = formulas;
  if (data.widths?.some((w) => w != null)) meta.w = data.widths.map((w) => w ?? null);

  const cols = data.rows[0].length;
  const numeric = Array.from({ length: cols }, (_, c) => {
    const vals = display
      .slice(1)
      .map((r) => r[c])
      .filter((v) => v !== '');
    return vals.length > 0 && vals.every(isNumericText);
  });
  const line = (cells: string[]) => '| ' + cells.map((v) => escCell(v) || ' ').join(' | ') + ' |';
  const lines: string[] = [];
  if (Object.keys(meta).length) lines.push(`<!-- gc:table ${commentJson(meta)} -->`);
  lines.push(line(display[0]));
  lines.push('| ' + numeric.map((n) => (n ? '---:' : '---')).join(' | ') + ' |');
  for (const row of display.slice(1)) lines.push(line(row));
  return lines.join('\n');
}

/** A buffer: its settings in a comment, then a plain table with the amounts to add. */
export function bufferToMarkdown(input: BufferData): string {
  const d = normalizeBuffer(input);
  const rows = bufferTable(d);
  const line = (cells: string[]) => '| ' + cells.map((v) => escCell(v) || ' ').join(' | ') + ' |';
  return [`<!-- gc:buffer ${commentJson(bufferMeta(d))} -->`, line(rows[0]), '| --- | ---: | ---: | ---: |', ...rows.slice(1).map(line)].join('\n');
}

/** A plate layout: its name, format and samples in a comment, then the plate as a table (a cell per well). */
export function plateToMarkdown(input: PlateData): string {
  const d = normalizePlate(input);
  const rows = plateTable(d);
  const line = (cells: string[]) => '| ' + cells.map((v) => escCell(v) || ' ').join(' | ') + ' |';
  return [
    `<!-- gc:plate ${commentJson(plateMeta(d))} -->`,
    line(rows[0]),
    '| ' + rows[0].map(() => '---').join(' | ') + ' |',
    ...rows.slice(1).map(line),
  ].join('\n');
}

type NodeFn = (state: MarkdownSerializerState, node: PMNode, parent: PMNode, index: number) => void;

const nodes: Record<string, NodeFn> = {
  paragraph(state, node, parent, index) {
    if (node.childCount === 0 && parent.type.name === 'doc') {
      // Markdown has no empty paragraph: an empty line left between others (Enter pressed twice) is kept
      // as <br>, so it reaches the other device and shows in other Markdown viewers. Empty lines at the end are not.
      for (let i = index + 1; i < parent.childCount; i++)
        if (parent.child(i).type !== node.type || parent.child(i).childCount > 0) {
          state.write('<br>');
          break;
        }
    } else state.renderInline(node);
    state.closeBlock(node);
  },
  heading(state, node) {
    state.write(state.repeat('#', node.attrs.level as number) + ' ');
    state.renderInline(node, false);
    state.closeBlock(node);
  },
  blockquote(state, node) {
    state.wrapBlock('> ', null, node, () => state.renderContent(node));
  },
  codeBlock(state, node) {
    const backticks = node.textContent.match(/`{3,}/gm);
    const fence = backticks ? backticks.sort().slice(-1)[0] + '`' : '```';
    state.write(fence + ((node.attrs.language as string | null) || '') + '\n');
    state.text(node.textContent, false);
    state.write('\n');
    state.write(fence);
    state.closeBlock(node);
  },
  horizontalRule(state, node) {
    state.write('---');
    state.closeBlock(node);
  },
  bulletList(state, node) {
    state.renderList(node, '  ', () => '- ');
  },
  orderedList(state, node) {
    const start = (node.attrs.start as number) || 1;
    const maxW = String(start + node.childCount - 1).length;
    const space = state.repeat(' ', maxW + 2);
    state.renderList(node, space, (i) => {
      const n = String(start + i);
      return state.repeat(' ', maxW - n.length) + n + '. ';
    });
  },
  listItem(state, node) {
    state.renderContent(node);
  },
  taskList(state, node) {
    state.renderList(node, '  ', () => '- ');
  },
  taskItem(state, node) {
    state.write(node.attrs.checked ? '[x] ' : '[ ] ');
    state.renderContent(node);
  },
  hardBreak(state, node, parent, index) {
    for (let i = index + 1; i < parent.childCount; i++) {
      if (parent.child(i).type !== node.type) {
        state.write('\\\n');
        return;
      }
    }
  },
  text(state, node) {
    defaultMarkdownSerializer.nodes.text(state, node, node, 0);
  },
  image(state, node) {
    const { src, alt, title, width } = node.attrs as { src: string; alt: string; title: string | null; width: string | null };
    if (width) {
      const href = isRelativeFileLink(src) ? encodeLinkPath(src) : src;
      state.write(
        `<img src="${escAttr(href)}" alt="${escAttr(alt || '')}"${title ? ` title="${escAttr(title)}"` : ''} width="${escAttr(String(width))}">`,
      );
    } else {
      const t = title ? ` "${title.replace(/"/g, '\\"')}"` : '';
      state.write(`![${state.esc(alt || '')}](${linkDest(src)}${t})`);
    }
    state.closeBlock(node);
  },
  spreadsheet(state, node) {
    state.text(sheetToMarkdown(node.attrs.data as SheetData), false);
    state.closeBlock(node);
  },
  buffer(state, node) {
    state.text(bufferToMarkdown(node.attrs.data as BufferData), false);
    state.closeBlock(node);
  },
  plate(state, node) {
    state.text(plateToMarkdown(node.attrs.data as PlateData), false);
    state.closeBlock(node);
  },
  flow(state, node) {
    state.text(flowToMarkdown(node.attrs.data as FlowData), false);
    state.closeBlock(node);
  },
  attachment(state, node) {
    const { src, name } = node.attrs as { src: string; name: string };
    state.write(`[${escLinkText(name || src.split('/').pop() || 'file')}](${linkDest(src)})`);
    state.closeBlock(node);
  },
  include(state, node) {
    state.write(`<!-- gc:include ${commentJson({ id: node.attrs.ref, name: node.attrs.name })} -->`);
    state.closeBlock(node);
  },
  rawBlock(state, node) {
    state.text(String(node.attrs.content ?? ''), false);
    state.closeBlock(node);
  },
  rawInline(state, node) {
    state.text(String(node.attrs.content ?? ''), false);
  },
};

const linkSpec = defaultMarkdownSerializer.marks.link;

const marks = {
  italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
  bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
  strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  underline: { open: '<u>', close: '</u>', mixable: true, expelEnclosingWhitespace: true },
  subscript: { open: '<sub>', close: '</sub>', mixable: true },
  superscript: { open: '<sup>', close: '</sup>', mixable: true },
  highlight: { open: '<mark>', close: '</mark>', mixable: true, expelEnclosingWhitespace: true },
  code: defaultMarkdownSerializer.marks.code,
  link: {
    open: linkSpec.open,
    close(state: MarkdownSerializerState, mark: Mark, parent: PMNode, index: number) {
      const s = state as MarkdownSerializerState & { inAutolink?: boolean };
      if (s.inAutolink) {
        s.inAutolink = undefined;
        return '>';
      }
      const href = hrefDest(String(mark.attrs.href ?? ''));
      const title = mark.attrs.title ? ` "${String(mark.attrs.title).replace(/"/g, '\\"')}"` : '';
      void parent;
      void index;
      return `](${href}${title})`;
    },
    mixable: true,
  },
};

const serializer = new MarkdownSerializer(nodes, marks, {
  escapeExtraCharacters: /<(?=[a-zA-Z/!?])/g,
  hardBreakNodeName: 'hardBreak',
});

/** Serialize a document body to Markdown (ends with a single newline). */
export function serializeMarkdown(doc: PMNode): string {
  const out = serializer.serialize(doc, { tightLists: true });
  const trimmed = out.replace(/\s+$/, '');
  return trimmed ? trimmed + '\n' : '';
}
