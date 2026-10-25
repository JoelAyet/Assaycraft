// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatTimeRange, parseTypedTime, timeOfDay } from '../../src/lib/dates';
import { foldLine, icsText, notebookCalendar } from '../../src/calendar/ics';
import { eventsBetween, normalizeCalendarUrl, parseCalendar, type CalendarLink } from '../../src/calendar/external';
import { metaFromFrontMatter, type DocMeta, type StatusOption } from '../../src/notebook/model';
import { joinFrontMatter, splitFrontMatter } from '../../src/notebook/frontmatter';

const statuses: StatusOption[] = [
  { id: 'planned', name: 'Planned', color: 'gray' },
  { id: 'in-progress', name: 'In progress', color: 'blue' },
];

describe('times of day', () => {
  it('reads times from front matter, and only real ones', () => {
    expect(timeOfDay('9:30')).toBe('09:30');
    expect(timeOfDay('14:05')).toBe('14:05');
    expect(timeOfDay('24:00')).toBeUndefined();
    expect(timeOfDay(570)).toBeUndefined();
    expect(timeOfDay('noon')).toBeUndefined();
  });
  it('understands times as people type them', () => {
    expect(parseTypedTime('9')).toBe('09:00');
    expect(parseTypedTime('930')).toBe('09:30');
    expect(parseTypedTime('14.30')).toBe('14:30');
    expect(parseTypedTime('14h30')).toBe('14:30');
    expect(parseTypedTime('2pm')).toBe('14:00');
    expect(parseTypedTime('12 am')).toBe('00:00');
    expect(parseTypedTime('2:30 PM')).toBe('14:30');
    expect(parseTypedTime('25:00')).toBeUndefined();
    expect(parseTypedTime('soon')).toBeUndefined();
  });
  it('are kept in quotes in the file, and read back', () => {
    const text = joinFrontMatter({ title: 'ELISA', date: '2026-10-24', time: '09:30', 'end-time': '12:00' }, 'Body\n');
    expect(text).toContain('time: "09:30"');
    expect(text).toContain('end-time: "12:00"');
    const meta = metaFromFrontMatter('Projects/A/EXP-0001 ELISA.md', 'entry', splitFrontMatter(text).data, 'ELISA');
    expect([meta.time, meta.endTime]).toEqual(['09:30', '12:00']);
    expect(meta.extra).toEqual({});
  });
  it('show as a range', () => {
    expect(formatTimeRange()).toBe('');
    expect(formatTimeRange('09:30', '12:00')).toMatch(/9:30.*–.*12:00/);
  });
});

const doc = (p: Partial<DocMeta> & Pick<DocMeta, 'path' | 'kind'>): DocMeta => ({ id: '', title: '', tags: [], extra: {}, mtime: 0, text: '', ...p });
const entry = (p: Partial<DocMeta>): DocMeta => doc({ path: 'Projects/IL-6/EXP-0001 ELISA.md', kind: 'entry', id: 'EXP-0001', title: 'ELISA', ...p });

