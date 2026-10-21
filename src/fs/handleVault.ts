import { splitPath, join } from '../lib/path';
import { isNotFound, VaultError, type FileStat, type Vault, type VaultEntry, type VaultKind, type WriteData } from './types';

/**
 * Vault backed by a FileSystemDirectoryHandle: either a folder on the user's disk
 * (File System Access API) or the browser's origin-private file system.
 */
export class HandleVault implements Vault {
  readonly root: FileSystemDirectoryHandle;
  readonly id: string;
  readonly kind: VaultKind;

  constructor(root: FileSystemDirectoryHandle, id: string, kind: VaultKind = 'folder') {
    this.root = root;
    this.id = id;
    this.kind = kind;
  }

  get name() {
    return this.root.name || 'Notebook';
  }

  private async dir(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    let dir = this.root;
    for (const part of splitPath(path)) {
      try {
        dir = await dir.getDirectoryHandle(part, { create });
      } catch (err) {
        throw wrap(err, path);
      }
    }
    return dir;
  }

  private async file(path: string, create = false): Promise<FileSystemFileHandle> {
    const parts = splitPath(path);
    const name = parts.pop();
    if (!name) throw new VaultError(`Invalid file path "${path}"`);
    const dir = await this.dir(parts.join('/'), create);
    try {
      return await dir.getFileHandle(name, { create });
    } catch (err) {
      throw wrap(err, path);
    }
  }

  async list(dirPath: string): Promise<VaultEntry[]> {
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await this.dir(dirPath);
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
    const out: VaultEntry[] = [];
    for await (const [name, handle] of dir.entries()) {
      out.push({ name, kind: handle.kind, path: join(dirPath, name) });
    }
    return out;
  }

  async stat(path: string): Promise<FileStat | null> {
    try {
      const file = await (await this.file(path)).getFile();
      return { size: file.size, lastModified: file.lastModified };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async readText(path: string): Promise<string> {
    return (await this.readBlob(path)).text();
  }

  async readBlob(path: string): Promise<Blob> {
    return (await this.file(path)).getFile();
  }

  async write(path: string, data: WriteData): Promise<void> {
    const handle = await this.file(path, true);
    const writable = await handle.createWritable();
    try {
      await writable.write(data);
      await writable.close();
    } catch (err) {
      await writable.abort().catch(() => undefined);
      throw err;
    }
  }

  async remove(path: string): Promise<void> {
    const parts = splitPath(path);
    const name = parts.pop();
    if (!name) throw new VaultError('Refusing to remove the notebook root');
    try {
      const dir = await this.dir(parts.join('/'));
      // Only remove an entry that is listed under exactly this name. On systems that cannot encode
      // the name (e.g. Chrome on Linux with a POSIX locale), it may otherwise resolve to the folder itself.
      let listed = false;
      for await (const key of dir.keys()) {
        if (key === name) {
          listed = true;
          break;
        }
      }
      if (!listed) return;
      await dir.removeEntry(name, { recursive: true });
    } catch (err) {
      if (isNotFound(err)) return;
      throw err;
    }
  }

  async mkdir(path: string): Promise<void> {
    await this.dir(path, true);
  }

  async exists(path: string): Promise<boolean> {
    const parts = splitPath(path);
    const name = parts.pop();
    if (!name) return true;
    try {
      const dir = await this.dir(parts.join('/'));
      try {
        await dir.getFileHandle(name);
        return true;
      } catch {
        await dir.getDirectoryHandle(name);
        return true;
      }
    } catch {
      return false;
    }
  }

  async moveFile(from: string, to: string): Promise<void> {
    const src = await this.file(from);
    const parts = splitPath(to);
    const name = parts.pop()!;
    const destDir = await this.dir(parts.join('/'), true);
    if (typeof src.move === 'function') {
      try {
        await src.move(destDir, name);
        return;
      } catch {
        // fall back to copy + delete below
      }
    }
    const blob = await src.getFile();
    await this.write(to, blob);
    await this.remove(from);
  }
}

function wrap(err: unknown, path: string): unknown {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'NotFoundError' || name === 'TypeMismatchError') return new VaultError(`Not found: ${path}`, 'not-found');
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return new VaultError(`Permission denied for ${path}. Reopen the notebook folder to grant access again.`, 'permission');
  return err;
}

export function supportsFolderAccess(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function ensurePermission(handle: FileSystemHandle, request: boolean): Promise<boolean> {
  if (!handle.queryPermission) return true;
  const opts = { mode: 'readwrite' as const };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (!request || !handle.requestPermission) return false;
  return (await handle.requestPermission(opts)) === 'granted';
}
