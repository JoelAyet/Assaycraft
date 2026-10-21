import { join, extname } from '../lib/path';
import type { Vault, VaultEntry } from './types';

/** Recursively list all files under `dir`. Directories named in `skip` are not entered. */
export async function walk(vault: Vault, dir: string, skip: (entry: VaultEntry) => boolean = () => false): Promise<VaultEntry[]> {
  const out: VaultEntry[] = [];
  const queue = [dir];
  while (queue.length) {
    const d = queue.shift()!;
    for (const entry of await vault.list(d)) {
      if (skip(entry)) continue;
      out.push(entry);
      if (entry.kind === 'directory') queue.push(entry.path);
    }
  }
  return out;
}

export async function copyFile(vault: Vault, from: string, to: string): Promise<void> {
  await vault.write(to, await vault.readBlob(from));
}

export async function moveFile(vault: Vault, from: string, to: string): Promise<void> {
  if (from === to) return;
  if (vault.moveFile) return vault.moveFile(from, to);
  await copyFile(vault, from, to);
  await vault.remove(from);
}

export async function copyDir(vault: Vault, from: string, to: string): Promise<void> {
  await vault.mkdir(to);
  for (const entry of await walk(vault, from)) {
    const rel = entry.path.slice(from.length + 1);
    if (entry.kind === 'directory') await vault.mkdir(join(to, rel));
    else await copyFile(vault, entry.path, join(to, rel));
  }
}

export async function moveDir(vault: Vault, from: string, to: string): Promise<void> {
  if (from === to) return;
  await copyDir(vault, from, to);
  await vault.remove(from);
}

/** Returns a path in `dir` for `fileName` that does not exist yet: "gel.png", "gel (2).png", … */
export async function uniquePath(vault: Vault, dir: string, fileName: string): Promise<string> {
  const extLen = extname(fileName).length;
  const ext = fileName.slice(fileName.length - extLen);
  const base = fileName.slice(0, fileName.length - extLen);
  let candidate = join(dir, fileName);
  for (let n = 2; await vault.exists(candidate); n++) candidate = join(dir, `${base} (${n})${ext}`);
  return candidate;
}
