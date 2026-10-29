import { useEffect } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { BellRing, CalendarDays, Clock, Trash2 } from 'lucide-react';
import { Popover, usePopover } from '../ui/overlay';
import { formatTime, LOCALE } from '../lib/dates';
import { DateField, TimeField } from '../ui/fields';
import { reminderOpened, reminderOpenRequested } from '../editor/datePrompts';

/** "Fri, Oct 30 · 2:00 PM", always in English. */
export function reminderLabel(date: string, time?: string | null): string {
  const [y, m, d] = date.split('-').map(Number);
  const day = Number.isFinite(y) ? new Date(y, m - 1, d).toLocaleDateString(LOCALE, { weekday: 'short', month: 'short', day: 'numeric' }) : date;
  return time ? `${day} · ${formatTime(time)}` : day;
}

/**
 * A reminder in the text: a chip with its date. Click it to change the day or the time, with the
 * same controls as an entry's Date and Time.
 */
export function ReminderView({ node, updateAttributes, deleteNode, editor, selected }: NodeViewProps) {
  const p = usePopover<HTMLButtonElement>();
  const date = String(node.attrs.date);
  const time = (node.attrs.time as string | null) ?? undefined;
  const label = reminderLabel(date, time ?? null);
  const { setOpen } = p;
  // Just inserted with /reminder: show its day and time at once.
  useEffect(() => {
    if (!editor.isEditable || !reminderOpenRequested()) return;
    // Once the chip is in the page, so the popover can be placed under it.
    const t = setTimeout(() => {
      reminderOpened();
      setOpen(true);
    }, 30);
    return () => clearTimeout(t);
  }, [editor, setOpen]);
  return (
    <NodeViewWrapper as="span" className={`gc-reminder-chip ${selected ? 'is-selected' : ''}`}>
      <button
        ref={p.ref}
        type="button"
        className="gc-reminder-btn"
        contentEditable={false}
        aria-label={`Reminder ${label}`}
        title={editor.isEditable ? 'Reminder: click to change its day or time' : 'Reminder'}
        onClick={() => editor.isEditable && p.toggle()}
      >
        <BellRing />
        {label}
      </button>
      {p.open && (
        <Popover anchor={p.ref.current} onClose={p.close}>
          <div className="gc-reminder-edit" role="group" aria-label="Reminder">
            <div className="gc-reminder-row">
              <span className="gc-reminder-key">
                <CalendarDays /> Date
              </span>
              <DateField value={date} clearable={false} onChange={(v) => v && updateAttributes({ date: v })} />
            </div>
            <div className="gc-reminder-row">
              <span className="gc-reminder-key">
                <Clock /> Time
              </span>
              <TimeField value={time} onChange={(v) => updateAttributes({ time: v ?? null })} />
            </div>
            <p className="muted gc-reminder-help">It shows on the calendar, where you can move it or check it off.</p>
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
