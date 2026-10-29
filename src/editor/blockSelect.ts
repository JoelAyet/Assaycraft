/**
 * Block selection, to delete, cut or copy whole blocks (paragraphs, tables, images, buffers…)
 * together: drag from anywhere around the text and a light-blue box selects the blocks it touches;
 * or drag from inside the text into another block.
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

/** The top-level block holding `pos`, or the nearest one. */
function blockAt(view: EditorView, pos: number): Range | null {
  const { doc } = view.state;
  const $p = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  if ($p.depth > 0) return { from: $p.before(1), to: $p.after(1) };
  const after = doc.childAfter($p.pos);
  if (after.node) return { from: after.offset, to: after.offset + after.node.nodeSize };
  const before = doc.childBefore($p.pos);
  return before.node ? { from: before.offset, to: before.offset + before.node.nodeSize } : null;
}

export const BlockSelect = Extension.create({
  name: 'blockSelect',
  // Before the editor's own keys, so Delete removes the selected blocks rather than a letter.
  priority: 1000,
  addProseMirrorPlugins() {
    // A drag that starts in the text and reaches another block selects whole blocks (as in Notion);
    // while it lasts, the text selection the browser keeps changing does not end it.
    let crossing = false;
    const startCrossing = (view: EditorView, event: MouseEvent) => {
      if (event.button !== 0 || event.shiftKey || !view.editable) return;
      const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
      const first = at && blockAt(view, at.pos);
      if (!first) return;
      const move = (e: MouseEvent) => {
        const here = view.posAtCoords({ left: e.clientX, top: e.clientY });
        // Past the end of the text: the last block.
        const block = here
          ? blockAt(view, here.pos)
          : e.clientY > view.dom.getBoundingClientRect().bottom
            ? blockAt(view, view.state.doc.content.size)
            : null;
        if (!block || (!crossing && block.from === first.from)) return;
        if (!crossing) {
          crossing = true;
          view.dom.classList.add('is-block-dragging');
        }
        window.getSelection()?.removeAllRanges();
        const range = { from: Math.min(first.from, block.from), to: Math.max(first.to, block.to) };
        const cur = blockSelectKey.getState(view.state);
        if (!cur || cur.from !== range.from || cur.to !== range.to) view.dispatch(view.state.tr.setMeta(blockSelectKey, range));
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        if (!crossing) return;
        const range = blockSelectKey.getState(view.state);
        crossing = false;
        view.dom.classList.remove('is-block-dragging');
        // After the browser's last word on the selection.
        setTimeout(() => {
          if (!range) return;
          const tr = view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(range.from + 1))).setMeta(blockSelectKey, range);
          view.dispatch(tr);
        });
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };
    return [
      new Plugin<Range | null>({
        key: blockSelectKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(blockSelectKey) as Range | null | undefined;
            if (meta !== undefined) return meta;
            if (!value) return null;
            if (tr.docChanged) return null;
            // Any cursor move ends it, except the browser's own while a drag crosses blocks.
            if (tr.selectionSet && !crossing) return null;
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
            mousedown: (view, event) => {
              if (selectedRange(view)) view.dispatch(view.state.tr.setMeta(blockSelectKey, null));
              startCrossing(view, event);
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
