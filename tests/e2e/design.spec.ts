import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { newBlankEntry, openFolderNotebook, skipTour, trackErrors, waitForSave } from './helpers';

const PHONE_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

/**
 * Design checks on the main screens, in light and dark and on a phone: text contrast (WCAG AA),
 * controls with no name, tap targets under 24 px on touch screens, pages that scroll sideways,
 * text cut off with no “…”, text running off the side of the screen, buttons with underlined
 * text, the field being typed in hidden under something (a toast), and wide side margins on a phone.
 */
/** Runs in the page: contrast, clipped text, overlaps, small targets, unnamed controls. */
function audit(phone: boolean) {
  const parse = (c: string): number[] | null => {
    let m = c.match(/^rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      return [p[0], p[1], p[2], p[3] ?? 1];
    }
    m = c.match(/^color\(srgb ([^)]+)\)/);
    if (m) {
      const p = m[1]
        .split(/[\s/]+/)
        .filter(Boolean)
        .map(Number);
      return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1];
    }
    return null;
  };
  const blend = (top: number[], bottom: number[]) => {
    const a = top[3];
    return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
  };
  const bgOf = (el: Element | null): number[] => {
    const layers: number[][] = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c[3] > 0) {
        layers.push(c);
        if (c[3] >= 1) break;
      }
    }
    let out = [255, 255, 255, 1];
    if (layers.length && layers[layers.length - 1][3] >= 1) out = layers.pop()!;
    for (const l of layers.reverse()) out = blend(l, out);
    return out;
  };
  const lum = (c: number[]) => {
    const f = (v: number) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a: number[], b: number[]) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const name = (el: Element) =>
    el.tagName.toLowerCase() + (el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : '') + (el.id ? '#' + el.id : '');
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') return false;
    let op = 1;
    for (let e: Element | null = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    return op > 0.05;
  };
  const hex = (c: number[]) =>
    '#' +
    c
      .slice(0, 3)
      .map((v) => Math.round(v).toString(16).padStart(2, '0'))
      .join('');
  // Text running past the box that clips it (or past the screen), unless that box ends it with “…” or is a strip
  // made to scroll sideways (a toolbar, a plate, a row of filters). A page scrolling sideways as well as down is a fault.
  const runsOff = (el: Element, right: number) => {
    for (let a = el.parentElement; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX === 'visible') continue;
      if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && a.scrollWidth > a.clientWidth + 1 && a.scrollHeight <= a.clientHeight + 1)
        return false;
      if (right <= a.getBoundingClientRect().right + 1) continue;
      return !(s.textOverflow === 'ellipsis' && !/flex|grid/.test(s.display));
    }
    return right > window.innerWidth + 1;
  };
  const contrast: unknown[] = [];
  const clipped: unknown[] = [];
  const cut: unknown[] = [];
  const offscreen: unknown[] = [];
  const all = [...document.querySelectorAll('body *')];
  for (const el of all) {
    if (el.closest('svg, .ProseMirror-hideselection, [aria-hidden="true"]')) continue;
    const text = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join('')
      .trim();
    if (!text) continue;
    // Words squeezed to no width at all, the rest of their row having taken it, are not drawn either.
    const flat = el.getBoundingClientRect();
    if (
      flat.width < 1 &&
      flat.height >= 1 &&
      el.scrollWidth > 8 &&
      getComputedStyle(el).position !== 'absolute' &&
      el.parentElement &&
      visible(el.parentElement)
    )
      cut.push({ el: name(el), text: text.slice(0, 40), w: 0, need: el.scrollWidth, squeezed: true });
    if (!visible(el)) continue;
    if (el.closest('[disabled], [aria-disabled="true"]')) continue;
    const s = getComputedStyle(el);
    const fg = parse(s.color);
    if (!fg) continue;
    const bg = bgOf(el);
    let op = 1;
    for (let e: Element | null = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    const shown = blend([fg[0], fg[1], fg[2], fg[3] * op], bg);
    const size = parseFloat(s.fontSize);
    const large = size >= 24 || (size >= 18.6 && Number(s.fontWeight) >= 700);
    const r = ratio(shown, bg);
    if (r < (large ? 3 : 4.5)) contrast.push({ el: name(el), text: text.slice(0, 40), fg: hex(shown), bg: hex(bg), ratio: +r.toFixed(2), size });
    if ((s.overflowX === 'hidden' || s.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1) {
      clipped.push({ el: name(el), text: text.slice(0, 40), ellipsis: s.textOverflow === 'ellipsis', w: el.clientWidth, need: el.scrollWidth });
      // No “…” is drawn on a flex or grid row, whatever text-overflow says. (Screen-reader-only text is 1 px wide.)
      if (el.clientWidth > 2 && (s.textOverflow !== 'ellipsis' || /flex|grid/.test(s.display)))
        cut.push({ el: name(el), text: text.slice(0, 40), w: el.clientWidth, need: el.scrollWidth });
      // A “…” after a letter or two says nothing: a label squeezed that far is cut off too.
      else if (el.clientWidth > 2 && el.clientWidth < 3 * size)
        cut.push({ el: name(el), text: text.slice(0, 40), w: el.clientWidth, need: el.scrollWidth, squeezed: true });
    }
    const box = el.getBoundingClientRect();
    if (box.width > 2 && runsOff(el, box.right)) offscreen.push({ el: name(el), text: text.slice(0, 40), right: Math.round(box.right) });
  }
  // Children of one parent drawn on top of each other.
  const overlaps: unknown[] = [];
  for (const el of all) {
    const kids = [...el.children].filter((k) => visible(k) && !['absolute', 'fixed'].includes(getComputedStyle(k).position));
    if (kids.length < 2 || kids.length > 40) continue;
    const rects = kids.map((k) => k.getBoundingClientRect());
    for (let i = 0; i < kids.length; i++)
      for (let j = i + 1; j < kids.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 3 && oy > 3)
          overlaps.push({
            parent: name(el),
            a: name(kids[i]),
            b: name(kids[j]),
            ax: (kids[i].textContent ?? '').trim().slice(0, 25),
            bx: (kids[j].textContent ?? '').trim().slice(0, 25),
            ox: Math.round(ox),
            oy: Math.round(oy),
          });
      }
  }
  const small: unknown[] = [];
  const unnamed: unknown[] = [];
  for (const el of document.querySelectorAll('button, a[href], [role="button"], input:not([type="hidden"]), select, textarea')) {
    if (!visible(el) || el.closest('[aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect();
    const label =
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('aria-labelledby') ||
      (el.textContent ?? '').trim() ||
      (el as HTMLInputElement).placeholder ||
      (el.id && document.querySelector(`label[for="${el.id}"]`)) ||
      el.closest('label');
    if (!label) unnamed.push({ el: name(el), html: el.outerHTML.slice(0, 120) });
    const min = Math.min(r.width, r.height);
    const labeled = el.tagName === 'INPUT' && (el.closest('label')?.textContent ?? '').trim().length > 0;
    if (phone && min < 24 && !labeled && !(el.tagName === 'A' && getComputedStyle(el).display === 'inline'))
      small.push({
        el: name(el),
        text: (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 25),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
  }
  const pageOverflow = document.documentElement.scrollWidth > window.innerWidth + 1 ? document.documentElement.scrollWidth : 0;
  // A link drawn as a button reads as a button: no underline.
  const underlined = [...document.querySelectorAll('.btn, [role="button"]')]
    .filter((el) => visible(el) && getComputedStyle(el).textDecorationLine.includes('underline'))
    .map((el) => ({ el: name(el), text: (el.textContent ?? '').trim().slice(0, 25) }));
  // The field being typed in must not be under something else, such as a toast. (An icon drawn in the
  // field, a search glass, is part of it.)
  const covered: unknown[] = [];
  const active = document.activeElement;
  if (active && active.matches('input, textarea, select, [contenteditable="true"]') && visible(active)) {
    const r = active.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + Math.min(r.height / 2, 16);
    const top = x > 0 && y > 0 && x < window.innerWidth && y < window.innerHeight ? document.elementFromPoint(x, y) : null;
    // A menu opened from the page (Color and size, say) is meant to sit over it for a moment.
    const menu = top?.closest('.popover, [role="menu"], [role="dialog"]');
    if (top && !menu && !active.contains(top) && !top.contains(active) && !top.parentElement?.contains(active))
      covered.push({ field: name(active), under: name(top), text: (top.textContent ?? '').trim().slice(0, 40) });
  }
  // A phone has no room to spare: a page's title starts near the edge, as on every other page.
  const gutter = phone
    ? [...document.querySelectorAll('.gc-page-title, .gc-home-title')]
        .filter((el) => visible(el) && !el.closest('[role="dialog"]') && el.getBoundingClientRect().left > 24)
        .map((el) => ({ el: name(el), text: (el.textContent ?? '').trim().slice(0, 25), left: Math.round(el.getBoundingClientRect().left) }))
    : [];
  return { contrast, clipped, cut, offscreen, overlaps, small, unnamed, pageOverflow, underlined, covered, gutter };
}

/** The faults to report from an audit, or null when there are none. (Clipped text with a “…” and overlaps are only for looking at.) */
function faults(r: ReturnType<typeof audit>) {
  const found = {
    contrast: r.contrast,
    unnamed: r.unnamed,
    small: r.small,
    cut: r.cut,
    offscreen: r.offscreen,
    pageOverflow: r.pageOverflow,
    underlined: r.underlined,
    covered: r.covered,
    gutter: r.gutter,
  };
  return Object.values(found).some((v) => (Array.isArray(v) ? v.length : v)) ? found : null;
}

const SETUPS = [
  { name: 'desktop, light', w: 1440, h: 900, scheme: 'light' as const, phone: false },
  { name: 'laptop, dark', w: 1100, h: 760, scheme: 'dark' as const, phone: false },
  { name: 'phone, light', w: 390, h: 844, scheme: 'light' as const, phone: true },
  { name: 'phone, dark', w: 390, h: 844, scheme: 'dark' as const, phone: true },
];

for (const s of SETUPS) {
  test.describe(s.name, () => {
    test.use({ viewport: { width: s.w, height: s.h }, isMobile: s.phone, hasTouch: s.phone, colorScheme: s.scheme });

    test('every screen passes the design checks', async ({ page }) => {
      test.setTimeout(120_000);
      const problems: Record<string, unknown> = {};
      const check = async (screen: string) => {
        await page.waitForTimeout(250);
        const found = faults(await page.evaluate(audit, s.phone));
        if (found) problems[screen] = found;
      };
      const nav = async (item: string) => {
        if (s.phone) await page.locator('.gc-nav-toggle').first().click();
        await page.locator('.gc-nav-item', { hasText: item }).click();
      };

      // A fake clock, to take a break between editing sessions (for version history).
      await page.clock.install();
      await page.goto('/');
      await check('Welcome');
      await openFolderNotebook(page);
      if (s.phone) await page.locator('.gc-nav-toggle').first().click();
      await page.locator('.gc-new-btn').click();
      await page.locator('.gc-template-option', { hasText: 'Molecular cloning' }).click();
      await page.locator('.gc-var', { hasText: 'Construct' }).locator('input').fill('pLenti-GFP');
      await check('New entry dialog');
      await page.getByRole('button', { name: 'Create entry' }).click();
      await waitForSave(page);
      await check('Entry');
      await page.locator('.gc-toolbar').getByRole('button', { name: 'Insert…', exact: true }).click();
      await page.locator('.menu-item', { hasText: 'Buffer' }).click();
      await page.locator('.gc-buffer [data-cell="0:name"]').fill('NaCl');
      await page.locator('.gc-buffer [data-cell="0:stock"]').fill('58.44');
      await page.getByLabel('Stock unit of NaCl').selectOption('g/mol');
      await page.locator('.gc-buffer [data-cell="0:final"]').fill('150');
      await page.locator('.gc-buffer [data-cell="1:name"]').fill('Too much');
      await page.locator('.gc-buffer [data-cell="1:stock"]').fill('1');
      await page.locator('.gc-buffer [data-cell="1:final"]').fill('5000');
      await check('Buffer');
      // A plate layout, 96 and 384 wells.
      await page.locator('.gc-toolbar').getByRole('button', { name: 'Insert…', exact: true }).click();
      await page.locator('.menu-item', { hasText: 'Plate layout' }).click();
      for (const n of ['Blank', 'Std 1', 'WT']) {
        await page.getByLabel('Add sample').fill(n);
        await page.getByLabel('Add sample').press('Enter');
      }
      await page.getByRole('button', { name: 'Fill row B', exact: true }).click();
      await page.locator('.gc-plate-sample', { hasText: 'Blank' }).click();
      await page.getByRole('button', { name: 'Fill column 1', exact: true }).click();
      await check('Plate');
      await page.getByLabel('Plate format').selectOption('384');
      await check('Plate 384');
      // A stock linked in the text.
      await page.locator('.gc-toolbar').getByRole('button', { name: 'Insert…', exact: true }).click();
      await page.locator('.menu-item', { hasText: 'Stock' }).click();
      await check('Stock picker');
      await page.keyboard.type('EGFP-fwd');
      await page.keyboard.press('Enter');
      await page.locator('.ProseMirror a', { hasText: 'PR-0001' }).waitFor();
      await check('Entry with a stock link');
      // Notes, and a flow with one step started.
      await nav('Notes');
      await check('Notes');
      await page.locator('.gc-note-open').first().click();
      await check('Note');
      if (s.phone) await page.locator('.gc-nav-toggle').first().click();
      await page.locator('.gc-new-btn').click();
      await page.locator('.gc-template-option', { hasText: 'Protein production' }).click();
      await page.locator('.gc-var', { hasText: 'Protein' }).locator('input').fill('GFP');
      await page.getByRole('button', { name: 'Create entry' }).click();
      await page.locator('.gc-flow-card[data-step="5"]').waitFor();
      await page.getByRole('button', { name: /^Start step 2/ }).click();
      await check('Start step dialog');
      await page.getByRole('dialog').getByRole('button', { name: 'Start', exact: true }).click();
      await page.getByPlaceholder('The outcome in one line').fill('12 colonies');
      await waitForSave(page);
      await check('Flow step');
      await page.locator('.gc-flowbar-parent').click();
      await page.locator('.gc-flow').scrollIntoViewIfNeeded();
      await check('Flow');
      // Literature: the library, adding and importing papers, a paper, and citing one in the example entry.
      await nav('Literature');
      await check('Literature');
      await page.getByRole('button', { name: 'New paper' }).click();
      await page.getByRole('dialog').locator('#paper-title').fill('A test paper');
      await check('Add paper dialog');
      await page.getByRole('tab', { name: 'BibTeX or RIS' }).click();
      await page.locator('#paper-bib').fill('@article{x, title={T}, author={A, B}, year={2020}}');
      await check('Import papers');
      await page.keyboard.press('Escape');
      await page.locator('.gc-paper-row .gc-note-open').first().click();
      await check('Paper');
      await page.locator('.gc-backlink', { hasText: 'EXAMPLE-1' }).click();
      await page.locator('.gc-buffer').waitFor();
      await check('Example entry');
      await page.locator('.gc-toolbar').getByRole('button', { name: 'Insert…', exact: true }).click();
      await page.locator('.menu-item', { hasText: 'Cite a paper' }).click();
      await check('Cite picker');
      await page.keyboard.press('Escape');
      await nav('Home');
      await check('Home');
      await nav('Protocols');
      await check('Protocols');
      await page.locator('.gc-protocol-table tbody tr').first().click();
      await check('Protocol');
      await nav('Templates');
      await page.locator('.gc-tpl-card').first().waitFor();
      await check('Templates');
      await page.locator('.gc-tpl-card', { hasText: 'Molecular cloning' }).click();
      await check('Template');
      await nav('Stocks');
      await page.locator('.gc-viewtab', { hasText: 'Primers' }).click();
      await page.locator('.gc-stock-table').waitFor();
      await check('Stocks');
      await page.locator('.gc-stock-id', { hasText: 'PR-0001' }).click();
      await check('Stock details');
      await page.getByRole('button', { name: 'Close the details' }).click();
      await page.getByRole('button', { name: 'More to add' }).click();
      await check('New menu');
      await page.getByRole('menuitem', { name: 'New collection…' }).click();
      await check('New collection dialog');
      await page.keyboard.press('Escape');
      // Two editing sessions, then the version history.
      const location = page.locator('.gc-stock-table tr[data-stock="PR-0001"]').getByLabel(/^Location of /);
      await location.fill('Freezer A · box 1');
      await waitForSave(page);
      await page.clock.fastForward('11:00');
      await location.fill('Freezer B · box 7');
      await page.locator('.gc-new-main').click();
      await page.keyboard.type('T7 promoter');
      await page.keyboard.press('Escape');
      await waitForSave(page);
      await page.getByTitle('Primers options').click();
      await page.getByRole('menuitem', { name: 'Version history…' }).click();
      await page.locator('.gc-history-item').nth(2).waitFor();
      await check('Version history');
      await page.locator('.gc-history-item').nth(1).click();
      await page.getByRole('button', { name: 'Compare with current' }).click();
      await check('Version history compared with current');
      await page.keyboard.press('Escape');
      await nav('Lab tasks');
      await check('Task board');
      if (s.phone) await page.locator('.gc-nav-toggle').first().click();
      await page.getByTitle('New board').click();
      await page.getByRole('dialog', { name: 'New board' }).getByLabel('Name').fill('Cloning status');
      await check('New board dialog');
      await page.getByRole('button', { name: 'Create board' }).click();
      await page.locator('.gc-col-add').first().click();
      await page.keyboard.type('pUC19-EGFP');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Escape');
      await check('Tracking board');
      await nav('Calendar');
      for (const view of ['Month', 'Week', 'Agenda']) {
        await page.locator('.gc-viewtab', { hasText: view }).click();
        await check(`Calendar ${view}`);
      }
      if (s.phone) {
        await page.locator('.gc-nav-toggle').first().click();
        await check('Menu');
      }
      await page.locator('.gc-tree-row.is-folder', { hasText: 'General' }).first().click();
      await check('Project folder');
      // The trash, with something in it.
      await page.goto('/#/notes');
      await page.locator('.gc-note-open').first().click();
      await page.getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitem', { name: 'Move to trash' }).click();
      // Red buttons, on a dialog over the page.
      await check('Move to trash dialog');
      await page.getByRole('button', { name: 'Move to trash' }).click();
      await page.goto('/#/trash');
      await page.locator('.gc-trash-row').first().waitFor();
      await check('Trash');
      await page.getByRole('button', { name: 'Empty trash' }).click();
      await check('Empty trash dialog');
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
      await page.goto('/#/settings');
      await check('Settings');
      await page.goto('/#/phone');
      await page.getByRole('img', { name: /QR code/ }).waitFor();
      await check('Connect a phone');
      await page.goto('/#/');
      await page.keyboard.press('Control+k');
      await page.keyboard.type('gib');
      await check('Search');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+k');
      await page.keyboard.type('take the tour');
      await page.keyboard.press('Enter');
      await page.locator('#gc-tour-name').waitFor();
      await check('Tour');
      await page.getByRole('button', { name: 'Skip tour' }).click();
      if (s.phone) await page.locator('.gc-nav-toggle').first().click();
      await page.locator('.gc-notebook-name').click();
      await page.getByRole('menuitem', { name: 'Switch notebook' }).click();
      await page.locator('.gc-recent-row').waitFor();
      await check('Welcome, recent notebook');
      await page.getByRole('button', { name: /Paste the link/ }).click();
      await page.getByLabel('Link from the computer').fill('not a link');
      await page.getByRole('button', { name: 'Connect', exact: true }).click();
      await check('Connect to a computer');

      expect(problems).toEqual({});
    });

    test('Connect a phone, on both devices, passes the design checks', async ({ browser }) => {
      test.setTimeout(120_000);
      const problems: Record<string, unknown> = {};
      const device = async (phone: boolean, mine: boolean) => {
        const context = await browser.newContext({
          viewport: mine ? { width: s.w, height: s.h } : phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
          isMobile: phone,
          hasTouch: phone,
          colorScheme: mine ? s.scheme : 'light',
          userAgent: phone ? PHONE_UA : undefined,
        });
        const page = await context.newPage();
        await skipTour(page);
        return { context, page, errors: trackErrors(page) };
      };
      // This setup's screen is the computer's or the phone's; the other device is plain.
      const computer = await device(false, !s.phone);
      const phone = await device(true, s.phone);
      const mine = s.phone ? phone.page : computer.page;
      const check = async (screen: string) => {
        await mine.waitForTimeout(250);
        const found = faults(await mine.evaluate(audit, s.phone));
        if (found) problems[screen] = found;
      };
      try {
        if (s.phone) {
          await phone.page.goto('/');
          await check('Phone welcome: Connect to a computer');
          await phone.page.getByRole('button', { name: 'Scan the code' }).click();
          // The scanner, or (no camera here) the link to paste.
          await phone.page.waitForTimeout(1000);
          await check('Scan the code');
          await phone.page.keyboard.press('Escape');
          await phone.page.getByRole('button', { name: 'No computer? Use this device on its own' }).click();
          await check('Phone welcome, every way');
        }
        await computer.page.goto('/');
        await computer.page.getByRole('button', { name: /Create browser notebook/ }).click();
        await computer.page.getByRole('dialog').getByRole('textbox').fill('Smith lab');
        await computer.page.getByRole('button', { name: 'Create notebook' }).click();
        await computer.page.goto('/#/phone');
        await computer.page.getByRole('img', { name: /QR code/ }).waitFor();
        const url = (await computer.page.getByRole('button', { name: 'Copy link' }).getAttribute('data-url'))!;
        await phone.page.goto(url);
        await phone.page.locator('.gc-main').waitFor({ timeout: 30_000 });
        await computer.page.locator('.gc-peer', { hasText: 'Connected' }).waitFor({ timeout: 20_000 });
        if (!s.phone) {
          await check('Phone connected');
          await computer.page.getByRole('button', { name: 'Disconnect' }).click();
          await check('Disconnect phone dialog');
          await computer.page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
          // An entry just written: the sidebar's foot holds the phone's icon and “Saved”.
          await newBlankEntry(computer.page, 'Bench log');
          await computer.page.locator('.ProseMirror').click();
          await computer.page.keyboard.type('Written on the computer.');
          await waitForSave(computer.page);
          await check('Entry, with the phone icon in the sidebar');
          await phone.context.close();
          await computer.page.goto('/#/phone');
          await computer.page.locator('.gc-peer', { hasText: 'Not connected' }).waitFor({ timeout: 90_000 });
          await check('Phone gone');
        } else {
          await phone.page.goto(url.replace(/#.*/, '#/phone'));
          await phone.page.locator('.gc-peer-status', { hasText: 'Connected' }).waitFor({ timeout: 20_000 });
          await check('Computer connection');
          await phone.page.locator('.gc-nav-toggle').first().click();
          await phone.page.locator('.gc-notebook-name').click();
          await check('Phone notebook menu');
          await phone.page.keyboard.press('Escape');
          await computer.context.close();
          await phone.page.goto(url.replace(/#.*/, '#/phone'));
          await phone.page.locator('.gc-peer-status', { hasText: 'Waiting for the computer' }).waitFor({ timeout: 90_000 });
          await check('Computer gone');
        }
        expect(computer.errors).toEqual([]);
        expect(phone.errors).toEqual([]);
      } finally {
        await computer.context.close().catch(() => {});
        await phone.context.close().catch(() => {});
      }
      expect(problems).toEqual({});
    });

    test('times, other calendars and the calendar link pass the design checks', async ({ page }) => {
      test.setTimeout(120_000);
      const problems: Record<string, unknown> = {};
      const check = async (screen: string) => {
        await page.waitForTimeout(250);
        const found = faults(await page.evaluate(audit, s.phone));
        if (found) problems[screen] = found;
      };
      const nav = async (item: string) => {
        if (s.phone) await page.locator('.gc-nav-toggle').first().click();
        await page.locator('.gc-nav-item', { hasText: item }).click();
      };
      // The lab's calendar, as the website would pass it on: a weekly meeting, and a booking over two days.
      const ymd = (days: number) => {
        const d = new Date();
        d.setDate(d.getDate() + days);
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      };
      const lab = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'X-WR-CALNAME:Lab bookings',
        'BEGIN:VEVENT',
        'UID:a@lab',
        `DTSTART;VALUE=DATE:${ymd(0)}`,
        `DTEND;VALUE=DATE:${ymd(2)}`,
        'SUMMARY:Confocal booked (Imaging core)',
        'LOCATION:Imaging core, room B12',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:b@lab',
        `DTSTART:${ymd(0)}T160000`,
        `DTEND:${ymd(0)}T170000`,
        'RRULE:FREQ=WEEKLY',
        'SUMMARY:Lab meeting',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n');
      await page.route('**/ical?url=*', (route) => route.fulfill({ contentType: 'text/calendar', body: lab }));

      await openFolderNotebook(page);
      if (s.phone) await page.locator('.gc-nav-toggle').first().click();
      await newBlankEntry(page, 'ELISA IL-6, plate 1');
      await page.getByRole('button', { name: 'Add time' }).click();
      await check('Time picker');
      await page.getByLabel('Type a time').fill('9:30');
      await page.getByLabel('Type a time').press('Enter');
      await page.getByRole('button', { name: 'End time' }).click();
      await check('End time picker');
      await page.getByRole('option', { name: /^12:00/ }).click();
      await waitForSave(page);
      await check('Entry with a time');
      await nav('Calendar');
      await page.locator('.gc-viewtab', { hasText: 'Month' }).click();
      await page.getByRole('button', { name: 'Calendars' }).click();
      await check('Calendars');
      await page.getByLabel('Calendar address (iCal)').fill('https://calendar.google.com/calendar/ical/lab%40group/private-0123456789/basic.ics');
      await page.getByRole('button', { name: 'Add calendar' }).click();
      await expect(page.getByLabel('Calendar name')).toHaveValue('Lab bookings');
      await page.locator('.gc-calendars-help summary').click();
      await page.getByRole('button', { name: 'Create a private calendar link' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Up to date' })).toBeVisible();
      await check('Calendars, with a calendar and the link');
      await page.keyboard.press('Escape');
      await check('Month with another calendar');
      if (s.phone) await page.locator('.gc-viewtab', { hasText: 'Agenda' }).click();
      await page.locator('.gc-cal-item.is-event:visible, .gc-agenda-item.is-event:visible', { hasText: 'Confocal' }).first().click();
      await check('Event of another calendar');
      await page.keyboard.press('Escape');
      await page.locator('.gc-viewtab', { hasText: 'Week' }).click();
      await check('Week with times');
      await page.locator('.gc-viewtab', { hasText: 'Agenda' }).click();
      await check('Agenda with times');
      await nav('Home');
      await check('Home with a time');
      expect(problems).toEqual({});
    });
    test('colors, reminders, the reading board, drawn notes and planned steps pass the design checks', async ({ page }) => {
      test.setTimeout(150_000);
      const problems: Record<string, unknown> = {};
      const check = async (screen: string) => {
        await page.waitForTimeout(250);
        const found = faults(await page.evaluate(audit, s.phone));
        if (found) problems[screen] = found;
      };
      const nav = async (item: string) => {
        if (s.phone) await page.locator('.gc-nav-toggle').first().click();
        await page.locator('.gc-nav-item', { hasText: item }).click();
      };
      const slash = async (command: string, item: string) => {
        await page.keyboard.type(`/${command}`);
        await page.locator('.gc-slash-item').filter({ hasText: item }).first().click();
      };
      await openFolderNotebook(page);
      if (s.phone) await page.locator('.gc-nav-toggle').first().click();
      await newBlankEntry(page, 'Western blot, day 2');
      await page.locator('.ProseMirror').click();
      await page.keyboard.type('Transfer at 100 V');
      await page.keyboard.press('Shift+Home');
      await page.getByRole('button', { name: 'Highlight color' }).click();
      await check('Highlight colors');
      await page.getByRole('button', { name: 'Highlight green' }).click();
      await page.getByRole('button', { name: 'Text color and size' }).click();
      await page.getByRole('button', { name: 'Text red' }).click();
      await check('Text color and size menu');
      await page.keyboard.press('Escape');
      await page.locator('.ProseMirror').press('End');
      await page.keyboard.press('Enter');
      await slash('day', 'Day');
      await expect(page.locator('.ProseMirror h2')).toBeVisible();
      await page.locator('.gc-date-chip').click();
      await check('Day of a date heading');
      await page.keyboard.press('Escape');
      await page.locator('.ProseMirror > p').last().click();
      await slash('reminder', 'Reminder');
      const reminder = page.getByRole('group', { name: 'Reminder' });
      await expect(reminder).toBeVisible();
      await page.keyboard.type('Take the membrane out of the blocking buffer');
      await reminder.getByRole('button', { name: 'Add time' }).click();
      await page.getByLabel('Type a time').fill('14:30');
      await page.getByLabel('Type a time').press('Enter');
      await check('Reminder');
      await page.keyboard.press('Escape');
      await expect(page.locator('.gc-reminder-btn')).toBeVisible();
      await page.getByRole('button', { name: 'Add tag' }).click();
      await page.keyboard.type('blot');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Color of tag blot' }).click();
      await check('Tag color');
      await page.keyboard.press('Escape');
      await page.locator('.ProseMirror > p').last().click();
      await page.getByRole('button', { name: 'Insert a table' }).click();
      await page.locator('.gc-sheet-grid td[data-r="1"][data-c="0"]').click({ button: 'right' });
      await check('Table menu with cell colors');
      await page.getByRole('menuitemradio', { name: 'Fill yellow' }).click();
      await page.locator('.gc-sheet-grid td[data-r="2"][data-c="1"]').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Freeze columns A–B' }).click();
      await waitForSave(page);
      await check('Entry with colors, a reminder and a table');
      // A flow with a step planned for a day.
      await page.locator('.ProseMirror > p').last().click();
      await slash('flow', 'Flow');
      await page.keyboard.type('Strip and reprobe');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Set a day for step 1' }).click();
      await check('Day of a flow step');
      await page.getByRole('group', { name: 'Day of step 1' }).locator('.gc-minical-day').last().click();
      await waitForSave(page);
      await page.locator('.gc-flow').scrollIntoViewIfNeeded();
      await check('Flow with a planned step');
      // A gel photo with notes drawn on it.
      await page.locator('.ProseMirror > p').last().click();
      const chooser = page.waitForEvent('filechooser');
      await page.locator('.gc-toolbar').getByRole('button', { name: 'Attach files' }).click();
      await (await chooser).setFiles({ name: 'gel.heic', mimeType: 'image/heic', buffer: readFileSync('tests/fixtures/heic/gel.heic') });
      const image = page.locator('.gc-image').first();
      await expect.poll(() => image.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 30_000 }).toBe(320);
      await image.hover();
      await image.getByRole('button', { name: 'Annotate' }).click();
      const box = (await image.locator('svg.gc-ann-layer').boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.6, { steps: 4 });
      await page.mouse.up();
      await check('Drawing on an image');
      await page.getByRole('button', { name: 'Done' }).click();
      await waitForSave(page);
      if (!s.phone) {
        await page.getByRole('navigation', { name: 'Index of this page' }).hover();
        await check('Index of the page');
      }
      await nav('Calendar');
      await page.getByRole('button', { name: 'Color by project' }).click();
      await page.locator('.gc-viewtab', { hasText: 'Month' }).click();
      await check('Month by project, with a reminder');
      await page.locator('.gc-viewtab', { hasText: 'Week' }).click();
      await check('Week by project, with a reminder');
      await page.locator('.gc-viewtab', { hasText: 'Agenda' }).click();
      await check('Agenda with a reminder and a planned step');
      await page.getByRole('button', { name: 'Color by project' }).click();
      await nav('Literature');
      await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Board' }).click();
      await check('Literature board');
      await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'List' }).click();
      await check('Literature list with reading status');
      expect(problems).toEqual({});
    });
  });
}
