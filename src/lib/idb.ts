/** Tiny promise wrapper around IndexedDB. */

// Safari sometimes fails a request without saying why (its error is null): reject with a real error anyway.
const failed = (error: DOMException | null, what: string) => error ?? new Error(`The browser could not ${what} (no reason given).`);

export function openDb(name: string, version: number, upgrade: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(failed(req.error, 'open its storage'));
    req.onblocked = () => reject(new Error(`Database "${name}" is blocked by another tab`));
  });
}

export function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(failed(req.error, 'read its storage'));
  });
}

export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(failed(tx.error, 'save to its storage'));
    tx.onabort = () => reject(failed(tx.error, 'save to its storage'));
  });
}

export function deleteDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(failed(req.error, 'delete its storage'));
    req.onblocked = () => resolve();
  });
}
