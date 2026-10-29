/**
 * Reminders in a page's text: "(@2026-10-30)" or "(@2026-10-30 14:00)" after the thing to remember,
 * usually on a checklist line:
 *
 *   - [ ] Order more Q5 polymerase (@2026-10-30 14:00)
 *
 * The same syntax as Obsidian's Reminder plugin, so the file reads well anywhere. The calendar lists
 * them, moves them (rewriting the date in the file) and checks them off (the line's checkbox).
 */
import { timeOfDay } from '../lib/dates';

export interface Reminder {
  /** Its place among the page's reminders (0 = first), to find it again in the file. */
  index: number;
  date: string;
  time?: string;
  /** The line it is on, without list marks, checkbox or other reminders. */
  text: string;
  done: boolean;
  /** Whether the line has a checkbox to tick. */
  checkable: boolean;
}

/** One reminder mark. Group 1 is the date, group 2 the time. */
export const REMINDER_RE = /\(@(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?\)/g;
const TASK_LINE_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](\s|$)/;
const FENCE_RE = /^\s*(```|~~~)/;
const COMMENT_START_RE = /<!--/;

const validDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(y, m - 1, day);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === day;
};

/** The text of a mark: "(@2026-10-30 14:00)". */
export function reminderMark(date: string, time?: string): string {
  return `(@${date}${time ? ` ${time}` : ''})`;
}

/** Lines that can hold reminders: not in code blocks or HTML comments. */
function* textLines(body: string): Generator<{ line: string; n: number }> {
  const lines = body.split('\n');
  let fence = false;
  let comment = false;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (FENCE_RE.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    if (comment) {
      if (line.includes('-->')) comment = false;
      continue;
    }
    if (COMMENT_START_RE.test(line) && !line.includes('-->')) {
      comment = true;
      continue;
    }
    yield { line, n };
  }
}

/** Plain words of a reminder's line, for its title on the calendar. */
function lineText(line: string): string {
  return line
    .replace(TASK_LINE_RE, '')
    .replace(/^\s*(?:[-*+]|\d+[.)]|>|#{1,6})\s+/, '')
    .replace(REMINDER_RE, '')
    .replace(/<[^>]+>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The reminders in a page's Markdown body, in order. */
export function remindersIn(body: string): Reminder[] {
  if (!body.includes('(@')) return [];
  const out: Reminder[] = [];
  for (const { line } of textLines(body)) {
    const task = TASK_LINE_RE.exec(line);
    for (const m of line.matchAll(REMINDER_RE)) {
      if (!validDate(m[1])) continue;
      out.push({
        index: out.length,
        date: m[1],
        time: m[2] ? timeOfDay(m[2]) : undefined,
        text: lineText(line) || 'Reminder',
        done: !!task && task[2] !== ' ',
        checkable: !!task,
      });
    }
  }
  return out;
}

/** Find reminder `index` in a body: its line number and the mark's place in the line. */
function locate(body: string, index: number): { n: number; at: number; length: number } | null {
  if (index < 0) return null;
  let i = 0;
  for (const { line, n } of textLines(body)) {
    for (const m of line.matchAll(REMINDER_RE)) {
      if (!validDate(m[1])) continue;
      if (i === index) return { n, at: m.index, length: m[0].length };
      i++;
    }
  }
  return null;
}

/** The body with reminder `index` moved to another day and time (undefined if there is no such reminder). */
export function moveReminder(body: string, index: number, date: string, time?: string | null): string | undefined {
  const where = locate(body, index);
  if (!where) return undefined;
  const lines = body.split('\n');
  const line = lines[where.n];
  const old = line.slice(where.at, where.at + where.length);
  const keep = time === undefined ? /\(@\d{4}-\d{2}-\d{2}[ T](\d{1,2}:\d{2})\)/.exec(old)?.[1] : time || undefined;
  lines[where.n] = line.slice(0, where.at) + reminderMark(date, keep ? timeOfDay(keep) : undefined) + line.slice(where.at + where.length);
  return lines.join('\n');
}

/** The body with reminder `index`'s checkbox checked or not (undefined if its line has no checkbox). */
export function setReminderDone(body: string, index: number, done: boolean): string | undefined {
  const where = locate(body, index);
  if (!where) return undefined;
  const lines = body.split('\n');
  const m = TASK_LINE_RE.exec(lines[where.n]);
  if (!m) return undefined;
  lines[where.n] = lines[where.n].replace(TASK_LINE_RE, `$1[${done ? 'x' : ' '}]$3`);
  return lines.join('\n');
}
