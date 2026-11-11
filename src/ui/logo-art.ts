/**
 * The Assaycraft logo, as drawn by its designer: an A of three joined strokes over a blue drop
 * that wraps around it (the drop passes over the A's right leg, under the rest). The paths are the
 * designer's own (Asset 3), in the mark's coordinates: 321 × 307.
 *
 * The same paths make the logo in the app (Logo.tsx) and its icons (scripts/icons.mjs).
 */

/** The A: its three strokes and the rounded ends. */
export const A_PATH =
  'M307.8,225.6c-6.8-6.7-49-53-62.93-77.07-4.71-8.14-24.49-42.12-34.07-68.93-5-14-16.26-52.64-16-53,0,0-4.85-26.06-34.33-26.6-29.48.54-34.33,26.6-34.33,26.6.26.36-11,39-16,53-9.57,26.8-29.35,60.78-34.07,68.93-13.93,24.07-56.13,70.37-62.93,77.07-6.08,6-18,22-11,40,5.28,13.57,22.84,28.54,47.68,20.09,23.75-8.09,90.5-14.68,110.65-14.23,20.15-.44,86.9,6.14,110.65,14.23,24.84,8.46,42.4-6.52,47.68-20.09,7-18-4.92-34-11-40ZM252.39,237.21c-3.85,8.67-3,18-3,18,0,0-45.01,3-89.01,3h-1c-1.31.04-.86,0-1.82,0-44,0-86-3-86-3,0,0,.85-9.33-3-18-4-9-10-13-10-13,0,0,10-32,36-84,20.4-40.8,46-75,46-75,.93.93,8.8,5.33,17.95,5.93.68.04,1.18.07,1.87.07s1.39-.02,2.07-.07c9.15-.6,17.02-5,17.95-5.93,0,0,25.6,34.2,46,75,26,52,36,84,36,84,0,0-6,4-10,13Z';

/** The drop. */
export const DROP_PATH =
  'M24.6,77.23c-51.33,50.06-12.17,220.53,68.12,229.18,71.18,7.67,161.32-52.97,191.96-73.2,57.33-37.84,5.34-96.18-45.68-66.71-46.25,26.71-130.11,82.93-144.28,24.08-17.7-73.5,172.5-81.31,160.42-139.37-9.11-43.78-43.18-35.72-115.23-25.19-29.83,4.36-76.07,12.95-115.31,51.23Z';

/** Where the A is drawn again over the drop: everywhere but where the drop crosses its right leg. */
export const OVER_PATH =
  'M-2-2v292.15h324.94V-2H-2ZM284.68,233.21c-8.21,5.42-20.69,13.74-35.93,22.87l.18-.83-.53.05c-.04-.39-.83-9.69,3.08-18.5,3.36-7.56,8.06-11.67,9.74-12.97-1.28-3.92-8.28-24.62-23.08-56.83.29-.17.58-.34.87-.51,4.96-2.86,9.93-4.89,14.81-6.19,16.66,23.27,43.31,52.44,47.88,57.4-4,5.36-9.58,10.61-17.01,15.51Z';

/** The designer's colors; icons sit on white (phones and desktops want an icon with a square behind it). */
export const LOGO_BLUE = '#2f7bff';
export const LOGO_INK = '#000000';
export const LOGO_PAPER = '#ffffff';

/** The mark's size, in its own coordinates. */
export const MARK_W = 320.94;
export const MARK_H = 307.07;

/**
 * The logo as SVG markup, for files. With no `background`, the mark alone, its A light when the
 * browser is dark (for the browser tab). With one, the mark on a square of that color: rounded
 * (`radius` > 0) or to its edges for icons a phone rounds itself, the mark spanning `scale` of it.
 */
export function logoSvg(opts: { background?: string; radius?: number; scale?: number; size?: number; id?: string } = {}): string {
  const { background, radius = 0, scale = 0.81, size, id = 'a' } = opts;
  const clip = `<clipPath id="${id}"><path d="${OVER_PATH}"/></clipPath>`;
  const mark = `<path class="ink" d="${A_PATH}" fill="${LOGO_INK}"/><path d="${DROP_PATH}" fill="${LOGO_BLUE}"/><path class="ink" d="${A_PATH}" fill="${LOGO_INK}" clip-path="url(#${id})"/>`;
  const dims = size ? ` width="${size}" height="${size}"` : '';
  if (!background) {
    const dark = '<style>@media (prefers-color-scheme: dark) { .ink { fill: #fff; } }</style>';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${-(MARK_W - MARK_H) / 2} ${MARK_W} ${MARK_W}"${dims}>${dark}<defs>${clip}</defs>${mark}</svg>`;
  }
  // A square of 402 (the designer's tile width), with the mark centered on it at `scale` of its width.
  const S = 402;
  const k = (S * scale) / MARK_W;
  const x = (S - MARK_W * k) / 2;
  const y = (S - MARK_H * k) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}"${dims}><defs>${clip}</defs><rect width="${S}" height="${S}" rx="${radius}" fill="${background}"/><g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${k.toFixed(4)})">${mark}</g></svg>`;
}
