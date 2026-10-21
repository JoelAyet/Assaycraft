/**
 * The days you worked in the notebook, for the contributions graph on Home. Each day lists the
 * documents edited (by id, or by path when they have none). The log is saved in the notebook
 * (.assaycraft/activity.json), so it travels with the folder and with .zip exports.
 */
import { create } from 'zustand';
import type { Vault } from '../fs/types';
import { localDate } from '../lib/dates';
import { toYmd, type DocMeta } from './model';
import { EXAMPLE_ENTRY_ID } from './seed';

export const ACTIVITY_DIR = '.assaycraft';
export const ACTIVITY_FILE = '.assaycraft/activity.json';

/** Day (YYYY-MM-DD) → documents edited that day. */
export type ActivityLog = Record<string, string[]>;

export const useActivity = create<{ days: ActivityLog }>(() => ({ days: {} }));

export function parseActivity(text: string): ActivityLog {
  const out: ActivityLog = {};
  try {
    const days = (JSON.parse(text) as { days?: unknown }).days;
    if (days && typeof days === 'object')
      for (const [day, docs] of Object.entries(days))
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Array.isArray(docs)) out[day] = docs.filter((d): d is string => typeof d === 'string');
  } catch {
    // An unreadable log starts again empty.
  }
  return out;
}

/** One line per day, oldest first, so the file stays readable and diffs well. */
export function serializeActivity(days: ActivityLog): string {
  const lines = Object.keys(days)
    .sort()
    .map((day) => `    ${JSON.stringify(day)}: ${JSON.stringify(days[day])}`);
  return `{\n  "version": 1,\n  "days": {\n${lines.join(',\n')}${lines.length ? '\n' : ''}  }\n}\n`;
}

export function mergeActivity(a: ActivityLog, b: ActivityLog): ActivityLog {
  const out: ActivityLog = { ...a };
  for (const [day, docs] of Object.entries(b)) out[day] = [...new Set([...(out[day] ?? []), ...docs])];
  return out;
}

const docKey = (d: Pick<DocMeta, 'id' | 'path'>) => d.id || d.path;

let current: Vault | null = null;
let saving: Promise<void> = Promise.resolve();

async function readLog(v: Vault): Promise<ActivityLog> {
  return (await v.stat(ACTIVITY_FILE)) ? parseActivity(await v.readText(ACTIVITY_FILE)) : {};
}

function save(v: Vault) {
  saving = saving
    .then(async () => {
      if (current !== v) return;
      if (!(await v.exists(ACTIVITY_DIR))) await v.mkdir(ACTIVITY_DIR);
      await v.write(ACTIVITY_FILE, serializeActivity(useActivity.getState().days));
    })
    .catch((err) => console.warn('Could not save the activity log', err));
  return saving;
}

/** Load the log of a notebook that was just opened (or `null` when it closes). */
export async function loadActivity(v: Vault | null) {
  current = v;
  useActivity.setState({ days: v ? await readLog(v).catch(() => ({})) : {} });
}

/** Pick up days logged elsewhere, e.g. on another computer sharing the folder. */
export async function reloadActivity(v: Vault) {
  if (current !== v) return;
  const disk = await readLog(v).catch(() => ({}));
  useActivity.setState((s) => ({ days: mergeActivity(s.days, disk) }));
}

/** Add days from another copy of the notebook (an imported .zip). */
export async function importActivity(text: string) {
  if (!current) return;
  useActivity.setState((s) => ({ days: mergeActivity(s.days, parseActivity(text)) }));
  await save(current);
}

/** Note that a document was edited today (written at most once per document a day). */
export function recordEdit(doc: Pick<DocMeta, 'id' | 'path'>, day = localDate()) {
  const v = current;
  if (!v) return;
  const key = docKey(doc);
  const { days } = useActivity.getState();
  if (days[day]?.includes(key)) return;
  useActivity.setState({ days: { ...days, [day]: [...(days[day] ?? []), key] } });
  void save(v);
}

export function flushActivity() {
  return saving;
}

/**
 * Documents edited per day: the log, plus what the files themselves say for work done before the
 * log existed (the day an entry was made, and the day any document was last changed).
 */
export function activityByDay(days: ActivityLog, docs: Iterable<DocMeta>): Map<string, number> {
  const sets = new Map<string, Set<string>>();
  const add = (day: string | undefined, key: string) => {
    if (!day) return;
    let set = sets.get(day);
    if (!set) sets.set(day, (set = new Set()));
    set.add(key);
  };
  for (const [day, keys] of Object.entries(days)) for (const k of keys) add(day, k);
  for (const d of docs) {
    if (d.kind === 'board') continue;
    // The day an entry was made counts, except for the example entry that comes with a new notebook.
    if (d.kind === 'entry' && d.created && d.id !== EXAMPLE_ENTRY_ID) add(toYmd(d.created), docKey(d));
    // Unchanged since it was made (e.g. the example templates of a new notebook): not an edit.
    if (d.modified && d.modified !== d.created) add(toYmd(d.modified), docKey(d));
  }
  return new Map([...sets].map(([day, set]) => [day, set.size]));
}
