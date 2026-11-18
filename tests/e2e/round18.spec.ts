/**
 * The second audit (a review of the phone connection): the QR code stops being a key once a phone
 * has used it, two tabs do not push each other off the connection, a phone out of space ends its
 * first copy with a clear message, and a page edited on both devices apart keeps its latest edit.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { newBlankEntry, skipTour, trackErrors, waitForSave, KEYS } from './helpers';

const PHONE = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
};

async function device(browser: Browser, phone = false) {
  const context = await browser.newContext(phone ? PHONE : {});
  const page = await context.newPage();
  const errors = trackErrors(page);
  await skipTour(page);
  await context.addInitScript(() => localStorage.setItem('assaycraft:direct', 'off'));
  return { context, page, errors };
}

async function computerWithEntry(page: Page) {
  await page.goto('/');
  await page.getByText('Start new notebooks with example templates').click();
  await page.getByRole('button', { name: /Create browser notebook/ }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Smith lab');
  await page.getByRole('button', { name: 'Create notebook' }).click();
  await expect(page.locator('.gc-sidebar')).toBeVisible();
  await newBlankEntry(page, 'Bench log');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Written on the computer.');
  await waitForSave(page);
}

async function showCode(page: Page): Promise<string> {
  await page.locator('.gc-notebook-btn, .gc-sidebar-head button').first().click();
  await page.getByRole('menuitem', { name: 'Connect a phone' }).click();
  await expect(page.getByRole('img', { name: /QR code to connect a phone/ })).toBeVisible();
  return (await page.getByRole('button', { name: 'Copy link' }).getAttribute('data-url'))!;
}

async function pasteLink(page: Page, url: string) {
  await page.goto('/');
  await page.getByRole('button', { name: /Paste the link/ }).click();
  await page.getByLabel('Link from the computer').fill(url);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
}

async function connectPhone(page: Page, url: string) {
  await pasteLink(page, url);
  await expect(page.locator('.gc-main')).toBeVisible({ timeout: 30_000 });
}

async function openEntry(page: Page, title: string) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await expect(page.locator('.gc-title-input')).toHaveValue(title);
}

/** The computer's record of its paired phones. */
const pairings = (page: Page) =>
  page.evaluate(async () => {
    const { getState } = await import(/* @vite-ignore */ '/src/notebook/store.ts' as string);
    const { getKnownNotebook } = await import(/* @vite-ignore */ '/src/fs/registry.ts' as string);
    const nb = await getKnownNotebook(getState().vault.id);
    return (nb?.pairings ?? []) as { secret: string; keyed?: boolean; next?: string }[];
  });

const close = (...contexts: BrowserContext[]) => Promise.all(contexts.map((c) => c.close()));

test('once a phone has used the code, the two use a key of their own: the code no longer connects anything', async ({ browser }) => {
  const computer = await device(browser);
  const phone = await device(browser, true);
  const stranger = await device(browser, true);
  try {
    await computerWithEntry(computer.page);
    const url = await showCode(computer.page);
    const qrSecret = url.split('/').pop()!;
    await connectPhone(phone.page, url);
    await expect.poll(async () => (await pairings(computer.page))[0], { timeout: 20_000 }).toMatchObject({ keyed: true });
    const [p] = await pairings(computer.page);
    expect(p.secret).not.toBe(qrSecret);
    expect(p.next).toBeUndefined();

    // The two still sync, with the new key.
    await openEntry(phone.page, 'Bench log');
    await phone.page.locator('.ProseMirror').click();
    await phone.page.keyboard.press(KEYS.lineEnd);
    await phone.page.keyboard.type(' Then at the bench.');
    await openEntry(computer.page, 'Bench log');
    await expect(computer.page.locator('.ProseMirror')).toContainText('Then at the bench.', { timeout: 15_000 });

    // Someone else with the code (a photo of the screen, the copied link) gets nothing.
    await pasteLink(stranger.page, url);
    await stranger.page.waitForTimeout(6000);
    await expect(stranger.page.getByRole('dialog')).toContainText('Waiting for the computer');
    await expect(stranger.page.locator('.gc-main')).toHaveCount(0);
    expect(await pairings(computer.page)).toHaveLength(1);
    expect(computer.errors).toEqual([]);
    expect(phone.errors).toEqual([]);
  } finally {
    await close(computer.context, phone.context, stranger.context);
  }
});

test('a phone paired before keeps working, and switches to a key of its own at the next connection', async ({ browser }) => {
  const computer = await device(browser);
  const phone = await device(browser, true);
  try {
    await computerWithEntry(computer.page);
    await connectPhone(phone.page, await showCode(computer.page));
    await expect.poll(async () => (await pairings(computer.page))[0]?.keyed, { timeout: 20_000 }).toBe(true);
    // As a pairing made by an earlier version: the QR code's secret, on both, not keyed.
    const old = (await pairings(computer.page))[0].secret;
    const legacy = 'AAAAAAAAAAAAAAAAAAAAAA';
    await computer.page.evaluate(async (secret) => {
      const { getState } = await import(/* @vite-ignore */ '/src/notebook/store.ts' as string);
      const { updateKnownNotebook } = await import(/* @vite-ignore */ '/src/fs/registry.ts' as string);
      await updateKnownNotebook(getState().vault.id, (nb: { pairings: object[] }) => ({
        ...nb,
        pairings: nb.pairings.map((p) => ({ ...p, secret, keyed: undefined })),
      }));
    }, legacy);
    await phone.page.evaluate(async (secret) => {
      const { getState } = await import(/* @vite-ignore */ '/src/notebook/store.ts' as string);
      const { updateKnownNotebook } = await import(/* @vite-ignore */ '/src/fs/registry.ts' as string);
      await updateKnownNotebook(getState().vault.id, (nb: { link: object }) => ({ ...nb, link: { ...nb.link, secret, keyed: undefined } }));
    }, legacy);
    await computer.page.reload();
    await phone.page.reload();
    await expect.poll(async () => (await pairings(computer.page))[0], { timeout: 30_000 }).toMatchObject({ keyed: true });
    const now = (await pairings(computer.page))[0].secret;
    expect(now).not.toBe(legacy);
    expect(now).not.toBe(old);
    await expect(phone.page.locator('.gc-sync-indicator')).toHaveAttribute('title', /Connected/, { timeout: 20_000 });
  } finally {
    await close(computer.context, phone.context);
  }
});

