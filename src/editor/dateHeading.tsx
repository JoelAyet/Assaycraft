/**
 * Day headings (/day, "2026-10-28 · Wednesday"): their date is a button. Clicking it opens a small
 * calendar, and the day picked rewrites the heading, weekday included.
 */
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration } from '@tiptap/pm/view';
import { rescanChanged, scanAll } from './incremental';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Popover, openDialog } from '../ui/overlay';
import { MiniCalendar } from '../ui/MiniCalendar';
import { dateHeadingText } from './datePrompts';

const DAY_HEADING = /^(\d{4}-\d{2}-\d{2}) · [A-Za-z]+$/;

/** Headings are top-level blocks: the chip of the one at `pos`, if it is a day heading. */
function scanBlock(node: PMNode, pos: number): Decoration[] {
  if (node.type.name !== 'heading') return [];
  const m = DAY_HEADING.exec(node.textContent);
  return m ? [Decoration.inline(pos + 1, pos + 1 + m[1].length, { class: 'gc-date-chip', 'data-date': m[1], title: 'Change the day' })] : [];
}

function pickDay(editor: Editor, pos: number, date: string, anchor: DOMRect) {
  openDialog((close) => (
    <Popover anchor={anchor} onClose={close}>
      <MiniCalendar
        value={date}
        label="Day of this heading"
        onPick={(ymd) => {
          close();
          const node = editor.state.doc.nodeAt(pos);
          if (!node || node.type.name !== 'heading' || !DAY_HEADING.test(node.textContent)) return;
          editor
            .chain()
            .focus()
            .insertContentAt({ from: pos + 1, to: pos + 1 + node.content.size }, dateHeadingText(ymd))
            .run();
        }}
      />
    </Popover>
  ));
}

export const DateHeading = Extension.create({
  name: 'dateHeading',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('dateHeading'),
        state: {
          init: (_, { doc }) => scanAll(doc, scanBlock),
          apply: (tr, old) => rescanChanged(tr, old, scanBlock),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
          handleDOMEvents: {
            mousedown(view, event) {
              const chip = (event.target as HTMLElement).closest?.('.gc-date-chip') as HTMLElement | null;
              if (!chip || !view.editable || event.button !== 0) return false;
              event.preventDefault();
              const inside = view.posAtDOM(chip, 0);
              const $pos = view.state.doc.resolve(inside);
              const heading = $pos.depth > 0 ? $pos.before($pos.depth) : inside - 1;
              pickDay(editor, heading, chip.dataset.date!, chip.getBoundingClientRect());
              return true;
            },
          },
        },
      }),
    ];
  },
});