describe('the private calendar file', () => {
  const opts = { name: 'Smith lab · Assaycraft', feedId: 'abcdefghijklmnopqrstuv', statuses, projectOf: () => 'IL-6' };

  it('escapes text and folds long lines at 75 bytes, never inside a character', () => {
    expect(icsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const folded = foldLine('SUMMARY:' + 'µ'.repeat(60));
    for (const line of folded.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe('SUMMARY:' + 'µ'.repeat(60));
  });

  it('holds entries on their days and at their times, and open tasks; nothing from the pages', () => {
    const list: DocMeta[] = [
      entry({ path: 'a', date: '2026-10-24', time: '09:30', endTime: '12:00', status: 'planned', modified: '2026-10-20T10:00:00Z' }),
      entry({ path: 'b', id: 'EXP-0002', title: 'Westerns', date: '2026-10-26', end: '2026-10-28' }),
      entry({ path: 'c', id: 'EXP-0003', title: 'No date' }),
      doc({
        path: 'Boards/Lab/_board.md',
        kind: 'board',
        title: 'Lab',
        columns: [
          { id: 'todo', name: 'To do', color: 'gray' },
          { id: 'done', name: 'Done', color: 'green' },
        ],
      }),
      doc({ path: 'Boards/Lab/T-0001 Order Q5.md', kind: 'card', id: 'T-0001', title: 'Order Q5', due: '2026-10-25', status: 'todo' }),
      doc({ path: 'Boards/Lab/T-0002 Pour plates.md', kind: 'card', id: 'T-0002', title: 'Pour plates', due: '2026-10-25', status: 'done' }),
    ];
    const docs = Object.fromEntries(list.map((d) => [d.path, d]));
    const { ics, count } = notebookCalendar(docs, opts);
    expect(count).toBe(3);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('X-WR-CALNAME:Smith lab · Assaycraft');
    // A timed entry, in UTC (the tests run in UTC).
    expect(ics).toContain('DTSTART:20261024T093000Z\r\nDTEND:20261024T120000Z');
    expect(ics).toContain('SUMMARY:EXP-0001 ELISA');
    expect(ics).toContain('DESCRIPTION:Project: IL-6\\nStatus: Planned');
    // A multi-day entry: all day, ending the day after its last day.
    expect(ics).toContain('DTSTART;VALUE=DATE:20261026\r\nDTEND;VALUE=DATE:20261029');
    // Open tasks only.
    expect(ics).toContain('SUMMARY:Order Q5');
    expect(ics).not.toContain('Pour plates');
    // Built again from the same notebook, the file is the same (so it is only sent when the plan changes).
    expect(notebookCalendar(docs, opts).ics).toBe(ics);
  });

  it('gives a timed entry without an end an hour', () => {
    const { ics } = notebookCalendar({ a: entry({ path: 'a', date: '2026-10-24', time: '15:00' }) }, opts);
    expect(ics).toContain('DTSTART:20261024T150000Z\r\nDURATION:PT1H');
  });
});

const LAB = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
X-WR-CALNAME:Lab bookings
BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:meeting@lab
DTSTART;TZID=America/New_York:20261005T100000
DTEND;TZID=America/New_York:20261005T110000
RRULE:FREQ=WEEKLY;BYDAY=MO
EXDATE;TZID=America/New_York:20261012T100000
SUMMARY:Lab meeting
LOCATION:Room 2.14
END:VEVENT
BEGIN:VEVENT
UID:meeting@lab
RECURRENCE-ID;TZID=America/New_York:20261019T100000
DTSTART;TZID=America/New_York:20261020T150000
DTEND;TZID=America/New_York:20261020T160000
SUMMARY:Lab meeting (moved)
END:VEVENT
BEGIN:VEVENT
UID:confocal@lab
DTSTART;VALUE=DATE:20261021
DTEND;VALUE=DATE:20261023
SUMMARY:Confocal booked\\, whole day
END:VEVENT
BEGIN:VEVENT
UID:cancelled@lab
STATUS:CANCELLED
DTSTART:20261022T090000Z
DTEND:20261022T100000Z
SUMMARY:Called off
END:VEVENT
END:VCALENDAR
`;

describe('other calendars', () => {
  const cal: CalendarLink = { id: 'lab', name: 'Lab bookings', url: 'https://example.org/lab.ics', color: 'teal' };

  it('take webcal and https addresses', () => {
    expect(normalizeCalendarUrl(' webcal://p01-caldav.icloud.com/published/2/abc ')).toBe('https://p01-caldav.icloud.com/published/2/abc');
    expect(normalizeCalendarUrl('https://calendar.google.com/calendar/ical/x/basic.ics')).toBe(
      'https://calendar.google.com/calendar/ical/x/basic.ics',
    );
    expect(normalizeCalendarUrl('ftp://x')).toBeNull();
    expect(normalizeCalendarUrl('not a link')).toBeNull();
  });

  it('show repeating events in this time zone, without the skipped ones, with the moved one moved', async () => {
    const parsed = await parseCalendar(LAB);
    expect(parsed.name).toBe('Lab bookings');
    const events = (await eventsBetween(cal, parsed, '2026-10-01', '2026-10-31')).sort((a, b) => (a.start + a.time).localeCompare(b.start + b.time));
    const summary = events.map((e) => `${e.start}${e.time ? ' ' + e.time + '-' + e.endTime : '..' + e.end} ${e.title}`);
    expect(summary).toEqual([
      // 10:00 in New York (EDT) is 14:00 UTC.
      '2026-10-05 14:00-15:00 Lab meeting',
      '2026-10-20 19:00-20:00 Lab meeting (moved)',
      '2026-10-21..2026-10-22 Confocal booked, whole day',
      '2026-10-26 14:00-15:00 Lab meeting',
    ]);
    expect(events[0].location).toBe('Room 2.14');
  });

  it('follow the clocks: after the switch to winter time the meeting is at 15:00 UTC', async () => {
    const parsed = await parseCalendar(LAB);
    const nov = await eventsBetween(cal, parsed, '2026-11-01', '2026-11-10');
    expect(nov.map((e) => `${e.start} ${e.time}`)).toEqual(['2026-11-02 15:00', '2026-11-09 15:00']);
  });

  it('say so when the file is not a calendar', async () => {
    await expect(parseCalendar('<html>Sign in</html>')).rejects.toThrow(/not give a calendar/);
  });
});
