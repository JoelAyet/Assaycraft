import { create } from 'zustand';
import type { Vault } from '../fs/types';
import { DEFAULT_ENTRY_STATUSES, type DocMeta, type NotebookConfig } from './model';
import type { TrashItem } from './trash';
import { firstDayOfWeek } from '../lib/dates';

export type Route =
  | { name: 'home' }
  | { name: 'doc'; path: string }
  | { name: 'folder'; path: string }
  | { name: 'board'; path: string }
  | { name: 'calendar' }
  | { name: 'templates' }
  | { name: 'protocols' }
  | { name: 'notes' }
  | { name: 'literature' }
  | { name: 'trash' }
  /** A stock collection, optionally with one stock picked out (from a link). */
  | { name: 'stocks'; path?: string; id?: string }
  | { name: 'settings' }
  /** Connect a phone (on a phone's copy: the connection to its computer). */
  | { name: 'phone' };

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
  /** Stays until dismissed. */
  sticky?: boolean;
}

export type Theme = 'light' | 'dark' | 'system';
export type Accent = 'blue' | 'violet' | 'green' | 'graphite';
export type PageFont = 'sans' | 'serif';
/** First day of the week in the calendar and the activity graph. */
export type WeekStart = 'monday' | 'sunday';
/** As a day number (0 = Sunday), for date maths. */
export const weekStartDay = (w: WeekStart) => (w === 'sunday' ? 0 : 1);
export const ACCENTS: { id: Accent; name: string; color: string }[] = [
  { id: 'blue', name: 'Blue', color: '#0866ff' },
  { id: 'violet', name: 'Violet', color: '#7c3aed' },
  { id: 'green', name: 'Green', color: '#0b7f5f' },
  { id: 'graphite', name: 'Graphite', color: '#3a3a40' },
];
export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface NotebookState {
  vault: Vault | null;
  config: NotebookConfig;
  docs: Record<string, DocMeta>;
  /** Directories under Projects/ (vault paths), sorted. */
  folders: string[];
  /** What is in the notebook's trash, newest first. */
  trash: TrashItem[];
  /** Stable React keys for open docs, so renaming a file does not remount its editor. */
  docKeys: Record<string, string>;
  route: Route;
  loading: boolean;
  scanning: boolean;
  toasts: Toast[];
  theme: Theme;
  /** Accent color and font of entry text (Settings → Appearance), kept in this browser. */
  accent: Accent;
  pageFont: PageFont;
  weekStart: WeekStart;
  saveState: SaveState;
  peek: string | null;
  paletteOpen: boolean;
  /** Phones: the sidebar drawer is open. */
  navOpen: boolean;
}

export const BUILTIN_EXPERIMENTS_BOARD = '@experiments';

export function defaultConfig(name = 'Lab notebook'): NotebookConfig {
  return {
    app: 'assaycraft',
    version: 1,
    name,
    author: '',
    idPrefix: 'EXP-',
    idDigits: 4,
    cardPrefix: 'T-',
    protocolPrefix: 'P-',
    entryStatuses: DEFAULT_ENTRY_STATUSES,
    created: new Date().toISOString(),
  };
}

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (v && (allowed as readonly string[]).includes(v)) return v as T;
  } catch {
    /* storage unavailable */
  }
  return fallback;
}

/** Preferences saved before the app was renamed (Labcraft, and Genecraft before it) carry over once. */
function migrateStoredPreferences() {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    for (const old of ['labcraft:', 'genecraft:'])
      for (const key of keys) {
        if (!key?.startsWith(old)) continue;
        const next = 'assaycraft:' + key.slice(old.length);
        if (localStorage.getItem(next) === null) localStorage.setItem(next, localStorage.getItem(key)!);
      }
  } catch {
    /* storage unavailable */
  }
}
migrateStoredPreferences();

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

const initialTheme = () => stored<Theme>('assaycraft:theme', ['light', 'dark', 'system'], 'system');

