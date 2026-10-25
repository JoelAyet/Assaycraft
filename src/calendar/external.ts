/**
 * Other calendars shown in Assaycraft's calendar, read-only: the lab's Google Calendar, an Apple or
 * Outlook calendar, anything with an iCal (.ics) address. The website fetches the address for the
 * app (a browser may not read another site's file) and passes it on without keeping it; the events
 * stay in memory here and are fetched again after a while.
 */
import type ICALNs from 'ical.js';
import type { ColorName } from '../notebook/model';

/** A calendar added in Calendars (kept in the notebook's settings). */
export interface CalendarLink {
  id: string;
  name: string;
  url: string;
  color: ColorName;
  /** Left out of the calendar for now. */
  hidden?: boolean;
}

/** One occurrence of an event, in this device's time zone. */
export interface ExternalEvent {
  key: string;
  calendar: CalendarLink;
  title: string;
  /** First and last day, YYYY-MM-DD. */
  start: string;
  end: string;
  /** Start and end time (HH:MM) of a timed event; none for an all-day one. */
  time?: string;
  endTime?: string;
  location?: string;
  description?: string;
}

type ICAL = typeof ICALNs;
type ICALEvent = InstanceType<ICAL['Event']>;
type ICALTime = InstanceType<ICAL['Time']>;

interface Parsed {
  name?: string;
  events: ICALEvent[];
}

let lib: Promise<ICAL> | null = null;
/** ical.js is loaded only when a calendar is shown. */
const ical = () => (lib ??= import('ical.js').then((m) => m.default));

/** webcal:// is how calendar links are often shared; it is https underneath. */
export function normalizeCalendarUrl(input: string): string | null {
  const s = input.trim().replace(/^webcals?:\/\//i, 'https://');
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Fetch a calendar through the website. */
export async function fetchCalendarText(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`/ical?url=${encodeURIComponent(url)}`, { cache: 'no-store' });
  } catch {
    throw new Error('No connection: the calendar could not be loaded.');
  }
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `The calendar could not be loaded (${res.status}).`);
  return res.text();
}

export async function parseCalendar(text: string): Promise<Parsed> {
  const ICAL = await ical();
  let comp: InstanceType<ICAL['Component']>;
  try {
    comp = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new Error('That address does not give a calendar (iCal) file.');
  }
  // Time zones the file defines, so its times convert to this device's.
  for (const tz of comp.getAllSubcomponents('vtimezone')) {
    try {
      ICAL.TimezoneService.register(tz);
    } catch {
      /* a zone it cannot read: its times stay as written */
    }
  }
  const masters = new Map<string, ICALEvent>();
  const exceptions: ICALEvent[] = [];
  for (const v of comp.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(v);
    if (String(v.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED' && !ev.isRecurrenceException()) continue;
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.set(ev.uid || `${masters.size}`, ev);
  }
  for (const ex of exceptions) masters.get(ex.uid)?.relateException(ex);
  const name = comp.getFirstPropertyValue('x-wr-calname');
  return { name: typeof name === 'string' ? name : undefined, events: [...masters.values()] };
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymdOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hmOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
function dayBefore(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return ymdOf(new Date(y, m - 1, d - 1));
}

/** One occurrence as days (and times) here. */
function occurrence(cal: CalendarLink, ev: ICALEvent, start: ICALTime, end: ICALTime | null, key: string): ExternalEvent {
  const base = {
    key,
    calendar: cal,
    title: ev.summary || '(no title)',
    location: ev.location || undefined,
    description: ev.description ? ev.description.slice(0, 600) : undefined,
  };
  if (start.isDate) {
    const s = `${start.year}-${pad(start.month)}-${pad(start.day)}`;
    // An all-day event ends the day after its last day.
    const e = end && end.isDate ? dayBefore(`${end.year}-${pad(end.month)}-${pad(end.day)}`) : s;
    return { ...base, start: s, end: e < s ? s : e };
  }
  const a = start.toJSDate();
  const b = end ? end.toJSDate() : a;
  // Ending at midnight: the event ends on the day before.
  const last = b > a && hmOf(b) === '00:00' ? new Date(b.getTime() - 60000) : b;
  return { ...base, start: ymdOf(a), end: ymdOf(last), time: hmOf(a), endTime: b > a ? hmOf(b) : undefined };
}

/** The events of a calendar that touch the days from `from` to `to` (YYYY-MM-DD), repeating ones included. */
export async function eventsBetween(cal: CalendarLink, parsed: Parsed, from: string, to: string): Promise<ExternalEvent[]> {
  const ICAL = await ical();
  const out: ExternalEvent[] = [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const rangeStart = new Date(fy, fm - 1, fd);
  const rangeEnd = new Date(ty, tm - 1, td + 1);
  for (const ev of parsed.events) {
    if (!ev.startDate) continue;
    if (!ev.isRecurring()) {
      const o = occurrence(cal, ev, ev.startDate, ev.endDate, `${cal.id}:${ev.uid}`);
      if (o.end >= from && o.start <= to) out.push(o);
      continue;
    }
    const it = ev.iterator();
    // Long-running series: stop at the end of the range, or after many occurrences.
    for (let n = 0, next = it.next(); next && n < 5000; n++, next = it.next()) {
      const at = next.isDate ? new Date(next.year, next.month - 1, next.day) : next.toJSDate();
      if (at >= rangeEnd) break;
      const det = ev.getOccurrenceDetails(next);
      if (String(det.item.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') continue;
      const o = occurrence(cal, det.item, det.startDate, det.endDate, `${cal.id}:${ev.uid}:${next.toString()}`);
      if (o.end >= from && o.start <= to && (det.endDate ?? det.startDate).toJSDate() >= rangeStart) out.push(o);
    }
  }
  void ICAL;
  return out;
}

interface Loaded {
  at: number;
  parsed?: Parsed;
  error?: string;
}
const loaded = new Map<string, Loaded>();
const loading = new Map<string, Promise<Loaded>>();
/** How long a fetched calendar is used before it is fetched again. */
const FRESH = 10 * 60 * 1000;

/** A calendar's events, fetched again when older than ten minutes (or when `force`). */
export function loadCalendar(url: string, force = false): Promise<Loaded> {
  const have = loaded.get(url);
  if (have && !force && Date.now() - have.at < FRESH) return Promise.resolve(have);
  const running = loading.get(url);
  if (running) return running;
  const p = fetchCalendarText(url)
    .then(parseCalendar)
    .then(
      (parsed): Loaded => ({ at: Date.now(), parsed }),
      // Keep the last good copy when a later fetch fails (offline at the bench).
      (err: Error): Loaded => ({ at: Date.now(), parsed: have?.parsed, error: err.message }),
    )
    .then((l) => {
      loaded.set(url, l);
      loading.delete(url);
      return l;
    });
  loading.set(url, p);
  return p;
}

export const calendarState = (url: string) => loaded.get(url);
