import { useMemo, useRef, useState } from 'react';
import { MoreHorizontal, NotebookPen, Plus, Search, Trash2 } from 'lucide-react';
import { navigate, useNotebook } from '../notebook/store';
import { createNote, trashDoc } from '../notebook/actions';
import type { DocMeta } from '../notebook/model';
import { excerpt } from '../notebook/text';
import { formatDate, formatRelative, LOCALE } from '../lib/dates';
import { MenuButton, confirmDialog } from './overlay';
import { TagPill } from './status';
import { NavToggle } from './nav';

/** Newest first: by the note's date, then by when it was created and last edited. */
const sortKey = (d: DocMeta) => `${d.date ?? (d.created ?? '').slice(0, 10)} ${d.created ?? ''} ${d.modified ?? ''}`;

function monthOf(d: DocMeta): string {
  const day = d.date ?? (d.created ?? '').slice(0, 10);
  if (!day) return 'Undated';
  const [y, m] = day.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
}

function NoteRow({ note }: { note: DocMeta }) {
  const open = () => navigate({ name: 'doc', path: note.path });
  return (
    <div className="gc-note-row">
      <button className="gc-note-open" onClick={open}>
        <span className="gc-note-date">{formatDate(note.date ?? note.created)}</span>
        <span className="gc-note-main">
          <strong>{note.title || 'Untitled note'}</strong>
          {note.text && <span className="gc-note-snippet">{excerpt(note.text, 160)}</span>}
        </span>
      </button>
      <span className="gc-note-side">
        {note.tags.map((t) => (
          <TagPill key={t} tag={t} />
        ))}
        <span className="muted gc-note-edited">edited {formatRelative(note.modified)}</span>
        <MenuButton
          className="icon-btn icon-btn-sm"
          title="Note options"
          items={[
            {
              label: 'Move to trash',
              icon: <Trash2 />,
              danger: true,
              onSelect: () =>
                void confirmDialog({
                  title: 'Move to trash?',
                  message: `“${note.title}” will be moved to the trash, where you can restore it.`,
                  confirmLabel: 'Move to trash',
                  danger: true,
                }).then((ok) => {
                  if (ok) void trashDoc(note.path);
                }),
            },
          ]}
        >
          <MoreHorizontal />
        </MenuButton>
      </span>
    </div>
  );
}

export function NotesPage() {
  const docs = useNotebook((s) => s.docs);
  const notes = useMemo(
    () =>
      Object.values(docs)
        .filter((d) => d.kind === 'note')
        .sort((a, b) => sortKey(b).localeCompare(sortKey(a))),
    [docs],
  );
  const tags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags))].sort((a, b) => a.localeCompare(b)), [notes]);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const shown = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return notes.filter((n) => {
      if (tag && !n.tags.includes(tag)) return false;
      const hay = `${n.title} ${n.tags.join(' ')} ${n.text}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [notes, q, tag]);
  const groups = useMemo(() => {
    const out: { month: string; notes: DocMeta[] }[] = [];
    for (const n of shown) {
      const month = monthOf(n);
      if (out[out.length - 1]?.month === month) out[out.length - 1].notes.push(n);
      else out.push({ month, notes: [n] });
    }
    return out;
  }, [shown]);
  const creating = useRef(false);
  const add = () => {
    if (creating.current) return;
    creating.current = true;
    void createNote().finally(() => (creating.current = false));
  };

  return (
    <div className="gc-page gc-notes-page">
      <div className="gc-topbar">
        <NavToggle />
        <span className="gc-page-icon">
          <NotebookPen />
        </span>
        <span className="gc-topbar-title">Notes</span>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={add}>
          <Plus /> New note
        </button>
      </div>
      <div className="gc-folder-inner gc-notes-inner">
        <header className="gc-page-head">
          <h1 className="gc-page-title">Notes</h1>
          <p className="gc-lede">
            Meeting notes, ideas and brainstorming. A note is written like an entry but has no ID, project or status, and stays off the calendar and
            boards.
          </p>
        </header>
        {notes.length > 0 && (
          <div className="gc-table-tools">
            <label className="gc-filter">
              <Search />
              <input value={q} placeholder="Filter notes…" aria-label="Filter notes" onChange={(e) => setQ(e.target.value)} />
            </label>
            {tags.length > 0 && (
              <div className="gc-status-filters">
                <button className={`pill ${tag === null ? 'is-selected' : 'gc-pill-empty'}`} onClick={() => setTag(null)}>
                  All {notes.length}
                </button>
                {tags.map((t) => (
                  <button key={t} className={`pill ${tag === t ? 'is-selected' : 'gc-pill-empty'}`} onClick={() => setTag(tag === t ? null : t)}>
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {groups.map((g) => (
          <section key={g.month} className="gc-notes-group" aria-label={g.month}>
            <h2 className="gc-notes-month">{g.month}</h2>
            <div className="gc-notes-list">
              {g.notes.map((n) => (
                <NoteRow key={n.path} note={n} />
              ))}
            </div>
          </section>
        ))}
        {notes.length > 0 && !shown.length && <p className="muted gc-notes-none">No notes match.</p>}
        {!notes.length && (
          <div className="empty-state gc-notes-empty">
            <NotebookPen />
            <h3>No notes yet</h3>
            <p>Keep lab meetings, journal clubs and ideas here, apart from your experiments.</p>
            <button className="btn btn-primary" onClick={add}>
              <Plus /> New note
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
