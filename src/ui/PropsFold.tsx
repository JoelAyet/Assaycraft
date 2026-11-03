/**
 * On a phone, a page's properties (status, date, tags, protocols…) take most of the first screen.
 * There they fold into one line that says the essentials, "● In progress · Tue, Nov 3 · cloning ·
 * 2 protocols", and open with a tap. On a computer they are shown as they are.
 */
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useNotebook } from '../notebook/store';
import { LAYOUT, type DocMeta } from '../notebook/model';
import { dirname } from '../lib/path';
import { formatTimeRange } from '../lib/dates';
import { StatusPill, statusOf } from './status';

const PHONE = '(max-width: 760px)';
const KEY = 'assaycraft:propertiesOpen';

function usePhone(): boolean {
  return useSyncExternalStore(
    (change) => {
      const mq = window.matchMedia(PHONE);
      mq.addEventListener('change', change);
      return () => mq.removeEventListener('change', change);
    },
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}

function remembered(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** "2026-11-03" → "Tue, Nov 3" (read as a day here, not as midnight in London). */
function shortDay(ymd: string | undefined): string {
  const m = ymd && /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

const FOLDED = new Set<DocMeta['kind']>(['entry', 'card', 'protocol']);

export function PropsFold({ meta, children }: { meta: DocMeta; children: ReactNode }) {
  const phone = usePhone();
  const [open, setOpen] = useState(remembered);
  const entryStatuses = useNotebook((s) => s.config.entryStatuses);
  const board = useNotebook((s) => (meta.kind === 'card' ? s.docs[`${dirname(meta.path)}/${LAYOUT.boardFile}`] : undefined));
  if (!phone || !FOLDED.has(meta.kind)) return <>{children}</>;

  const status =
    meta.kind === 'entry' ? statusOf(entryStatuses, meta.status) : meta.kind === 'card' ? statusOf(board?.columns ?? [], meta.status) : undefined;
  const bits: string[] = [];
  if (meta.kind === 'protocol' && meta.version) bits.push(`v${meta.version}`);
  const day = shortDay(meta.date);
  if (day) bits.push(meta.end && meta.end !== meta.date ? `${day} → ${shortDay(meta.end)}` : day);
  const time = formatTimeRange(meta.time, meta.endTime);
  if (time) bits.push(time);
  if (meta.tags.length) bits.push(meta.tags.length > 2 ? `${meta.tags.slice(0, 2).join(', ')} +${meta.tags.length - 2}` : meta.tags.join(', '));
  const protocols = meta.protocols?.length ?? 0;
  if (protocols && meta.kind !== 'protocol') bits.push(`${protocols} protocol${protocols === 1 ? '' : 's'}`);

  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(KEY, open ? '0' : '1');
    } catch {
      /* not remembered */
    }
  };
  return (
    <div className={`gc-props-fold ${open ? 'is-open' : ''}`}>
      <button type="button" className="gc-props-summary" aria-expanded={open} onClick={toggle}>
        {status && <StatusPill status={status} />}
        <span className="gc-props-summary-text">{bits.join(' · ') || 'Details'}</span>
        <span className="gc-props-summary-toggle">
          {open ? 'Less' : 'Details'}
          <ChevronDown />
        </span>
      </button>
      {open && children}
    </div>
  );
}
