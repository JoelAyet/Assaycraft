/**
 * What sync remembers in this browser (not in the notebook): for each paired phone, the files as
 * they were when the two last agreed; for each notebook, file fingerprints, so unchanged files are
 * not read again at every connection.
 */
import { openDb, reqToPromise, txDone } from '../lib/idb';

type Store = 'base' | 'hashes';

let db: Promise<IDBDatabase> | null = null;
const open = () =>
  (db ??= openDb('assaycraft-sync', 1, (d) => {
    for (const name of ['base', 'hashes']) if (!d.objectStoreNames.contains(name)) d.createObjectStore(name);
  }));

export async function loadRecord<T>(store: Store, key: string): Promise<T | undefined> {
  const d = await open();
  return reqToPromise(d.transaction(store).objectStore(store).get(key) as IDBRequest<T | undefined>);
}

export async function saveRecord(store: Store, key: string, value: unknown): Promise<void> {
  const d = await open();
  const tx = d.transaction(store, 'readwrite');
  tx.objectStore(store).put(value, key);
  await txDone(tx);
}

export async function deleteRecord(store: Store, key: string): Promise<void> {
  const d = await open();
  const tx = d.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await txDone(tx);
}

/**
 * A pairing's base as stored. Bases saved before version 2 counted what the computer sent as agreed,
 * so they can list files the phone never got (a first copy cut off midway, a change sent into a dead
 * connection). They are still used, but not to delete files on the computer: compared against one,
 * files the phone never got read as deleted there.
 */
export interface BaseRecord {
  v: 2;
  files: Record<string, string>;
}

export const baseRecord = (files: Record<string, string>): BaseRecord => ({ v: 2, files });

export function baseFiles(rec: unknown): { files: Record<string, string>; confirmed: boolean } {
  if (!rec || typeof rec !== 'object') return { files: {}, confirmed: true };
  const r = rec as Partial<BaseRecord>;
  if (r.v === 2) return { files: r.files && typeof r.files === 'object' ? r.files : {}, confirmed: true };
  return { files: rec as Record<string, string>, confirmed: false };
}
