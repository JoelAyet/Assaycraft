const pad = (n: number, w = 2) => String(Math.abs(Math.trunc(n))).padStart(w, '0');

/** ISO 8601 timestamp in local time with offset, e.g. 2026-10-16T14:03:00+02:00 */
export function localIso(date = new Date()): string {
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(off / 60)}:${pad(off % 60)}`
  );
}

/** YYYY-MM-DD in local time. */
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function localTime(date = new Date()): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A time of day as written in front matter ("9:30", "09:30"), as HH:MM; anything else is no time. */
export function timeOfDay(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(value);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return undefined;
  return `${pad(Number(m[1]))}:${m[2]}`;
}

/** A time as typed: "9", "930", "9:30", "9.30", "14h30", "2pm", "2:30 PM". */
export function parseTypedTime(input: string): string | undefined {
  const m = /^\s*(\d{1,2})(?:\s*[:.h]\s*(\d{2})|(\d{2}))?\s*([ap])?\.?\s*m?\.?\s*$/i.exec(input);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2] ?? m[3] ?? 0);
  const ampm = m[4]?.toLowerCase();
  if (ampm) {
    if (h < 1 || h > 12) return undefined;
    h = (h % 12) + (ampm === 'p' ? 12 : 0);
  }
  if (h > 23 || min > 59) return undefined;
  return `${pad(h)}:${pad(min)}`;
}

/** Minutes from midnight of HH:MM. */
export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** HH:MM shown the way this browser shows times ("9:30 AM", "09:30"). */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** A time in few characters, for a calendar chip: "9:30am", "4pm" (or "09:30", "16:00" on a 24-hour clock). */
export function formatTimeShort(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const parts = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).formatToParts(new Date(2000, 0, 1, h, m));
  const twelve = parts.some((p) => p.type === 'dayPeriod');
  let out = '';
  parts.forEach((p, i) => {
    if (twelve && m === 0 && (p.type === 'minute' || (p.type === 'literal' && parts[i + 1]?.type === 'minute'))) return;
    if (p.type === 'dayPeriod') out = out.trimEnd() + p.value.replace(/[.\s]/g, '').toLowerCase();
    else out += p.value;
  });
  return out.trim();
}

/** "9:30 – 12:00", or the start alone. */
export function formatTimeRange(time?: string, endTime?: string): string {
  if (!time) return endTime ? `– ${formatTime(endTime)}` : '';
  return endTime ? `${formatTime(time)} – ${formatTime(endTime)}` : formatTime(time);
}

export function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: unknown, withTime = false): string {
  const d = parseDate(value);
  if (!d) return '';
  const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString(undefined, opts);
}

/** "just now", "5 min ago", "3 h ago", "yesterday", or a date. */
export function formatRelative(value: unknown, now = Date.now()): string {
  const d = parseDate(value);
  if (!d) return '';
  const s = Math.round((now - d.getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  if (s < 7 * 86400) return `${Math.round(s / 86400)} days ago`;
  return formatDate(d);
}

export function longDate(date = new Date()): string {
  return date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/** First day of the week in the browser's locale (0 = Sunday, 1 = Monday). */
export function firstDayOfWeek(): number {
  try {
    const loc = new Intl.Locale(navigator.language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const fd = loc.getWeekInfo?.().firstDay ?? loc.weekInfo?.firstDay;
    if (fd) return fd % 7; // 7 (Sunday) → 0
  } catch {
    /* ignore */
  }
  return 1; // Monday
}
