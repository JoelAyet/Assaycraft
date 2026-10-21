export type VaultKind = 'folder' | 'browser';

export interface VaultEntry {
  name: string;
  /** Vault-relative path, e.g. "Projects/CRISPR/EXP-0001 Title.md" */
  path: string;
  kind: 'file' | 'directory';
}

export interface FileStat {
  size: number;
  lastModified: number;
}

export type WriteData = string | Blob | ArrayBuffer | Uint8Array<ArrayBuffer>;

/**
 * Minimal file-system abstraction for a notebook. Two implementations:
 * a real folder on disk (File System Access API) and IndexedDB browser storage.
 */
export interface Vault {
  readonly kind: VaultKind;
  /** Registry id (used to reopen the notebook later). */
  readonly id: string;
  readonly name: string;
  list(dir: string): Promise<VaultEntry[]>;
  /** null when the file does not exist. */
  stat(path: string): Promise<FileStat | null>;
  readText(path: string): Promise<string>;
  readBlob(path: string): Promise<Blob>;
  write(path: string, data: WriteData): Promise<void>;
  /** Removes a file, or a directory with everything inside it. Missing paths are ignored. */
  remove(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Optional fast rename/move of a single file. */
  moveFile?(from: string, to: string): Promise<void>;
}

export class VaultError extends Error {
  readonly code: 'not-found' | 'permission' | 'other';
  constructor(message: string, code: VaultError['code'] = 'other') {
    super(message);
    this.code = code;
  }
}

export function isNotFound(err: unknown): boolean {
  if (err instanceof VaultError) return err.code === 'not-found';
  const name = (err as { name?: string } | null)?.name;
  return name === 'NotFoundError' || name === 'TypeMismatchError';
}
