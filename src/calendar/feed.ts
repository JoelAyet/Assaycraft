/**
 * The private calendar link: Apple, Google or Outlook Calendar subscribe to an address on the website
 * (/cal/<id>.ics) that holds the notebook's plan as an iCalendar file. It is off until turned on. The
 * device that turned it on keeps the copy up to date while the notebook is open on it; the address is
 * long and random, and only that device holds the key to change or delete the copy.
 */
import { create } from 'zustand';
import { getState, useNotebook } from '../notebook/store';
import { projectOf } from '../notebook/actions';
import { getKnownNotebook, updateKnownNotebook } from '../fs/registry';
import { newSecret } from '../sync/crypto';
import { notebookCalendar } from './ics';

interface FeedState {
  /** The address calendar apps subscribe to, when the link is on. */
  url: string | null;
  /** When the copy online was last brought up to date, and how many events it holds. */
  updated?: number;
  count?: number;
  error?: string;
}
export const useFeed = create<FeedState>(() => ({ url: null }));

export const feedUrl = (id: string) => `${location.origin}/cal/${id}.ics`;

let current: { notebook: string; id: string; key: string } | null = null;
let lastSent = '';
let timer: ReturnType<typeof setTimeout> | undefined;
let unsubscribe: (() => void) | null = null;

function build(id: string) {
  const s = getState();
  return notebookCalendar(s.docs, {
    name: `${s.config.name || s.vault?.name || 'Notebook'} · Assaycraft`,
    feedId: id,
    statuses: s.config.entryStatuses,
    projectOf,
  });
}

async function send(): Promise<void> {
  const feed = current;
  if (!feed) return;
  const { ics, count } = build(feed.id);
  if (ics === lastSent) return;
  try {
    const res = await fetch(`/cal/${feed.id}.ics`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${feed.key}`, 'content-type': 'text/calendar; charset=utf-8' },
      body: ics,
    });
    if (!res.ok) throw new Error((await res.text().catch(() => '')) || `The calendar could not be updated (${res.status}).`);
    if (current !== feed) return;
    lastSent = ics;
    useFeed.setState({ updated: Date.now(), count, error: undefined });
  } catch (err) {
    if (current !== feed) return;
    useFeed.setState({ error: (err as Error).message || 'No connection: the calendar will be updated when there is one.' });
  }
}

/** A few seconds after the plan changes (typing a title changes it at every key). */
function schedule(delay = 4000) {
  clearTimeout(timer);
  timer = setTimeout(() => void send(), delay);
}

function watch(notebook: string, id: string, key: string) {
  current = { notebook, id, key };
  lastSent = '';
  useFeed.setState({ url: feedUrl(id), updated: undefined, count: undefined, error: undefined });
  unsubscribe?.();
  // The plan is in the pages' dates, titles and statuses, and in the notebook's settings.
  unsubscribe = useNotebook.subscribe((s, prev) => {
    if (s.docs !== prev.docs || s.config !== prev.config) schedule();
  });
  addEventListener('online', onOnline);
}
const onOnline = () => schedule(500);

/** When a notebook opens: keep its calendar link up to date, if this device has one. */
export async function startFeed(notebook: string): Promise<void> {
  stopFeed();
  const nb = await getKnownNotebook(notebook).catch(() => undefined);
  if (!nb?.feed || getState().vault?.id !== notebook) return;
  watch(notebook, nb.feed.id, nb.feed.key);
  schedule(500);
}

export function stopFeed() {
  clearTimeout(timer);
  unsubscribe?.();
  unsubscribe = null;
  removeEventListener('online', onOnline);
  current = null;
  useFeed.setState({ url: null, updated: undefined, count: undefined, error: undefined });
}

/** Turn the link on: a new address, with this notebook's plan in it. */
export async function enableFeed(): Promise<string> {
  const v = getState().vault;
  if (!v) throw new Error('No notebook is open.');
  const id = newSecret();
  const key = newSecret();
  watch(v.id, id, key);
  await send();
  const err = useFeed.getState().error;
  if (err) {
    stopFeed();
    throw new Error(err);
  }
  await updateKnownNotebook(v.id, (nb) => ({ ...nb, feed: { id, key } }));
  return feedUrl(id);
}

/** Turn the link off: the copy online is deleted, and calendars subscribed to it stop showing it. */
export async function disableFeed(): Promise<void> {
  const feed = current;
  if (!feed) return;
  const res = await fetch(`/cal/${feed.id}.ics`, { method: 'DELETE', headers: { authorization: `Bearer ${feed.key}` } }).catch(() => null);
  if (!res || (!res.ok && res.status !== 404)) throw new Error('No connection: the link could not be turned off. Try again when online.');
  await updateKnownNotebook(feed.notebook, (nb) => ({ ...nb, feed: undefined }));
  stopFeed();
}

/** Send the latest plan now (after a change in Calendars). */
export const refreshFeed = () => schedule(0);
