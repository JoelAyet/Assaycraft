import { openDb, reqToPromise, txDone, deleteDb } from '../lib/idb';
import { splitPath, basename } from '../lib/path';
import { VaultError, type FileStat, type Vault, type VaultEntry, type WriteData } from './types';

/** A file's or folder's details: what listing the notebook needs, without the file's contents. */
interface Meta {
  path: string;
  kind: 'file' | 'directory';
  size?: number;
  type?: string;
  lastModified: number;
}

interface Rec extends Meta {
  /**
   * Text as a string, anything else as an ArrayBuffer (with its media type in `type`). Safari's
   * private windows cannot store Blobs in IndexedDB; notebooks saved before that was known may
   * still hold Blobs, which are read as before.
   */
  data?: Blob | string | ArrayBuffer;
}

/** The files, with their contents. */
const FILES = 'files';
/**
 * Every file's and folder's details. Listing a folder, or asking a file's size and date, reads only
 * these: reading them from FILES loaded every file's contents, attachments included, which made a
 * notebook stored in the browser slow to scan (on a phone, at every change the computer sent).
 */
const META = 'meta';

const sizeOf = (data: Rec['data']) =>
  typeof data === 'string' ? new TextEncoder().encode(data).length : data instanceof Blob ? data.size : (data?.byteLength ?? 0);
const metaOf = (rec: Rec): Meta => ({
  path: rec.path,
  kind: rec.kind,
  size: rec.size ?? sizeOf(rec.data),
  type: rec.type,
  lastModified: rec.lastModified,
});
const below = (p: string) => IDBKeyRange.bound(p + '/', p + '/\uffff');

/**
 * Vault stored inside the browser (IndexedDB). Works in every modern browser;
 * the notebook can be exported as a .zip of Markdown files at any time.
 */
export class IdbVault implements Vault {
  readonly kind = 'browser' as const;
  readonly id: string;
  readonly name: string;
  private db: IDBDatabase;

  private constructor(db: IDBDatabase, id: string, name: string) {
    this.db = db;
    this.id = id;
    this.name = name;
  }

  static dbName(id: string) {
    // The app's former name: kept so notebooks stored in the browser before the rename stay available.
    return `genecraft-notebook-${id}`;
  }

