import { lazy, Suspense, useState } from 'react';
import { NodeViewWrapper, useEditorState, type NodeViewProps } from '@tiptap/react';
import { localDate } from '../lib/dates';

const WeekCalendar = lazy(() => import('../ui/CalendarPage').then((m) => ({ default: m.WeekCalendar })));

/**
 * /calendar in a page: the week it was put in (kept in the file, so the page shows that week when
 * read later). Its arrows move it, and the week moved to is kept too; in a page that cannot be
 * changed they only look.
 */
export function CalendarWeekView({ node, updateAttributes, editor }: NodeViewProps) {
  const editable = useEditorState({ editor, selector: (s) => s.editor.isEditable });
  const [looking, setLooking] = useState<string | null>(null);
  const week = looking ?? (node.attrs.week as string | null) ?? localDate();
  return (
    <NodeViewWrapper className="gc-weekblock-wrap" data-drag-handle contentEditable={false}>
      <Suspense fallback={<div className="gc-weekblock is-loading">Loading the calendar…</div>}>
        <WeekCalendar week={week} onWeek={(day) => (editable ? updateAttributes({ week: day }) : setLooking(day))} />
      </Suspense>
    </NodeViewWrapper>
  );
}
