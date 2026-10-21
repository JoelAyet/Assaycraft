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
