import { useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { BellRing, Trash2 } from 'lucide-react';
import { Popover, usePopover } from '../ui/overlay';
import { formatTime, LOCALE, parseTypedTime } from '../lib/dates';

/** "Fri, Oct 30 · 2:00 PM", always in English. */
export function reminderLabel(date: string, time?: string | null): string {
  const [y, m, d] = date.split('-').map(Number);
  const day = Number.isFinite(y) ? new Date(y, m - 1, d).toLocaleDateString(LOCALE, { weekday: 'short', month: 'short', day: 'numeric' }) : date;
  return time ? `${day} · ${formatTime(time)}` : day;
}

/** A reminder in the text: a chip with its date; click it to change the date or time. */
export function ReminderView({ node, updateAttributes, deleteNode, editor, selected }: NodeViewProps) {
  const p = usePopover();
  const date = String(node.attrs.date);
  const time = (node.attrs.time as string | null) ?? '';
  const [t, setT] = useState(time);
  const label = reminderLabel(date, time || null);
  return (
    <NodeViewWrapper as="span" className={`gc-reminder-chip ${selected ? 'is-selected' : ''}`}>
      <button
        ref={p.ref}
        type="button"
        className="gc-reminder-btn"
        contentEditable={false}
        aria-label={`Reminder ${label}`}
        title={editor.isEditable ? 'Reminder: click to change its date or time' : 'Reminder'}
        onClick={() => {
          if (!editor.isEditable) return;
          setT(time);
          p.toggle();
        }}
      >
        <BellRing />
        {label}
      </button>
      {p.open && (
        <Popover anchor={p.ref.current} onClose={p.close}>
          <div className="gc-reminder-edit">
            <div className="field">
              <label htmlFor="gc-rem-edit-date">Date</label>
              <input
                id="gc-rem-edit-date"
                type="date"
                className="input"
                value={date}
                onChange={(e) => /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && updateAttributes({ date: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="gc-rem-edit-time">Time</label>
              <input
                id="gc-rem-edit-time"
                type="time"
                className="input"
                value={t}
                step={300}
                onChange={(e) => {
                  setT(e.target.value);
                  if (!e.target.value) updateAttributes({ time: null });
                  else if (parseTypedTime(e.target.value)) updateAttributes({ time: parseTypedTime(e.target.value) });
                }}
              />
            </div>
            <button
              className="btn btn-ghost btn-sm gc-reminder-remove"
              onClick={() => {
                p.close();
                deleteNode();
              }}
            >
              <Trash2 /> Remove reminder
            </button>
          </div>
        </Popover>
      )}
    </NodeViewWrapper>
  );
}
