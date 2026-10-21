import { openDb, reqToPromise, txDone, deleteDb } from '../lib/idb';
import { splitPath, basename } from '../lib/path';
import { VaultError, type FileStat, type Vault, type VaultEntry, type WriteData } from './types';

interface Rec {
  path: string;
  kind: 'file' | 'directory';
  data?: Blob | string;
  size?: number;
  lastModified: number;
}

const STORE = 'files';

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
    const db = await openDb(IdbVault.dbName(id), 1, (d) => {
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'path' });
    });
    return new IdbVault(db, id, name);
  }

  static async destroy(id: string) {
    await deleteDb(IdbVault.dbName(id));
  }

  close() {
    this.db.close();
  }

  private store(mode: IDBTransactionMode) {
    const tx = this.db.transaction(STORE, mode);
    return { tx, store: tx.objectStore(STORE) };
  }

  private async get(path: string): Promise<Rec | undefined> {
    const { store } = this.store('readonly');
    return reqToPromise(store.get(path) as IDBRequest<Rec | undefined>);
  }

  private async under(prefix: string): Promise<Rec[]> {
    const { store } = this.store('readonly');
    if (!prefix) return reqToPromise(store.getAll() as IDBRequest<Rec[]>);
    const range = IDBKeyRange.bound(prefix + '/', prefix + '/￿');
    return reqToPromise(store.getAll(range) as IDBRequest<Rec[]>);
  }

  async list(dir: string): Promise<VaultEntry[]> {
    const prefix = splitPath(dir).join('/');
    const recs = await this.under(prefix);
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
    const rec = await this.get(splitPath(path).join('/'));
    if (!rec || rec.kind !== 'file') return null;
    return { size: rec.size ?? 0, lastModified: rec.lastModified };
  }

  async readText(path: string): Promise<string> {
    const rec = await this.get(splitPath(path).join('/'));
    if (!rec || rec.kind !== 'file') throw new VaultError(`Not found: ${path}`, 'not-found');
    return typeof rec.data === 'string' ? rec.data : (rec.data?.text() ?? '');
  }

  async readBlob(path: string): Promise<Blob> {
    const p = splitPath(path).join('/');
    const rec = await this.get(p);
    if (!rec || rec.kind !== 'file') throw new VaultError(`Not found: ${path}`, 'not-found');
    const data = rec.data ?? '';
    const blob = typeof data === 'string' ? new Blob([data], { type: 'text/plain' }) : data;
    return new File([blob], basename(p), { lastModified: rec.lastModified, type: blob.type });
  }

  async write(path: string, data: WriteData): Promise<void> {
    const parts = splitPath(path);
    if (!parts.length) throw new VaultError('Invalid path');
    const p = parts.join('/');
    let stored: Blob | string;
    let size: number;
    if (typeof data === 'string') {
      stored = data;
      size = new TextEncoder().encode(data).length;
    } else if (data instanceof Blob) {
      stored = data;
      size = data.size;
    } else {
      stored = new Blob([data]);
      size = stored.size;
    }
    const { tx, store } = this.store('readwrite');
    for (let i = 1; i < parts.length; i++) {
      store.put({ path: parts.slice(0, i).join('/'), kind: 'directory', lastModified: Date.now() } satisfies Rec);
    }
    store.put({ path: p, kind: 'file', data: stored, size, lastModified: Date.now() } satisfies Rec);
    await txDone(tx);
  }

  async remove(path: string): Promise<void> {
    const p = splitPath(path).join('/');
    if (!p) throw new VaultError('Refusing to remove the notebook root');
    const { tx, store } = this.store('readwrite');
    store.delete(p);
    store.delete(IDBKeyRange.bound(p + '/', p + '/￿'));
    await txDone(tx);
  }

  async mkdir(path: string): Promise<void> {
    const parts = splitPath(path);
    if (!parts.length) return;
    const { tx, store } = this.store('readwrite');
    for (let i = 1; i <= parts.length; i++) {
      store.put({ path: parts.slice(0, i).join('/'), kind: 'directory', lastModified: Date.now() } satisfies Rec);
    }
    await txDone(tx);
  }

  async exists(path: string): Promise<boolean> {
    const p = splitPath(path).join('/');
    if (!p) return true;
    if (await this.get(p)) return true;
    return (await this.under(p)).length > 0;
  }

  async moveFile(from: string, to: string): Promise<void> {
    const src = await this.get(splitPath(from).join('/'));
    if (!src || src.kind !== 'file') throw new VaultError(`Not found: ${from}`, 'not-found');
    await this.write(to, src.data ?? '');
    await this.remove(from);
  }
}
