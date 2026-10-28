import { parseDate, timeOfDay } from '../lib/dates';
import type { Reminder } from '../reminders/model';
import type { CalendarLink } from '../calendar/external';
import { dirname, join } from '../lib/path';
import type { StockItem } from '../stocks/model';

export type DocKind = 'entry' | 'template' | 'subtemplate' | 'card' | 'board' | 'protocol' | 'stocks' | 'note' | 'reference';

export type ColorName = 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink' | 'red';
export const COLOR_NAMES: ColorName[] = ['gray', 'brown', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'red'];

export interface StatusOption {
  id: string;
  name: string;
  color: ColorName;
}

export const DEFAULT_ENTRY_STATUSES: StatusOption[] = [
  { id: 'planned', name: 'Planned', color: 'gray' },
  { id: 'in-progress', name: 'In progress', color: 'blue' },
  { id: 'completed', name: 'Completed', color: 'green' },
  { id: 'failed', name: 'Failed', color: 'red' },
];

export const DEFAULT_BOARD_COLUMNS: StatusOption[] = [
  { id: 'todo', name: 'To do', color: 'gray' },
  { id: 'doing', name: 'In progress', color: 'blue' },
  { id: 'done', name: 'Done', color: 'green' },
];

/**
 * What a board's cards are (front matter `cards:`): tasks, with a due date and priority, shown on the
 * calendar and on Home; or things to track through stages (constructs, samples, orders…), which have
 * neither. Boards made before there was a choice hold tasks.
 */
export type BoardCards = 'tasks' | 'items';
export const boardCards = (board: Pick<DocMeta, 'extra'> | undefined): BoardCards => (board?.extra?.cards === 'items' ? 'items' : 'tasks');
/** The board a card is on. */
export const boardOf = (card: Pick<DocMeta, 'path'>, docs: Record<string, DocMeta>): DocMeta | undefined =>
  docs[join(dirname(card.path), LAYOUT.boardFile)];
/** A card on a task board. */
export const isTask = (d: DocMeta, docs: Record<string, DocMeta>) => d.kind === 'card' && boardCards(boardOf(d, docs)) === 'tasks';
/** What one card on the board is called. */
export const cardNoun = (cards: BoardCards) => (cards === 'tasks' ? 'task' : 'card');

export const PROTOCOL_STATUSES: StatusOption[] = [
  { id: 'draft', name: 'Draft', color: 'yellow' },
  { id: 'active', name: 'Active', color: 'green' },
  { id: 'retired', name: 'Retired', color: 'gray' },
];

/** One released version of a protocol (newest first in `DocMeta.revisions`). */
export interface Revision {
  version: string;
  date: string;
  note?: string;
  author?: string;
}

export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export const PRIORITIES: { id: Priority; name: string; color: ColorName }[] = [
  { id: 'urgent', name: 'Urgent', color: 'red' },
  { id: 'high', name: 'High', color: 'orange' },
  { id: 'medium', name: 'Medium', color: 'yellow' },
  { id: 'low', name: 'Low', color: 'gray' },
];

