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
 * A pairing's base as stored. Bases saved before version 2 could list files the phone never got (a
 * first copy cut off midway, a change sent into a dead connection): compared against one, those
 * files read as deleted on the phone, and were deleted on the computer. They are not used. With no
 * base nothing is deleted: files on one side only are copied over, and files that differ are kept
 * twice ("… (from iPad).md") the first time the devices meet again.
 */
export interface BaseRecord {
  v: 2;
  files: Record<string, string>;
}

export const baseRecord = (files: Record<string, string>): BaseRecord => ({ v: 2, files });

export function baseFiles(rec: unknown): Record<string, string> {
  const r = rec as Partial<BaseRecord> | undefined;
  return r?.v === 2 && r.files && typeof r.files === 'object' ? r.files : {};
}