test('a second tab takes the connection over; the first says so and does not take it back by itself', async ({ browser }) => {
  const computer = await device(browser);
  const phone = await device(browser, true);
  let sockets = 0;
  await phone.context.routeWebSocket(/\/connect\//, (ws) => {
    sockets++;
    ws.connectToServer();
  });
  try {
    await computerWithEntry(computer.page);
    await connectPhone(phone.page, await showCode(computer.page));
    await expect(phone.page.locator('.gc-sync-indicator')).toHaveAttribute('title', /Connected/);
    const second = await phone.context.newPage();
    await second.goto('/');
    await expect(second.locator('.gc-sync-indicator')).toHaveAttribute('title', /Connected/, { timeout: 20_000 });
    await expect(phone.page.locator('.gc-sync-indicator')).toHaveAttribute('title', /another tab/);
    // Neither pushes the other out again.
    const settled = sockets;
    await phone.page.waitForTimeout(6000);
    expect(sockets).toBe(settled);
    await expect(second.locator('.gc-sync-indicator')).toHaveAttribute('title', /Connected/);
    // Used again, the first takes it back.
    await phone.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(phone.page.locator('.gc-sync-indicator')).toHaveAttribute('title', /Connected/, { timeout: 20_000 });
    await expect(second.locator('.gc-sync-indicator')).toHaveAttribute('title', /another tab/);
  } finally {
    await close(computer.context, phone.context);
  }
});

test('a phone out of space ends its first copy with a clear message and can try again', async ({ browser }) => {
  const computer = await device(browser);
  const phone = await device(browser, true);
  // The phone's browser storage is full: writing a file of a notebook fails as a full disk does.
  await phone.context.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if ((window as unknown as { full?: boolean }).full && this.name === 'files')
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  try {
    await computerWithEntry(computer.page);
    const url = await showCode(computer.page);
    await phone.page.goto('/');
    await phone.page.evaluate(() => ((window as unknown as { full: boolean }).full = true));
    await phone.page.getByRole('button', { name: /Paste the link/ }).click();
    await phone.page.getByLabel('Link from the computer').fill(url);
    await phone.page.getByRole('button', { name: 'Connect', exact: true }).click();
    const dialog = phone.page.getByRole('dialog');
    await expect(dialog).toContainText('no room left for the notebook', { timeout: 20_000 });
    await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible();
  } finally {
    await close(computer.context, phone.context);
  }
});

test('a page edited on both devices while apart keeps its latest edit on both, the other in its history', async ({ browser }) => {
  const computer = await device(browser);
  const phone = await device(browser, true);
  try {
    await computerWithEntry(computer.page);
    await connectPhone(phone.page, await showCode(computer.page));
    await openEntry(phone.page, 'Bench log');
    await openEntry(computer.page, 'Bench log');

    await phone.context.setOffline(true);
    await expect(phone.page.locator('.gc-sync-indicator')).toHaveAttribute('title', /No internet connection|Waiting/, { timeout: 20_000 });
    await computer.page.locator('.ProseMirror').click();
    await computer.page.keyboard.press(KEYS.docEnd);
    await computer.page.keyboard.type(' Desk edit, earlier.');
    await waitForSave(computer.page);
    await computer.page.waitForTimeout(1500);
    await phone.page.locator('.ProseMirror').click();
    await phone.page.keyboard.press(KEYS.lineEnd);
    await phone.page.keyboard.type(' Bench edit, later.');
    await waitForSave(phone.page);

    await phone.context.setOffline(false);
    await expect(computer.page.locator('.ProseMirror')).toContainText('Bench edit, later.', { timeout: 30_000 });
    await expect(computer.page.locator('.ProseMirror')).not.toContainText('Desk edit, earlier.');
    await expect(computer.page.locator('.toast', { hasText: 'was the latest and is kept' })).toBeVisible();
    await expect(phone.page.locator('.ProseMirror')).toContainText('Bench edit, later.');
    // No copies; the desk edit is in the page's history on the computer.
    const files = await computer.page.evaluate(async () => {
      const { getState } = await import(/* @vite-ignore */ '/src/notebook/store.ts' as string);
      return Object.keys(getState().docs).filter((p) => p.includes('(from'));
    });
    expect(files).toEqual([]);
    await computer.page.getByRole('button', { name: 'History' }).click();
    const history = computer.page.getByRole('dialog', { name: /Version history/ });
    await expect(history).toContainText('Replaced by a later edit');
  } finally {
    await close(computer.context, phone.context);
  }
});
