import { createContext, useContext } from 'react';
import type { Vault } from '../fs/types';
import type { DocKind } from '../notebook/model';

/** Information node views need about the document they live in. */
export interface DocContextValue {
  vault: Vault;
  /** Vault path of the Markdown file. */
  path: string;
  /** Folder of the Markdown file; relative links resolve against it. */
  folder: string;
  /** Doc id, used to name the attachments folder. */
  docId: string;
  kind: DocKind;
  readOnly: boolean;
}

export const DocContext = createContext<DocContextValue | null>(null);

export function useDocContext(): DocContextValue {
  const ctx = useContext(DocContext);
  if (!ctx) throw new Error('DocContext missing');
  return ctx;
}
