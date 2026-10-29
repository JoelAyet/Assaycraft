import { test, expect, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { trackErrors, skipTour } from './helpers';

/** The hosted build (npm run build), served from a copy so a test can publish a "new version". */
const dist = resolve(import.meta.dirname, '../../dist');

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

async function serveSite() {
  const root = mkdtempSync(join(tmpdir(), 'assaycraft-site-'));
  cpSync(dist, root, { recursive: true });
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    requests.push(path);
    // Like Cloudflare: the app page is only served at the site's address.
    if (path === '/index.html') {
      res.writeHead(307, { location: '/' }).end();
      return;
    }
    const file = join(root, path === '/' ? 'index.html' : path);
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(readFileSync(file));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    root,
    requests,
    close: () => {
      server.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const cacheNames = (page: Page) => page.evaluate(() => caches.keys());

test.describe('offline copy of the hosted app', () => {
  test.skip(!existsSync(join(dist, 'sw.js')), 'run `npm run build` first');

  test('after the first visit it opens and imports PDFs without a connection', async ({ page, context }) => {
    const errors = trackErrors(page);
    const site = await serveSite();
    try {
      await skipTour(page);
      await page.goto(site.url);
      await expect(page.locator('.toast')).toContainText('it now opens without an internet connection', { timeout: 20_000 });
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      const [name] = await cacheNames(page);
      expect(name).toMatch(/^assaycraft-[0-9a-f]{12}$/);
      const cached = await page.evaluate(async (n) => (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname), name);
      // The app page is kept under the app's own address: hosts such as Cloudflare redirect /index.html there.
      expect(cached).toContain('/');
      expect(cached).not.toContain('/index.html');
      expect(cached.some((p) => /\/assets\/pdfjs-.*\.js$/.test(p))).toBe(true);

      await page.getByRole('button', { name: /Create browser notebook/ }).click();
      await page.getByRole('button', { name: 'Create notebook' }).click();
      await expect(page.locator('.gc-sidebar')).toBeVisible();

      // No connection from here on.
      await context.setOffline(true);
      await page.reload();
      await expect(page.locator('.gc-sidebar')).toBeVisible();
      await page.locator('.gc-nav-item', { hasText: 'Protocols' }).click();
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'More to add' }).click();
      await page.getByRole('menuitem', { name: 'Import PDF protocols…' }).click();
      await (
        await chooser
      ).setFiles({ name: 'gibson.pdf', mimeType: 'application/pdf', buffer: readFileSync('tests/fixtures/pdf/gibson-chromium.pdf') });
      await expect(page.locator('.gc-pdf-card-sub')).toContainText('2 pages converted', { timeout: 30_000 });
      await page.getByRole('button', { name: 'Create protocol' }).click();
      await expect(page.locator('.gc-title-input')).toHaveValue('Gibson assembly of three fragments');

      await page.goto(site.url + '#/settings');
      await expect(page.locator('.gc-about-offline')).toHaveText('Works offline: a copy of the app is saved on this device.');
      expect(errors.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e))).toEqual([]);
    } finally {
      await context.setOffline(false);
      site.close();
    }
  });

  test('a new version is offered, and used after Reload', async ({ page }) => {
    const errors = trackErrors(page);
    const site = await serveSite();
    try {
      await page.goto(site.url);
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      const [before] = await cacheNames(page);

      // Publish a new version.
      site.requests.length = 0;
      const swPath = join(site.root, 'sw.js');
      writeFileSync(swPath, readFileSync(swPath, 'utf8').replace(/const VERSION = "([0-9a-f]+)"/, 'const VERSION = "$1-next"'));
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());

      const offer = page.locator('.toast', { hasText: 'A new version of Assaycraft is ready.' });
      await expect(offer).toBeVisible({ timeout: 20_000 });
      await Promise.all([page.waitForEvent('load'), offer.getByRole('button', { name: 'Reload' }).click()]);
      await expect.poll(() => cacheNames(page)).toEqual([`${before}-next`]);
      // Built files that did not change (here, all of them) are not downloaded again.
      expect(site.requests.filter((p) => p.startsWith('/assets/'))).toEqual([]);
      await expect(page.getByRole('heading', { name: 'Assaycraft' })).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      site.close();
    }
  });
});
