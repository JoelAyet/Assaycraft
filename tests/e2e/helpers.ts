import { expect, type Page } from '@playwright/test';

export const NOTEBOOK = 'Test Notebook';

/** Collects uncaught errors so tests can assert the app stayed healthy. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|favicon/i.test(m.text())) errors.push(m.text());
  });
  return errors;
}

/** Marks the guided tour as seen, so it does not cover the page in tests about something else. */
export async function skipTour(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('assaycraft:tourDone', '1');
    } catch {
      /* file:// pages may have no storage */
    }
  });
}

/**
 * Opens a "folder" notebook. The native folder picker is replaced by a directory in the
 * browser's origin-private file system, which implements the same File System Access API.
 */
export async function openFolderNotebook(page: Page, opts: { seed?: boolean; tour?: boolean } = {}) {
  if (!opts.tour) await skipTour(page);
  await page.addInitScript((name) => {
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
  }, NOTEBOOK);
  await page.goto('/');
  await useWithoutComputer(page);
  if (opts.seed === false) await page.getByText('Start new notebooks with example templates').click();
  await page.getByRole('button', { name: /Choose folder/ }).click();
  // (On phones the sidebar is a hidden drawer.)
  await expect(page.locator('.gc-main')).toBeVisible();
}

/** On a phone or tablet the welcome page offers only Connect to a computer, until asked for the other ways. */
export async function useWithoutComputer(page: Page) {
  await page.locator('.gc-welcome-options').waitFor();
  const alone = page.getByRole('button', { name: 'No computer? Use this device on its own' });
  if (await alone.isVisible()) await alone.click();
}

export async function readFile(page: Page, path: string): Promise<string> {
  return page.evaluate(
    async ({ nb, path }) => {
      let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(nb);
      const parts = path.split('/');
      const name = parts.pop()!;
      for (const p of parts) dir = await dir.getDirectoryHandle(p);
      return (await (await dir.getFileHandle(name)).getFile()).text();
    },
    { nb: NOTEBOOK, path },
  );
}

export async function writeFile(page: Page, path: string, text: string) {
  await page.evaluate(
    async ({ nb, path, text }) => {
      let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(nb);
      const parts = path.split('/');
      const name = parts.pop()!;
      for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await w.write(text);
      await w.close();
    },
    { nb: NOTEBOOK, path, text },
  );
}

export async function listFiles(page: Page, path: string): Promise<string[]> {
  return page.evaluate(
    async ({ nb, path }) => {
      let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(nb);
      for (const p of path.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(p);
      const out: string[] = [];
      for await (const [name] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) out.push(name);
      return out.sort();
    },
    { nb: NOTEBOOK, path },
  );
}

/** Waits until every pending save has been written. */
export async function waitForSave(page: Page) {
  // Let the save indicator render first: on a busy machine it can lag the last keystroke.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await expect(page.locator('.gc-save-pending, .gc-save-saving')).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(150);
}

export async function newBlankEntry(page: Page, title: string) {
  await page.locator('.gc-new-btn').click();
  await page.locator('.gc-template-option', { hasText: 'Blank entry' }).click();
  await page.locator('#ne-title').fill(title);
  await page.getByRole('button', { name: 'Create entry' }).click();
  await expect(page.locator('.gc-title-input')).toHaveValue(title);
}

export function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
