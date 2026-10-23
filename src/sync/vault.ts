import type { FileStat, Vault, VaultEntry, WriteData } from '../fs/types';

export type VaultChange =
  { op: 'write'; path: string } | { op: 'remove'; path: string } | { op: 'mkdir'; path: string } | { op: 'move'; from: string; to: string };

/**
 * The open notebook's vault, telling listeners about every change the app makes, so a connected
 * phone or computer can be sent them. Changes that arrive from the other device are written through
 * `raw`, which tells no one (they must not be sent back).
 */
export class SyncableVault implements Vault {
  readonly raw: Vault;
  private listeners = new Set<(change: VaultChange) => void>();
  moveFile?: (from: string, to: string) => Promise<void>;

  constructor(raw: Vault) {
    this.raw = raw;
    if (raw.moveFile)
      this.moveFile = async (from, to) => {
        await raw.moveFile!(from, to);
        this.emit({ op: 'move', from, to });
      };
  }

  get kind() {
    return this.raw.kind;
  }
  get id() {
    return this.raw.id;
  }
  get name() {
    return this.raw.name;
  }

  subscribe(fn: (change: VaultChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(change: VaultChange) {
    for (const fn of this.listeners) fn(change);
  }

  list(dir: string): Promise<VaultEntry[]> {
    return this.raw.list(dir);
  }
  stat(path: string): Promise<FileStat | null> {
    return this.raw.stat(path);
  }
  readText(path: string): Promise<string> {
    return this.raw.readText(path);
  }
  readBlob(path: string): Promise<Blob> {
    return this.raw.readBlob(path);
  }
  exists(path: string): Promise<boolean> {
    return this.raw.exists(path);
  }
  async write(path: string, data: WriteData): Promise<void> {
    await this.raw.write(path, data);
    this.emit({ op: 'write', path });
  }
  async remove(path: string): Promise<void> {
    await this.raw.remove(path);
    this.emit({ op: 'remove', path });
  }
  async mkdir(path: string): Promise<void> {
    await this.raw.mkdir(path);
    this.emit({ op: 'mkdir', path });
  }
}
