/** /day and /reminder: small windows that ask for a date (and a time) before inserting. */
import { useState } from 'react';
import type { Editor, JSONContent } from '@tiptap/core';
import { BellRing, CalendarDays } from 'lucide-react';
import { Dialog, openDialog } from '../ui/overlay';
import { LOCALE, localDate, parseTypedTime } from '../lib/dates';
import { insertBlocks } from './insertion';

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const shiftDay = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDate(d);
};
const weekday = (ymd: string) => parseYmd(ymd).toLocaleDateString(LOCALE, { weekday: 'long' });

/** The heading /day inserts: "2026-10-28 · Wednesday", always in English. */
export function dateHeadingText(ymd: string): string {
  return `${ymd} · ${weekday(ymd)}`;
}

export function insertDateHeading(editor: Editor, ymd = localDate()) {
  insertBlocks(editor, [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: dateHeadingText(ymd) }] }, { type: 'paragraph' }]);
}

function QuickDays({ value, onPick }: { value: string; onPick: (d: string) => void }) {
  const days: [string, string][] = [
    ['Yesterday', shiftDay(-1)],
    ['Today', shiftDay(0)],
    ['Tomorrow', shiftDay(1)],
  ];
  return (
    <div className="gc-quick-days" role="group" aria-label="Quick dates">
      {days.map(([label, d]) => (
        <button
          key={label}
          type="button"
          className={`btn btn-sm ${value === d ? 'is-picked' : ''}`}
          aria-pressed={value === d}
          onClick={() => onPick(d)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function DayDialog({ editor, close }: { editor: Editor; close: () => void }) {
  const [date, setDate] = useState(localDate());
  const insert = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    close();
    insertDateHeading(editor, date);
  };
  return (
    <Dialog
      title="Date heading"
      icon={<CalendarDays className="gc-dialog-icon" />}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={insert}>
            Insert {date === localDate() ? 'today' : 'date'}
          </button>
        </>
      }
    >
      <form
        className="gc-date-prompt"
        onSubmit={(e) => {
          e.preventDefault();
          insert();
        }}
      >
        <div className="field">
          <label htmlFor="gc-day-date">Day</label>
          <input id="gc-day-date" type="date" className="input" autoFocus value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <QuickDays value={date} onPick={setDate} />
        {/^\d{4}-\d{2}-\d{2}$/.test(date) && <p className="muted gc-date-preview">Inserts “{dateHeadingText(date)}”.</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** /day: a heading for a day of work, today unless another day is picked. */
export function openDayDialog(editor: Editor) {
  openDialog((close) => <DayDialog editor={editor} close={close} />);
}

function ReminderDialog({ editor, close, withText }: { editor: Editor; close: () => void; withText: boolean }) {
  const [text, setText] = useState('');
  const [date, setDate] = useState(localDate());
  const [time, setTime] = useState('');
  const validTime = !time || !!parseTypedTime(time);
  const add = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !validTime) return;
    close();
    const chip: JSONContent = { type: 'reminder', attrs: { date, time: time ? parseTypedTime(time) : null } };
    if (withText) {
      const words: JSONContent[] = text.trim() ? [{ type: 'text', text: `${text.trim()} ` }] : [];
      const { $from } = editor.state.selection;
      // In an empty checklist line already: fill it rather than start another list.
      if ($from.node(-1)?.type.name === 'taskItem')
        editor
          .chain()
          .focus()
          .insertContent([...words, chip])
          .run();
      else
        insertBlocks(editor, {
          type: 'taskList',
          content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [...words, chip] }] }],
        });
    } else {
      const before = editor.state.selection.$from.nodeBefore?.text ?? '';
      editor
        .chain()
        .focus()
        .insertContent(before && !before.endsWith(' ') ? [{ type: 'text', text: ' ' }, chip] : [chip])
        .run();
    }
  };
  return (
    <Dialog
      title="Reminder"
      icon={<BellRing className="gc-dialog-icon" />}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!validTime} onClick={add}>
            Add reminder
          </button>
        </>
      }
    >
      <form
        className="gc-date-prompt"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        {withText && (
          <div className="field">
            <label htmlFor="gc-rem-text">Remind me to</label>
            <input
              id="gc-rem-text"
              className="input"
              autoFocus
              value={text}
              placeholder="e.g. Take the plates out of the incubator"
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        )}
        <div className="gc-form-row">
          <div className="field">
            <label htmlFor="gc-rem-date">Date</label>
            <input id="gc-rem-date" type="date" className="input" autoFocus={!withText} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="gc-rem-time">Time (optional)</label>
            <input id="gc-rem-time" type="time" className="input" value={time} step={300} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <QuickDays value={date} onPick={setDate} />
        <p className="muted gc-date-preview">It shows on the calendar, where you can move it to another day or tick it off.</p>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/**
 * /reminder: a checklist line with a date (and time) that shows on the calendar.
 * Typed at the end of a line that has text, it adds the date to that line.
 */
export function openReminderDialog(editor: Editor) {
  const parent = editor.state.selection.$from.parent;
  const withText = !parent.textContent.trim();
  openDialog((close) => <ReminderDialog editor={editor} close={close} withText={withText} />);
}
