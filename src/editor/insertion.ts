import type { Editor, JSONContent } from '@tiptap/core';

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

/** Insert blocks at the right place and leave the cursor after them. */
export function insertBlocks(editor: Editor, content: JSONContent | JSONContent[]) {
  const at = insertionPoint(editor);
  points.delete(editor);
  if (at !== undefined) return editor.chain().insertContentAt(at, content).focus().scrollIntoView().run();
  return editor.chain().focus().insertContent(content).scrollIntoView().run();
}
