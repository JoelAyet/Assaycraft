import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Folder, FolderOpen, FolderPlus, MoreHorizontal, Pencil, Plus, Search, Trash2, ChevronRight } from 'lucide-react';
import { navigate, toast, useNotebook } from '../notebook/store';
import { LAYOUT, type DocMeta } from '../notebook/model';
import { createFolder, renameFolder, trashFolder } from '../notebook/actions';
import { openNewEntryDialog } from './NewEntryDialog';
import { MenuButton, confirmDialog, openContextMenu, promptDialog, type MenuItemSpec } from './overlay';
import { StatusPill, TagPill, statusOf } from './status';
import { entryMenu } from './Sidebar';
import { basename, dirname, isInside } from '../lib/path';
import { formatRelative } from '../lib/dates';
import { NavToggle } from './nav';

type SortKey = 'id' | 'title' | 'status' | 'date' | 'modified' | 'folder';

export function FolderPage({ path }: { path: string }) {
  const docs = useNotebook((s) => s.docs);
  const folders = useNotebook((s) => s.folders);
  const statuses = useNotebook((s) => s.config.entryStatuses);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'modified', dir: -1 });
  const isRoot = path === LAYOUT.projects;
  const exists = isRoot || folders.includes(path);

  const children = folders.filter((f) => dirname(f) === path);
  const entries = useMemo(() => Object.values(docs).filter((d) => d.kind === 'entry' && isInside(d.path, path)), [docs, path]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return entries.filter(
      (d) => (!statusFilter || d.status === statusFilter) && (!s || `${d.id} ${d.title} ${d.tags.join(' ')} ${d.text}`.toLowerCase().includes(s)),
    );
  }, [entries, q, statusFilter]);
  const rows = useMemo(() => {
    const val = (d: DocMeta): string => {
      switch (sort.key) {
        case 'id':
          return d.id;
        case 'title':
          return d.title.toLowerCase();
        case 'status':
          return String(statuses.findIndex((s) => s.id === d.status)).padStart(3, '0');
        case 'date':
          return d.date ?? d.created ?? '';
        case 'folder':
          return dirname(d.path);
        default:
          return d.modified ?? '';
      }
    };
    return [...filtered].sort((a, b) => val(a).localeCompare(val(b), undefined, { numeric: true }) * sort.dir);
  }, [filtered, sort, statuses]);

  if (!exists)
    return (
      <div className="gc-page">
        <div className="empty-state">
          <Folder />
          <h3>Folder not found</h3>
        </div>
      </div>
    );

  const head = (key: SortKey, label: string, cls = '') => (
    <th className={cls}>
      <button
        className="gc-th-btn"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'modified' || key === 'date' ? -1 : 1 }))}
      >
        {label}
        {sort.key === key && (sort.dir === 1 ? <ArrowUp /> : <ArrowDown />)}
      </button>
    </th>
  );

  const menu: MenuItemSpec[] = [
    {
      label: 'New subfolder',
      icon: <FolderPlus />,
      onSelect: () =>
        void promptDialog({ title: 'New folder', label: 'Name' }).then((n) => {
          if (n) void createFolder(path, n);
        }),
    },
    ...(isRoot
      ? []
      : ([
          {
            label: 'Rename',
            icon: <Pencil />,
            onSelect: () =>
              void promptDialog({ title: 'Rename folder', label: 'Name', defaultValue: basename(path) }).then((n) => {
                if (n) void renameFolder(path, n).catch((e: Error) => toast(e.message, 'error'));
              }),
          },
          'sep',
          {
            label: 'Move to trash',
            icon: <Trash2 />,
            danger: true,
            onSelect: () =>
              void confirmDialog({
                title: 'Move folder to trash?',
                message: `“${basename(path)}” and its ${entries.length} entries will be moved to the trash, where you can restore them.`,
                confirmLabel: 'Move to trash',
                danger: true,
              }).then((ok) => {
                if (ok) void trashFolder(path);
              }),
          },
        ] as MenuItemSpec[])),
  ];

  const crumbs = path.split('/');
  return (
    <div className="gc-page gc-folder-page">
      <div className="gc-topbar">
        <NavToggle />
        <nav className="gc-crumbs" aria-label="Breadcrumbs">
          {crumbs.map((c, i) => {
            const p = crumbs.slice(0, i + 1).join('/');
            const last = i === crumbs.length - 1;
            return (
              <span key={p} className={`gc-crumb ${last ? 'is-current' : ''}`}>
                {last ? <span>{c}</span> : <button onClick={() => navigate({ name: 'folder', path: p })}>{c}</button>}
                {!last && <ChevronRight />}
              </span>
            );
          })}
        </nav>
        <span className="spacer" />
        <MenuButton items={menu} title="Folder options">
          <MoreHorizontal />
        </MenuButton>
        <button className="btn btn-primary btn-sm" onClick={() => openNewEntryDialog({ folder: path })}>
          <Plus /> New entry
        </button>
      </div>
      <div className="gc-folder-inner">
        <header className="gc-page-head">
          <div className="gc-eyebrow">
            <FolderOpen /> {isRoot ? 'Projects' : dirname(path) === LAYOUT.projects ? 'Project' : basename(dirname(path))}
          </div>
          <h1 className="gc-page-title">{isRoot ? 'All entries' : basename(path)}</h1>
          <p className="gc-lede">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
            {entries.length > 0 && ` · ${entries.filter((e) => e.status === 'in-progress').length} in progress`}
          </p>
        </header>
        {children.length > 0 && (
          <div className="gc-subfolders">
            {children.map((f) => (
              <button key={f} className="gc-subfolder" onClick={() => navigate({ name: 'folder', path: f })}>
                <Folder />
                <span>{basename(f)}</span>
                <span className="muted">{Object.values(docs).filter((d) => d.kind === 'entry' && isInside(d.path, f)).length}</span>
              </button>
            ))}
          </div>
        )}
        <div className="gc-table-tools">
          <label className="gc-filter">
            <Search />
            <input value={q} placeholder="Filter entries…" onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="gc-status-filters">
            <button className={`pill ${statusFilter === null ? 'is-selected' : 'gc-pill-empty'}`} onClick={() => setStatusFilter(null)}>
              All {entries.length}
            </button>
            {statuses.map((s) => {
              const n = entries.filter((e) => e.status === s.id).length;
              return (
                <button
                  key={s.id}
                  className={`pill ${statusFilter === s.id ? `tone-${s.color}` : 'gc-pill-empty'}`}
                  onClick={() => setStatusFilter(statusFilter === s.id ? null : s.id)}
                >
                  {s.name} {n}
                </button>
              );
            })}
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">
            <Folder />
            <h3>{entries.length ? 'No matching entries' : 'No entries here yet'}</h3>
            {!entries.length && (
              <button className="btn btn-primary" onClick={() => openNewEntryDialog({ folder: path })}>
                <Plus /> New entry
              </button>
            )}
          </div>
        ) : (
          <table className="gc-table">
            <thead>
              <tr>
                {head('id', 'ID', 'col-id')}
                {head('title', 'Title')}
                {head('status', 'Status', 'col-status')}
                {head('date', 'Date', 'col-date')}
                <th className="col-tags">Tags</th>
                {head('folder', 'Folder', 'col-folder')}
                {head('modified', 'Modified', 'col-mod')}
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.path} onClick={() => navigate({ name: 'doc', path: d.path })} onContextMenu={(e) => openContextMenu(e, entryMenu(d))}>
                  <td className="col-id">
                    <span className="id-chip">{d.id}</span>
                  </td>
                  <td className="col-title">{d.title}</td>
                  <td className="col-status">
                    <StatusPill status={statusOf(statuses, d.status)} />
                  </td>
                  <td className="col-date muted">
                    {d.date ? new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                  </td>
                  <td className="col-tags">
                    <span className="gc-tags">
                      {d.tags.slice(0, 3).map((t) => (
                        <TagPill key={t} tag={t} />
                      ))}
                    </span>
                  </td>
                  <td className="col-folder muted">{dirname(d.path).split('/').slice(1).join(' / ')}</td>
                  <td className="col-mod muted">{formatRelative(d.modified)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
