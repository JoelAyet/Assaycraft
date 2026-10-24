/**
 * The notebook's plan as an iCalendar file (RFC 5545), for the private calendar link: entries on
 * their dates (at their times, when they have one) and open tasks on theirs. Only what a calendar
 * shows goes in: ID, title, project, status. Nothing from the pages themselves.
 */
import { boardOf, docSpan, isTask, type DocMeta, type StatusOption } from '../notebook/model';
import { minutesOf } from '../lib/dates';

/** Text in a property value: backslash, semicolon, comma and line breaks escaped. */
export function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Lines longer than 75 bytes are folded: a line break and a space (never inside a UTF-8 character). */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    // Continuation lines start with a space, which counts.
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymdCompact = (ymd: string) => ymd.replace(/-/g, '');

/** The day after YYYY-MM-DD (an all-day event ends the day after its last day). */
function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** A local date and time on this device as UTC, 20261024T073000Z. */
function utcStamp(ymd: string, hhmm: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  return utcOf(new Date(y, m - 1, d, h, min));
}
function utcOf(t: Date): string {
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}Z`;
}

/** A short stable hash, for UIDs of pages without an ID. */
function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export interface FeedOptions {
  /** The calendar's name in the calendar app. */
  name: string;
  /** Part of each event's UID, so that two notebooks' events never collide. */
  feedId: string;
  statuses: StatusOption[];
  /** The project (folder) a page is in, or ''. */
  projectOf: (path: string) => string;
}

/** The events of a notebook, sorted, as one iCalendar file. */
export function notebookCalendar(docs: Record<string, DocMeta>, opts: FeedOptions): { ics: string; count: number } {
  const events: string[][] = [];
  const all = Object.values(docs).sort((a, b) => a.path.localeCompare(b.path));
  for (const d of all) {
    const task = d.kind === 'card' && isTask(d, docs);
    if (d.kind !== 'entry' && !task) continue;
    const span = docSpan(d);
    if (!span) continue;
    // A task in its board's last column is done: off the calendar.
    const columns = task ? (boardOf(d, docs)?.columns ?? []) : [];
    if (task && columns.length && columns[columns.length - 1].id === d.status) continue;
    const lines = ['BEGIN:VEVENT', `UID:${d.id || hash(d.path)}-${opts.feedId.slice(0, 8)}@assaycraft`];
    // The last change of the page, so the file only changes when the plan does.
    const changed = Date.parse(d.modified ?? d.created ?? '');
    lines.push(`DTSTAMP:${utcOf(new Date(Number.isFinite(changed) ? changed : 0))}`);
    const time = d.kind === 'entry' ? d.time : undefined;
    if (time) {
      lines.push(`DTSTART:${utcStamp(span.start, time)}`);
      const endTime = d.endTime;
      if (endTime && (span.end !== span.start || minutesOf(endTime) > minutesOf(time))) lines.push(`DTEND:${utcStamp(span.end, endTime)}`);
      else if (span.end !== span.start) lines.push(`DTEND:${utcStamp(nextDay(span.end), '00:00')}`);
      else lines.push(`DURATION:PT1H`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${ymdCompact(span.start)}`, `DTEND;VALUE=DATE:${ymdCompact(nextDay(span.end))}`);
    }
    lines.push(`SUMMARY:${icsText([d.kind === 'entry' ? d.id : '', d.title].filter(Boolean).join(' '))}`);
    const project = opts.projectOf(d.path);
    const status = d.kind === 'entry' && d.status ? (opts.statuses.find((st) => st.id === d.status)?.name ?? d.status) : undefined;
    const about = [project && `Project: ${project}`, status && `Status: ${status}`, task && 'Task'].filter(Boolean).join('\n');
    if (about) lines.push(`DESCRIPTION:${icsText(about)}`);
    if (d.status === 'cancelled' || d.status === 'failed') lines.push('STATUS:CANCELLED');
    lines.push('TRANSP:TRANSPARENT', 'END:VEVENT');
    events.push(lines);
  }
  const head = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Assaycraft//Lab notebook//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(opts.name)}`,
    // How often calendar apps that read these should look again.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  const lines = [...head, ...events.flat(), 'END:VCALENDAR'];
  return { ics: lines.map(foldLine).join('\r\n') + '\r\n', count: events.length };
}
