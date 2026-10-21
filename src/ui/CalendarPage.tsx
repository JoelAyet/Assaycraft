import { useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { CalendarDays, CheckSquare, ChevronLeft, ChevronRight, FlaskConical, ListTodo, Plus } from 'lucide-react';
import { navigate, setState, useNotebook, weekStartDay } from '../notebook/store';
import { boardCards, docSpan, isTask, LAYOUT, toYmd, type ColorName, type DocMeta } from '../notebook/model';
import { createCard, patchMeta, projectOf } from '../notebook/actions';
import { Popover } from './overlay';
import { openNewEntryDialog } from './NewEntryDialog';
import { statusOf } from './status';
import { dirname, join } from '../lib/path';
import { localDate } from '../lib/dates';
import { PHONE, useMediaQuery } from '../lib/useMedia';
import { NavToggle } from './nav';

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

interface CalItem {
  doc: DocMeta;
  start: string;
  end: string;
  color: ColorName;
  done: boolean;
}

function useCalendarItems(showEntries: boolean, showTasks: boolean): CalItem[] {
  const docs = useNotebook((s) => s.docs);
  const statuses = useNotebook((s) => s.config.entryStatuses);
  return useMemo(() => {
    const out: CalItem[] = [];
    for (const d of Object.values(docs)) {
      if (d.kind === 'entry' && !showEntries) continue;
      // Only tasks have a place on the calendar; cards on a tracking board do not.
      if (d.kind === 'card' && (!showTasks || !isTask(d, docs))) continue;
      const span = docSpan(d);
      if (!span) continue;
      if (d.kind === 'entry') {
        const st = statusOf(statuses, d.status);
        out.push({ doc: d, ...span, color: st?.color ?? 'gray', done: d.status === 'completed' || d.status === 'failed' });
      } else {
        const board = docs[join(dirname(d.path), LAYOUT.boardFile)];
        const cols = board?.columns ?? [];
        const col = cols.find((c) => c.id === d.status);
        out.push({ doc: d, ...span, color: col?.color ?? 'gray', done: !!cols.length && cols[cols.length - 1].id === d.status });
      }
    }
    return out.sort(
      (a, b) => a.start.localeCompare(b.start) || diffDays(b.start, b.end) - diffDays(a.start, a.end) || a.doc.title.localeCompare(b.doc.title),
    );
  }, [docs, statuses, showEntries, showTasks]);
}

function open(item: CalItem) {
  if (item.doc.kind === 'card') setState({ peek: item.doc.path });
  else navigate({ name: 'doc', path: item.doc.path });
}

function reschedule(doc: DocMeta, delta: number) {
  if (!delta) return;
  if (doc.kind === 'entry') {
    const start = doc.date ?? (doc.created ? toYmd(doc.created) : undefined);
    if (!start) return;
    patchMeta(doc.path, { date: addDays(start, delta), end: doc.end ? addDays(doc.end, delta) : undefined }, 200);
  } else {
    patchMeta(doc.path, { start: doc.start ? addDays(doc.start, delta) : undefined, due: doc.due ? addDays(doc.due, delta) : undefined }, 200);
  }
}

/** An event dropped on a day moves so that the day it was grabbed by lands there. */
function dropOnDay(e: DragEvent, day: string, items: CalItem[]) {
  e.preventDefault();
  try {
    const { path, offset: grab } = JSON.parse(e.dataTransfer.getData(CAL_MIME)) as { path: string; offset: number };
    const item = items.find((i) => i.doc.path === path);
    if (item) reschedule(item.doc, diffDays(item.start, addDays(day, -grab)));
  } catch {
    /* not ours */
  }
}

function ItemLabel({ item }: { item: CalItem }) {
  return (
    <>
      {item.doc.kind === 'card' ? <CheckSquare /> : <FlaskConical />}
      {item.doc.kind === 'entry' && item.doc.id && <span className="gc-cal-id">{item.doc.id}</span>}
      <span className="gc-cal-title">{item.doc.title}</span>
    </>
  );
}

function NewOnDay({ day, anchor, onClose }: { day: string; anchor: DOMRect; onClose: () => void }) {
  const docs = useNotebook((s) => s.docs);
  const boards = Object.values(docs).filter((d) => d.kind === 'board' && boardCards(d) === 'tasks');
  const label = parseYmd(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <Popover anchor={anchor} onClose={onClose}>
      <div className="menu-label">{label}</div>
      <button
        className="menu-item"
        onClick={() => {
          onClose();
          openNewEntryDialog({ date: day, status: day > localDate() ? 'planned' : 'in-progress' });
        }}
      >
        <FlaskConical /> New entry on this day
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
function CalBar({ p, ws, we, phone, row }: { p: Placed; ws: string; we: string; phone: boolean; row: () => HTMLElement | null | undefined }) {
  const { item, lane, sc, ec } = p;
  return (
    <button
      className={`gc-cal-item tone-${item.color} ${item.done ? 'is-done' : ''} ${item.start < ws ? 'cont-left' : ''} ${item.end > we ? 'cont-right' : ''} ${item.doc.kind === 'card' ? 'is-task' : 'is-entry'}`}
      style={{ gridColumn: `${sc + 1} / ${ec + 2}`, gridRow: lane + 1 }}
      // Phones show these as bars and list the tapped day's events below.
      tabIndex={phone ? -1 : undefined}
      aria-hidden={phone || undefined}
      draggable
      title={`${item.doc.id ? item.doc.id + ' · ' : ''}${item.doc.title}${projectOf(item.doc.path) ? ' · ' + projectOf(item.doc.path) : ''}`}
      onDragStart={(e) => {
        const el = row();
        let grab = 0;
        if (el) {
          const r = el.getBoundingClientRect();
          const col = Math.max(0, Math.min(6, Math.floor(((e.clientX - r.left) / r.width) * 7)));
          grab = diffDays(item.start, addDays(ws, col));
        }
        e.dataTransfer.setData(CAL_MIME, JSON.stringify({ path: item.doc.path, offset: grab }));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={(e) => {
        e.stopPropagation();
        open(item);
      }}
    >
      <ItemLabel item={item} />
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
}: {
  day: string;
  className: string;
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
        dropOnDay(e, day, items);
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

  const dayNames = Array.from({ length: 7 }, (_, i) => parseYmd(addDays(gridStart, i)).toLocaleDateString(undefined, { weekday: 'short' }));
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
                        {date.getDate() === 1 ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : date.getDate()}
                      </span>
                    </DayCell>
                  );
                })}
              </div>
              <div className="gc-week-items">
                {placed
                  .filter((p) => p.lane < MAX_LANES)
                  .map((p) => (
                    <CalBar key={p.item.doc.path} p={p} ws={ws} we={we} phone={phone} row={() => rowRefs.current.get(w)} />
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
            <div className="menu-label">{parseYmd(more.day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
            {items
              .filter((i) => i.start <= more.day && i.end >= more.day)
              .map((i) => (
                <button
                  key={i.doc.path}
                  className={`menu-item gc-cal-menu-item ${i.done ? 'is-done' : ''}`}
                  onClick={() => {
                    setMore(null);
                    open(i);
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
            <h3>{parseYmd(picked).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
            <button className="btn btn-sm" onClick={(e) => setNewAt({ day: picked, rect: e.currentTarget.getBoundingClientRect() })}>
              <Plus /> New
            </button>
          </header>
          {pickedItems.length ? (
            pickedItems.map((i) => <AgendaRow key={i.doc.path} item={i} />)
          ) : (
            <p className="muted gc-month-day-empty">Nothing planned for this day.</p>
          )}
        </section>
      )}
    </>
  );
}

/**
 * One week. On a computer, seven tall columns with every event in full (no "+ more"), each a bar
 * across its days. On a phone, the seven days one under the other, like the agenda.
 */
function WeekView({ start, items }: { start: string; items: CalItem[] }) {
  const today = localDate();
  const phone = useMediaQuery(PHONE);
  const [newAt, setNewAt] = useState<{ day: string; rect: DOMRect } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const { we, placed } = placeWeek(items, start);

  if (phone)
    return (
      <div className="gc-weeklist">
        {days.map((day) => {
          const list = items.filter((i) => i.start <= day && i.end >= day);
          const name = parseYmd(day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
          return (
            <section key={day} className={`gc-agenda-day ${day === today ? 'is-today' : ''}`} data-day={day}>
              <header className="gc-month-day-head">
                <h3>
                  {day === today ? 'Today · ' : ''}
                  {name}
                </h3>
                <button
                  className="btn btn-sm"
                  aria-label={`New on ${name}`}
                  onClick={(e) => setNewAt({ day, rect: e.currentTarget.getBoundingClientRect() })}
                >
                  <Plus /> New
                </button>
              </header>
              {list.length ? (
                list.map((i) => <AgendaRow key={i.doc.path} item={i} day={day} />)
              ) : (
                <p className="muted gc-month-day-empty">Nothing planned.</p>
              )}
            </section>
          );
        })}
        {newAt && <NewOnDay day={newAt.day} anchor={newAt.rect} onClose={() => setNewAt(null)} />}
      </div>
    );

  return (
    <div className="gc-month gc-weekview">
      <div className="gc-month-head gc-weekview-head">
        {days.map((day) => {
          const date = parseYmd(day);
          return (
            <div key={day} className={day === today ? 'is-today' : ''}>
              <span className="gc-weekview-dow">{date.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <span className="gc-weekview-date">{date.getDate()}</span>
            </div>
          );
        })}
      </div>
      <div className="gc-week gc-weekview-body" ref={rowRef}>
        <div className="gc-week-bg">
          {days.map((day) => (
            <DayCell
              key={day}
              day={day}
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
            <CalBar key={p.item.doc.path} p={p} ws={start} we={we} phone={false} row={() => rowRef.current} />
          ))}
        </div>
        {placed.length === 0 && <p className="gc-weekview-empty muted">Nothing planned this week. Click a day to add an entry or a task.</p>}
      </div>
      {newAt && <NewOnDay day={newAt.day} anchor={newAt.rect} onClose={() => setNewAt(null)} />}
    </div>
  );
}

function AgendaRow({ item, day }: { item: CalItem; day?: string }) {
  return (
    <button className={`gc-agenda-item ${item.done ? 'is-done' : ''}`} onClick={() => open(item)}>
      <span className={`gc-status-dot tone-${item.color}`} />
      <ItemLabel item={item} />
      {day && item.start !== item.end && (
        <span className="muted gc-agenda-span">{item.start === day ? 'starts' : item.end === day ? 'ends' : 'continues'}</span>
      )}
      {projectOf(item.doc.path) && <span className="muted gc-agenda-proj">{projectOf(item.doc.path)}</span>}
    </button>
  );
}

function AgendaView({ items }: { items: CalItem[] }) {
  const today = localDate();
  const from = addDays(today, -7);
  const to = addDays(today, 60);
  const overdue = items.filter((i) => i.doc.kind === 'card' && !i.done && i.end < today);
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
            <AgendaRow key={i.doc.path} item={i} />
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
            {parseYmd(day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </h3>
          {list.map((i) => (
            <AgendaRow key={i.doc.path + day} item={i} day={day} />
          ))}
        </section>
      ))}
    </div>
  );
}

type View = 'month' | 'week' | 'agenda';
const VIEWS: { id: View; name: string }[] = [
  { id: 'month', name: 'Month' },
  { id: 'week', name: 'Week' },
  { id: 'agenda', name: 'Agenda' },
];
const VIEW_KEY = 'assaycraft:calendarView';

/** The month of a week ("October 2026"), or both ("Sep – Oct 2026"); its days head the columns. */
function weekTitle(ws: string): string {
  const a = parseYmd(ws);
  const b = parseYmd(addDays(ws, 6));
  if (a.getMonth() === b.getMonth()) return a.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const f = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });
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
  const items = useCalendarItems(showEntries, showTasks);
  const weekStart = useNotebook((s) => weekStartDay(s.weekStart));
  const today = localDate();
  const c = parseYmd(cursor);
  const month = new Date(c.getFullYear(), c.getMonth(), 1);
  const ws = startOfWeek(cursor, weekStart);

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
  const title =
    view === 'month' ? month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : view === 'week' ? weekTitle(ws) : 'Agenda';

  return (
    <div className="gc-page gc-calendar-page">
      <div className="gc-topbar">
        <NavToggle />
        <span className="gc-page-icon">
          <CalendarDays />
        </span>
        {/* Before the title, so they stay in place however long the month's name is. */}
        {view !== 'agenda' && (
          <span className="gc-cal-nav">
            <button className="btn btn-sm" disabled={atToday} onClick={() => setCursor(localDate())}>
              Today
            </button>
            <button className="icon-btn" title={`Previous ${unit}`} onClick={() => shift(-1)}>
              <ChevronLeft />
            </button>
            <button className="icon-btn" title={`Next ${unit}`} onClick={() => shift(1)}>
              <ChevronRight />
            </button>
          </span>
        )}
        <h1 className="gc-topbar-title is-display" aria-live="polite">
          {title}
        </h1>
        {/* Phones: the new-entry button sits by the title, leaving the second row to the filters. */}
        <button className="btn btn-primary btn-sm gc-cal-new-phone" aria-label="New entry" onClick={() => openNewEntryDialog({})}>
          <Plus />
        </button>
        <span className="spacer" />
        {/* One group: when the bar is too narrow, it moves down whole rather than one button at a time. */}
        <div className="gc-cal-tools">
          <label className="checkbox">
            <input type="checkbox" checked={showEntries} onChange={(e) => setShowEntries(e.target.checked)} /> Entries
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={showTasks} onChange={(e) => setShowTasks(e.target.checked)} /> Tasks
          </label>
          <div className="gc-segmented gc-segmented-sm" role="group" aria-label="View">
            {VIEWS.map((v) => (
              <button key={v.id} className={view === v.id ? 'active' : ''} aria-pressed={view === v.id} onClick={() => setV(v.id)}>
                {v.name}
              </button>
            ))}
          </div>
          <button className="btn btn-primary btn-sm gc-cal-new" onClick={() => openNewEntryDialog({})}>
            <Plus /> New entry
          </button>
        </div>
      </div>
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