/** Everything Assaycraft knows about a Markdown file in the notebook (from its front matter). */
export interface DocMeta {
  path: string;
  kind: DocKind;
  id: string;
  title: string;
  status?: string;
  tags: string[];
  author?: string;
  created?: string;
  modified?: string;
  /** Entries: experiment date (YYYY-MM-DD). */
  date?: string;
  /** Entries: last day of a multi-day experiment. */
  end?: string;
  /** Entries: start time on `date` (HH:MM), for a planned experiment. */
  time?: string;
  /** Entries: end time (HH:MM), on `end` or else on `date`. */
  endTime?: string;
  /** Cards: start date. */
  start?: string;
  /** Cards: due date. */
  due?: string;
  priority?: Priority;
  /** Cards: position within their column. */
  order?: number;
  /** Cards: linked entry ids. */
  links?: string[];
  /** Entries, templates and cards: ids of the protocols they follow. */
  protocols?: string[];
  /** Protocols: current version, e.g. "1.2". */
  version?: string;
  /** Protocols: released versions, newest first. */
  revisions?: Revision[];
  /** Protocols imported from a file (e.g. a PDF): the original, relative to the doc's folder. */
  source?: string;
  /** Entries: name of the template it was created from. */
  template?: string;
  /** Entries: the outcome in one line (shown where the entry is a step of a flow). */
  result?: string;
  /** Templates and boards. */
  description?: string;
  locked?: boolean;
  /** Boards: column definitions. */
  columns?: StatusOption[];
  /** Front-matter keys Assaycraft does not use, preserved on save. */
  extra: Record<string, unknown>;
  mtime: number;
  /** Plain text of the body, for search. */
  text: string;
  /** Computed: ids of sub-templates referenced by the body. */
  includes?: string[];
  /** Computed: checklist progress in the body. */
  tasks?: { done: number; total: number };
  /** Computed, stock collections: their stocks (one per table row). */
  stockItems?: StockItem[];
  /** Computed: ids of notebook docs linked from the body ("EXP-0002 Title.md" → EXP-0002). */
  refs?: string[];
  /** Computed: the steps of the flow block in the body, if there is one. */
  flow?: FlowStepRef[];
  /** Computed: reminders in the body, "(@2026-10-30 14:00)". */
  reminders?: Reminder[];
}

/** One step of a flow, as far as other pages need to know: its title and, once started, its entry's id. */
export interface FlowStepRef {
  title: string;
  ref?: string;
  /** ID or title of the template a new entry for the step starts from. */
  template?: string;
  /** The day it is planned for, while it is not started. */
  date?: string;
}

export interface NotebookConfig {
  app: 'assaycraft';
  version: 1;
  name: string;
  author: string;
  idPrefix: string;
  idDigits: number;
  cardPrefix: string;
  protocolPrefix: string;
  entryStatuses: StatusOption[];
  created: string;
  /** Other calendars shown in the calendar (read-only), by their iCal address. */
  calendars?: CalendarLink[];
  /** Colours chosen for tags (others get one from their name). */
  tagColors?: Record<string, ColorName>;
  /** Colours chosen for projects on the calendar (others get one from their name). */
  projectColors?: Record<string, ColorName>;
}

export const LAYOUT = {
  config: 'assaycraft.json',
  /** Settings files of notebooks made before the app was renamed (Labcraft, and Genecraft before it); moved to `config` when opened. */
  legacyConfigs: ['labcraft.json', 'genecraft.json'],
  /** The app's own files in the notebook: version history and activity. */
  appDir: '.assaycraft',
  /** That folder in notebooks made before the app was renamed (Labcraft); moved to `appDir` when opened. */
  legacyAppDir: '.labcraft',
  projects: 'Projects',
  templates: 'Templates',
  subtemplates: 'Templates/Sub-templates',
  boards: 'Boards',
  protocols: 'Protocols',
  stocks: 'Stocks',
  notes: 'Notes',
  literature: 'Literature',
  attachments: 'attachments',
  boardFile: '_board.md',
} as const;

const KNOWN_KEYS = new Set([
  'id',
  'kind',
  'title',
  'status',
  'priority',
  'date',
  'end',
  'time',
  'end-time',
  'start',
  'due',
  'tags',
  'links',
  'protocols',
  'version',
  'revisions',
  'source',
  'author',
  'created',
  'modified',
  'template',
  'result',
  'description',
  'locked',
  'order',
  'columns',
]);

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
  const s = String(v).trim();
  return s || undefined;
}

function dateOnly(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : undefined;
}

function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter((x): x is string => !!x);
  if (typeof v === 'string')
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

function revisionsOf(v: unknown): Revision[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Revision[] = [];
  for (const r of v) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const version = str(o.version);
    if (!version) continue;
    out.push({ version, date: dateOnly(o.date) ?? '', note: str(o.note), author: str(o.author) });
  }
  return out.length ? out : undefined;
}

function columnsOf(v: unknown): StatusOption[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: StatusOption[] = [];
  for (const c of v) {
    if (!c || typeof c !== 'object') continue;
    const o = c as Record<string, unknown>;
    const name = str(o.name) ?? str(o.id);
    if (!name) continue;
    const color = (COLOR_NAMES as string[]).includes(String(o.color)) ? (o.color as ColorName) : 'gray';
    out.push({ id: str(o.id) ?? slugify(name), name, color });
  }
  return out.length ? out : undefined;
}

