import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { create } from 'zustand';
import {
  BellRing,
  CalendarDays,
  CalendarRange,
  CalendarSync,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  List,
  ListFilter,
  ListTodo,
  MapPin,
  Palette,
  Plus,
  Workflow,
} from 'lucide-react';
import { getState, navigate, setState, toast, useNotebook, weekStartDay } from '../notebook/store';
import { boardCards, docSpan, isTask, LAYOUT, toYmd, type ColorName, type DocMeta } from '../notebook/model';
import { createCard, patchMeta, projectOf, saveConfig, updateFlowStepDate, updateReminder } from '../notebook/actions';
import type { Reminder } from '../reminders/model';
import { Popover, usePopover } from './overlay';
import { openNewEntryDialog } from './NewEntryDialog';
import { ColorPicker, projectColor, statusOf } from './status';
import { dirname, join } from '../lib/path';
import { clock, formatTime, formatTimeRange, formatTimeShort, localDate, minutesOf, LOCALE } from '../lib/dates';
import { eventsBetween, loadCalendar, type ExternalEvent } from '../calendar/external';
import { openCalendarsDialog } from './CalendarsDialog';
import { PHONE, useMediaQuery } from '../lib/useMedia';
import { NewButton, PageHead, PhoneBar, ViewBar, ViewTabs, type ViewTab } from './PageHeader';

const CAL_MIME = 'application/x-assaycraft-cal';
const MAX_LANES = 4;
const DAY = 86400000;

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function ymd(d: Date) {
  return localDate(d);
}
export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
export function diffDays(a: string, b: string): number {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / DAY);
}
/** The first day of the week holding `day` (weekStart: 0 = Sunday, 1 = Monday). */
export function startOfWeek(day: string, weekStart: number): string {
  return addDays(day, -((parseYmd(day).getDay() - weekStart + 7) % 7));
}

/** Something on the calendar: an entry, a task, a reminder in a page, or an event of another calendar (read-only). */
interface CalItem {
  key: string;
  kind: 'entry' | 'card' | 'event' | 'reminder' | 'step';
  doc?: DocMeta;
  event?: ExternalEvent;
  reminder?: Reminder;
  /** A flow step planned for a day but not started: its place in the flow kept in `doc`. */
  step?: number;
  /** The entry's ID. */
  id?: string;
  title: string;
  start: string;
  end: string;
  /** Start and end time (HH:MM); none for a whole day. */
  time?: string;
  endTime?: string;
  color: ColorName;
  done: boolean;
  /** Its project, or the calendar it comes from. */
  where?: string;
}

/** By day; across several days first; a whole day before a time; then by time and title. */
function byStart(a: CalItem, b: CalItem): number {
  return (
    a.start.localeCompare(b.start) ||
    diffDays(b.start, b.end) - diffDays(a.start, a.end) ||
    (a.time ? 1 : 0) - (b.time ? 1 : 0) ||
    (a.time && b.time ? minutesOf(a.time) - minutesOf(b.time) : 0) ||
    a.title.localeCompare(b.title)
  );
}

function docItem(d: DocMeta, span: { start: string; end: string }, color: ColorName, done: boolean): CalItem {
  const entry = d.kind === 'entry';
  return {
    key: d.path,
    kind: entry ? 'entry' : 'card',
    doc: d,
    id: entry ? d.id || undefined : undefined,
    title: d.title,
    ...span,
    time: entry ? d.time : undefined,
    endTime: entry ? d.endTime : undefined,
    color,
    done,
    where: projectOf(d.path) || undefined,
  };
}

type ColorBy = 'status' | 'project';

function useCalendarItems(showEntries: boolean, showTasks: boolean, colorBy: ColorBy): CalItem[] {
  const docs = useNotebook((s) => s.docs);
  const statuses = useNotebook((s) => s.config.entryStatuses);
  const projectColors = useNotebook((s) => s.config.projectColors);
  return useMemo(() => {
    const out: CalItem[] = [];
    // By project, everything of a project shares its color; things outside projects stay gray.
    const tone = (item: CalItem, own: ColorName) => (colorBy === 'project' ? (item.where ? projectColor(item.where, projectColors) : 'gray') : own);
    for (const d of Object.values(docs)) {
      // Reminders in pages show with the tasks.
      if (showTasks && d.reminders?.length && (d.kind === 'entry' || d.kind === 'note' || d.kind === 'card')) {
        const where = projectOf(d.path) || undefined;
        for (const r of d.reminders) {
          const item: CalItem = {
            key: `${d.path}#reminder-${r.index}`,
            kind: 'reminder',
            doc: d,
            reminder: r,
            title: r.text,
            start: r.date,
            end: r.date,
            time: r.time,
            color: 'orange',
            done: r.done,
            where,
          };
          out.push({ ...item, color: tone(item, 'orange') });
        }
      }
      // Flow steps planned for a day and not started yet show with the entries.
      if (showEntries && d.flow?.some((st) => st.date && !st.ref)) {
        const where = projectOf(d.path) || undefined;
        d.flow.forEach((st, i) => {
          if (!st.date || st.ref) return;
          const item: CalItem = {
            key: `${d.path}#step-${i}`,
            kind: 'step',
            doc: d,
            step: i,
            title: st.title || `Step ${i + 1}`,
            start: st.date,
            end: st.date,
            color: 'gray',
            done: false,
            where,
          };
          out.push({ ...item, color: tone(item, 'gray') });
        });
      }
      if (d.kind === 'entry' && !showEntries) continue;
      // Only tasks have a place on the calendar; cards on a tracking board do not.
      if (d.kind === 'card' && (!showTasks || !isTask(d, docs))) continue;
      const span = docSpan(d);
      if (!span) continue;
      let item: CalItem;
      if (d.kind === 'entry') {
        const st = statusOf(statuses, d.status);
        item = docItem(d, span, st?.color ?? 'gray', d.status === 'completed' || d.status === 'failed');
      } else {
        const board = docs[join(dirname(d.path), LAYOUT.boardFile)];
        const cols = board?.columns ?? [];
        const col = cols.find((c) => c.id === d.status);
        item = docItem(d, span, col?.color ?? 'gray', !!cols.length && cols[cols.length - 1].id === d.status);
      }
      out.push({ ...item, color: tone(item, item.color) });
    }
    return out;
  }, [docs, statuses, showEntries, showTasks, colorBy, projectColors]);
}

