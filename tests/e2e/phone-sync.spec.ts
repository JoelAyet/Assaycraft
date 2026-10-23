import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { join } from 'node:path';
import { newBlankEntry, openFolderNotebook, readFile, skipTour, trackErrors, waitForSave } from './helpers';

/**
 * Connect a phone: a "computer" and a "phone", each a browser context of its own (separate storage,
 * like two devices), syncing through the relay of the dev server.
 */

const PHONE = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
};

async function device(browser: Browser, opts: { phone?: boolean; direct?: boolean } = {}) {
  const context = await browser.newContext(opts.phone ? PHONE : {});
  const page = await context.newPage();
  const errors = trackErrors(page);
  await skipTour(page);
  if (opts.direct === false) await page.addInitScript(() => localStorage.setItem('assaycraft:direct', 'off'));
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

/** Open Connect a phone from the notebook menu, and return the link its QR code holds. */
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
  await page.keyboard.press('Control+k');
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await expect(page.locator('.gc-title-input')).toHaveValue(title);
}

const close = (...contexts: BrowserContext[]) => Promise.all(contexts.map((c) => c.close()));

test('a phone connects with the code, gets the notebook, and edits go both ways (through the relay)', async ({ browser }) => {
  const computer = await device(browser, { direct: false });
  const phone = await device(browser, { phone: true, direct: false });
  try {
    await computerWithEntry(computer.page);
    const url = await showCode(computer.page);
    expect(url).toMatch(/\/#\/pair\/[A-Za-z0-9_-]{22}$/);

    await connectPhone(phone.page, url);
    await expect(phone.page.locator('.toast', { hasText: '“Smith lab” is on this device' })).toBeVisible();
    await expect(computer.page.locator('.gc-peer')).toContainText('Connected through the relay');
    await expect(computer.page.locator('.gc-peer')).toContainText('Android phone · Chrome');

    // The phone has the entry the computer wrote.
    await openEntry(phone.page, 'Bench log');
    await expect(phone.page.locator('.ProseMirror')).toContainText('Written on the computer.');

    // Written at the bench, it shows up on the computer while it is open there.
    await openEntry(computer.page, 'Bench log');
    await phone.page.locator('.ProseMirror').click();
    await phone.page.keyboard.press('End');
    await phone.page.keyboard.type(' Added at the bench.');
    await expect(computer.page.locator('.ProseMirror')).toContainText('Added at the bench.', { timeout: 15_000 });
    await expect(computer.page.locator('.toast', { hasText: 'outside Assaycraft' })).toHaveCount(0);

    // And the other way.
    await computer.page.locator('.ProseMirror').click();
    await computer.page.keyboard.press('Control+End');
    await computer.page.keyboard.type(' Then on the computer again.');
    await expect(phone.page.locator('.ProseMirror')).toContainText('Then on the computer again.', { timeout: 15_000 });

    // A new entry on the phone appears on the computer. (On a phone, New entry is in the closed menu: use its shortcut.)
    await phone.page.keyboard.press('Control+Alt+n');
    await phone.page.locator('.gc-template-option', { hasText: 'Blank entry' }).click();
    await phone.page.locator('#ne-title').fill('Colony count');
    await phone.page.getByRole('button', { name: 'Create entry' }).click();
    await expect(phone.page.locator('.gc-title-input')).toHaveValue('Colony count');
    await expect(computer.page.locator('.gc-sidebar')).toContainText('Colony count', { timeout: 15_000 });

    expect(computer.errors).toEqual([]);
    expect(phone.errors).toEqual([]);
  } finally {
    await close(computer.context, phone.context);
  }
});

test('the phone keeps its copy, reconnects by itself, and catches up on what changed meanwhile', async ({ browser }) => {
  const computer = await device(browser, { direct: false });
  const phone = await device(browser, { phone: true, direct: false });
  try {
    await computerWithEntry(computer.page);
    await connectPhone(phone.page, await showCode(computer.page));

    // The computer closes the notebook; the phone works on, offline from it.
    await computer.page.goto('about:blank');
    await openEntry(phone.page, 'Bench log');
    await phone.page.locator('.ProseMirror').click();
    await phone.page.keyboard.press('End');
    await phone.page.keyboard.type(' Done while the computer was off.');
    await waitForSave(phone.page);
    await phone.page.reload();
    await expect(phone.page.locator('.ProseMirror')).toContainText('Done while the computer was off.');
    await expect(phone.page.locator('.gc-sync-indicator')).toHaveAttribute('title', /Waiting for the computer/);

    // The computer opens the notebook again: the phone connects and the two catch up.
    await computer.page.goto('/');
    await expect(computer.page.locator('.gc-sidebar')).toBeVisible();
    await expect(phone.page.locator('.gc-sync-indicator')).toHaveAttribute('title', /Connected/, { timeout: 20_000 });
    await openEntry(computer.page, 'Bench log');
    await expect(computer.page.locator('.ProseMirror')).toContainText('Done while the computer was off.', { timeout: 15_000 });
    expect(phone.errors).toEqual([]);
  } finally {
    await close(computer.context, phone.context);
  }
});

test('the two connect directly (WebRTC) when the network allows it', async ({ browser }) => {
  const computer = await device(browser);
  const phone = await device(browser, { phone: true });
  try {
    await computerWithEntry(computer.page);
    await connectPhone(phone.page, await showCode(computer.page));
    await expect(computer.page.locator('.gc-peer')).toContainText('Connected directly', { timeout: 30_000 });
    await openEntry(phone.page, 'Bench log');
    await phone.page.locator('.ProseMirror').click();
    await phone.page.keyboard.press('End');
    await phone.page.keyboard.type(' Sent directly.');
    await openEntry(computer.page, 'Bench log');
    await expect(computer.page.locator('.ProseMirror')).toContainText('Sent directly.', { timeout: 15_000 });
  } finally {
    await close(computer.context, phone.context);
  }
});

test('disconnecting a phone stops the sync; the phone keeps its copy', async ({ browser }) => {
  const computer = await device(browser, { direct: false });
  const phone = await device(browser, { phone: true, direct: false });
  try {
    await computerWithEntry(computer.page);
    await connectPhone(phone.page, await showCode(computer.page));
    await expect(computer.page.locator('.gc-peer')).toContainText('Connected');
    await computer.page.getByRole('button', { name: 'Disconnect' }).click();
    await computer.page.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click();
    await expect(computer.page.locator('.gc-peer')).toHaveCount(0);
    await expect(phone.page.locator('.toast', { hasText: 'The computer disconnected this device' })).toBeVisible();
    await expect(phone.page.locator('.gc-sync-indicator')).toHaveCount(0);
    await openEntry(phone.page, 'Bench log');
  } finally {
    await close(computer.context, phone.context);
  }
});

test('a folder notebook on the computer, with an image, syncs to the phone and back into the folder', async ({ browser }) => {
  const computer = await device(browser, { direct: false });
  const phone = await device(browser, { phone: true, direct: false });
  try {
    await openFolderNotebook(computer.page, { seed: false });
    await newBlankEntry(computer.page, 'Gel of the PCR');
    const chooser = computer.page.waitForEvent('filechooser');
    await computer.page.getByRole('button', { name: 'Attach files' }).click();
    await (await chooser).setFiles(join('tests', 'fixtures', 'folder-notebook', 'Gel photos', 'gel.png'));
    await expect(computer.page.locator('.ProseMirror img')).toHaveJSProperty('naturalWidth', 32);
    await waitForSave(computer.page);

    await connectPhone(phone.page, await showCode(computer.page));
    await openEntry(phone.page, 'Gel of the PCR');
    await expect(phone.page.locator('.ProseMirror img')).toHaveJSProperty('naturalWidth', 32);

    // Written on the phone, it lands in the Markdown file in the computer's folder.
    await phone.page.locator('.ProseMirror').click();
    await phone.page.keyboard.press('Control+End');
    await phone.page.keyboard.type('Band at 1.2 kb.');
    await expect.poll(() => readFile(computer.page, 'Projects/EXP-0001 Gel of the PCR.md'), { timeout: 15_000 }).toContain('Band at 1.2 kb.');
    expect(computer.errors).toEqual([]);
    expect(phone.errors).toEqual([]);
  } finally {
    await close(computer.context, phone.context);
  }
});

test('the phone loses its network at the bench: both add entries, and they catch up when it is back', async ({ browser }) => {
  const computer = await device(browser, { direct: false });
  const phone = await device(browser, { phone: true, direct: false });
  try {
    await computerWithEntry(computer.page);
    await connectPhone(phone.page, await showCode(computer.page));
    await expect(phone.page.locator('.gc-sync-indicator')).toHaveAttribute('title', /Connected/);

    await phone.context.setOffline(true);
    await expect(phone.page.locator('.gc-sync-indicator')).toHaveAttribute('title', /No internet connection|Waiting/, { timeout: 20_000 });
    // Each device adds an entry; both get the next ID, EXP-0002.
    await phone.page.keyboard.press('Control+Alt+n');
    await phone.page.locator('.gc-template-option', { hasText: 'Blank entry' }).click();
    await phone.page.locator('#ne-title').fill('Plated at the bench');
    await phone.page.getByRole('button', { name: 'Create entry' }).click();
    await expect(phone.page.locator('.gc-title-input')).toHaveValue('Plated at the bench');
    await waitForSave(phone.page);
    await newBlankEntry(computer.page, 'Written at the desk');
    await waitForSave(computer.page);

    await phone.context.setOffline(false);
    await expect(computer.page.locator('.gc-sidebar')).toContainText('Plated at the bench', { timeout: 30_000 });
    await expect(computer.page.locator('.toast', { hasText: 'EXP-0002 is now the ID of 2 pages' })).toBeVisible();
    await openEntry(phone.page, 'Written at the desk');
    expect(phone.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|WebSocket/.test(e))).toEqual([]);
  } finally {
    await close(computer.context, phone.context);
  }
});
