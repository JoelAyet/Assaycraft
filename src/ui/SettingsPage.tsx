import { useState, type CSSProperties } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpenText,
  CircleCheck,
  CodeXml,
  Compass,
  CloudOff,
  Download,
  HardDrive,
  Globe,
  Plus,
  Settings,
  Trash2,
  Upload,
} from 'lucide-react';
import { ACCENTS, navigate, setAccent, setPageFont, setTheme, setWeekStart, toast, useNotebook, type Theme, type WeekStart } from '../notebook/store';
import { exportZip, importSummary, importZip, saveConfig } from '../notebook/actions';
import { slugify, type StatusOption } from '../notebook/model';
import { ColorPicker } from './status';
import { Popover, usePopover } from './overlay';
import { downloadBlob, pickFiles } from '../lib/download';
import { renameKnownNotebook } from '../fs/registry';
import { ABOUT } from '../lib/about';
import { useOfflineState } from '../lib/offline';
import { Logo } from './Sidebar';
import { NavToggle } from './nav';
import { startTour } from './Tour';

function StatusRow({
  s,
  onChange,
  onRemove,
  onMove,
  first,
  last,
}: {
  s: StatusOption;
  onChange: (s: StatusOption) => void;
  onRemove: () => void;
  onMove: (d: -1 | 1) => void;
  first: boolean;
  last: boolean;
}) {
  const p = usePopover();
  return (
    <div className="gc-status-row">
      <button ref={p.ref} className={`gc-color-swatch tone-${s.color}`} title="Color" onClick={p.toggle} />
      {p.open && (
        <Popover anchor={p.ref.current} onClose={p.close}>
          <ColorPicker
            value={s.color}
            onChange={(color) => {
              onChange({ ...s, color });
              p.close();
            }}
          />
        </Popover>
      )}
      <input
        className="input"
        aria-label={`Name of the “${s.id}” status`}
        value={s.name}
        onChange={(e) => onChange({ ...s, name: e.target.value })}
      />
      <span className="mono muted gc-status-id">{s.id}</span>
      <button className="icon-btn icon-btn-sm" disabled={first} title="Move up" onClick={() => onMove(-1)}>
        <ArrowUp />
      </button>
      <button className="icon-btn icon-btn-sm" disabled={last} title="Move down" onClick={() => onMove(1)}>
        <ArrowDown />
      </button>
      <button className="icon-btn icon-btn-sm" title="Remove" onClick={onRemove}>
        <Trash2 />
      </button>
    </div>
  );
}

function OfflineStatus() {
  const state = useOfflineState();
  if (state === 'unavailable') return null;
  return (
    <p className={`gc-about-offline is-${state}`}>
      {state === 'pending' ? <CloudOff /> : <CircleCheck />}
      {state === 'file'
        ? 'Works offline: opened from a file on this computer.'
        : state === 'ready'
          ? 'Works offline: a copy of the app is saved on this device.'
          : 'Saving a copy of the app for offline use…'}
    </p>
  );
}

