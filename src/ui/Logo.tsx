import { useId } from 'react';
import { A_PATH, DROP_PATH, LOGO_BLUE, LOGO_TILE, MARK_H, MARK_W, OVER_PATH } from './logo-art';

/**
 * The Assaycraft logo. On its light-blue tile (the app's icon) by default; `mark` is the A and its
 * drop alone, for beside the name on a page, where the A takes the page's ink (black, or light in
 * the dark theme) so it is seen on either.
 */
export function Logo({ size = 22, mark = false }: { size?: number; mark?: boolean }) {
  // Each logo on a page needs its own clip (one in a hidden part of the page cannot serve another).
  const clip = `logo${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const ink = mark ? 'var(--logo-ink)' : '#000';
  const art = (
    <>
      <defs>
        <clipPath id={clip}>
          <path d={OVER_PATH} />
        </clipPath>
      </defs>
      <path d={A_PATH} fill={ink} />
      <path d={DROP_PATH} fill={LOGO_BLUE} />
      <path d={A_PATH} fill={ink} clipPath={`url(#${clip})`} />
    </>
  );
  if (mark)
    return (
      <svg className="gc-logo is-mark" width={size} height={size} viewBox={`0 ${-(MARK_W - MARK_H) / 2} ${MARK_W} ${MARK_W}`} aria-hidden="true">
        {art}
      </svg>
    );
  // The designer's tile, made square, with the mark on it at the same size.
  const k = (402 * 0.81) / MARK_W;
  return (
    <svg className="gc-logo" width={size} height={size} viewBox="0 0 402 402" aria-hidden="true">
      <rect width="402" height="402" rx="64" fill={LOGO_TILE} />
      <g transform={`translate(${((402 - MARK_W * k) / 2).toFixed(2)} ${((402 - MARK_H * k) / 2).toFixed(2)}) scale(${k.toFixed(4)})`}>{art}</g>
    </svg>
  );
}
