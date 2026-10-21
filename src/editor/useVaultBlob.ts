import { useEffect, useState } from 'react';
import type { Vault } from '../fs/types';

export interface VaultBlobState {
  blob: Blob | null;
  url: string | null;
  error: string | null;
  loading: boolean;
}

/** Load a file from the notebook and expose it as an object URL (revoked on unmount). */
export function useVaultBlob(vault: Vault | null, path: string | null, version = 0): VaultBlobState {
  const [state, setState] = useState<VaultBlobState>({ blob: null, url: null, error: null, loading: !!path });
  useEffect(() => {
    if (!vault || !path) {
      setState({ blob: null, url: null, error: null, loading: false });
      return;
    }
    let url: string | null = null;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    vault
      .readBlob(path)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setState({ blob, url, error: null, loading: false });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ blob: null, url: null, error: (err as Error).message || 'File not found', loading: false });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [vault, path, version]);
  return state;
}