export function SettingsPage() {
  const config = useNotebook((s) => s.config);
  const vault = useNotebook((s) => s.vault)!;
  const theme = useNotebook((s) => s.theme);
  const accent = useNotebook((s) => s.accent);
  const pageFont = useNotebook((s) => s.pageFont);
  const weekStart = useNotebook((s) => s.weekStart);
  const [draft, setDraft] = useState(config);
  const dirty = JSON.stringify(draft) !== JSON.stringify(config);
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));
  const statuses = draft.entryStatuses;
  const setStatuses = (entryStatuses: StatusOption[]) => set({ entryStatuses });

  const save = async () => {
    // New statuses get a stable id derived from their name.
    const taken = new Set<string>();
    const entryStatuses = draft.entryStatuses.map((st) => {
      let id = st.id.startsWith('new-status') ? slugify(st.name) : st.id;
      while (taken.has(id)) id += '-2';
      taken.add(id);
      return { ...st, id };
    });
    const next = { ...draft, entryStatuses };
    setDraft(next);
    await saveConfig(next);
    if (draft.name !== config.name) await renameKnownNotebook(vault.id, draft.name);
    toast('Settings saved', 'success');
    navigate({ name: 'home' });
  };

  return (
    <div className="gc-page gc-settings-page">
      <div className="gc-topbar">
        <NavToggle />
        <span className="gc-page-icon">
          <Settings />
        </span>
        <span className="gc-topbar-title">Settings</span>
        <span className="spacer" />
        <button className="btn btn-sm" disabled={!dirty} onClick={() => setDraft(config)}>
          Discard
        </button>
        <button className="btn btn-primary btn-sm" disabled={!dirty} onClick={() => void save()}>
          Save settings
        </button>
      </div>
      <div className="gc-settings-inner">
        <header className="gc-page-head">
          <h1 className="gc-page-title">Settings</h1>
          <p className="gc-lede">How this notebook names, sorts and stores your work, and how Assaycraft looks in this browser.</p>
        </header>
        <section className="gc-settings-section">
          <h2>Notebook</h2>
          <div className="gc-form-grid">
            <div className="field">
              <label htmlFor="set-name">Notebook name</label>
              <input className="input" id="set-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="set-author">Your name</label>
              <input
                className="input"
                id="set-author"
                value={draft.author}
                placeholder="Shown as the author of new entries"
                onChange={(e) => set({ author: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="set-id-prefix">Entry ID prefix</label>
              <input
                className="input mono"
                id="set-id-prefix"
                value={draft.idPrefix}
                onChange={(e) => set({ idPrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })}
              />
              <span className="field-hint">
                Next entries look like{' '}
                <span className="mono">
                  {draft.idPrefix}
                  {'1'.padStart(draft.idDigits, '0')}
                </span>
              </span>
            </div>
            <div className="field">
              <label htmlFor="set-id-digits">ID digits</label>
              <input
                className="input"
                type="number"
                min={2}
                max={8}
                id="set-id-digits"
                value={draft.idDigits}
                onChange={(e) => set({ idDigits: Math.max(2, Math.min(8, Number(e.target.value) || 4)) })}
              />
            </div>
            <div className="field">
              <label htmlFor="set-card-prefix">Task ID prefix</label>
              <input
                className="input mono"
                id="set-card-prefix"
                value={draft.cardPrefix}
                onChange={(e) => set({ cardPrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })}
              />
            </div>
            <div className="field">
              <label htmlFor="set-protocol-prefix">Protocol ID prefix</label>
              <input
                className="input mono"
                id="set-protocol-prefix"
                value={draft.protocolPrefix}
                onChange={(e) => set({ protocolPrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })}
              />
              <span className="field-hint">
                New protocols look like <span className="mono">{draft.protocolPrefix || 'P-'}0001</span>
              </span>
            </div>
          </div>
        </section>

        <section className="gc-settings-section">
          <h2>Entry statuses</h2>
          <p className="muted">These are the columns of the Experiments board. Each entry stores its status id in its front matter.</p>
          <div className="gc-status-list">
            {statuses.map((s, i) => (
              <StatusRow
                key={s.id + i}
                s={s}
                first={i === 0}
                last={i === statuses.length - 1}
                onChange={(next) => setStatuses(statuses.map((x, j) => (j === i ? next : x)))}
                onRemove={() => statuses.length > 1 && setStatuses(statuses.filter((_, j) => j !== i))}
                onMove={(d) => {
                  const next = [...statuses];
                  [next[i], next[i + d]] = [next[i + d], next[i]];
                  setStatuses(next);
                }}
              />
            ))}
          </div>
          <button
            className="btn btn-sm"
            onClick={() => {
              let id = 'new-status';
              while (statuses.some((s) => s.id === id)) id += '-2';
              setStatuses([...statuses, { id, name: 'New status', color: 'purple' }]);
            }}
          >
            <Plus /> Add status
          </button>
          <p className="field-hint">
            Rename freely: entries store the id shown on the right, which never changes. New statuses get an id from their name when you save.
          </p>
        </section>

        <section className="gc-settings-section">
          <h2>Appearance</h2>
          <p className="muted">Saved in this browser, so each person and computer can choose their own.</p>
          <div className="gc-appearance">
            <div className="field">
              <span className="field-label">Theme</span>
              <div className="gc-segmented">
                {(['system', 'light', 'dark'] as Theme[]).map((t) => (
                  <button key={t} className={theme === t ? 'active' : ''} onClick={() => setTheme(t)}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-label">Accent</span>
              <div className="gc-accents" role="radiogroup" aria-label="Accent color">
                {ACCENTS.map((a) => (
                  <button
                    key={a.id}
                    role="radio"
                    aria-checked={accent === a.id}
                    className={`gc-accent-option ${accent === a.id ? 'active' : ''}`}
                    style={{ '--swatch': a.color } as CSSProperties}
                    onClick={() => setAccent(a.id)}
                  >
                    <span className="gc-accent-swatch" />
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-label">Font</span>
              <div className="gc-font-options" role="radiogroup" aria-label="Font of titles and entries">
                {(
                  [
                    { id: 'sans', name: 'Sans' },
                    { id: 'serif', name: 'Serif' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    role="radio"
                    aria-checked={pageFont === f.id}
                    className={`gc-font-option ${pageFont === f.id ? 'active' : ''}`}
                    onClick={() => setPageFont(f.id)}
                  >
                    <span className={`gc-font-sample is-${f.id}`}>Ag</span>
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-label" id="gc-week-start">
                Week starts on
              </span>
              <div className="gc-segmented" role="radiogroup" aria-labelledby="gc-week-start">
                {(['monday', 'sunday'] as WeekStart[]).map((w) => (
                  <button
                    key={w}
                    role="radio"
                    aria-checked={weekStart === w}
                    className={weekStart === w ? 'active' : ''}
                    onClick={() => setWeekStart(w)}
                  >
                    {w[0].toUpperCase() + w.slice(1)}
                  </button>
                ))}
              </div>
              <span className="field-hint">For the calendar’s month and week views and the activity graph on Home.</span>
            </div>
          </div>
        </section>

        <section className="gc-settings-section">
          <h2>Storage</h2>
          <div className="gc-storage-card">
            {vault.kind === 'folder' ? <HardDrive /> : <Globe />}
            <div>
              {vault.kind === 'folder' ? (
                <>
                  <strong>Folder on your computer: {vault.name}</strong>
                  <p className="muted">
                    Every entry is a Markdown file: <span className="mono">Projects/&lt;project&gt;/EXP-0001 Title.md</span>, with its files in an{' '}
                    <span className="mono">attachments/</span> folder next to it. Protocols live in <span className="mono">Protocols/</span>,
                    templates in <span className="mono">Templates/</span> and boards in <span className="mono">Boards/</span>. You can open, back up
                    or version the folder with any tool (Git, Dropbox, Obsidian…).
                  </p>
                </>
              ) : (
                <>
                  <strong>Stored inside this browser</strong>
                  <p className="muted">
                    Your notebook lives in this browser’s storage. Export a .zip regularly as a backup, or move to a folder on your computer with
                    Chrome or Edge.
                  </p>
                </>
              )}
            </div>
          </div>
          <div className="gc-row-buttons">
            <button className="btn" onClick={() => void exportZip().then(({ blob, name }) => downloadBlob(blob, name))}>
              <Download /> Export notebook (.zip)
            </button>
            <button
              className="btn"
              onClick={() =>
                void pickFiles({ accept: '.zip', multiple: false }).then(async ([f]) => {
                  if (!f) return;
                  toast(importSummary(await importZip(f)), 'success');
                })
              }
            >
              <Upload /> Import .zip
            </button>
          </div>
        </section>

        <section className="gc-settings-section">
          <h2>Keyboard shortcuts</h2>
          <dl className="gc-shortcuts">
            <dt>
              <kbd>Ctrl</kbd> <kbd>K</kbd>
            </dt>
            <dd>Search / jump to anything</dd>
            <dt>
              <kbd>/</kbd>
            </dt>
            <dd>Insert a block: table, buffer, flow, file, sequence, protocol, sub-template, date…</dd>
            <dt>
              <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>N</kbd>
            </dt>
            <dd>New entry</dd>
            <dt>
              <kbd>Ctrl</kbd> <kbd>click</kbd>
            </dt>
            <dd>Open a link inside an entry</dd>
            <dt>Tables</dt>
            <dd>
              Type to edit, <kbd>Enter</kbd>/<kbd>Tab</kbd> to move, <kbd>Alt</kbd>+<kbd>Enter</kbd> new line, <kbd>Ctrl</kbd>+<kbd>D</kbd> fill down,
              drag the corner handle to fill, click cells while typing a formula to insert references.
            </dd>
          </dl>
        </section>

        <section className="gc-settings-section gc-about" aria-labelledby="gc-about-title">
          <h2 id="gc-about-title">About</h2>
          <div className="gc-about-card">
            <Logo size={44} />
            <div>
              <div className="gc-about-name">
                {ABOUT.name} <span className="pill pill-sq mono">v{ABOUT.version}</span>
              </div>
              <p className="muted">
                A local-first electronic lab notebook. Entries, protocols, templates and boards are plain Markdown files in a folder you own.
              </p>
              <p className="gc-about-credit">
                Created by <strong>{ABOUT.author}</strong> · {ABOUT.year} ·{' '}
                <a href={ABOUT.url} target="_blank" rel="noreferrer">
                  {ABOUT.url.replace('https://', '')}
                </a>
              </p>
              <div className="gc-about-links">
                <button className="btn btn-sm" onClick={startTour}>
                  <Compass /> Take the tour
                </button>
                <a className="btn btn-sm" href={ABOUT.guide} target="_blank" rel="noreferrer">
                  <BookOpenText /> How each feature works
                </a>
                <a className="btn btn-sm" href={ABOUT.repo} target="_blank" rel="noreferrer">
                  <CodeXml /> Source code on GitHub
                </a>
              </div>
              <OfflineStatus />
              <p className="gc-about-fineprint">The Serif font option uses Newsreader by Production Type (SIL Open Font License).</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
