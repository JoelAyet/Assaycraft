import { useSyncExternalStore } from 'react';

/** Phone-sized screens: the same width as the `max-width: 760px` rules in mobile.css. */
export const PHONE = '(max-width: 760px)';

/** Whether a CSS media query matches, kept up to date as the window changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', onChange);
      return () => m.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
