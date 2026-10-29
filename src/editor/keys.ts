import { Extension } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';

/** The list item the cursor is in, the innermost one (a bulleted item inside a checklist item, say). */
function listItemType($pos: ResolvedPos): string | null {
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name;
    if (name === 'listItem' || name === 'taskItem') return name;
  }
  return null;
}

/**
 * Tab and Shift+Tab in lists always nest and un-nest the item the cursor is in, whatever kind of
 * list it is. Where it cannot (the first item of a list has nothing to nest under), Tab does nothing
 * rather than moving the focus out of the page.
 */
export const ListIndent = Extension.create({
  name: 'listIndent',
  priority: 200,
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const type = listItemType(this.editor.state.selection.$from);
        if (!type) return false;
        this.editor.commands.sinkListItem(type);
        return true;
      },
      'Shift-Tab': () => {
        const type = listItemType(this.editor.state.selection.$from);
        if (!type) return false;
        this.editor.commands.liftListItem(type);
        return true;
      },
    };
  },
});
