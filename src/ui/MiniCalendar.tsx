import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { LOCALE, localDate } from '../lib/dates';
import { useNotebook, weekStartDay } from '../notebook/store';

const pad = (n: number) => String(n).padStart(2, '0');
const ymdOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** A month to pick a day from; the notebook's first day of the week starts each row. */
export function MiniCalendar({ value, onPick, label = 'Pick a day' }: { value?: string; onPick: (ymd: string) => void; label?: string }) {
  const weekStart = useNotebook((s) => weekStartDay(s.weekStart));
  const today = localDate();
  const [shown, setShown] = useState(() => {
    const [y, m] = (value ?? today).split('-').map(Number);
    return { y, m: m - 1 };
  });
  const first = new Date(shown.y, shown.m, 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const days = new Date(shown.y, shown.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const names = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + weekStart + i).toLocaleDateString(LOCALE, { weekday: 'narrow' }));
  const go = (n: number) => setShown(({ y, m }) => ({ y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 }));
  return (
    <div className="gc-minical" role="group" aria-label={label}>
      <div className="gc-minical-head">
        <button className="icon-btn icon-btn-sm" aria-label="Previous month" onClick={() => go(-1)}>
          <ChevronLeft />
        </button>
        <span className="gc-minical-title">{first.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' })}</span>
        <button className="icon-btn icon-btn-sm" aria-label="Next month" onClick={() => go(1)}>
          <ChevronRight />
        </button>
      </div>
      <div className="gc-minical-grid">
        {names.map((n, i) => (
          <span key={`h${i}`} className="gc-minical-dow" aria-hidden="true">
            {n}
          </span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const ymd = ymdOf(shown.y, shown.m, d);
          const name = new Date(shown.y, shown.m, d).toLocaleDateString(LOCALE, { weekday: 'long', month: 'long', day: 'numeric' });
          return (
            <button
              key={i}
              className={`gc-minical-day ${ymd === value ? 'is-picked' : ''} ${ymd === today ? 'is-today' : ''}`}
              aria-label={name}
              aria-pressed={ymd === value}
              onClick={() => onPick(ymd)}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}
