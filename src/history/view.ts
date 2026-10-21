/** What the version history window lists: the current file and the stored versions, ready to compare. */
import { splitFrontMatter } from '../notebook/frontmatter';
import { countChanges, type ChangeCount } from './diff';
import { versionTexts, type HistoryFile } from './store';

export interface HistoryItem {
  key: string;
  /** When this version was saved. */
  t: number;
  /** The whole file (what a restore writes back). */
  text: string;
  body: string;
  props: Record<string, unknown>;
  current: boolean;
  label?: string;
  oldest: boolean;
  /** Words added and removed since the version before it (none for the oldest). */
  delta: ChangeCount | null;
  /** Properties changed since the version before it. */
  propsChanged: number;
}

/** Changes every save, so not worth showing. */
const IGNORED = new Set(['modified']);

function parts(text: string) {
  const { data, body } = splitFrontMatter(text);
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!IGNORED.has(k)) props[k] = v;
  return { body, props };
}

export function showValue(v: unknown): string {
  if (v === undefined || v === null || v === '') return '';
  if (Array.isArray(v)) return v.map(showValue).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export interface PropChange {
  key: string;
  from: string;
  to: string;
}

export function propChanges(from: Record<string, unknown>, to: Record<string, unknown>): PropChange[] {
  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])];
  return keys.map((key) => ({ key, from: showValue(from[key]), to: showValue(to[key]) })).filter((c) => c.from !== c.to);
}

/**
 * Newest first: the current file, then the stored versions. A version that differs from the one
 * after it only in its "modified" time is left out, as there is nothing to see.
 */
export function historyItems(current: { text: string; t: number } | null, h: HistoryFile | null): HistoryItem[] {
  const items: HistoryItem[] = [];
  const add = (text: string, t: number, key: string, isCurrent: boolean, label?: string) => {
    const p = parts(text);
    const prev = items[items.length - 1];
    if (prev && prev.body === p.body && !propChanges(prev.props, p.props).length) return;
    items.push({ key, t, text, ...p, current: isCurrent, label, oldest: false, delta: null, propsChanged: 0 });
  };
  if (current) add(current.text, current.t, 'current', true);
  if (h) {
    const texts = versionTexts(h);
    texts.forEach((text, i) => add(text, h.versions[i].t, `v${h.versions[i].t}-${i}`, false, h.versions[i].label));
  }
  for (let i = 0; i < items.length - 1; i++) {
    items[i].delta = countChanges(items[i + 1].body, items[i].body);
    items[i].propsChanged = propChanges(items[i + 1].props, items[i].props).length;
  }
  if (items.length > 1) items[items.length - 1].oldest = true;
  return items;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** "Today", "Yesterday" or the date, for grouping versions by day. */
export function dayLabel(t: number, now = Date.now()): string {
  const d = new Date(t);
  const today = new Date(now);
  if (dayKey(d) === dayKey(today)) return 'Today';
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (dayKey(d) === dayKey(yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export const timeLabel = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
