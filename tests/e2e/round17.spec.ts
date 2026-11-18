/**
 * The phone connection's audit: a notebook kept in the browser (as on every phone) lists its files
 * without reading them, a page edited on the other device is read again on its own, a phone put
 * away reconnects as soon as it is back on screen without the computer's changes made meanwhile
 * being undone, and iPhones and iPads are told how to keep their copy.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { newBlankEntry, skipTour, trackErrors, waitForSave, KEYS } from './helpers';

const ANDROID = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
};
const IPHONE = {
  ...ANDROID,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
};

async function device(browser: Browser, phone = false) {
  const context = await browser.newContext(phone ? ANDROID : {});
  const page = await context.newPage();
  const errors = trackErrors(page);
  await skipTour(page);
  await page.addInitScript(() => localStorage.setItem('assaycraft:direct', 'off'));
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

async function connectPhone(page: Page, url: string) {
  await page.goto('/');
  await page.getByRole('button', { name: /Paste the link/ }).click();
  await page.getByLabel('Link from the computer').fill(url);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.locator('.gc-main')).toBeVisible({ timeout: 30_000 });
}

async function openEntry(page: Page, title: string) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await expect(page.locator('.gc-title-input')).toHaveValue(title);
}

const close = (...contexts: BrowserContext[]) => Promise.all(contexts.map((c) => c.close()));

test('a notebook kept in the browser by an earlier version opens as before, and lists its files without reading them', async ({ page }) => {
  const errors = trackErrors(page);
  await skipTour(page);
  await page.goto('/');
  // The notebook as earlier versions stored it: one store, each folder and file with its contents.
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('genecraft-notebook-oldlab', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'path' });
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('files', 'readwrite');
        const s = tx.objectStore('files');
        const t = Date.now() - 86_400_000;
        const config = JSON.stringify({ name: 'Old lab', idPrefix: 'EXP' });
        for (const path of [
          '.assaycraft',
          'Projects',
          'Projects/General',
          'Projects/General/attachments',
          'Projects/General/attachments/EXP-0001',
          'Notes',
        ])
          s.put({ path, kind: 'directory', lastModified: t });
        s.put({ path: 'assaycraft.json', kind: 'file', data: config, size: config.length, lastModified: t });
        const md = '---\nid: EXP-0001\ntitle: Gel of the old lab\nstatus: In progress\n---\n\nThe gel ran well.\n';
        s.put({ path: 'Projects/General/EXP-0001 Gel of the old lab.md', kind: 'file', data: md, size: md.length, lastModified: t });
        const png = new Uint8Array(3000).fill(7).buffer;
        s.put({ path: 'Projects/General/attachments/EXP-0001/gel.png', kind: 'file', data: png, type: 'image/png', size: 3000, lastModified: t });
        // An even older one: a Blob, and no size.
        s.put({ path: 'Notes/Plan.md', kind: 'file', data: new Blob(['# Plan\n'], { type: 'text/plain' }), lastModified: t });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
  const found = await page.evaluate(async () => {
    const { IdbVault } = await import(/* @vite-ignore */ '/src/fs/idbVault.ts' as string);
    const v = await IdbVault.open('oldlab', 'Old lab');
    const out = {
      general: (await v.list('Projects/General')).map((e: { name: string; kind: string }) => `${e.kind} ${e.name}`).sort(),
      gel: await v.stat('Projects/General/attachments/EXP-0001/gel.png'),
      plan: await v.stat('Notes/Plan.md'),
      planText: await v.readText('Notes/Plan.md'),
      png: (await v.readBlob('Projects/General/attachments/EXP-0001/gel.png')).size,
      hasAttachments: await v.exists('Projects/General/attachments'),
      hasNothing: await v.exists('Projects/Gen'),
    };
    await v.remove('Projects/General/attachments');
    const after = (await v.list('Projects/General')).map((e: { name: string }) => e.name);
    v.close();
    const stores = await new Promise<string[]>((resolve) => {
      const req = indexedDB.open('genecraft-notebook-oldlab');
      req.onsuccess = () => {
        resolve([String(req.result.version), ...req.result.objectStoreNames]);
        req.result.close();
      };
    });
    return { ...out, after, stores };
  });
  expect(found.general).toEqual(['directory attachments', 'file EXP-0001 Gel of the old lab.md']);
  expect(found.gel).toMatchObject({ size: 3000 });
  expect(found.plan).toMatchObject({ size: 7 });
  expect(found.planText).toBe('# Plan\n');
  expect(found.png).toBe(3000);
  expect(found.hasAttachments).toBe(true);
  expect(found.hasNothing).toBe(false);
  expect(found.after).toEqual(['EXP-0001 Gel of the old lab.md']);
  expect(found.stores).toEqual(['2', 'files', 'meta']);

  // And in the app: the last notebook opened, it opens again by itself, its entry there.
  await page.evaluate(async () => {
    const { saveKnownNotebook } = await import(/* @vite-ignore */ '/src/fs/registry.ts' as string);
    await saveKnownNotebook({ id: 'oldlab', kind: 'browser', name: 'Old lab', lastOpened: Date.now() });
  });
  await page.reload();
  await expect(page.locator('.gc-sidebar')).toContainText('Old lab');
  await expect(page.locator('.gc-sidebar')).not.toContainText('Getting started');
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('Gel of the old lab');
  await page.keyboard.press('Enter');
  await expect(page.locator('.gc-title-input')).toHaveValue('Gel of the old lab');
  await expect(page.locator('.ProseMirror')).toContainText('The gel ran well.');
  expect(errors).toEqual([]);
});

