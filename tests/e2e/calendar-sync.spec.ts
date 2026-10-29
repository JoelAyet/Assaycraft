import { test, expect, type Page } from '@playwright/test';
import { newBlankEntry, openFolderNotebook, readFile, trackErrors, waitForSave } from './helpers';

/** YYYY-MM-DD, `days` from today. */
const day = (days = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const compact = (ymd: string) => ymd.replace(/-/g, '');

/** A lab calendar as Google Calendar gives it: a weekly meeting and a booking tomorrow. */
function labCalendar() {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
    'X-WR-CALNAME:Lab bookings',
    'BEGIN:VEVENT',
    'UID:confocal@lab',
    `DTSTART;VALUE=DATE:${compact(day(1))}`,
    `DTEND;VALUE=DATE:${compact(day(2))}`,
    'SUMMARY:Confocal booked',
    'LOCATION:Imaging core',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:meeting@lab',
    `DTSTART:${compact(day(0))}T160000`,
    `DTEND:${compact(day(0))}T170000`,
    'RRULE:FREQ=WEEKLY',
    'SUMMARY:Lab meeting',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

async function openCalendar(page: Page) {
  await page.locator('.gc-nav-item', { hasText: 'Calendar' }).click();
  await expect(page.locator('.gc-calendar-page')).toBeVisible();
}

test('an experiment gets a time: on its page, in its file and on the calendar', async ({ page }) => {
  const errors = trackErrors(page);
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'ELISA plate 1');
  const path = decodeURIComponent(new URL(page.url()).hash.replace('#/doc/', ''));
  await page.getByRole('button', { name: 'Add time' }).click();
  await page.getByLabel('Type a time').fill('9:30');
  await page.getByLabel('Type a time').press('Enter');
  await expect(page.getByRole('button', { name: /^9:30/ })).toBeVisible();
  // The end time lists the times after the start, with how long that is.
  await page.getByRole('button', { name: 'End time' }).click();
  await expect(page.getByRole('option', { name: /^12:00.*2\.5 h/ })).toBeVisible();
  await page.getByRole('option', { name: /^12:00/ }).click();
  await waitForSave(page);
  const text = await readFile(page, path);
  expect(text).toContain('time: "09:30"');
  expect(text).toContain('end-time: "12:00"');

  await openCalendar(page);
  await page.locator('.gc-viewtab', { hasText: 'Week' }).click();
  // In the week, at its hours.
  await expect(page.locator('.gc-tevent', { hasText: 'ELISA plate 1' })).toContainText(/9:30/);
  await page.locator('.gc-viewtab', { hasText: 'Agenda' }).click();
  await expect(page.locator('.gc-agenda-item', { hasText: 'ELISA plate 1' }).locator('.gc-agenda-time')).toHaveText(/9:30.*–.*12:00/);
  expect(errors).toEqual([]);
});

test('a new experiment is planned at a time from the New entry window', async ({ page }) => {
  const errors = trackErrors(page);
  await openFolderNotebook(page, { seed: false });
  await page.locator('.gc-new-btn').click();
  await page.locator('#ne-title').fill('qPCR run');
  await page.getByLabel('Time (optional)').fill('09:15');
  await page.getByRole('button', { name: 'Create entry' }).click();
  await expect(page.locator('.gc-title-input')).toHaveValue('qPCR run');
  await expect(page.getByRole('button', { name: /^9:15/ })).toBeVisible();
  await waitForSave(page);
  const path = decodeURIComponent(new URL(page.url()).hash.replace('#/doc/', ''));
  expect(await readFile(page, path)).toContain('time: "09:15"');

  // Left empty, the entry has a day and no time.
  await newBlankEntry(page, 'Gel');
  await expect(page.getByRole('button', { name: 'Add time' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('another calendar shows next to the experiments, read-only, and can be hidden', async ({ page }) => {
  const errors = trackErrors(page);
  // What the website would pass on from Google.
  let fetched = '';
  await page.route('**/ical?url=*', (route) => {
    fetched = new URL(route.request().url()).searchParams.get('url') ?? '';
    return route.fulfill({ contentType: 'text/calendar', body: labCalendar() });
  });
  await openFolderNotebook(page, { seed: false });
  await openCalendar(page);
  await page.getByRole('button', { name: 'Calendars' }).click();
  const dialog = page.getByRole('dialog', { name: 'Calendars' });
  await dialog.getByLabel('Calendar address (iCal)').fill('webcal://calendar.google.com/calendar/ical/lab%40group/private-x/basic.ics');
  await dialog.getByRole('button', { name: 'Add calendar' }).click();
  await expect(page.locator('.toast', { hasText: '“Lab bookings” is now shown in the calendar.' })).toBeVisible();
  expect(fetched).toBe('https://calendar.google.com/calendar/ical/lab%40group/private-x/basic.ics');
  await expect(dialog.getByLabel('Calendar name')).toHaveValue('Lab bookings');
  await page.keyboard.press('Escape');

  // Saved with the notebook, so a connected phone shows it too.
  expect(await readFile(page, 'assaycraft.json')).toContain('"name": "Lab bookings"');

  await page.locator('.gc-viewtab', { hasText: 'Agenda' }).click();
  const booking = page.locator('.gc-agenda-item', { hasText: 'Confocal booked' });
  await expect(booking).toContainText('Lab bookings');
  await expect(page.locator('.gc-agenda-item', { hasText: 'Lab meeting' }).first()).toBeVisible();
  // A repeating event is on every week in view.
  expect(await page.locator('.gc-agenda-item', { hasText: 'Lab meeting' }).count()).toBeGreaterThan(4);
  await booking.click();
  await expect(page.locator('.gc-event-peek')).toContainText('Imaging core');
  await expect(page.locator('.gc-event-peek')).toContainText('read-only here');
  await page.keyboard.press('Escape');

  // Hidden for now, from Calendars.
  await page.getByRole('button', { name: 'Calendars' }).click();
  await dialog.getByLabel('Show').uncheck();
  await page.keyboard.press('Escape');
  await expect(page.locator('.gc-agenda-item', { hasText: 'Confocal booked' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the private calendar link holds the plan, follows changes, and is deleted when turned off', async ({ page }) => {
  const errors = trackErrors(page);
  await openFolderNotebook(page, { seed: false });
  await newBlankEntry(page, 'Westerns');
  await page.getByRole('button', { name: 'Add time' }).click();
  await page.getByLabel('Type a time').fill('14:00');
  await page.getByLabel('Type a time').press('Enter');
  await waitForSave(page);
  await openCalendar(page);
  await page.getByRole('button', { name: 'Calendars' }).click();
  const dialog = page.getByRole('dialog', { name: 'Calendars' });
  await dialog.getByRole('button', { name: 'Create a private calendar link' }).click();
  const address = dialog.getByLabel('Private calendar address');
  await expect(address).toHaveValue(/\/cal\/[A-Za-z0-9_-]{22}\.ics$/);
  const url = await address.inputValue();
  await expect(dialog.getByRole('status')).toContainText('Up to date · 1 events');
  await expect(dialog.getByRole('link', { name: 'Apple Calendar' })).toHaveAttribute('href', url.replace(/^http:/, 'webcal:'));
  await expect(dialog.getByRole('link', { name: 'Google Calendar' })).toHaveAttribute('href', /calendar\.google\.com\/calendar\/r\?cid=webcal/);

  // What a calendar app reads.
  const ics = await (await page.request.get(url)).text();
  expect(ics).toContain('SUMMARY:EXP-0001 Westerns');
  expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
  // Nobody else can change it.
  expect((await page.request.put(url, { data: 'BEGIN:VCALENDAR', headers: { authorization: 'Bearer ' + 'x'.repeat(22) } })).status()).toBe(403);

  // A new entry reaches it a few seconds later.
  await page.keyboard.press('Escape');
  await newBlankEntry(page, 'Miniprep');
  await waitForSave(page);
  await expect.poll(async () => (await page.request.get(url)).text(), { timeout: 15_000 }).toContain('Miniprep');

  // Reopened, the notebook keeps the link up to date.
  await page.reload();
  await openCalendar(page);
  await page.getByRole('button', { name: 'Calendars' }).click();
  await expect(dialog.getByLabel('Private calendar address')).toHaveValue(url);

  await dialog.getByRole('button', { name: 'Turn off the link' }).click();
  await page.getByRole('dialog', { name: 'Turn off the calendar link?' }).getByRole('button', { name: 'Turn off' }).click();
  await expect(dialog.getByRole('button', { name: 'Create a private calendar link' })).toBeVisible();
  expect((await page.request.get(url)).status()).toBe(404);
  expect(errors).toEqual([]);
});