export function slugify(s: string): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'item'
  );
}

export function metaFromFrontMatter(
  path: string,
  kind: DocKind,
  data: Record<string, unknown>,
  fallbackTitle: string,
): Omit<DocMeta, 'mtime' | 'text'> {
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!KNOWN_KEYS.has(k)) extra[k] = v;
  const priority = str(data.priority) as Priority | undefined;
  const order = Number(data.order);
  return {
    path,
    kind,
    id: str(data.id) ?? '',
    title: str(data.title) ?? fallbackTitle,
    status: str(data.status),
    tags: strList(data.tags),
    author: str(data.author),
    created: str(data.created),
    modified: str(data.modified),
    date: dateOnly(data.date),
    end: dateOnly(data.end),
    time: timeOfDay(data.time),
    endTime: timeOfDay(data['end-time']),
    start: dateOnly(data.start),
    due: dateOnly(data.due),
    priority: priority && PRIORITIES.some((p) => p.id === priority) ? priority : undefined,
    order: Number.isFinite(order) ? order : undefined,
    links: strList(data.links),
    protocols: strList(data.protocols),
    version: str(data.version),
    revisions: revisionsOf(data.revisions),
    source: str(data.source),
    template: str(data.template),
    result: str(data.result),
    description: str(data.description),
    locked: data.locked === true || data.locked === 'true' ? true : undefined,
    columns: columnsOf(data.columns),
    extra,
  };
}

export function frontMatterFromMeta(meta: Omit<DocMeta, 'mtime' | 'text' | 'path'>): Record<string, unknown> {
  const fm: Record<string, unknown> = {
    id: meta.id || undefined,
    kind: meta.kind === 'entry' ? undefined : meta.kind,
    title: meta.title,
    status: meta.status,
    priority: meta.priority,
    date: meta.date,
    end: meta.end,
    time: meta.time,
    'end-time': meta.endTime,
    start: meta.start,
    due: meta.due,
    tags: meta.tags,
    links: meta.links,
    protocols: meta.protocols,
    version: meta.version,
    source: meta.source,
    author: meta.author,
    created: meta.created,
    modified: meta.modified,
    template: meta.template,
    result: meta.result || undefined,
    description: meta.description,
    locked: meta.locked || undefined,
    order: meta.order,
    columns: meta.columns,
    revisions: meta.revisions?.map((r) => ({
      version: r.version,
      date: r.date || undefined,
      note: r.note || undefined,
      author: r.author || undefined,
    })),
  };
  return { ...fm, ...meta.extra };
}

/** The version after `v`: "1.0" → "1.1", "2" → "3", "v1.9" → "v1.10". */
export function nextVersion(v?: string): string {
  if (!v) return '1.0';
  const m = /^(.*?)(\d+)(\D*)$/.exec(v);
  return m ? `${m[1]}${Number(m[2]) + 1}${m[3]}` : `${v}.1`;
}

/** Docs that link to `target`: through their protocols or linked entries, or with a link in their text. */
export function backlinksOf(target: DocMeta, docs: Iterable<DocMeta>): DocMeta[] {
  const id = target.id;
  if (!id) return [];
  const out: DocMeta[] = [];
  for (const d of docs) {
    if (d.path === target.path || d.kind === 'board') continue;
    if (d.protocols?.includes(id) || d.links?.includes(id) || d.refs?.includes(id)) out.push(d);
  }
  return out;
}

/** Calendar span of a doc, as YYYY-MM-DD strings (null when it has no date). */
export function docSpan(meta: DocMeta): { start: string; end: string } | null {
  if (meta.kind === 'entry') {
    const start = meta.date ?? (meta.created ? toYmd(meta.created) : undefined);
    if (!start) return null;
    const end = meta.end && meta.end >= start ? meta.end : start;
    return { start, end };
  }
  if (meta.kind === 'card') {
    const start = meta.start ?? meta.due;
    if (!start) return null;
    const end = meta.due && meta.due >= start ? meta.due : start;
    return { start, end };
  }
  return null;
}

export function toYmd(value: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = parseDate(value);
  if (!d) return undefined;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
