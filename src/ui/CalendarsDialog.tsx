import { useEffect, useState, type FormEvent } from 'react';
import { CalendarSync, Check, Copy, Link2Off, Plus, Trash2 } from 'lucide-react';
import { saveConfig } from '../notebook/actions';
import { toast, useNotebook } from '../notebook/store';
import type { ColorName } from '../notebook/model';
import { calendarState, loadCalendar, normalizeCalendarUrl, type CalendarLink } from '../calendar/external';
import { disableFeed, enableFeed, useFeed } from '../calendar/feed';
import { syncSupported } from '../sync/manager';
import { newSecret } from '../sync/crypto';
import { formatRelative } from '../lib/dates';
import { ColorPicker } from './status';
import { Dialog, Popover, confirmDialog, openDialog, usePopover } from './overlay';

/** Calendar → Calendars: other calendars shown in Assaycraft's, and this notebook in calendar apps. */
export function openCalendarsDialog() {
  openDialog((close) => (
    <Dialog title="Calendars" icon={<CalendarSync />} onClose={close} wide className="gc-calendars-dialog">
      {syncSupported() ? (
        <>
          <OtherCalendars />
          <CalendarLinkSection />
        </>
      ) : (
        <p className="gc-option-note">Calendars need the website (assaycraftlab.com), not the single-file version.</p>
      )}
    </Dialog>
  ));
}

const saveCalendars = (calendars: CalendarLink[]) => saveConfig({ calendars });
const CALENDAR_COLORS: ColorName[] = ['teal', 'purple', 'orange', 'pink', 'brown', 'yellow', 'blue', 'green', 'red'];

function ColorButton({ cal, onChange }: { cal: CalendarLink; onChange: (c: ColorName) => void }) {
  const p = usePopover();
  return (
    <>
      <button
        ref={p.ref}
        className={`gc-color-swatch tone-${cal.color}`}
        title={`Color of ${cal.name}`}
        aria-label={`Color of ${cal.name}`}
        onClick={p.toggle}
      />
      {p.open && (
        <Popover anchor={p.ref.current} onClose={p.close}>
          <ColorPicker
            value={cal.color}
            onChange={(c) => {
              onChange(c);
              p.close();
            }}
          />
        </Popover>
      )}
    </>
  );
}