test('a page edited on the computer is read again on its own on the phone; a new page rescans the notebook', async ({ browser }) => {
  const computer = await device(browser);
  const phone = await device(browser, true);
  try {
    await computerWithEntry(computer.page);
    await connectPhone(phone.page, await showCode(computer.page));
    await openEntry(phone.page, 'Bench log');
    // Count the phone's rescans from here on.
    await phone.page.evaluate(async () => {
      const { useNotebook } = await import(/* @vite-ignore */ '/src/notebook/store.ts' as string);
      const w = window as unknown as { rescans: number };
      w.rescans = 0;
      useNotebook.subscribe((s: { scanning: boolean }, prev: { scanning: boolean }) => {
        if (s.scanning && !prev.scanning) w.rescans++;
      });
    });
    const rescans = () => phone.page.evaluate(() => (window as unknown as { rescans: number }).rescans);

    // Typing on the computer: the phone's page follows, its title in the sidebar too, with no rescan.
    await openEntry(computer.page, 'Bench log');
    await computer.page.locator('.ProseMirror').click();
    await computer.page.keyboard.press(KEYS.docEnd);
    await computer.page.keyboard.type(' And again.');
    await expect(phone.page.locator('.ProseMirror')).toContainText('And again.', { timeout: 15_000 });
    // A property: the phone's list of pages has it too.
    await computer.page
      .locator('.gc-props')
      .getByRole('button', { name: /^(In progress|Planned)$/ })
      .click();
    await computer.page.locator('.popover .menu-item', { hasText: 'Completed' }).click();
    await waitForSave(computer.page);
    await expect
      .poll(
        () =>
          phone.page.evaluate(async () => {
            const { getState } = await import(/* @vite-ignore */ '/src/notebook/store.ts' as string);
            const docs = Object.values(getState().docs) as { title: string; status?: string }[];
            return docs.find((d) => d.title === 'Bench log')?.status;
          }),
        { timeout: 15_000 },
      )
      .toBe('completed');
    expect(await rescans()).toBe(0);

    // A new entry: the phone rescans, and has it.
    await newBlankEntry(computer.page, 'Colony count');
    await waitForSave(computer.page);
    await expect
      .poll(
        () =>
          phone.page.evaluate(async () => {
            const { getState } = await import(/* @vite-ignore */ '/src/notebook/store.ts' as string);
            return (Object.values(getState().docs) as { title: string }[]).some((d) => d.title === 'Colony count');
          }),
        { timeout: 15_000 },
      )
      .toBe(true);
    expect(await rescans()).toBeGreaterThan(0);
    expect(computer.errors).toEqual([]);
    expect(phone.errors).toEqual([]);
  } finally {
    await close(computer.context, phone.context);
  }
});

test('a phone put away with a connection that looks open reconnects as soon as it is back on screen', async ({ browser }) => {
  const computer = await device(browser);
  const phone = await device(browser, true);
  // The phone's connections to the relay, through a switch that can make them go silent (as when a
  // phone is put away: the socket looks open, but nothing goes through).
  const sockets: { silent: boolean }[] = [];
  await phone.page.routeWebSocket(/\/connect\//, (ws) => {
    const me = { silent: false };
    sockets.push(me);
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      if (!me.silent) server.send(m);
    });
    server.onMessage((m) => {
      if (!me.silent) ws.send(m);
    });
  });
  try {
    await computerWithEntry(computer.page);
    await connectPhone(phone.page, await showCode(computer.page));
    await expect(phone.page.locator('.gc-sync-indicator')).toHaveAttribute('title', /Connected/);

    // Put away: its connection goes silent. The computer writes on meanwhile.
    for (const s of sockets) s.silent = true;
    await openEntry(computer.page, 'Bench log');
    await computer.page.locator('.ProseMirror').click();
    await computer.page.keyboard.press(KEYS.docEnd);
    await computer.page.keyboard.type(' While the phone was away.');
    await waitForSave(computer.page);

    // Back on screen: within seconds (not the minute it took to notice), it has caught up.
    await phone.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await openEntry(phone.page, 'Bench log');
    await expect(phone.page.locator('.ProseMirror')).toContainText('While the phone was away.', { timeout: 12_000 });
    expect(sockets.length).toBeGreaterThan(1);
    // And the computer kept it: the change that never reached the phone was not counted as agreed,
    // so the phone's older version did not replace it.
    await computer.page.waitForTimeout(1000);
    await expect(computer.page.locator('.ProseMirror')).toContainText('While the phone was away.');
    expect(await computer.page.locator('.toast', { hasText: 'both versions are kept' }).count()).toBe(0);
    expect(computer.errors).toEqual([]);
    expect(phone.errors.filter((e) => !/WebSocket/.test(e))).toEqual([]);
  } finally {
    await close(computer.context, phone.context);
  }
});

test('on an iPhone in Safari, connecting says how to keep the copy; elsewhere it does not', async ({ browser }) => {
  for (const [ua, shows] of [
    [IPHONE, true],
    [ANDROID, false],
  ] as const) {
    const context = await browser.newContext(ua);
    const page = await context.newPage();
    await skipTour(page);
    await page.goto('/');
    await page.locator('.gc-welcome-options').getByRole('button', { name: 'Scan the code' }).click();
    const note = page.getByRole('dialog').getByText('add Assaycraft to your Home Screen');
    if (shows) await expect(note).toBeVisible();
    else await expect(note).toHaveCount(0);
    await context.close();
  }
});
