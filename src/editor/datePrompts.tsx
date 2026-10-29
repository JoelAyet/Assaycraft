/** /day and /reminder: both insert at once, for today; the date is then changed where it shows. */
import type { Editor, JSONContent } from '@tiptap/core';
import { LOCALE, localDate } from '../lib/dates';
import { insertBlocks } from './insertion';

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const weekday = (ymd: string) => parseYmd(ymd).toLocaleDateString(LOCALE, { weekday: 'long' });

/** The heading /day inserts: "2026-10-28 · Wednesday", always in English. */
export function dateHeadingText(ymd: string): string {
  return `${ymd} · ${weekday(ymd)}`;
}

/** /day: a heading for today. Click its date to pick another day (dateHeading.tsx). */
export function insertDateHeading(editor: Editor, ymd = localDate()) {
  insertBlocks(editor, [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: dateHeadingText(ymd) }] }, { type: 'paragraph' }]);
}

/** The reminder just inserted opens its date and time when it appears (ReminderView). */
let openRequested = 0;
export const reminderOpenRequested = () => Date.now() - openRequested < 1500;
export function reminderOpened() {
  openRequested = 0;
}

/**
 * /reminder: a reminder for today. On a line with words it goes at the end of the line; otherwise it
 * starts a checklist line, with the cursor before it to write what to do. Its date and time open
 * right away, as on an entry's Date and Time.
 */
export function insertReminder(editor: Editor) {
  const chip: JSONContent = { type: 'reminder', attrs: { date: localDate(), time: null } };
  const { $from } = editor.state.selection;
  const text = $from.parent.textContent;
  openRequested = Date.now();
  if (text.trim()) {
    editor
      .chain()
      .focus()
      .insertContentAt($from.end(), text.endsWith(' ') ? [chip] : [{ type: 'text', text: ' ' }, chip])
      .run();
    return;
  }
  if ($from.node(-1)?.type.name === 'taskItem') editor.chain().focus().insertContent(chip).run();
  else
    insertBlocks(editor, {
      type: 'taskList',
      content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [chip] }] }],
    });
  // The cursor goes before the reminder, to type what it is for.
  const head = editor.state.selection.from;
  let before: number | null = null;
  editor.state.doc.nodesBetween(Math.max(0, head - 4), head, (node, pos) => {
    if (node.type.name === 'reminder') before = pos;
  });
  if (before !== null) editor.commands.setTextSelection(before);
}