function CalendarRow({ cal, all }: { cal: CalendarLink; all: CalendarLink[] }) {
  const [name, setName] = useState(cal.name);
  const [state, setState] = useState(() => calendarState(cal.url));
  useEffect(() => {
    let alive = true;
    void loadCalendar(cal.url).then((l) => alive && setState(l));
    return () => {
      alive = false;
    };
  }, [cal.url]);
  const patch = (p: Partial<CalendarLink>) => void saveCalendars(all.map((c) => (c.id === cal.id ? { ...c, ...p } : c)));
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Remove “${cal.name}”?`,
      message: 'Its events no longer show in this notebook’s calendar. The calendar itself is not changed.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (ok) await saveCalendars(all.filter((c) => c.id !== cal.id));
  };
  const status = !state ? 'Loading…' : state.error ? state.error : `Updated ${formatRelative(state.at)}`;
  return (
    <li className="gc-calsub">
      <ColorButton cal={cal} onChange={(color) => patch({ color })} />
      <div className="gc-calsub-main">
        <input
          className="input gc-calsub-name"
          aria-label="Calendar name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name.trim() !== cal.name && patch({ name: name.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span className={`gc-calsub-status ${state?.error ? 'is-error' : 'muted'}`}>{status}</span>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={!cal.hidden} onChange={(e) => patch({ hidden: !e.target.checked || undefined })} /> Show
      </label>
      <button className="icon-btn" title={`Remove ${cal.name}`} aria-label={`Remove ${cal.name}`} onClick={() => void remove()}>
        <Trash2 />
      </button>
    </li>
  );
}

function OtherCalendars() {
  const calendars = useNotebook((s) => s.config.calendars) ?? [];
  const [address, setAddress] = useState('');
  const [problem, setProblem] = useState('');
  const [adding, setAdding] = useState(false);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const url = normalizeCalendarUrl(address);
    if (!url) {
      setProblem('That is not a web address. Calendar addresses start with https:// or webcal://.');
      return;
    }
    if (calendars.some((c) => c.url === url)) {
      setProblem('That calendar is already here.');
      return;
    }
    setAdding(true);
    setProblem('');
    const l = await loadCalendar(url, true);
    setAdding(false);
    if (!l.parsed) {
      setProblem(l.error ?? 'The calendar could not be loaded.');
      return;
    }
    const used = new Set(calendars.map((c) => c.color));
    // Colors that stand apart from the entry statuses first.
    const color = CALENDAR_COLORS.find((c) => !used.has(c)) ?? 'teal';
    const name = l.parsed.name?.trim() || new URL(url).hostname;
    await saveCalendars([...calendars, { id: newSecret().slice(0, 8), name, url, color }]);
    setAddress('');
    toast(`“${name}” is now shown in the calendar.`, 'success');
  };

  return (
    <section className="gc-calendars-part">
      <h3>Other calendars here</h3>
      <p className="muted">
        Show a calendar from Google, Apple or Outlook next to your experiments: the lab’s equipment bookings, seminars, your own calendar. Its events
        are read-only here; change them in its own app.
      </p>
      {calendars.length > 0 && (
        <ul className="gc-calsubs">
          {calendars.map((c) => (
            <CalendarRow key={c.id} cal={c} all={calendars} />
          ))}
        </ul>
      )}
      <form className="gc-calsub-add" onSubmit={(e) => void add(e)}>
        <label className="field-label" htmlFor="gc-cal-address">
          Calendar address (iCal)
        </label>
        <div className="gc-calsub-add-row">
          <input
            id="gc-cal-address"
            className="input"
            value={address}
            placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
            autoComplete="off"
            onChange={(e) => setAddress(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={!address.trim() || adding}>
            <Plus /> {adding ? 'Adding…' : 'Add calendar'}
          </button>
        </div>
        {problem && <p className="gc-option-note">{problem}</p>}
      </form>
      <details className="gc-calendars-help">
        <summary>Where to find a calendar’s address</summary>
        <ul>
          <li>
            <strong>Google Calendar</strong>, on a computer: Settings → under <em>Settings for my calendars</em>, the calendar →{' '}
            <em>Integrate calendar</em> → <em>Secret address in iCal format</em>. (For a public calendar, its <em>Public address in iCal format</em>.)
          </li>
          <li>
            <strong>Apple Calendar</strong> (iCloud): click the calendar’s share button, turn on <em>Public Calendar</em> and copy the link.
          </li>
          <li>
            <strong>Outlook</strong>: Settings → Calendar → Shared calendars → <em>Publish a calendar</em> → the ICS link.
          </li>
        </ul>
        <p className="muted">
          The address is saved in this notebook’s settings, so a connected phone shows the calendar too. Assaycraft’s website fetches the calendar for
          the app and keeps nothing.
        </p>
      </details>
    </section>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn"
      onClick={() =>
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CalendarLinkSection() {
  const feed = useFeed();
  const notebook = useNotebook((s) => s.config.name || s.vault?.name || 'Notebook');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const turnOn = async () => {
    setBusy(true);
    setProblem('');
    try {
      await enableFeed();
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    const ok = await confirmDialog({
      title: 'Turn off the calendar link?',
      message: 'The copy online is deleted, and calendars subscribed to the link stop showing this notebook. You can make a new link later.',
      confirmLabel: 'Turn off',
      danger: true,
    });
    if (!ok) return;
    try {
      await disableFeed();
      toast('The calendar link is off and its copy deleted.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  if (!feed.url)
    return (
      <section className="gc-calendars-part">
        <h3>This notebook in your calendar app</h3>
        <p className="muted">
          See planned experiments and tasks in Apple, Google or Outlook Calendar, on your phone as well. Assaycraft keeps a copy of their dates,
          times, IDs, titles, projects and statuses at a private address on its website, and brings it up to date while this notebook is open on this
          device. Nothing else from the notebook goes online.
        </p>
        <button className="btn btn-primary" disabled={busy} onClick={() => void turnOn()}>
          <CalendarSync /> {busy ? 'Making the link…' : 'Create a private calendar link'}
        </button>
        {problem && <p className="gc-option-note">{problem}</p>}
      </section>
    );

  const webcal = feed.url.replace(/^https?:/, 'webcal:');
  const status = feed.error ? feed.error : feed.updated ? `Up to date · ${feed.count} events · updated ${formatRelative(feed.updated)}` : 'Updating…';
  return (
    <section className="gc-calendars-part">
      <h3>This notebook in your calendar app</h3>
      <p className="muted">Subscribe to this address in your calendar app. Keep it private: anyone with it can see these titles and times.</p>
      <div className="gc-calsub-add-row">
        <input className="input mono" readOnly value={feed.url} aria-label="Private calendar address" onFocus={(e) => e.target.select()} />
        <CopyButton text={feed.url} />
      </div>
      <div className="gc-row-buttons gc-calendar-apps">
        <a className="btn btn-sm" href={webcal}>
          Apple Calendar
        </a>
        <a className="btn btn-sm" href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`} target="_blank" rel="noreferrer">
          Google Calendar
        </a>
        <a
          className="btn btn-sm"
          href={`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feed.url)}&name=${encodeURIComponent(notebook)}`}
          target="_blank"
          rel="noreferrer"
        >
          Outlook
        </a>
      </div>
      <p className={`gc-calsub-status ${feed.error ? 'is-error' : 'muted'}`} role="status">
        {status}
      </p>
      <p className="muted gc-calendars-small">
        Calendar apps look for changes on their own: Apple Calendar as often as you set it to, Google Calendar every few hours. The link is kept up to
        date from this device; on the phone, add it to its calendar app rather than making a second one.
      </p>
      <button className="btn btn-ghost btn-sm gc-calendar-off" onClick={() => void turnOff()}>
        <Link2Off /> Turn off the link
      </button>
    </section>
  );
}
