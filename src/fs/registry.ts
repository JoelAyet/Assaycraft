import { openDb, reqToPromise, txDone } from '../lib/idb';
import { HandleVault, ensurePermission } from './handleVault';
import { IdbVault } from './idbVault';
import type { Vault, VaultKind } from './types';

/** A notebook the user opened before, so it can be reopened with one click. */
export interface KnownNotebook {
  id: string;
  kind: VaultKind;
  name: string;
  lastOpened: number;
  handle?: FileSystemDirectoryHandle;
}

// The app's former name (Genecraft): kept so the list of known notebooks survives the rename.
const DB = 'genecraft';
const STORE = 'notebooks';

let dbPromise: Promise<IDBDatabase> | null = null;
function db() {
  dbPromise ??= openDb(DB, 1, (d) => {
    if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
  });
  return dbPromise;
}

export async function listKnownNotebooks(): Promise<KnownNotebook[]> {
  const d = await db();
  const all = await reqToPromise(d.transaction(STORE).objectStore(STORE).getAll() as IDBRequest<KnownNotebook[]>);
  return all.sort((a, b) => b.lastOpened - a.lastOpened);
}

export async function saveKnownNotebook(nb: KnownNotebook): Promise<void> {
  const d = await db();
  const tx = d.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(nb);
  await txDone(tx);
}

export async function forgetNotebook(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(id);
  await txDone(tx);
}

export function newId(): string {
  const rnd = crypto.getRandomValues(new Uint8Array(6));
  return (
    Date.now().toString(36) +
    Array.from(rnd, (b) => b.toString(36).padStart(2, '0'))
      .join('')
      .slice(0, 8)
  );
}

/** Ask the user for a folder and return a vault for it (Chromium browsers only). */
export async function pickFolderVault(): Promise<Vault> {
  if (!window.showDirectoryPicker) throw new Error('This browser cannot open local folders. Use Chrome or Edge, or browser storage.');
  const handle = await window.showDirectoryPicker({ id: 'genecraft-notebook', mode: 'readwrite' });
  if (!(await ensurePermission(handle, true))) throw new Error('Permission to edit the folder was not granted.');
  const known = await listKnownNotebooks();
  let id = newId();
  for (const nb of known) {
    if (nb.handle && (await nb.handle.isSameEntry(handle).catch(() => false))) {
      id = nb.id;
      break;
    }
  }
  await saveKnownNotebook({ id, kind: 'folder', name: handle.name, lastOpened: Date.now(), handle });
  return new HandleVault(handle, id, 'folder');
}

export async function createBrowserVault(name: string): Promise<Vault> {
  const id = newId();
  const vault = await IdbVault.open(id, name);
  await saveKnownNotebook({ id, kind: 'browser', name, lastOpened: Date.now() });
  return vault;
}

/**
 * Reopen a known notebook. For folders, `request` must be true when called from a
 * user gesture (click) because the browser may need to ask for permission again.
 */
export async function reopenNotebook(nb: KnownNotebook, request: boolean): Promise<Vault | null> {
  if (nb.kind === 'browser') {
    const vault = await IdbVault.open(nb.id, nb.name);
    await saveKnownNotebook({ ...nb, lastOpened: Date.now() });
    return vault;
  }
  if (!nb.handle) return null;
  if (!(await ensurePermission(nb.handle, request))) return null;
  await saveKnownNotebook({ ...nb, lastOpened: Date.now() });
  return new HandleVault(nb.handle, nb.id, 'folder');
}

export async function renameKnownNotebook(id: string, name: string) {
  const all = await listKnownNotebooks();
  const nb = all.find((n) => n.id === id);
  if (nb) await saveKnownNotebook({ ...nb, name });
}
