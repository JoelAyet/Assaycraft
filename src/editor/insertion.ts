import type { Editor, JSONContent } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';

/**
 * Where toolbar/menu insertions should go when the text cursor is not active, e.g. right after
 * the table the user was just working in, or at the end of a document that was never clicked.
 */
const points = new WeakMap<Editor, number>();
const touched = new WeakSet<Editor>();

export function trackEditorFocus(editor: Editor) {
  const onFocus = () => {
    touched.add(editor);
    points.delete(editor);
  };
  editor.on('focus', onFocus);
  return () => {
    editor.off('focus', onFocus);
  };
}

export function rememberInsertionPoint(editor: Editor, pos: number) {
  touched.add(editor);
  points.set(editor, pos);
}

/** Position to insert block content at, or undefined to use the current selection. */
export function insertionPoint(editor: Editor): number | undefined {
  if (editor.isFocused) return undefined;
  const p = points.get(editor);
  const size = editor.state.doc.content.size;
  if (p !== undefined) return Math.min(p, size);
  if (!touched.has(editor)) return size;
  return undefined;
}

/**
 * Insert blocks at the right place and leave the cursor after them. A block that is selected (the
 * picture just added, a table clicked) stays: what is inserted goes after it, not in its place.
 */
export function insertBlocks(editor: Editor, content: JSONContent | JSONContent[]) {
  const at = insertionPoint(editor) ?? (editor.state.selection instanceof NodeSelection ? editor.state.selection.to : undefined);
  points.delete(editor);
  const done =
    at !== undefined
      ? editor.chain().insertContentAt(at, content).focus().scrollIntoView().run()
      : editor.chain().focus().insertContent(content).scrollIntoView().run();
  leaveBlock(editor);
  return done;
}

/**
 * A block just put in (a flow, a picture, a plate) is left selected by the editor: a key typed then
 * (before the block's own field has focus, on a busy computer) would replace it. The cursor goes
 * to the line after it instead, made if there is none.
 */
function leaveBlock(editor: Editor) {
  const { state } = editor;
  const sel = state.selection;
  if (!(sel instanceof NodeSelection) || !sel.node.isBlock || !sel.node.isAtom) return;
  const after = sel.to;
  const next = state.doc.resolve(after).nodeAfter;
  const tr = state.tr;
  if (!next || !next.isTextblock) tr.insert(after, state.schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.create(tr.doc, after + 1));
  editor.view.dispatch(tr.scrollIntoView());
}