export const useNotebook = create<NotebookState>(() => ({
  vault: null,
  config: defaultConfig(),
  docs: {},
  folders: [],
  trash: [],
  docKeys: {},
  route: { name: 'home' },
  loading: false,
  scanning: false,
  toasts: [],
  theme: initialTheme(),
  accent: stored<Accent>(
    'assaycraft:accent',
    ACCENTS.map((a) => a.id),
    'blue',
  ),
  pageFont: stored<PageFont>('assaycraft:font', ['sans', 'serif'], 'sans'),
  // Until chosen in Settings, what the browser's language uses.
  weekStart: stored<WeekStart>('assaycraft:weekStart', ['monday', 'sunday'], firstDayOfWeek() === 1 ? 'monday' : 'sunday'),
  saveState: 'idle',
  peek: null,
  paletteOpen: false,
  navOpen: false,
}));

export const getState = () => useNotebook.getState();
export const setState = useNotebook.setState;

// ───────────── Routing (hash based, so reload/back/forward work) ─────────────

function encodePath(p: string) {
  return p.split('/').map(encodeURIComponent).join('/');
}

export function routeToHash(r: Route): string {
  switch (r.name) {
    case 'home':
      return '#/';
    case 'doc':
      return `#/doc/${encodePath(r.path)}`;
    case 'folder':
      return `#/folder/${encodePath(r.path)}`;
    case 'board':
      return `#/board/${encodePath(r.path)}`;
    case 'stocks':
      return `#/stocks${r.path ? '/' + encodePath(r.path) : ''}${r.id ? `?id=${encodeURIComponent(r.id)}` : ''}`;
    default:
      return `#/${r.name}`;
  }
}

export function hashToRoute(hash: string): Route {
  const [h, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const [head, ...rest] = h.split('/');
  const path = rest
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .join('/');
  switch (head) {
    case 'doc':
      return path ? { name: 'doc', path } : { name: 'home' };
    case 'folder':
      return { name: 'folder', path };
    case 'board':
      return path ? { name: 'board', path } : { name: 'board', path: BUILTIN_EXPERIMENTS_BOARD };
    case 'stocks': {
      const id = new URLSearchParams(query).get('id') || undefined;
      return { name: 'stocks', path: path || undefined, id };
    }
    case 'calendar':
    case 'templates':
    case 'protocols':
    case 'notes':
    case 'literature':
    case 'trash':
    case 'settings':
    case 'phone':
      return { name: head };
    default:
      return { name: 'home' };
  }
}

export function navigate(route: Route, opts: { replace?: boolean } = {}) {
  setState({ route, peek: route.name === 'doc' ? null : getState().peek, navOpen: false });
  const hash = routeToHash(route);
  if (location.hash !== hash) {
    if (opts.replace) history.replaceState(null, '', hash);
    else history.pushState(null, '', hash);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (getState().vault) setState({ route: hashToRoute(location.hash), navOpen: false });
  });
}

// ───────────── Toasts ─────────────

let toastSeq = 0;
export function toast(message: string, kind: Toast['kind'] = 'info', action?: Toast['action'], opts: { sticky?: boolean } = {}) {
  const id = ++toastSeq;
  setState((s) => ({
    toasts: [...s.toasts.filter((t) => !(t.sticky && t.message === message)), { id, message, kind, action, sticky: opts.sticky }],
  }));
  if (!opts.sticky) setTimeout(() => dismissToast(id), kind === 'error' ? 8000 : action ? 6000 : 3500);
}

export function dismissToast(id: number) {
  setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function setTheme(theme: Theme) {
  remember('assaycraft:theme', theme);
  setState({ theme });
}

export function setAccent(accent: Accent) {
  remember('assaycraft:accent', accent);
  setState({ accent });
}

export function setPageFont(pageFont: PageFont) {
  remember('assaycraft:font', pageFont);
  setState({ pageFont });
}

export function setWeekStart(weekStart: WeekStart) {
  remember('assaycraft:weekStart', weekStart);
  setState({ weekStart });
}