/** The events of the other calendars (Calendars) on the days from `from` to `to`, fetched again every ten minutes. */
function useOtherCalendars(from: string, to: string): CalItem[] {
  const calendars = useNotebook((s) => s.config.calendars);
  const [events, setEvents] = useState<CalItem[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 10 * 60 * 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const shown = (calendars ?? []).filter((c) => !c.hidden);
    if (!shown.length) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    void Promise.all(
      shown.map(async (cal) => {
        const l = await loadCalendar(cal.url);
        return l.parsed ? eventsBetween(cal, l.parsed, from, to) : [];
      }),
    ).then((lists) => {
      if (cancelled) return;
      setEvents(
        lists.flat().map((e) => ({
          key: e.key,
          kind: 'event',
          event: e,
          title: e.title,
          start: e.start,
          end: e.end,
          time: e.time,
          endTime: e.endTime,
          color: e.calendar.color,
          done: false,
          where: e.calendar.name,
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [calendars, from, to, tick]);
  return events;
}

/** An event of another calendar, open: what, when and where. */
const usePeekEvent = create<{ item: CalItem; anchor: DOMRect } | null>(() => null);

function open(item: CalItem, anchor?: HTMLElement) {
  if (item.kind === 'reminder' || item.kind === 'step') navigate({ name: 'doc', path: item.doc!.path });
  else if (item.kind === 'event') usePeekEvent.setState({ item, anchor: (anchor ?? document.body).getBoundingClientRect() }, true);
  else if (item.kind === 'card') setState({ peek: item.doc!.path });
  else navigate({ name: 'doc', path: item.doc!.path });
}

function EventPeek() {
  const peek = usePeekEvent();
  if (!peek) return null;
  const { item, anchor } = peek;
  const e = item.event!;
  const day = (d: string) => parseYmd(d).toLocaleDateString(LOCALE, { weekday: 'long', month: 'long', day: 'numeric' });
  const when = item.start === item.end ? day(item.start) : `${day(item.start)} – ${day(item.end)}`;
  return (
    <Popover anchor={anchor} onClose={() => usePeekEvent.setState(null, true)} className="gc-event-peek">
      <div className="gc-event-peek-body">
        <h3>{e.title}</h3>
        <p>
          {when}
          {item.time && (
            <>
              <br />
              {formatTimeRange(item.time, item.endTime)}
            </>
          )}
        </p>
        {e.location && (
          <p className="gc-event-peek-where">
            <MapPin /> {e.location}
          </p>
        )}
        {e.description && <p className="gc-event-peek-desc">{e.description}</p>}
        <p className="muted gc-event-peek-cal">
          <span className={`gc-status-dot tone-${item.color}`} /> {e.calendar.name} · read-only here
        </p>
      </div>
    </Popover>
  );
}

function reschedule(item: CalItem, delta: number) {
  const doc = item.doc;
  if (!delta || !doc) return;
  if (item.kind === 'step') {
    void updateFlowStepDate(doc.path, item.step!, addDays(item.start, delta)).catch((err: Error) =>
      toast(`Could not move the step: ${err.message}`, 'error'),
    );
  } else if (item.kind === 'reminder') {
    void updateReminder(doc.path, item.reminder!.index, { date: addDays(item.start, delta) }).catch((err: Error) =>
      toast(`Could not move the reminder: ${err.message}`, 'error'),
    );
  } else if (doc.kind === 'entry') {
    const start = doc.date ?? (doc.created ? toYmd(doc.created) : undefined);
    if (!start) return;
    patchMeta(doc.path, { date: addDays(start, delta), end: doc.end ? addDays(doc.end, delta) : undefined }, 200);
  } else {
    patchMeta(doc.path, { start: doc.start ? addDays(doc.start, delta) : undefined, due: doc.due ? addDays(doc.due, delta) : undefined }, 200);
  }
}

/** Check a reminder off (or not), in its page's checklist. */
function tick(item: CalItem, done: boolean) {
  if (!item.doc || !item.reminder) return;
  void updateReminder(item.doc.path, item.reminder.index, { done }).catch((err: Error) =>
    toast(`Could not check the reminder off: ${err.message}`, 'error'),
  );
}

/**
 * What is being dragged: browsers hide a drag's data until the drop, and the week's hours show where
 * it would land while it moves. `grabDays` is the day of a long bar it was grabbed by; `grabMinutes`
 * how far below its start a timed event was grabbed.
 */
let dragging: { key: string; grabDays: number; grabMinutes: number } | null = null;
function startDrag(e: DragEvent, item: CalItem, grabDays = 0, grabMinutes = 0) {
  dragging = { key: item.key, grabDays, grabMinutes };
  e.dataTransfer.setData(CAL_MIME, JSON.stringify({ key: item.key, offset: grabDays }));
  e.dataTransfer.effectAllowed = 'move';
}
function droppedItem(e: DragEvent, items: CalItem[]): { item: CalItem; grabDays: number; grabMinutes: number } | null {
  let key = dragging?.key;
  let grabDays = dragging?.grabDays ?? 0;
  try {
    const data = JSON.parse(e.dataTransfer.getData(CAL_MIME)) as { key: string; offset: number };
    key = data.key;
    grabDays = data.offset;
  } catch {
    /* only the bookkeeping */
  }
  const item = items.find((i) => i.key === key);
  const grabMinutes = dragging && dragging.key === key ? dragging.grabMinutes : 0;
  return item?.doc ? { item, grabDays, grabMinutes } : null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** Minutes after midnight as HH:MM, kept within the day. */
const hhmm = (min: number) => {
  const m = Math.max(0, Math.min(23 * 60 + 45, Math.round(min)));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
};

/**
 * Move something to a day and a time, or to the day as a whole (time null). Entries keep their
 * length; tasks and planned steps have a day only.
 */
function retime(item: CalItem, day: string, time: string | null) {
  const doc = item.doc;
  if (!doc) return;
  const delta = diffDays(item.start, day);
  if (item.kind === 'reminder') {
    void updateReminder(doc.path, item.reminder!.index, { date: day, time }).catch((err: Error) =>
      toast(`Could not move the reminder: ${err.message}`, 'error'),
    );
  } else if (item.kind === 'entry') {
    const oneDay = item.start === item.end;
    const length = oneDay && doc.time && doc.endTime ? minutesOf(doc.endTime) - minutesOf(doc.time) : 0;
    patchMeta(
      doc.path,
      {
        date: day,
        end: doc.end ? addDays(doc.end, delta) : undefined,
        time: time ?? undefined,
        endTime: time === null ? undefined : length > 0 ? hhmm(minutesOf(time) + length) : oneDay ? undefined : doc.endTime,
      },
      200,
    );
  } else reschedule(item, delta);
}

/**
 * An event dropped on a day moves so that the day it was grabbed by lands there. In the week's
 * all-day row it also loses its time.
 */
function dropOnDay(e: DragEvent, day: string, items: CalItem[], allDay = false) {
  e.preventDefault();
  const hit = droppedItem(e, items);
  dragging = null;
  if (!hit) return;
  const target = addDays(day, -hit.grabDays);
  if (allDay && hit.item.time) retime(hit.item, target, null);
  else reschedule(hit.item, diffDays(hit.item.start, target));
}

/** An item's icon, time (in full, or short on a month's chip), ID and title. */
function ItemLabel({ item, time = 'full' }: { item: CalItem; time?: 'full' | 'short' | false }) {
  return (
    <>
      {item.kind === 'card' ? (
        <CheckSquare />
      ) : item.kind === 'event' ? (
        <CalendarDays />
      ) : item.kind === 'reminder' ? (
        <BellRing />
      ) : item.kind === 'step' ? (
        <Workflow />
      ) : (
        <FlaskConical />
      )}
      {time && item.time && <span className="gc-cal-time">{time === 'short' ? formatTimeShort(item.time) : formatTime(item.time)}</span>}
      {item.id && <span className="gc-cal-id">{item.id}</span>}
      <span className="gc-cal-title">{item.title}</span>
    </>
  );
}

/** What a chip's tooltip says: ID, title, time, project or calendar. */
const itemTitle = (item: CalItem) =>
  [
    item.id,
    item.title,
    item.time && formatTimeRange(item.time, item.endTime),
    item.kind === 'step' ? `planned step of ${[item.doc?.id, item.doc?.title].filter(Boolean).join(' ')}` : item.where,
  ]
    .filter(Boolean)
    .join(' · ');

function NewOnDay({ day, time, anchor, onClose }: { day: string; time?: string; anchor: DOMRect; onClose: () => void }) {
  const docs = useNotebook((s) => s.docs);
  const boards = Object.values(docs).filter((d) => d.kind === 'board' && boardCards(d) === 'tasks');
  const label =
    parseYmd(day).toLocaleDateString(LOCALE, { weekday: 'short', month: 'short', day: 'numeric' }) + (time ? ` · ${formatTime(time)}` : '');
  return (
    <Popover anchor={anchor} onClose={onClose}>
      <div className="menu-label">{label}</div>
      <button
        className="menu-item"
        onClick={() => {
          onClose();
          openNewEntryDialog({ date: day, time, status: day > localDate() ? 'planned' : 'in-progress' });
        }}
      >
        <FlaskConical /> {time ? 'New entry at this time' : 'New entry on this day'}
      </button>
      {boards.map((b) => (
        <button
          key={b.path}
          className="menu-item"
          onClick={() => {
            onClose();
            void createCard(dirname(b.path), { due: day, open: true });
          }}
        >
          <ListTodo /> New task in {b.title}
        </button>
      ))}
    </Popover>
  );
}

interface Placed {
  item: CalItem;
  lane: number;
  /** First and last column (0–6) it covers in its week. */
  sc: number;
  ec: number;
}

/** A week's events in lanes: each takes the first lane that is free on its first day. */
function placeWeek(items: CalItem[], ws: string): { we: string; placed: Placed[] } {
  const we = addDays(ws, 6);
  const laneEnds: number[] = [];
  const placed: Placed[] = [];
  for (const it of items) {
    if (it.start > we || it.end < ws) continue;
    const sc = Math.max(0, diffDays(ws, it.start));
    const ec = Math.min(6, diffDays(ws, it.end));
    let lane = laneEnds.findIndex((end) => end < sc);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(ec);
    } else laneEnds[lane] = ec;
    placed.push({ item: it, lane, sc, ec });
  }
  return { we, placed };
}

/** An event as a bar across its days; drag it to another day to reschedule. */
function CalBar({
  p,
  ws,
  we,
  phone,
  row,
  week,
}: {
  p: Placed;
  ws: string;
  we: string;
  phone: boolean;
  row: () => HTMLElement | null | undefined;
  /** In the week view, with room for the time in full. */
  week?: boolean;
}) {
  const { item, lane, sc, ec } = p;
  const className = `gc-cal-item tone-${item.color} ${item.done ? 'is-done' : ''} ${item.start < ws ? 'cont-left' : ''} ${item.end > we ? 'cont-right' : ''} is-${item.kind === 'card' ? 'task' : item.kind}`;
  const style = { gridColumn: `${sc + 1} / ${ec + 2}`, gridRow: lane + 1 };
  const onDragStart = (e: DragEvent) => {
    if (!item.doc) return;
    const el = row();
    let grab = 0;
    if (el) {
      const r = el.getBoundingClientRect();
      const col = Math.max(0, Math.min(6, Math.floor(((e.clientX - r.left) / r.width) * 7)));
      grab = diffDays(item.start, addDays(ws, col));
    }
    startDrag(e, item, grab);
  };
  // A reminder: a box to check it off, and its words to open its page.
  if (item.kind === 'reminder')
    return (
      <div
        className={`${className} has-check`}
        style={style}
        aria-hidden={phone || undefined}
        draggable
        title={itemTitle(item)}
        onDragStart={onDragStart}
      >
        {item.reminder?.checkable && (
          <input
            type="checkbox"
            className="gc-cal-check"
            checked={item.done}
            tabIndex={phone ? -1 : undefined}
            aria-label={`Done: ${item.title}`}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => tick(item, e.target.checked)}
          />
        )}
        <button
          className="gc-cal-open"
          tabIndex={phone ? -1 : undefined}
          onClick={(e) => {
            e.stopPropagation();
            open(item, e.currentTarget);
          }}
        >
          <ItemLabel item={item} time={item.start >= ws && (week ? 'full' : 'short')} />
        </button>
      </div>
    );
  return (
    <button
      className={className}
      style={style}
      // Phones show these as bars and list the tapped day's events below.
      tabIndex={phone ? -1 : undefined}
      aria-hidden={phone || undefined}
      draggable={!!item.doc}
      title={itemTitle(item)}
      onDragStart={onDragStart}
      onClick={(e) => {
        e.stopPropagation();
        open(item, e.currentTarget);
      }}
    >
      {/* The time on the day it starts. */}
      <ItemLabel item={item} time={item.start >= ws && (week ? 'full' : 'short')} />
    </button>
  );
}

/** A day's column: events can be dropped on it, and it adds an entry or a task on that day. */
function DayCell({
  day,
  className,
  over,
  setOver,
  items,
  onPick,
  onNew,
  children,
  allDay,
}: {
  day: string;
  className: string;
  /** In the week's all-day row: a timed event dropped here loses its time. */
  allDay?: boolean;
  over: string | null;
  setOver: (fn: (o: string | null) => string | null) => void;
  items: CalItem[];
  onPick: (e: MouseEvent) => void;
  onNew: (rect: DOMRect) => void;
  children?: ReactNode;
}) {
  return (
    <div
      data-day={day}
      className={`gc-day ${className} ${over === day ? 'is-over' : ''}`}
      onClick={onPick}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(CAL_MIME)) return;
        e.preventDefault();
        if (over !== day) setOver(() => day);
      }}
      onDragLeave={() => setOver((o) => (o === day ? null : o))}
      onDrop={(e) => {
        setOver(() => null);
        dropOnDay(e, day, items, allDay);
      }}
    >
      {children}
      <button
        className="gc-day-add"
        title="New entry or task"
        onClick={(e) => {
          e.stopPropagation();
          onNew((e.currentTarget as HTMLElement).getBoundingClientRect());
        }}
      >
        <Plus />
      </button>
    </div>
  );
}

const isWeekend = (day: string) => [0, 6].includes(parseYmd(day).getDay());

function MonthView({ month, items, weekStart }: { month: Date; items: CalItem[]; weekStart: number }) {
  const today = localDate();
  const phone = useMediaQuery(PHONE);
  // Phones: the day whose events are listed under the grid (today, or the 1st of another month).
  const [picked, setPicked] = useState(() =>
    today.startsWith(ymd(month).slice(0, 7)) ? today : ymd(new Date(month.getFullYear(), month.getMonth(), 1)),
  );
  const [newAt, setNewAt] = useState<{ day: string; rect: DOMRect } | null>(null);
  const [more, setMore] = useState<{ day: string; rect: DOMRect } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const rowRefs = useRef(new Map<number, HTMLDivElement>());

  const first = ymd(new Date(month.getFullYear(), month.getMonth(), 1));
  const gridStart = startOfWeek(first, weekStart);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((diffDays(gridStart, first) + daysInMonth) / 7);
  const monthIdx = month.getMonth();

  const dayNames = Array.from({ length: 7 }, (_, i) => parseYmd(addDays(gridStart, i)).toLocaleDateString(LOCALE, { weekday: 'short' }));
  const pickedItems = items.filter((i) => i.start <= picked && i.end >= picked);

  return (
    <>
      <div className="gc-month">
        <div className="gc-month-head">
          {dayNames.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
        {Array.from({ length: weeks }, (_, w) => {
          const ws = addDays(gridStart, w * 7);
          const { we, placed } = placeWeek(items, ws);
          const hiddenPerDay = Array.from({ length: 7 }, (_, d) => placed.filter((p) => p.lane >= MAX_LANES && p.sc <= d && p.ec >= d).length);
          return (
            <div
              className="gc-week"
              key={ws}
              ref={(el) => {
                if (el) rowRefs.current.set(w, el);
              }}
            >
              <div className="gc-week-bg">
                {Array.from({ length: 7 }, (_, d) => {
                  const day = addDays(ws, d);
                  const date = parseYmd(day);
                  const classes = [
                    date.getMonth() !== monthIdx ? 'is-other' : '',
                    day === today ? 'is-today' : '',
                    isWeekend(day) ? 'is-weekend' : '',
                    phone && picked === day ? 'is-picked' : '',
                  ].join(' ');
                  return (
                    <DayCell
                      key={day}
                      day={day}
                      className={classes}
                      over={over}
                      setOver={setOver}
                      items={items}
                      onPick={(e) => (phone ? setPicked(day) : setNewAt({ day, rect: new DOMRect(e.clientX, e.clientY, 0, 0) }))}
                      onNew={(rect) => setNewAt({ day, rect })}
                    >
                      <span className="gc-day-num">
                        {date.getDate() === 1 ? date.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' }) : date.getDate()}
                      </span>
                    </DayCell>
                  );
                })}
              </div>
              <div className="gc-week-items">
                {placed
                  .filter((p) => p.lane < MAX_LANES)
                  .map((p) => (
                    <CalBar key={p.item.key} p={p} ws={ws} we={we} phone={phone} row={() => rowRefs.current.get(w)} />
                  ))}
                {hiddenPerDay.map((n, d) =>
                  n > 0 ? (
                    <button
                      key={`more-${d}`}
                      className="gc-cal-more"
                      style={{ gridColumn: `${d + 1} / ${d + 2}`, gridRow: MAX_LANES + 1 }}
                      onClick={(e) => setMore({ day: addDays(ws, d), rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })}
                    >
                      +{n} more
                    </button>
                  ) : null,
                )}
              </div>
            </div>
          );
        })}
        {newAt && <NewOnDay day={newAt.day} anchor={newAt.rect} onClose={() => setNewAt(null)} />}
        {more && (
          <Popover anchor={more.rect} onClose={() => setMore(null)}>
            <div className="menu-label">{parseYmd(more.day).toLocaleDateString(LOCALE, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
            {items
              .filter((i) => i.start <= more.day && i.end >= more.day)
              .map((i) => (
                <button
                  key={i.key}
                  className={`menu-item gc-cal-menu-item ${i.done ? 'is-done' : ''}`}
                  onClick={(e) => {
                    setMore(null);
                    open(i, e.currentTarget);
                  }}
                >
                  <span className={`gc-status-dot tone-${i.color}`} />
                  <ItemLabel item={i} />
                </button>
              ))}
          </Popover>
        )}
      </div>
      {phone && (
        <section className="gc-month-day" aria-label="Selected day">
          <header className="gc-month-day-head">
            <h3>{parseYmd(picked).toLocaleDateString(LOCALE, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
            <button
              className="icon-btn icon-btn-sm"
              aria-label={`New on ${parseYmd(picked).toLocaleDateString(LOCALE, { weekday: 'long', month: 'long', day: 'numeric' })}`}
              onClick={(e) => setNewAt({ day: picked, rect: e.currentTarget.getBoundingClientRect() })}
            >
              <Plus />
            </button>
          </header>
          {pickedItems.length ? (
            pickedItems.map((i) => <AgendaRow key={i.key} item={i} day={picked} />)
          ) : (
            <p className="muted gc-month-day-empty">Nothing planned for this day.</p>
          )}
        </section>
      )}
    </>
  );
}

/** One week: on a computer, its days by the hour (WeekGrid); on a phone, one under the other, like the agenda. */
function WeekView({ start, items }: { start: string; items: CalItem[] }) {
  const today = localDate();
  const phone = useMediaQuery(PHONE);
  const [newAt, setNewAt] = useState<{ day: string; rect: DOMRect } | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  if (phone)
    return (
      <div className="gc-weeklist">
        {days.map((day) => {
          const list = items.filter((i) => i.start <= day && i.end >= day);
          const name = parseYmd(day).toLocaleDateString(LOCALE, { weekday: 'long', month: 'long', day: 'numeric' });
          return (
            <section key={day} className={`gc-agenda-day ${day === today ? 'is-today' : ''}`} data-day={day}>
              <header className="gc-month-day-head">
                <h3>
                  {day === today ? 'Today · ' : ''}
                  {name}
                </h3>
                <button
                  className="icon-btn icon-btn-sm"
                  aria-label={`New on ${name}`}
                  onClick={(e) => setNewAt({ day, rect: e.currentTarget.getBoundingClientRect() })}
                >
                  <Plus />
                </button>
              </header>
              {list.length ? (
                list.map((i) => <AgendaRow key={i.key} item={i} day={day} />)
              ) : (
                <p className="muted gc-month-day-empty">Nothing planned.</p>
              )}
            </section>
          );
        })}
        {newAt && <NewOnDay day={newAt.day} anchor={newAt.rect} onClose={() => setNewAt(null)} />}
      </div>
    );

  return <WeekGrid start={start} days={days} items={items} />;
}

const HOUR_PX = 44;
const SNAP = 15;
/** Timed and within one day: placed at its hours. Everything else goes in the all-day row. */
const atHours = (i: CalItem) => !!i.time && i.start === i.end;
/** How long it lasts on the grid: to its end time, or an hour (half an hour for a reminder). */
function minutesLong(i: CalItem): number {
  if (i.time && i.endTime) {
    const d = minutesOf(i.endTime) - minutesOf(i.time);
    if (d > 0) return d;
  }
  return i.kind === 'reminder' ? 30 : 60;
}

interface Timed {
  item: CalItem;
  top: number;
  height: number;
  col: number;
  cols: number;
}
/** A day's timed events, side by side where they overlap. */
function layoutDay(list: CalItem[]): Timed[] {
  const sorted = [...list].sort((a, b) => minutesOf(a.time!) - minutesOf(b.time!) || minutesLong(b) - minutesLong(a));
  const out: Timed[] = [];
  let group: Timed[] = [];
  let groupEnd = -1;
  const colEnds: number[] = [];
  const close = () => {
    const cols = Math.max(1, ...group.map((t) => t.col + 1));
    for (const t of group) t.cols = cols;
    out.push(...group);
    group = [];
    colEnds.length = 0;
  };
  for (const item of sorted) {
    const from = minutesOf(item.time!);
    const to = from + minutesLong(item);
    if (group.length && from >= groupEnd) close();
    if (!group.length) groupEnd = -1;
    let col = colEnds.findIndex((end) => end <= from);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(to);
    } else colEnds[col] = to;
    groupEnd = Math.max(groupEnd, to);
    group.push({ item, top: (from / 60) * HOUR_PX, height: Math.max(22, ((to - from) / 60) * HOUR_PX - 2), col, cols: 1 });
  }
  close();
  return out;
}

const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(LOCALE, clock({ hour: 'numeric' }));
const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

/**
 * The week on a computer: the days across, an all-day row on top (whole-day and multi-day things,
 * tasks and steps), then the hours. Drag something to another hour or day to move it; drop it in
 * the all-day row to take its time away, or on an hour to give it one. Click an empty hour to plan
 * an entry then.
 */
function WeekGrid({ start, days, items }: { start: string; days: string[]; items: CalItem[] }) {
  const today = localDate();
  const [newAt, setNewAt] = useState<{ day: string; time?: string; rect: DOMRect } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ day: string; minutes: number; length: number } | null>(null);
  const [now, setNow] = useState(nowMinutes);
  const rowRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const allDay = items.filter((i) => !atHours(i));
  const timed = items.filter(atHours);
  const { we, placed } = placeWeek(allDay, start);

  useEffect(() => {
    const t = setInterval(() => setNow(nowMinutes()), 60_000);
    return () => clearInterval(t);
  }, []);
  // Open on the working day: an hour before the first timed event of the week, 7 AM at the latest.
  useEffect(() => {
    const first = Math.min(7 * 60, ...timed.filter((i) => i.start >= start && i.start <= we).map((i) => minutesOf(i.time!) - 60));
    scrollRef.current?.scrollTo({ top: Math.max(0, (first / 60) * HOUR_PX - 10) });
    // Only when another week opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  const minutesAt = (e: { clientY: number }, col: HTMLElement) => ((e.clientY - col.getBoundingClientRect().top) / HOUR_PX) * 60;
  const snapped = (m: number) => Math.round(m / SNAP) * SNAP;

  return (
    <div className="gc-month gc-tgrid" style={{ '--hour': `${HOUR_PX}px` } as CSSProperties}>
      <div className="gc-tgrid-row gc-tgrid-head">
        <div className="gc-tgrid-gutter" />
        {days.map((day) => {
          const date = parseYmd(day);
          return (
            <div key={day} className={`gc-tgrid-day ${day === today ? 'is-today' : ''}`}>
              <span className="gc-weekview-dow">{date.toLocaleDateString(LOCALE, { weekday: 'short' })}</span>
              <span className="gc-weekview-date">{date.getDate()}</span>
            </div>
          );
        })}
      </div>
      <div className="gc-tgrid-row gc-tgrid-allday">
        <div className="gc-tgrid-gutter">All day</div>
        <div className="gc-week gc-tgrid-allday-week" ref={rowRef}>
          <div className="gc-week-bg">
            {days.map((day) => (
              <DayCell
                key={day}
                day={day}
                allDay
                className={`${day === today ? 'is-today' : ''} ${isWeekend(day) ? 'is-weekend' : ''}`}
                over={over}
                setOver={setOver}
                items={items}
                onPick={(e) => setNewAt({ day, rect: new DOMRect(e.clientX, e.clientY, 0, 0) })}
                onNew={(rect) => setNewAt({ day, rect })}
              />
            ))}
          </div>
          <div className="gc-week-items">
            {placed.map((p) => (
              <CalBar key={p.item.key} p={p} ws={start} we={we} phone={false} row={() => rowRef.current} week />
            ))}
          </div>
        </div>
      </div>
      <div className="gc-tgrid-scroll" ref={scrollRef}>
        <div className="gc-tgrid-body">
          <div className="gc-tgrid-gutter gc-tgrid-hours" aria-hidden="true">
            {Array.from({ length: 23 }, (_, i) => (
              <span key={i} style={{ top: (i + 1) * HOUR_PX }}>
                {hourLabel(i + 1)}
              </span>
            ))}
          </div>
          {days.map((day) => (
            <div
              key={day}
              data-day={day}
              className={`gc-tgrid-col ${day === today ? 'is-today' : ''} ${isWeekend(day) ? 'is-weekend' : ''}`}
              onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                const m = Math.floor(minutesAt(e, e.currentTarget) / 30) * 30;
                setNewAt({ day, time: hhmm(m), rect: new DOMRect(e.clientX, e.clientY, 0, 0) });
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(CAL_MIME)) return;
                e.preventDefault();
                const item = dragging && items.find((i) => i.key === dragging!.key);
                const minutes = snapped(minutesAt(e, e.currentTarget) - (dragging?.grabMinutes ?? 0));
                const length = item ? (atHours(item) ? minutesLong(item) : item.kind === 'reminder' ? 30 : 60) : 60;
                if (ghost?.day !== day || ghost.minutes !== minutes) setGhost({ day, minutes: Math.max(0, minutes), length });
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setGhost((g) => (g?.day === day ? null : g));
              }}
              onDrop={(e) => {
                e.preventDefault();
                const hit = droppedItem(e, items);
                const minutes = snapped(minutesAt(e, e.currentTarget) - (hit?.grabMinutes ?? 0));
                dragging = null;
                setGhost(null);
                if (hit) retime(hit.item, day, hhmm(minutes));
              }}
            >
              {layoutDay(timed.filter((i) => i.start === day)).map((t) => (
                <TimedEvent key={t.item.key} t={t} />
              ))}
              {ghost?.day === day && (
                <div className="gc-tgrid-ghost" style={{ top: (ghost.minutes / 60) * HOUR_PX, height: (ghost.length / 60) * HOUR_PX - 2 }}>
                  {formatTime(hhmm(ghost.minutes))}
                </div>
              )}
              {day === today && <div className="gc-tgrid-now" style={{ top: (now / 60) * HOUR_PX }} aria-hidden="true" />}
            </div>
          ))}
        </div>
      </div>
      {newAt && <NewOnDay day={newAt.day} time={newAt.time} anchor={newAt.rect} onClose={() => setNewAt(null)} />}
    </div>
  );
}

/** The bottom edge of an item is being dragged: a change of length, not a move. */
let resizing = false;
const LAST_END = 23 * 60 + 45;

/**
 * Something with a time, placed at its hours: drag it to move it, click it to open it. An entry's
 * bottom edge changes how long it lasts, in steps of a quarter of an hour.
 */
function TimedEvent({ t }: { t: Timed }) {
  const { item } = t;
  const from = minutesOf(item.time!);
  // Its length while the bottom edge is being dragged.
  const [length, setLength] = useState<number | null>(null);
  const current = length ?? minutesLong(item);
  const height = length === null ? t.height : Math.max(22, (length / 60) * HOUR_PX - 2);
  const style: CSSProperties = {
    top: t.top,
    height,
    left: `calc(${(t.col / t.cols) * 100}% + 2px)`,
    width: `calc(${100 / t.cols}% - 4px)`,
  };
  const movable = !!item.doc;
  const resizable = movable && item.kind === 'entry';
  const short = height < 40;
  const clampLength = (m: number) => Math.max(SNAP, Math.min(LAST_END - from, m));
  const setEnd = (m: number) => {
    if (m !== minutesLong(item)) patchMeta(item.doc!.path, { endTime: hhmm(from + m) }, 200);
  };
  return (
    <div
      className={`gc-tevent tone-${item.color} is-${item.kind === 'card' ? 'task' : item.kind} ${item.done ? 'is-done' : ''} ${short ? 'is-short' : ''} ${length !== null ? 'is-resizing' : ''}`}
      style={style}
      draggable={movable}
      title={itemTitle(item)}
      onDragStart={(e) => {
        if (resizing) {
          e.preventDefault();
          return;
        }
        const r = e.currentTarget.getBoundingClientRect();
        startDrag(e, item, 0, Math.max(0, ((e.clientY - r.top) / HOUR_PX) * 60));
      }}
      onDragEnd={() => (dragging = null)}
    >
      {item.kind === 'reminder' && item.reminder?.checkable && (
        <input
          type="checkbox"
          className="gc-cal-check"
          checked={item.done}
          aria-label={`Done: ${item.title}`}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => tick(item, e.target.checked)}
        />
      )}
      <button
        className="gc-tevent-open"
        onClick={(e) => {
          e.stopPropagation();
          open(item, e.currentTarget);
        }}
      >
        <span className="gc-tevent-time">{formatTimeRange(item.time, length === null ? item.endTime : hhmm(from + length))}</span>
        <span className="gc-tevent-title" style={{ WebkitLineClamp: Math.max(1, Math.floor((height - 22) / 16)) }}>
          {item.title}
        </span>
      </button>
      {resizable && (
        <div
          className="gc-tevent-resize"
          role="slider"
          tabIndex={0}
          aria-label={`End time of ${item.title}`}
          aria-valuemin={from + SNAP}
          aria-valuemax={LAST_END}
          aria-valuenow={from + current}
          aria-valuetext={formatTime(hhmm(from + current))}
          // No drag of the whole item from here, and no text selection.
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            const handle = e.currentTarget;
            const top = handle.parentElement!.getBoundingClientRect().top;
            handle.setPointerCapture(e.pointerId);
            resizing = true;
            let next = minutesLong(item);
            const move = (ev: PointerEvent) => {
              next = clampLength(Math.round((((ev.clientY - top) / HOUR_PX) * 60) / SNAP) * SNAP);
              setLength(next);
            };
            const up = () => {
              handle.removeEventListener('pointermove', move);
              handle.removeEventListener('pointerup', up);
              handle.removeEventListener('pointercancel', up);
              resizing = false;
              setEnd(next);
              setLength(null);
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', up);
            handle.addEventListener('pointercancel', up);
          }}
          onKeyDown={(e) => {
            const step = { ArrowDown: SNAP, ArrowRight: SNAP, ArrowUp: -SNAP, ArrowLeft: -SNAP }[e.key];
            if (!step) return;
            e.preventDefault();
            setEnd(clampLength(minutesLong(item) + step));
          }}
        />
      )}
    </div>
  );
}

function AgendaRow({ item, day }: { item: CalItem; day?: string }) {
  // Times on the day it starts (and the end time on its last day).
  const time = !day || day === item.start ? formatTimeRange(item.time, item.end === item.start ? item.endTime : undefined) : '';
  const inner = (
    <>
      {item.kind !== 'reminder' && <span className={`gc-status-dot tone-${item.color}`} />}
      {time && <span className="gc-agenda-time">{time}</span>}
      <ItemLabel item={item} time={false} />
      {day && item.start !== item.end && (
        <span className="muted gc-agenda-span">
          {item.start === day ? 'starts' : item.end === day ? (item.endTime ? `until ${formatTime(item.endTime)}` : 'ends') : 'continues'}
        </span>
      )}
      {item.where && <span className="muted gc-agenda-proj">{item.where}</span>}
    </>
  );
  if (item.kind === 'reminder')
    return (
      <div className={`gc-agenda-item gc-agenda-reminder is-reminder ${item.done ? 'is-done' : ''}`}>
        {item.reminder?.checkable ? (
          <input
            type="checkbox"
            className="gc-cal-check"
            checked={item.done}
            aria-label={`Done: ${item.title}`}
            onChange={(e) => tick(item, e.target.checked)}
          />
        ) : (
          <span className={`gc-status-dot tone-${item.color}`} />
        )}
        <button className="gc-agenda-open" onClick={(e) => open(item, e.currentTarget)}>
          {inner}
        </button>
      </div>
    );
  return (
    <button className={`gc-agenda-item is-${item.kind} ${item.done ? 'is-done' : ''}`} onClick={(e) => open(item, e.currentTarget)}>
      {inner}
    </button>
  );
}

/** By project: each project's color, which can be changed here. */
function ProjectLegend({ items }: { items: CalItem[] }) {
  const projectColors = useNotebook((s) => s.config.projectColors);
  const projects = [...new Set(items.filter((i) => i.kind !== 'event' && i.where).map((i) => i.where!))].sort((a, b) => a.localeCompare(b));
  if (!projects.length) return null;
  return (
    <div className="gc-cal-legend" aria-label="Project colors">
      {projects.map((p) => (
        <LegendItem key={p} project={p} color={projectColor(p, projectColors)} />
      ))}
    </div>
  );
}

function LegendItem({ project, color }: { project: string; color: ColorName }) {
  const pop = usePopover();
  return (
    <>
      <button ref={pop.ref} className="gc-cal-legend-item" title={`Color of ${project}`} onClick={pop.toggle}>
        <span className={`gc-status-dot tone-${color}`} />
        {project}
      </button>
      {pop.open && (
        <Popover anchor={pop.ref.current} onClose={pop.close}>
          <div className="menu-label">Color of {project}</div>
          <ColorPicker
            value={color}
            onChange={(c) => {
              pop.close();
              void saveConfig({ projectColors: { ...getState().config.projectColors, [project]: c } });
            }}
          />
        </Popover>
      )}
    </>
  );
}

function AgendaView({ items }: { items: CalItem[] }) {
  const today = localDate();
  const from = addDays(today, -7);
  const to = addDays(today, 60);
  const overdue = items.filter((i) => i.kind === 'card' && !i.done && i.end < today);
  const days = new Map<string, CalItem[]>();
  for (const it of items) {
    if (it.end < from || it.start > to) continue;
    const s = it.start < from ? from : it.start;
    const e = it.end > to ? to : it.end;
    for (let d = s; d <= e; d = addDays(d, 1)) {
      if (!days.has(d)) days.set(d, []);
      days.get(d)!.push(it);
    }
  }
  const sorted = [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="gc-agenda">
      {overdue.length > 0 && (
        <section className="gc-agenda-day is-overdue">
          <h3>Overdue tasks</h3>
          {overdue.map((i) => (
            <AgendaRow key={i.key} item={i} />
          ))}
        </section>
      )}
      {sorted.length === 0 && (
        <div className="empty-state">
          <CalendarDays />
          <h3>Nothing scheduled</h3>
          <p>Entries appear on their experiment date; tasks on their due date.</p>
        </div>
      )}
      {sorted.map(([day, list]) => (
        <section key={day} className={`gc-agenda-day ${day === today ? 'is-today' : ''} ${day < today ? 'is-past' : ''}`}>
          <h3>
            {day === today ? 'Today · ' : ''}
            {parseYmd(day).toLocaleDateString(LOCALE, { weekday: 'long', month: 'long', day: 'numeric' })}
          </h3>
          {list.map((i) => (
            <AgendaRow key={i.key + day} item={i} day={day} />
          ))}
        </section>
      ))}
    </div>
  );
}

/** What the calendar shows: entries (and planned flow steps), tasks (and reminders), or both. */
function ShowFilter({
  entries,
  tasks,
  setEntries,
  setTasks,
}: {
  entries: boolean;
  tasks: boolean;
  setEntries: (v: boolean) => void;
  setTasks: (v: boolean) => void;
}) {
  const p = usePopover<HTMLButtonElement>();
  const label = entries && tasks ? 'Everything' : entries ? 'Entries only' : tasks ? 'Tasks only' : 'Nothing';
  return (
    <>
      <button
        ref={p.ref}
        className="btn btn-sm gc-cal-show"
        aria-label={`Show: ${label}`}
        title="What the calendar shows"
        aria-expanded={p.open}
        onClick={p.toggle}
      >
        <ListFilter /> <span className="gc-cal-btn-label">{label}</span>
      </button>
      {p.open && (
        <Popover anchor={p.ref.current} onClose={p.close} placement="bottom-end">
          <div className="menu-label">Show</div>
          <label className="checkbox gc-menu-check">
            <input type="checkbox" checked={entries} onChange={(e) => setEntries(e.target.checked)} /> Entries and planned steps
          </label>
          <label className="checkbox gc-menu-check">
            <input type="checkbox" checked={tasks} onChange={(e) => setTasks(e.target.checked)} /> Tasks and reminders
          </label>
        </Popover>
      )}
    </>
  );
}

type View = 'month' | 'week' | 'agenda';
const VIEWS: ViewTab<View>[] = [
  { id: 'month', label: 'Month', icon: <CalendarDays /> },
  { id: 'week', label: 'Week', icon: <CalendarRange /> },
  { id: 'agenda', label: 'Agenda', icon: <List /> },
];
const VIEW_KEY = 'assaycraft:calendarView';
const COLOR_KEY = 'assaycraft:calendarColor';

/** The month of a week ("October 2026"), or both ("Sep – Oct 2026"); its days head the columns. */
function weekTitle(ws: string): string {
  const a = parseYmd(ws);
  const b = parseYmd(addDays(ws, 6));
  if (a.getMonth() === b.getMonth()) return a.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
  const f = new Intl.DateTimeFormat(LOCALE, { month: 'short', year: 'numeric' });
  return typeof f.formatRange === 'function' ? f.formatRange(a, b) : `${f.format(a)} – ${f.format(b)}`;
}

export function CalendarPage() {
  // The day the calendar looks at: its month in the month view, its week in the week view.
  const [cursor, setCursor] = useState(() => localDate());
  const [view, setView] = useState<View>(() => {
    // Phones start with the agenda, which reads better than a month grid on a small screen.
    const phone = window.matchMedia(PHONE).matches;
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      return VIEWS.some((v) => v.id === saved) ? (saved as View) : phone ? 'agenda' : 'month';
    } catch {
      return phone ? 'agenda' : 'month';
    }
  });
  const [showEntries, setShowEntries] = useState(true);
  const [showTasks, setShowTasks] = useState(true);
  const [colorBy, setColorBy] = useState<ColorBy>(() => {
    try {
      return localStorage.getItem(COLOR_KEY) === 'project' ? 'project' : 'status';
    } catch {
      return 'status';
    }
  });
  const weekStart = useNotebook((s) => weekStartDay(s.weekStart));
  const today = localDate();
  const c = parseYmd(cursor);
  const month = new Date(c.getFullYear(), c.getMonth(), 1);
  const ws = startOfWeek(cursor, weekStart);
  // The days on screen, for the other calendars' repeating events.
  const gridStart = startOfWeek(ymd(month), weekStart);
  const [from, to] =
    view === 'month' ? [gridStart, addDays(gridStart, 41)] : view === 'week' ? [ws, addDays(ws, 6)] : [addDays(today, -7), addDays(today, 60)];
  const notebookItems = useCalendarItems(showEntries, showTasks, colorBy);
  const otherItems = useOtherCalendars(from, to);
  const items = useMemo(() => [...notebookItems, ...otherItems].sort(byStart), [notebookItems, otherItems]);

  const shift = (n: number) =>
    setCursor((cur) => {
      if (view === 'week') return addDays(cur, n * 7);
      const d = parseYmd(cur);
      const target = ymd(new Date(d.getFullYear(), d.getMonth() + n, 1));
      // Back in this month: today again, so the week view then opens on this week.
      return target.slice(0, 7) === today.slice(0, 7) ? today : target;
    });
  const setV = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };
  const unit = view === 'week' ? 'week' : 'month';
  const atToday = view === 'week' ? ws === startOfWeek(today, weekStart) : cursor.slice(0, 7) === today.slice(0, 7);
  const title = view === 'month' ? month.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' }) : view === 'week' ? weekTitle(ws) : 'Agenda';

  const toggleColor = () => {
    const v: ColorBy = colorBy === 'project' ? 'status' : 'project';
    setColorBy(v);
    try {
      localStorage.setItem(COLOR_KEY, v);
    } catch {
      /* ignore */
    }
  };
  const docs = useNotebook((s) => s.docs);
  const taskBoards = useMemo(() => Object.values(docs).filter((d) => d.kind === 'board' && boardCards(d) === 'tasks'), [docs]);

  return (
    <div className="gc-page gc-calendar-page">
      <PhoneBar />
      <div className="gc-page-inner is-wide gc-cal-head">
        <PageHead title="Calendar" />
        <ViewBar
          tools={
            <>
              <ShowFilter entries={showEntries} tasks={showTasks} setEntries={setShowEntries} setTasks={setShowTasks} />
              <button
                className="btn btn-sm gc-cal-colorby"
                aria-pressed={colorBy === 'project'}
                aria-label="Color by project"
                title={colorBy === 'project' ? 'Colored by project: click to color by status again' : 'Color by project instead of by status'}
                onClick={toggleColor}
              >
                <Palette /> <span className="gc-cal-btn-label">By project</span>
              </button>
              <button
                className="btn btn-sm gc-cal-calendars"
                aria-label="Calendars"
                title="Calendars: show other calendars here, or this one in your calendar app"
                onClick={() => openCalendarsDialog()}
              >
                <CalendarSync /> <span className="gc-cal-btn-label">Calendars</span>
              </button>
              <NewButton
                what="entry"
                onClick={() => openNewEntryDialog({})}
                more={taskBoards.map((b) => ({
                  label: `New task in ${b.title}`,
                  icon: <ListTodo />,
                  onSelect: () => void createCard(dirname(b.path), { due: today, open: true }),
                }))}
              />
            </>
          }
        >
          <ViewTabs label="View" value={view} onChange={setV} tabs={VIEWS} />
        </ViewBar>
        {view !== 'agenda' && (
          <div className="gc-cal-subhead">
            <h2 className="gc-cal-month-title" aria-live="polite">
              {title}
            </h2>
            <span className="gc-cal-nav">
              <button className="btn btn-sm" disabled={atToday} onClick={() => setCursor(localDate())}>
                Today
              </button>
              <button className="icon-btn" title={`Previous ${unit}`} aria-label={`Previous ${unit}`} onClick={() => shift(-1)}>
                <ChevronLeft />
              </button>
              <button className="icon-btn" title={`Next ${unit}`} aria-label={`Next ${unit}`} onClick={() => shift(1)}>
                <ChevronRight />
              </button>
            </span>
          </div>
        )}
        {colorBy === 'project' && <ProjectLegend items={notebookItems} />}
      </div>
      <EventPeek />
      <div className="gc-calendar-body">
        {view === 'month' ? (
          <MonthView key={`${ymd(month)}-${weekStart}`} month={month} items={items} weekStart={weekStart} />
        ) : view === 'week' ? (
          <WeekView key={ws} start={ws} items={items} />
        ) : (
          <AgendaView items={items} />
        )}
      </div>
    </div>
  );
}
