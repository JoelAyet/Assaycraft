// The writing experience: the "/" search, decorations kept up to date block by block, and views
// that saving the page being written does not redraw (audit of 21 November).
import { describe, expect, it } from 'vitest';
import { Schema, type Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { Decoration, type DecorationSet } from '@tiptap/pm/view';
import { blockCommands, filterCommands } from '../../src/editor/commands';
import { rescanChanged, scanAll } from '../../src/editor/incremental';
import { sameDocs } from '../../src/notebook/useDocs';
import type { DocMeta } from '../../src/notebook/model';

const noop = () => {};
const commands = blockCommands(
  { attachFiles: noop, insertSubtemplate: noop, insertProtocol: noop, linkEntry: noop, linkStock: noop, cite: noop },
  { inTemplate: false },
);
const titles = (q: string) => filterCommands(commands, q).map((c) => c.title);

describe('the "/" search', () => {
  it('lists every block for an empty search', () => {
    expect(titles('')).toHaveLength(commands.length);
  });

  it('puts titles that start with what is typed first', () => {
    expect(titles('ta')[0]).toBe('Table');
    expect(titles('h2')[0]).toBe('Heading 2');
    expect(titles('buf')[0]).toBe('Buffer');
    expect(titles('num')[0]).toBe('Numbered list');
  });

  it('finds blocks by the start of their keywords and words', () => {
    expect(titles('pcr')).toContain('Plate layout');
    expect(titles('list')).toEqual(expect.arrayContaining(['Bulleted list', 'Numbered list']));
    expect(titles('1.')).toContain('Numbered list');
  });

  it('does not match letters inside other words', () => {
    // "horizontal" and "citation" hold "ta"; neither block is about tables.
    expect(titles('ta')).not.toContain('Divider');
    expect(titles('ta')).not.toContain('Quote');
    expect(titles('xqz')).toEqual([]);
  });

  it('shows the typed shortcut of the basic blocks', () => {
    const hint = (id: string) => commands.find((c) => c.id === id)?.hint;
    expect([hint('h1'), hint('h2'), hint('h3'), hint('bullet'), hint('ordered'), hint('task'), hint('quote'), hint('divider')]).toEqual([
      '#',
      '##',
      '###',
      '-',
      '1.',
      '[]',
      '>',
      '---',
    ]);
    expect(hint('table')).toBeUndefined();
  });
});

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    list: { group: 'block', content: 'paragraph+' },
    text: {},
  },
});

/** Marks {{variables}}, as the editor does. */
function scan(block: PMNode, at: number): Decoration[] {
  const out: Decoration[] = [];
  block.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.text!.matchAll(/\{\{[^{}]+\}\}/g))
      out.push(Decoration.inline(at + 1 + pos + m.index!, at + 1 + pos + m.index! + m[0].length, {}));
  });
  return out;
}
const spans = (set: DecorationSet, doc: PMNode) =>
  set
    .find(0, doc.content.size)
    .map((d) => `${d.from}-${d.to}`)
    .sort();

/** A random number generator that always gives the same numbers. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

describe('decorations looked at again block by block', () => {
  it.each([7, 11, 23, 42, 99])('always match looking at the whole page, whatever is typed, cut or pasted (run %i)', (seed) => {
    const p = (t: string) => schema.node('paragraph', null, t ? [schema.text(t)] : []);
    let state = EditorState.create({
      schema,
      doc: schema.node('doc', null, [p('Add {{Volume}} of buffer'), schema.node('list', null, [p('{{A}} and {{B}}'), p('plain')]), p('end {{C}}')]),
    });
    let set = scanAll(state.doc, scan);
    const rand = rng(seed);
    const pieces = ['{{', '}}', 'x', ' ', '{{Temp}}', 'ab', '}'];
    for (let i = 0; i < 800; i++) {
      const size = state.doc.content.size;
      const tr = state.tr;
      const r = rand();
      const at = Math.floor(rand() * size);
      const $at = state.doc.resolve(at);
      if (r < 0.6 && $at.parent.isTextblock) tr.insertText(pieces[Math.floor(rand() * pieces.length)], at);
      else if (r < 0.8) {
        const to = Math.min(size, at + 1 + Math.floor(rand() * 6));
        tr.setSelection(TextSelection.create(state.doc, Math.max(1, Math.min(at, size - 1)))).deleteRange(at, to);
      } else if (r < 0.9) tr.insert(Math.min(size, state.doc.resolve(at).after(1)), p(rand() < 0.5 ? '{{New}} line' : 'new line'));
      else if ($at.parent.isTextblock) tr.split(at);
      if (!tr.docChanged) continue;
      set = rescanChanged(tr, set, scan);
      state = state.apply(tr);
      expect(spans(set, state.doc)).toEqual(spans(scanAll(state.doc, scan), state.doc));
    }
  });

  it('keep the same decorations when the change was only the cursor', () => {
    const state = EditorState.create({ schema, doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('{{X}}')])]) });
    const set = scanAll(state.doc, scan);
    expect(rescanChanged(state.tr.setSelection(TextSelection.create(state.doc, 2)), set, scan)).toBe(set);
  });
});

describe('views that a save of the page does not redraw', () => {
  const doc = (path: string, extra: Partial<DocMeta> = {}): DocMeta =>
    ({ path, id: path, title: path, kind: 'entry', mtime: 1, ...extra }) as DocMeta;
  const before = { a: doc('a', { text: 'one', modified: '2026-11-21T10:00:00+01:00' }), b: doc('b') };

  it('see the same pages when only the saved page’s text and save time changed', () => {
    const after = { ...before, a: { ...before.a, text: 'one two', mtime: 2, modified: '2026-11-21T10:00:05+01:00', preview: ['one two'] } };
    expect(sameDocs(before, after, 'a')).toBe(true);
    expect(sameDocs(before, after, true)).toBe(true);
  });

  it('see what a save read from the text only when it is different', () => {
    const flow = [{ title: 'Expression', path: 'p/1.md' }] as unknown as DocMeta['flow'];
    const withFlow = { ...before, a: { ...before.a, flow } };
    // Made anew by the save, the same steps.
    expect(sameDocs(withFlow, { ...withFlow, a: { ...withFlow.a, flow: JSON.parse(JSON.stringify(flow)), mtime: 9 } }, true)).toBe(true);
    // A step added: the sidebar shows it under the plan.
    expect(sameDocs(withFlow, { ...withFlow, a: { ...withFlow.a, flow: [...flow!, { title: 'Purification' }] as DocMeta['flow'] } }, true)).toBe(
      false,
    );
    // A box checked: boards show the count.
    expect(sameDocs(before, { ...before, a: { ...before.a, tasks: { done: 1, total: 2 } } }, true)).toBe(false);
  });

  it('see a change to anything else', () => {
    expect(sameDocs(before, { ...before, a: { ...before.a, title: 'renamed' } }, 'a')).toBe(false);
    expect(sameDocs(before, { ...before, a: { ...before.a, status: 'completed' } }, true)).toBe(false);
    // Another page saved: views of this page show it (recent pages, links).
    expect(sameDocs(before, { ...before, b: { ...before.b, mtime: 5 } }, 'a')).toBe(false);
    expect(sameDocs(before, { a: before.a }, true)).toBe(false);
  });
});