  static async open(id: string, name: string): Promise<IdbVault> {
    const db = await openDb(IdbVault.dbName(id), 2, (d, oldVersion, tx) => {
      if (!d.objectStoreNames.contains(FILES)) d.createObjectStore(FILES, { keyPath: 'path' });
      if (d.objectStoreNames.contains(META)) return;
      const meta = d.createObjectStore(META, { keyPath: 'path' });
      if (oldVersion < 1) return;
      // A notebook from before: its details, once, from the files themselves.
      const cursor = tx.objectStore(FILES).openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        meta.put(metaOf(c.value as Rec));
        c.continue();
      };
    });
    return new IdbVault(db, id, name);
  }

  static async destroy(id: string) {
    await deleteDb(IdbVault.dbName(id));
  }

  close() {
    this.db.close();
  }

  private tx(stores: string[], mode: IDBTransactionMode) {
    return this.db.transaction(stores, mode);
  }

  private async meta(path: string): Promise<Meta | undefined> {
    return reqToPromise(this.tx([META], 'readonly').objectStore(META).get(path) as IDBRequest<Meta | undefined>);
  }

  private async file(path: string): Promise<Rec | undefined> {
    return reqToPromise(this.tx([FILES], 'readonly').objectStore(FILES).get(path) as IDBRequest<Rec | undefined>);
  }

  async list(dir: string): Promise<VaultEntry[]> {
    const prefix = splitPath(dir).join('/');
    const store = this.tx([META], 'readonly').objectStore(META);
    const recs = await reqToPromise((prefix ? store.getAll(below(prefix)) : store.getAll()) as IDBRequest<Meta[]>);
    const seen = new Map<string, VaultEntry>();
    const start = prefix ? prefix.length + 1 : 0;
    for (const rec of recs) {
      const rest = rec.path.slice(start);
      if (!rest) continue;
      const slash = rest.indexOf('/');
      const name = slash === -1 ? rest : rest.slice(0, slash);
      const kind = slash === -1 ? rec.kind : 'directory';
      const path = prefix ? `${prefix}/${name}` : name;
      const prev = seen.get(name);
      if (!prev || kind === 'directory') seen.set(name, { name, kind, path });
    }
    return [...seen.values()];
  }

  async stat(path: string): Promise<FileStat | null> {
    const rec = await this.meta(splitPath(path).join('/'));
    if (!rec || rec.kind !== 'file') return null;
    return { size: rec.size ?? 0, lastModified: rec.lastModified };
  }

  async readText(path: string): Promise<string> {
    const rec = await this.file(splitPath(path).join('/'));
    if (!rec || rec.kind !== 'file') throw new VaultError(`Not found: ${path}`, 'not-found');
    if (rec.data instanceof ArrayBuffer) return new TextDecoder().decode(rec.data);
    return typeof rec.data === 'string' ? rec.data : (rec.data?.text() ?? '');
  }

  async readBlob(path: string): Promise<Blob> {
    const p = splitPath(path).join('/');
    const rec = await this.file(p);
    if (!rec || rec.kind !== 'file') throw new VaultError(`Not found: ${path}`, 'not-found');
    const data = rec.data ?? '';
    const blob =
      typeof data === 'string'
        ? new Blob([data], { type: 'text/plain' })
        : data instanceof ArrayBuffer
          ? new Blob([data], { type: rec.type ?? '' })
          : data;
    return new File([blob], basename(p), { lastModified: rec.lastModified, type: blob.type });
  }

  async write(path: string, data: WriteData): Promise<void> {
    const parts = splitPath(path);
    if (!parts.length) throw new VaultError('Invalid path');
    const p = parts.join('/');
    // Read the bytes before the transaction starts: it would close while waiting for them.
    let stored: string | ArrayBuffer;
    let type: string | undefined;
    if (typeof data === 'string') stored = data;
    else if (data instanceof Blob) {
      stored = await data.arrayBuffer();
      type = data.type || undefined;
    } else if (data instanceof ArrayBuffer) stored = data.slice(0);
    else stored = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const size = sizeOf(stored);
    const tx = this.tx([FILES, META], 'readwrite');
    const meta = tx.objectStore(META);
    const now = Date.now();
    for (let i = 1; i < parts.length; i++) meta.put({ path: parts.slice(0, i).join('/'), kind: 'directory', lastModified: now } satisfies Meta);
    const rec: Rec = { path: p, kind: 'file', data: stored, type, size, lastModified: now };
    tx.objectStore(FILES).put(rec);
    meta.put(metaOf(rec));
    await txDone(tx);
  }

  async remove(path: string): Promise<void> {
    const p = splitPath(path).join('/');
    if (!p) throw new VaultError('Refusing to remove the notebook root');
    const tx = this.tx([FILES, META], 'readwrite');
    for (const name of [FILES, META]) {
      tx.objectStore(name).delete(p);
      tx.objectStore(name).delete(below(p));
    }
    await txDone(tx);
  }

  async mkdir(path: string): Promise<void> {
    const parts = splitPath(path);
    if (!parts.length) return;
    const tx = this.tx([META], 'readwrite');
    const now = Date.now();
    for (let i = 1; i <= parts.length; i++)
      tx.objectStore(META).put({ path: parts.slice(0, i).join('/'), kind: 'directory', lastModified: now } satisfies Meta);
    await txDone(tx);
  }

  async exists(path: string): Promise<boolean> {
    const p = splitPath(path).join('/');
    if (!p) return true;
    if (await this.meta(p)) return true;
    return (await reqToPromise(this.tx([META], 'readonly').objectStore(META).count(below(p)))) > 0;
  }

  async moveFile(from: string, to: string): Promise<void> {
    const src = await this.file(splitPath(from).join('/'));
    if (!src || src.kind !== 'file') throw new VaultError(`Not found: ${from}`, 'not-found');
    const data = src.data ?? '';
    await this.write(to, data instanceof ArrayBuffer ? new Blob([data], { type: src.type ?? '' }) : data);
    await this.remove(from);
  }
}
