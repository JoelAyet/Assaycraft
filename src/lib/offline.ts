/**
 * Offline use of the hosted app: a service worker (sw.js, made from src/offline/sw.js when the app is
 * built) keeps a copy of the app, so it opens without a connection after the first visit. A new
 * version is downloaded in the background and used after a reload, when the user chooses.
 * Not used in development, nor by the single file opened from disk (which is already offline).
 */
import { useEffect, useState } from 'react';
import { flushAllWrites } from '../notebook/actions';
import { toast } from '../notebook/store';

const supported = () =>
  !import.meta.env.DEV &&
  import.meta.env.MODE !== 'single' &&
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  location.protocol !== 'file:';

let started = false;

export function registerOffline() {
  if (started || !supported()) return;
  started = true;
  const sw = navigator.serviceWorker;
  const hadCopy = !!sw.controller;
  let updating = false;
  const reload = () => void flushAllWrites().finally(() => location.reload());

  sw.addEventListener('controllerchange', () => {
    if (updating) reload();
    // Another window installed the new version: this one still runs the old one.
    else if (hadCopy) toast('Assaycraft was updated in another window.', 'info', { label: 'Reload', run: reload }, { sticky: true });
  });

  const register = () =>
    sw
      .register('./sw.js')
      .then((reg) => {
        const offer = (worker: ServiceWorker) =>
          toast(
            'A new version of Assaycraft is ready.',
            'info',
            {
              label: 'Reload',
              run: () => {
                updating = true;
                worker.postMessage('update');
              },
            },
            { sticky: true },
          );
        if (reg.waiting && sw.controller) offer(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state !== 'installed') return;
            if (sw.controller) offer(worker);
            else toast('Assaycraft is saved on this device: it now opens without an internet connection.', 'success');
          });
        });
        // Look for a new version when the app comes back to the screen, at most once an hour.
        let checked = Date.now();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'visible' || Date.now() - checked < 3_600_000) return;
          checked = Date.now();
          void reg.update().catch(() => {});
        });
      })
      .catch((err: unknown) => console.warn('The offline copy of Assaycraft could not be set up:', err));

  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register(), { once: true });
}

export type OfflineState = 'file' | 'ready' | 'pending' | 'unavailable';

/** Whether this copy of Assaycraft opens without a connection (for Settings → About). */
export function useOfflineState(): OfflineState {
  const initial = (): OfflineState =>
    typeof location !== 'undefined' && location.protocol === 'file:'
      ? 'file'
      : !supported()
        ? 'unavailable'
        : navigator.serviceWorker.controller
          ? 'ready'
          : 'pending';
  const [state, setState] = useState<OfflineState>(initial);
  useEffect(() => {
    if (!supported()) return;
    const update = () => setState(initial());
    navigator.serviceWorker.addEventListener('controllerchange', update);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', update);
  }, []);
  return state;
}
