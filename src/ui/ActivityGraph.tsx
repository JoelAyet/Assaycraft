import { useMemo, type CSSProperties } from 'react';
import { activityByDay, useActivity } from '../notebook/activity';
import { useNotebook, weekStartDay } from '../notebook/store';
import { localDate } from '../lib/dates';

const WEEKS = 26;

const dayLabel = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

/** A GitHub-style contributions graph: one square per day, darker the more documents were edited. */
export function ActivityGraph() {
  const log = useActivity((s) => s.days);
  const docs = useNotebook((s) => s.docs);
  const counts = useMemo(() => activityByDay(log, Object.values(docs)), [log, docs]);
  const weekStart = useNotebook((s) => weekStartDay(s.weekStart));
  const todayYmd = localDate();

  const { cells, months, weekdays, max, active } = useMemo(() => {
    // Noon, so adding days never trips over a daylight-saving change.
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const start = new Date(today);
    start.setDate(today.getDate() - ((today.getDay() - weekStart + 7) % 7) - (WEEKS - 1) * 7);
    const cells: { day: string; date: Date; count: number; week: number; row: number }[] = [];
    const months: { week: number; label: string }[] = [];
    for (let i = 0; i < WEEKS * 7; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const day = localDate(date);
      if (day > todayYmd) break;
      const week = Math.floor(i / 7);
      cells.push({ day, date, count: counts.get(day) ?? 0, week, row: i % 7 });
      if (date.getDate() === 1 && week < WEEKS - 1) months.push({ week, label: date.toLocaleDateString(undefined, { month: 'short' }) });
    }
    // Monday, Wednesday and Friday are labelled, whichever day the week starts on.
    const weekdays = [0, 1, 2, 3, 4, 5, 6]
      .filter((row) => [1, 3, 5].includes((weekStart + row) % 7))
      .map((row) => ({ row, label: cells[row]?.date.toLocaleDateString(undefined, { weekday: 'short' }) ?? '' }));
    const max = Math.max(0, ...cells.map((c) => c.count));
    return { cells, months, weekdays, max, active: cells.filter((c) => c.count > 0).length };
  }, [counts, weekStart, todayYmd]);

  const level = (n: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
  const summary = active ? `Active on ${active} ${active === 1 ? 'day' : 'days'} in the last 6 months` : 'No edits in the last 6 months yet';

  return (
    <figure className="gc-activity">
      <div className="gc-activity-grid" role="img" aria-label={summary} style={{ '--weeks': WEEKS } as CSSProperties}>
        {months.map((m) => (
          <span key={m.week} className="gc-activity-month" style={{ gridColumn: m.week + 2 }}>
            {m.label}
          </span>
        ))}
        {weekdays.map((w) => (
          <span key={w.row} className="gc-activity-weekday" style={{ gridRow: w.row + 2 }}>
            {w.label}
          </span>
        ))}
        {cells.map((c) => (
          <span
            key={c.day}
            className={`gc-activity-cell level-${level(c.count)}${c.day === todayYmd ? ' is-today' : ''}`}
            style={{ gridColumn: c.week + 2, gridRow: c.row + 2 }}
            title={`${c.count ? `${c.count} ${c.count === 1 ? 'document' : 'documents'} edited` : 'No edits'} · ${dayLabel(c.date)}`}
            data-day={c.day}
            data-count={c.count}
          />
        ))}
      </div>
      <figcaption className="gc-activity-foot">
        <span>{summary}</span>
        <span className="gc-activity-legend" aria-hidden>
          Less
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className={`gc-activity-cell level-${l}`} />
          ))}
          More
        </span>
      </figcaption>
    </figure>
  );
}
