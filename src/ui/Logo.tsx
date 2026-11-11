import { useId } from 'react';
import { A_PATH, DROP_PATH, LOGO_BLUE, MARK_H, MARK_W, OVER_PATH } from './logo-art';

/**
 * The Assaycraft logo: the A and its blue drop, on the page itself. The A takes the page's ink
 * (black, or light in the dark theme), so it is seen on either.
 */
export function Logo({ size = 22 }: { size?: number }) {
  // Each logo on a page needs its own clip (one in a hidden part of the page cannot serve another).
  const clip = `logo${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg className="gc-logo" width={size} height={size} viewBox={`0 ${-(MARK_W - MARK_H) / 2} ${MARK_W} ${MARK_W}`} aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <path d={OVER_PATH} />
        </clipPath>
      </defs>
      <path d={A_PATH} fill="var(--logo-ink)" />
      <path d={DROP_PATH} fill={LOGO_BLUE} />
      <path d={A_PATH} fill="var(--logo-ink)" clipPath={`url(#${clip})`} />
    </svg>
  );
}
