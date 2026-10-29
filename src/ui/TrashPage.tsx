import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BookMarked,
  BookOpen,
  CheckSquare,
  FileText,
  Folder,
  KanbanSquare,
  LayoutTemplate,
  MoreHorizontal,
  NotebookPen,
  Blocks,
  RotateCcw,
  TestTubes,
  Trash2,
} from 'lucide-react';
import { toast, useNotebook } from '../notebook/store';
import { deleteFromTrash, emptyTrash, loadTrash, restoreFromTrash } from '../notebook/actions';
import { LAYOUT } from '../notebook/model';
import type { TrashItem } from '../notebook/trash';
import { formatDate, formatRelative } from '../lib/dates';
import { MenuButton, confirmDialog } from './overlay';
import { FilterField, PageHead, PhoneBar, ViewBar } from './PageHeader';

const KIND_NAMES: Record<string, string> = {
  entry: 'Entry',
  card: 'Card',
  protocol: 'Protocol',
  stocks: 'Stock collection',
  note: 'Note',
  reference: 'Paper',
  template: 'Template',
  subtemplate: 'Sub-template',
};

function kindOf(item: TrashItem): { icon: ReactNode; name: string } {
  if (item.kind === 'folder') {
    return item.from.startsWith(LAYOUT.boards + '/') ? { icon: <KanbanSquare />, name: 'Board' } : { icon: <Folder />, name: 'Folder' };
  }
  const name = KIND_NAMES[item.docKind ?? 'entry'] ?? 'Page';
  switch (item.docKind) {
    case 'card':
      return { icon: <CheckSquare />, name };
    case 'protocol':
      return { icon: <BookOpen />, name };
    case 'stocks':
      return { icon: <TestTubes />, name };
    case 'note':
      return { icon: <NotebookPen />, name };
    case 'reference':
      return { icon: <BookMarked />, name };
    case 'template':
      return { icon: <LayoutTemplate />, name };
    case 'subtemplate':
      return { icon: <Blocks />, name };
    default:
      return { icon: <FileText />, name };
  }
}

/** Where it was, for people: "Projects / CRISPR screen". */
const placeOf = (item: TrashItem) => item.from.split('/').slice(0, -1).join(' / ') || 'the notebook';

function dayOf(iso: string): string {
  const day = iso.slice(0, 10);
  const today = new Date();
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (day === ymd(today)) return 'Today';
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (day === ymd(y)) return 'Yesterday';
  return formatDate(day);
}

function TrashRow({ item, onRestore }: { item: TrashItem; onRestore: (item: TrashItem) => void }) {
  const kind = kindOf(item);
  const forget = () =>
    void confirmDialog({
      title: 'Delete forever?',
      message: `“${item.title}” will be deleted from the notebook${item.kind === 'folder' ? ', with everything in it' : ', with its attachments and version history'}. This cannot be undone.`,
      confirmLabel: 'Delete forever',
      danger: true,
    }).then((ok) => {
      if (ok) void deleteFromTrash(item).then(() => toast(`Deleted “${item.title}” forever`, 'info'));
    });
  return (
    <div className="gc-note-row gc-trash-row">
      <span className="gc-trash-icon" aria-hidden="true">
        {kind.icon}
      </span>
      <span className="gc-note-main">
        <strong>
          {item.id && item.docKind !== 'note' && item.docKind !== 'template' && item.docKind !== 'subtemplate' && (
            <span className="id-chip">{item.id}</span>
          )}{' '}
          {item.title}
        </strong>
        <span className="gc-note-snippet">
          {kind.name} · {item.guessed ? 'goes back to' : 'from'} {placeOf(item)} · deleted {formatRelative(item.deleted)}
        </span>
      </span>
      <span className="gc-note-side">
        <button className="btn btn-sm" onClick={() => onRestore(item)}>
          <RotateCcw /> Restore
        </button>
        <MenuButton
          className="icon-btn icon-btn-sm"
          title={`More for “${item.title}”`}
          items={[{ label: 'Delete forever', icon: <Trash2 />, danger: true, onSelect: forget }]}
        >
          <MoreHorizontal />
        </MenuButton>
      </span>
    </div>
  );
}

export function TrashPage() {
  const trash = useNotebook((s) => s.trash);
  const vault = useNotebook((s) => s.vault);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  // Files may have been put in or taken out of .trash outside Assaycraft.
  useEffect(() => {
    void loadTrash();
  }, []);

  const shown = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return trash.filter((t) => {
      const hay = `${t.title} ${t.id ?? ''} ${t.from} ${kindOf(t).name}`.toLowerCase();
      return terms.every((w) => hay.includes(w));
    });
  }, [trash, q]);
  const groups = useMemo(() => {
    const out: { day: string; items: TrashItem[] }[] = [];
    for (const t of shown) {
      const day = dayOf(t.deleted);
      if (out[out.length - 1]?.day === day) out[out.length - 1].items.push(t);
      else out.push({ day, items: [t] });
    }
    return out;
  }, [shown]);

  const restore = (item: TrashItem) => {
    if (busy) return;
    setBusy(true);
    void restoreFromTrash(item)
      .catch((err: Error) => toast(`Could not restore “${item.title}”: ${err.message}`, 'error'))
      .finally(() => setBusy(false));
  };
  const empty = () =>
    void confirmDialog({
      title: 'Empty the trash?',
      message: `${trash.length} item${trash.length === 1 ? '' : 's'} will be deleted from the notebook for good, with their attachments and version history. This cannot be undone.`,
      confirmLabel: 'Empty trash',
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      void emptyTrash().then((n) => toast(`Deleted ${n} item${n === 1 ? '' : 's'} forever`, 'info'));
    });

  return (
    <div className="gc-page gc-notes-page gc-trash-page">
      <PhoneBar />
      <div className="gc-page-inner">
        <PageHead
          title="Trash"
          lede={`Deleted pages, boards and folders, kept until you delete them forever${vault?.kind === 'folder' ? ' (in the notebook’s .trash folder)' : ''}. Restore puts one back where it was, with its attachments and history.`}
        />
        {trash.length > 0 && (
          <ViewBar
            tools={
              <>
                <FilterField value={q} onChange={setQ} placeholder="Filter the trash…" />
                <button className="btn btn-sm btn-danger-ghost" onClick={empty}>
                  <Trash2 /> Empty trash
                </button>
              </>
            }
          />
        )}
        {groups.map((g) => (
          <section key={g.day} className="gc-notes-group" aria-label={g.day}>
            <h2 className="gc-notes-month">{g.day}</h2>
            <div className="gc-notes-list">
              {g.items.map((t) => (
                <TrashRow key={t.name} item={t} onRestore={restore} />
              ))}
            </div>
          </section>
        ))}
        {trash.length > 0 && !shown.length && <p className="muted gc-notes-none">Nothing in the trash matches.</p>}
        {!trash.length && (
          <div className="empty-state gc-notes-empty">
            <Trash2 />
            <h3>The trash is empty</h3>
          </div>
        )}
      </div>
    </div>
  );
}
