/**
 * Box selection: drag from the page's margin and a light-blue box selects the blocks it touches
 * (paragraphs, tables, images, buffers…), to delete, cut or copy them together.
 */
import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { useEffect } from 'react';

interface Range {
  from: number;
  to: number;
}

export const blockSelectKey = new PluginKey<Range | null>('blockSelect');

const selectedRange = (view: EditorView) => blockSelectKey.getState(view.state) ?? null;

export const BlockSelect = Extension.create({
  name: 'blockSelect',
  // Before the editor's own keys, so Delete removes the selected blocks rather than a letter.
  priority: 1000,
  addProseMirrorPlugins() {
    return [
      new Plugin<Range | null>({
        key: blockSelectKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(blockSelectKey) as Range | null | undefined;
            if (meta !== undefined) return meta;
            if (!value) return null;
            // Any edit or cursor move ends it.
            if (tr.docChanged || tr.selectionSet) return null;
            return value;
          },
        },
        props: {
          decorations(state) {
            const r = blockSelectKey.getState(state);
            if (!r) return null;
            const decos: Decoration[] = [];
            state.doc.forEach((node, offset) => {
              if (offset >= r.from && offset + node.nodeSize <= r.to)
                decos.push(Decoration.node(offset, offset + node.nodeSize, { class: 'gc-block-selected' }));
            });
            return DecorationSet.create(state.doc, decos);
          },
          handleKeyDown(view, event) {
            const r = selectedRange(view);
            if (!r) return false;
            if (event.key === 'Backspace' || event.key === 'Delete') {
              view.dispatch(view.state.tr.delete(r.from, r.to).setMeta(blockSelectKey, null).scrollIntoView());
              return true;
            }
            if (event.key === 'Escape') {
              view.dispatch(view.state.tr.setMeta(blockSelectKey, null));
              return true;
            }
            // Copy and cut go through the clipboard events below; any other key ends the selection.
            if ((event.metaKey || event.ctrlKey) && ['c', 'x', 'a'].includes(event.key.toLowerCase())) return false;
            view.dispatch(view.state.tr.setMeta(blockSelectKey, null));
            return false;
          },
          handleDOMEvents: {
            copy: (view, event) => copyBlocks(view, event, false),
            cut: (view, event) => copyBlocks(view, event, true),
            mousedown: (view) => {
              if (selectedRange(view)) view.dispatch(view.state.tr.setMeta(blockSelectKey, null));
              return false;
            },
          },
        },
      }),
    ];
  },
});

function copyBlocks(view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
  const r = selectedRange(view);
  if (!r || !event.clipboardData) return false;
  const slice = view.state.doc.slice(r.from, r.to);
  const { dom, text } = view.serializeForClipboard(slice);
  event.preventDefault();
  event.clipboardData.clearData();
  event.clipboardData.setData('text/html', dom.innerHTML);
  event.clipboardData.setData('text/plain', text);
  if (cut) view.dispatch(view.state.tr.delete(r.from, r.to).setMeta(blockSelectKey, null));
  return true;
}

/** Select the top-level blocks from..to (positions at block boundaries). */
export function selectBlocks(editor: Editor, range: Range | null) {
  const { view } = editor;
  const tr = view.state.tr;
  if (range) {
    // The text cursor goes to the start of the range, so typing elsewhere is not a surprise.
    tr.setSelection(TextSelection.near(view.state.doc.resolve(range.from + 1)));
  }
  tr.setMeta(blockSelectKey, range);
  view.dispatch(tr);
  if (range) view.focus();
}

/** Blocks whose box meets the rectangle (in viewport coordinates). */
function blocksIn(editor: Editor, rect: DOMRect): Range | null {
  const { view } = editor;
  let from = -1;
  let to = -1;
  view.state.doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset);
    if (!(dom instanceof HTMLElement)) return;
    const b = dom.getBoundingClientRect();
    if (b.bottom < rect.top || b.top > rect.bottom || b.right < rect.left || b.left > rect.right) return;
    if (from < 0) from = offset;
    to = offset + node.nodeSize;
  });
  return from < 0 ? null : { from, to };
}

const INTERACTIVE = 'button, a, input, textarea, select, label, [contenteditable="true"], .ProseMirror, .gc-props, .gc-toolbar-wrap, .gc-doc-index';

/**
 * Drag in the margins of `root` (the page around the text) to draw the box. Not on touch screens,
 * where a drag scrolls.
 */
export function useMarqueeSelect(editor: Editor | null, root: HTMLElement | null) {
  useEffect(() => {
    if (!editor || !root || !window.matchMedia('(pointer: fine)').matches) return;
    let box: HTMLDivElement | null = null;
    let start: { x: number; y: number } | null = null;
    const rectNow = (e: MouseEvent) =>
      new DOMRect(Math.min(start!.x, e.clientX), Math.min(start!.y, e.clientY), Math.abs(e.clientX - start!.x), Math.abs(e.clientY - start!.y));
    const move = (e: MouseEvent) => {
      if (!start) return;
      const r = rectNow(e);
      if (!box) {
        if (r.width < 6 && r.height < 6) return;
        box = document.createElement('div');
        box.className = 'gc-marquee';
        document.body.appendChild(box);
        document.body.classList.add('is-marquee');
      }
      Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      selectBlocks(editor, blocksIn(editor, r));
    };
    const up = () => {
      start = null;
      box?.remove();
      box = null;
      document.body.classList.remove('is-marquee');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    const down = (e: MouseEvent) => {
      if (e.button !== 0 || !editor.isEditable) return;
      const t = e.target as HTMLElement;
      if (t.closest(INTERACTIVE)) return;
      e.preventDefault();
      start = { x: e.clientX, y: e.clientY };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };
    root.addEventListener('mousedown', down);
    return () => {
      root.removeEventListener('mousedown', down);
      up();
    };
  }, [editor, root]);
}
