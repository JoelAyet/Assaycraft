/** Tiny promise wrapper around IndexedDB. */

// Safari sometimes fails a request without saying why (its error is null): reject with a real error anyway.
const failed = (error: DOMException | null, what: string) => error ?? new Error(`The browser could not ${what} (no reason given).`);

/**
 * Open (and if needed upgrade) a database. `upgrade` gets the version it had (0 for a new one) and
 * the upgrade's transaction, to move what is there. The connection closes itself when a newer
 * version of the app needs to upgrade the database from another tab.
 */
export function openDb(
  name: string,
  version: number,
  upgrade: (db: IDBDatabase, oldVersion: number, tx: IDBTransaction) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    let blocked: ReturnType<typeof setTimeout> | undefined;
    req.onupgradeneeded = (e) => upgrade(req.result, e.oldVersion, req.transaction!);
    req.onsuccess = () => {
      clearTimeout(blocked);
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => {
      clearTimeout(blocked);
      reject(failed(req.error, 'open its storage'));
    };
    // An older version of the app in another tab holds the database: it opens once that tab lets go.
    req.onblocked = () => {
      blocked ??= setTimeout(
        () => reject(new Error('Assaycraft is open in another tab with an older version. Reload or close that tab, then try again.')),
        5000,
      );
    };
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
