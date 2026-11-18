import { create } from 'zustand';

/** A page changed on both devices before they caught up: its latest edit was kept, here or from the other device. */
export interface ResolvedPage {
  path: string;
  kept: 'here' | 'there';
  /** The other device: "iPhone". */
  from: string;
  at: number;
}

/** The pages resolved since the notebook opened, newest first (Connect a phone lists them). */
export const useResolvedPages = create<{ list: ResolvedPage[] }>(() => ({ list: [] }));

export function noteResolved(page: ResolvedPage) {
  useResolvedPages.setState((s) => ({ list: [page, ...s.list.filter((p) => p.path !== page.path)].slice(0, 200) }));
}
