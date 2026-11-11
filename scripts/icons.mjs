/**
 * Makes the app's icons from the logo (src/ui/logo-art.ts): `node scripts/icons.mjs`.
 * - public/favicon.svg, and the same icon inlined in index.html (the single-file build has no other files):
 *   the mark alone, its A light in a dark browser;
 * - public/icon-192.png and icon-512.png: the mark on a rounded white square, for desktop shortcuts;
 * - public/icon-maskable-512.png: the white square to its edges, the mark inside the middle 80% that phones keep;
 * - public/apple-touch-icon.png: the white square to its edges (iOS rounds it).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { LOGO_PAPER, logoSvg } from '../src/ui/logo-art.ts';

const root = new URL('..', import.meta.url);
const path = (p) => new URL(p, root);

const favicon = logoSvg();
writeFileSync(path('public/favicon.svg'), favicon + '\n');
const html = readFileSync(path('index.html'), 'utf8');
const inline = `data:image/svg+xml,${encodeURIComponent(favicon).replace(/%20/g, ' ').replace(/%3D/g, '=').replace(/%2F/g, '/').replace(/%3A/g, ':')}`;
const next = html.replace(/(<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href=")[^"]*(")/, `$1${inline}$2`);
if (next === html && !html.includes(inline)) throw new Error('No <link rel="icon"> in index.html to update');
writeFileSync(path('index.html'), next);

const pngs = [
  ['public/icon-192.png', 192, logoSvg({ background: LOGO_PAPER, radius: 64 })],
  ['public/icon-512.png', 512, logoSvg({ background: LOGO_PAPER, radius: 64 })],
  ['public/icon-maskable-512.png', 512, logoSvg({ background: LOGO_PAPER, scale: 0.6 })],
  ['public/apple-touch-icon.png', 180, logoSvg({ background: LOGO_PAPER, scale: 0.72 })],
];
const browser = await chromium.launch();
try {
  for (const [file, size, svg] of pngs) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
    );
    await page.locator('svg').screenshot({ path: path(file).pathname, omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log('Icons written.');
