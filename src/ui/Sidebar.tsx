import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import {
  BookMarked,
  BookOpen,
  TestTubes,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Compass,
  CloudOff,
  Download,
  FileText,
  FlaskConical,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  HardDrive,
  Home,
  Laptop,
  Smartphone,
  KanbanSquare,
  LayoutTemplate,
  LoaderCircle,
  LogOut,
  Monitor,
  Moon,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  Upload,
  CircleAlert,
  Copy,
  FolderInput,
  X,
} from 'lucide-react';
import { syncSupported, useSync } from '../sync/manager';
import { peerStatus } from './PhonePage';
import { BUILTIN_EXPERIMENTS_BOARD, navigate, setState, setTheme, toast, useNotebook, type Route } from '../notebook/store';
import { LAYOUT, type DocMeta } from '../notebook/model';
import {
  closeNotebook,
  createFolder,
  duplicateDoc,
  exportZip,
  importSummary,
  importZip,
  moveDoc,
  renameFolder,
  retryFailedWrites,
  trashDoc,
  trashFolder,
  UnsavedChangesError,
} from '../notebook/actions';
import { Logo } from './Logo';
import { MenuButton, openContextMenu, openDialog, promptDialog, confirmDialog, useSheetFocus, type MenuItemSpec } from './overlay';
import { openNewBoardDialog } from './NewBoardDialog';
import { startTour } from './Tour';
import { openNewEntryDialog } from './NewEntryDialog';
import { MoveDialog } from './MoveDialog';
import { basename, dirname, isInside } from '../lib/path';
import { downloadBlob, pickFiles } from '../lib/download';
import { statusOf } from './status';

const EXPANDED_KEY = 'assaycraft:expanded';
const DOC_MIME = 'application/x-assaycraft-doc';

function loadExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/** The logo, for the pages that show it beside the name (Home, Settings → About). */
export { Logo };

/**
 * A sidebar row is a place to go: reachable with Tab, opened with Enter or Space, and marked as the
 * current page when it is. (A row holds buttons of its own, so it cannot be a button itself.)
 */
function goTo(open: () => void, current?: boolean) {
  return {
    role: 'link',
    tabIndex: 0,
    'aria-current': current ? ('page' as const) : undefined,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      open();
    },
  };
}

function NavItem({
  icon,
  label,
  active,
  onClick,
  count,
  actions,
  onDrop,
  title,
}: {
  icon: ReactNode;
  label: ReactNode;
  active?: boolean;
  onClick: () => void;
  count?: number;
  actions?: ReactNode;
  onDrop?: (e: DragEvent) => void;
  title?: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`gc-nav-item ${active ? 'active' : ''} ${over ? 'drop-over' : ''}`}
      {...goTo(onClick, active)}
      onClick={onClick}
      title={title}
      onDragOver={
        onDrop
          ? (e) => {
              if (e.dataTransfer.types.includes(DOC_MIME)) {
                e.preventDefault();
                setOver(true);
              }
            }
          : undefined
      }
      onDragLeave={onDrop ? () => setOver(false) : undefined}
      onDrop={
        onDrop
          ? (e) => {
              setOver(false);
              onDrop(e);
            }
          : undefined
      }
    >
      <span className="gc-nav-icon">{icon}</span>
      <span className="gc-nav-label">{label}</span>
      {count !== undefined && count > 0 && <span className="gc-nav-count">{count}</span>}
      {actions && (
        <span className="gc-nav-actions" onClick={(e) => e.stopPropagation()}>
          {actions}
        </span>
      )}
    </div>
  );
}

function Section({ title, children, onAdd, addTitle }: { title: string; children: ReactNode; onAdd?: () => void; addTitle?: string }) {
  return (
    <div className="gc-section">
      <div className="gc-section-head">
        <span>{title}</span>
        {onAdd && (
          <button className="icon-btn icon-btn-sm" title={addTitle} aria-label={addTitle} onClick={onAdd}>
            <Plus />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

interface TreeNode {
  path: string;
  name: string;
  folders: TreeNode[];
  entries: DocMeta[];
  /** Entries that are steps of a flow, under the entry that holds the flow (in the same folder). */
  steps: Map<string, DocMeta[]>;
}

function buildTree(folders: string[], docs: DocMeta[]): TreeNode {
  const root: TreeNode = { path: LAYOUT.projects, name: 'Projects', folders: [], entries: [], steps: new Map() };
  const byPath = new Map<string, TreeNode>([[LAYOUT.projects, root]]);
  for (const f of folders) {
    const node: TreeNode = { path: f, name: basename(f), folders: [], entries: [], steps: new Map() };
    byPath.set(f, node);
  }
  for (const f of folders) byPath.get(dirname(f))?.folders.push(byPath.get(f)!);
  // Each step's entry goes under the entry whose flow it is a step of, when they share a folder.
  const byId = new Map(docs.filter((d) => d.id).map((d) => [d.id, d]));
  const parentOf = new Map<string, DocMeta>();
  for (const d of docs)
    for (const st of d.flow ?? []) {
      const child = st.ref ? byId.get(st.ref) : undefined;
      if (child && child !== d && dirname(child.path) === dirname(d.path) && !parentOf.has(child.path)) parentOf.set(child.path, d);
    }
  // No loops: a plan that is itself a step of one of its steps stays at the top.
  for (const [child, parent] of [...parentOf]) {
    for (let p: DocMeta | undefined = parent, n = 0; p && n < 50; p = parentOf.get(p.path), n++)
      if (p.path === child) {
        parentOf.delete(child);
        break;
      }
  }
  for (const d of docs) {
    const node = byPath.get(dirname(d.path));
    if (!node) continue;
    const parent = parentOf.get(d.path);
    if (parent) node.steps.set(parent.path, [...(node.steps.get(parent.path) ?? []), d]);
    else node.entries.push(d);
  }
  for (const n of byPath.values()) {
    n.folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    n.entries.sort((a, b) => (b.created ?? '').localeCompare(a.created ?? '') || b.id.localeCompare(a.id));
    // Steps in the order of their flow.
    for (const [parentPath, list] of n.steps) {
      const order = (byPath.get(dirname(parentPath)) ? docs.find((d) => d.path === parentPath)?.flow : undefined) ?? [];
      list.sort((a, b) => order.findIndex((st) => st.ref === a.id) - order.findIndex((st) => st.ref === b.id));
    }
  }
  return root;
}

function countEntries(n: TreeNode): number {
  let steps = 0;
  for (const list of n.steps.values()) steps += list.length;
  return n.entries.length + steps + n.folders.reduce((s, f) => s + countEntries(f), 0);
}

export function moveDocWithPrompt(path: string) {
  openDialog((close) => <MoveDialog close={close} onPick={(folder) => void moveDoc(path, folder)} current={dirname(path)} />);
}

export function entryMenu(d: DocMeta): MenuItemSpec[] {
  return [
    { label: 'Open', icon: <FileText />, onSelect: () => navigate({ name: 'doc', path: d.path }) },
    { label: 'Duplicate', icon: <Copy />, onSelect: () => void duplicateDoc(d.path) },
    { label: 'Move to…', icon: <FolderInput />, onSelect: () => moveDocWithPrompt(d.path) },
    'sep',
    {
      label: 'Move to trash',
      icon: <Trash2 />,
      danger: true,
      onSelect: () =>
        void confirmDialog({
          title: 'Move entry to trash?',
          message: `“${d.title}” and its attachments will be moved to the trash, where you can restore them.`,
          confirmLabel: 'Move to trash',
          danger: true,
        }).then((ok) => {
          if (ok) void trashDoc(d.path);
        }),
    },
  ];
}

function folderMenu(path: string): MenuItemSpec[] {
  return [
    { label: 'New entry here', icon: <Plus />, onSelect: () => openNewEntryDialog({ folder: path }) },
    {
      label: 'New subfolder',
      icon: <FolderPlus />,
      onSelect: () =>
        void promptDialog({ title: 'New folder', label: 'Name', placeholder: 'e.g. Plasmids' }).then((name) => {
          if (name) void createFolder(path, name);
        }),
    },
    {
      label: 'Rename',
      icon: <Pencil />,
      onSelect: () =>
        void promptDialog({ title: 'Rename folder', label: 'Name', defaultValue: basename(path) }).then((name) => {
          if (name) void renameFolder(path, name).catch((err: Error) => toast(err.message, 'error'));
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
          message: `“${basename(path)}” and everything inside it will be moved to the trash, where you can restore it.`,
          confirmLabel: 'Move to trash',
          danger: true,
        }).then((ok) => {
          if (ok) void trashFolder(path);
        }),
    },
  ];
}

function TreeFolder({
  node,
  depth,
  expanded,
  toggle,
  route,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  toggle: (p: string, open?: boolean) => void;
  route: Route;
}) {
  const open = expanded.has(node.path);
  const [over, setOver] = useState(false);
  const active = route.name === 'folder' && route.path === node.path;
  return (
    <div>
      <div
        className={`gc-tree-row is-folder ${active ? 'active' : ''} ${over ? 'drop-over' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        {...goTo(() => {
          toggle(node.path, true);
          navigate({ name: 'folder', path: node.path });
        }, active)}
        onClick={() => {
          toggle(node.path, true);
          navigate({ name: 'folder', path: node.path });
        }}
        onContextMenu={(e) => openContextMenu(e, folderMenu(node.path))}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DOC_MIME)) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          const p = e.dataTransfer.getData(DOC_MIME);
          if (p && dirname(p) !== node.path) void moveDoc(p, node.path);
        }}
      >
        <button
          className="gc-tree-chevron"
          onClick={(e) => {
            e.stopPropagation();
            toggle(node.path);
          }}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? <ChevronDown /> : <ChevronRight />}
        </button>
        {open ? <FolderOpen className="gc-tree-icon" /> : <Folder className="gc-tree-icon" />}
        <span className="gc-tree-label">{node.name}</span>
        <span className="gc-tree-count">{countEntries(node) || ''}</span>
        <span className="gc-tree-actions" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn icon-btn-sm" title="New entry here" onClick={() => openNewEntryDialog({ folder: node.path })}>
            <Plus />
          </button>
          <MenuButton items={() => folderMenu(node.path)} className="icon-btn icon-btn-sm" title="Folder options">
            <MoreHorizontal />
          </MenuButton>
        </span>
      </div>
      {open && (
        <div>
          {node.folders.map((f) => (
            <TreeFolder key={f.path} node={f} depth={depth + 1} expanded={expanded} toggle={toggle} route={route} />
          ))}
          {node.entries.map((d) => (
            <TreeEntry key={d.path} doc={d} depth={depth + 1} route={route} steps={node.steps} />
          ))}
          {!node.folders.length && !node.entries.length && (
            <div className="gc-tree-empty" style={{ paddingLeft: 28 + (depth + 1) * 14 }}>
              Empty
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TreeEntry({ doc, depth, route, steps }: { doc: DocMeta; depth: number; route: Route; steps: Map<string, DocMeta[]> }) {
  const statuses = useNotebook((s) => s.config.entryStatuses);
  const active = route.name === 'doc' && route.path === doc.path;
  const st = statusOf(statuses, doc.status);
  const children = steps.get(doc.path) ?? [];
  const row = (
    <div
      className={`gc-tree-row is-entry ${active ? 'active' : ''}`}
      style={{ paddingLeft: 26 + depth * 14 }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DOC_MIME, doc.path);
        e.dataTransfer.effectAllowed = 'move';
      }}
      {...goTo(() => navigate({ name: 'doc', path: doc.path }), active)}
      onClick={() => navigate({ name: 'doc', path: doc.path })}
      onContextMenu={(e) => openContextMenu(e, entryMenu(doc))}
      title={`${doc.id} ${doc.title}`}
    >
      <span className={`gc-status-dot tone-${st?.color ?? 'gray'}`} />
      {doc.id && <span className="gc-tree-id">{doc.id}</span>}
      <span className="gc-tree-label">{doc.title}</span>
    </div>
  );
  if (!children.length) return row;
  // The steps of its flow, indented under it.
  return (
    <div className="gc-tree-plan">
      {row}
      <div className="gc-tree-steps" role="group" aria-label={`Steps of ${doc.title}`} style={{ ['--step-rail' as string]: `${29 + depth * 14}px` }}>
        {children.map((c) => (
          <TreeEntry key={c.path} doc={c} depth={depth + 1} route={route} steps={steps} />
        ))}
      </div>
    </div>
  );
}

/** Switch notebook, but not past changes that could not be saved without asking. */
async function switchNotebook() {
  try {
    await closeNotebook();
  } catch (err) {
    if (!(err instanceof UnsavedChangesError)) throw err;
    const discard = await confirmDialog({
      title: 'Some changes are not saved',
      message:
        'The last changes to some pages could not be saved, and Assaycraft is still trying. If you switch notebook now, they are lost. Export the notebook (.zip) first: the export has them. Or wait and try again.',
      confirmLabel: 'Switch and lose them',
      danger: true,
    });
    if (discard) await closeNotebook({ discard: true });
  }
}

/** Whether the browser has a network connection, kept up to date. */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/**
 * Saving, saved, or not saved (a click tries again). In the sidebar, and `compact` (the icon, with
 * the words for screen readers and as a tooltip) in a page's top bar on phones, where the sidebar is
 * closed while you write.
 */
export function SaveIndicator({ compact = false }: { compact?: boolean }) {
  const saveState = useNotebook((s) => s.saveState);
  const online = useOnline();
  const map = {
    idle: null,
    pending: { icon: <LoaderCircle className="spin-slow" />, text: 'Editing…' },
    saving: { icon: <LoaderCircle className="spin" />, text: 'Saving…' },
    saved: { icon: <CircleCheck />, text: 'Saved', title: 'All changes saved' },
    error: online ? { icon: <CircleAlert />, text: 'Save failed' } : { icon: <CloudOff />, text: 'Offline · not saved' },
  } as const;
  const m = map[saveState];
  if (!m) return null;
  // The compact one has its own classes: the sidebar's is the one that names the state (gc-save-saved…).
  const cls = compact ? `gc-save gc-save-compact is-${saveState}` : `gc-save gc-save-${saveState}`;
  const label = compact ? <span className="sr-only">{m.text}</span> : m.text;
  // A failed save keeps trying by itself; a click tries now.
  if (saveState === 'error')
    return (
      <button
        type="button"
        className={cls}
        title={
          online
            ? 'Changes could not be saved. Click to try again.'
            : 'No connection: your changes are kept here and saved when it comes back. Click to try now.'
        }
        onClick={() => void retryFailedWrites()}
      >
        {m.icon}
        {m.text}
      </button>
    );
  return (
    <span className={cls} role={compact ? 'status' : undefined} title={'title' in m ? m.title : compact ? m.text : undefined}>
      {m.icon}
      {label}
    </span>
  );
}

/** Connected phones (or, on a phone, the computer): one icon with a dot, green while in sync. */
function SyncIndicator() {
  const role = useSync((s) => s.role);
  const peers = useSync((s) => s.peers);
  const list = Object.values(peers);
  if (!role || !list.length) return null;
  const other = role === 'phone' ? 'computer' : 'phone';
  const states = list.map((p) => peerStatus(p, other));
  const tone = states.some((st) => st.tone === 'busy') ? 'busy' : states.some((st) => st.tone === 'live') ? 'live' : 'idle';
  const title = list.map((p, i) => `${p.device || (role === 'phone' ? 'Computer' : 'Phone')}: ${states[i].text}`).join('\n');
  return (
    <button className="icon-btn icon-btn-sm gc-sync-indicator" title={title} aria-label={title} onClick={() => navigate({ name: 'phone' })}>
      {role === 'phone' ? <Laptop /> : <Smartphone />}
      <span className={`gc-sync-dot is-${tone}`} aria-hidden="true" />
    </button>
  );
}

export function Sidebar() {
  const vault = useNotebook((s) => s.vault)!;
  const syncRole = useSync((s) => s.role);
  const config = useNotebook((s) => s.config);
  const docs = useNotebook((s) => s.docs);
  const folders = useNotebook((s) => s.folders);
  const route = useNotebook((s) => s.route);
  const theme = useNotebook((s) => s.theme);
  const navOpen = useNotebook((s) => s.navOpen);
  const asideRef = useRef<HTMLElement>(null);
  useSheetFocus(asideRef, navOpen, () => setState({ navOpen: false }));
  const trashCount = useNotebook((s) => s.trash.length);
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);

  const all = useMemo(() => Object.values(docs), [docs]);
  const entries = useMemo(() => all.filter((d) => d.kind === 'entry'), [all]);
  const boards = useMemo(() => all.filter((d) => d.kind === 'board').sort((a, b) => a.title.localeCompare(b.title)), [all]);
  const tree = useMemo(() => buildTree(folders, entries), [folders, entries]);

  const toggle = (p: string, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      const want = open ?? !next.has(p);
      if (want) next.add(p);
      else next.delete(p);
      try {
        localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });

  // Reveal the current doc in the tree.
  useEffect(() => {
    if (route.name !== 'doc' || !isInside(route.path, LAYOUT.projects)) return;
    const parts = dirname(route.path).split('/');
    const missing: string[] = [];
    for (let i = 2; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('/');
      if (!expanded.has(p)) missing.push(p);
    }
    if (missing.length) setExpanded((prev) => new Set([...prev, ...missing]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  const currentFolder =
    route.name === 'folder' ? route.path : route.name === 'doc' && isInside(route.path, LAYOUT.projects) ? dirname(route.path) : undefined;

  const notebookMenu: MenuItemSpec[] = [
    {
      heading:
        vault.kind === 'folder'
          ? `Folder: ${vault.name}`
          : syncRole === 'phone'
            ? 'In this browser, synced with a computer'
            : 'Stored in this browser',
    },
    { label: 'Settings', icon: <Settings />, onSelect: () => navigate({ name: 'settings' }) },
    ...(syncSupported()
      ? [
          syncRole === 'phone'
            ? { label: 'Computer connection', icon: <Laptop />, onSelect: () => navigate({ name: 'phone' }) }
            : { label: 'Connect a phone', icon: <Smartphone />, onSelect: () => navigate({ name: 'phone' }) },
        ]
      : []),
    { label: 'Take the tour', icon: <Compass />, onSelect: startTour },
    {
      label: 'Export notebook (.zip)',
      icon: <Download />,
      onSelect: () => {
        setState({ navOpen: false });
        void exportZip().then(({ blob, name }) => downloadBlob(blob, name));
      },
    },
    {
      label: 'Import .zip into notebook…',
      icon: <Upload />,
      onSelect: () =>
        void pickFiles({ accept: '.zip,application/zip', multiple: false }).then(async ([f]) => {
          if (!f) return;
          setState({ navOpen: false });
          toast(importSummary(await importZip(f)), 'success');
        }),
    },
    'sep',
    { label: 'Switch notebook', icon: <LogOut />, onSelect: () => void switchNotebook() },
  ];

  const themeIcon = theme === 'dark' ? <Moon /> : theme === 'light' ? <Sun /> : <Monitor />;
  const nextTheme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';

  const cardsIn = (boardPath: string) => {
    const cols = docs[boardPath]?.columns ?? [];
    const doneId = cols[cols.length - 1]?.id;
    return all.filter((d) => d.kind === 'card' && dirname(d.path) === dirname(boardPath) && d.status !== doneId).length;
  };

  return (
    <aside
      ref={asideRef}
      className={`gc-sidebar ${navOpen ? 'is-open' : ''}`}
      aria-label="Notebook"
      // On a phone, open, it covers the page: a dialog, with focus in it until it closes.
      role={navOpen ? 'dialog' : undefined}
      aria-modal={navOpen || undefined}
    >
      <div className="gc-sidebar-top">
        <MenuButton items={notebookMenu} className="gc-notebook-btn" label="Notebook menu" placement="bottom-start">
          <Logo />
          <span className="gc-notebook-name">{config.name || vault.name}</span>
          <ChevronDown className="gc-notebook-chevron" />
        </MenuButton>
        <button className="icon-btn gc-nav-close" aria-label="Close the menu" onClick={() => setState({ navOpen: false })}>
          <X />
        </button>
      </div>
      <button className="gc-search-btn" onClick={() => setState({ paletteOpen: true, navOpen: false })}>
        <Search />
        <span>Search</span>
        <kbd>Ctrl K</kbd>
      </button>
      <button
        className="btn btn-primary btn-block gc-new-btn"
        onClick={() => {
          setState({ navOpen: false });
          openNewEntryDialog({ folder: currentFolder });
        }}
      >
        <Plus /> New entry
      </button>
      <div className="gc-sidebar-scroll">
        <nav className="gc-nav">
          <NavItem icon={<Home />} label="Home" active={route.name === 'home'} onClick={() => navigate({ name: 'home' })} />
          <NavItem icon={<CalendarDays />} label="Calendar" active={route.name === 'calendar'} onClick={() => navigate({ name: 'calendar' })} />
          <NavItem
            icon={<BookOpen />}
            label="Protocols"
            active={route.name === 'protocols' || (route.name === 'doc' && isInside(route.path, LAYOUT.protocols))}
            onClick={() => navigate({ name: 'protocols' })}
          />
          <NavItem
            icon={<TestTubes />}
            label="Stocks"
            active={route.name === 'stocks' || (route.name === 'doc' && isInside(route.path, LAYOUT.stocks))}
            onClick={() => navigate({ name: 'stocks' })}
          />
          <NavItem
            icon={<BookMarked />}
            label="Literature"
            active={route.name === 'literature' || (route.name === 'doc' && isInside(route.path, LAYOUT.literature))}
            onClick={() => navigate({ name: 'literature' })}
          />
          <NavItem
            icon={<LayoutTemplate />}
            label="Templates"
            active={route.name === 'templates' || (route.name === 'doc' && isInside(route.path, LAYOUT.templates))}
            onClick={() => navigate({ name: 'templates' })}
          />
          <NavItem
            icon={<NotebookPen />}
            label="Notes"
            active={route.name === 'notes' || (route.name === 'doc' && isInside(route.path, LAYOUT.notes))}
            onClick={() => navigate({ name: 'notes' })}
          />
        </nav>
        <Section title="Boards" addTitle="New board" onAdd={openNewBoardDialog}>
          <NavItem
            icon={<FlaskConical />}
            label="Experiments"
            title="All notebook entries by status"
            active={route.name === 'board' && route.path === BUILTIN_EXPERIMENTS_BOARD}
            onClick={() => navigate({ name: 'board', path: BUILTIN_EXPERIMENTS_BOARD })}
          />
          {boards.map((b) => (
            <NavItem
              key={b.path}
              icon={<KanbanSquare />}
              label={b.title}
              count={cardsIn(b.path)}
              active={route.name === 'board' && route.path === dirname(b.path)}
              onClick={() => navigate({ name: 'board', path: dirname(b.path) })}
            />
          ))}
        </Section>
        <Section
          title="Projects"
          addTitle="New project folder"
          onAdd={() =>
            void promptDialog({ title: 'New project', label: 'Project name', placeholder: 'e.g. CRISPR screen' }).then(async (n) => {
              if (!n) return;
              const p = await createFolder(LAYOUT.projects, n);
              toggle(p, true);
              navigate({ name: 'folder', path: p });
            })
          }
        >
          <div className="gc-tree">
            {tree.folders.map((f) => (
              <TreeFolder key={f.path} node={f} depth={0} expanded={expanded} toggle={toggle} route={route} />
            ))}
            {tree.entries.map((d) => (
              <TreeEntry key={d.path} doc={d} depth={-1} route={route} steps={tree.steps} />
            ))}
            {!tree.folders.length && !tree.entries.length && <div className="gc-tree-empty">No projects yet</div>}
          </div>
        </Section>
        <nav className="gc-nav gc-nav-trash" aria-label="Trash">
          <NavItem
            icon={<Trash2 />}
            label="Trash"
            title="Deleted pages and folders, to restore. Drop a page here to delete it."
            count={trashCount || undefined}
            active={route.name === 'trash'}
            onClick={() => navigate({ name: 'trash' })}
            onDrop={(e) => {
              const p = e.dataTransfer.getData(DOC_MIME);
              if (p) void trashDoc(p);
            }}
          />
        </nav>
      </div>
      <div className="gc-sidebar-foot">
        <span
          className="gc-storage"
          title={
            vault.kind === 'folder'
              ? 'Entries are Markdown files in this folder on your computer'
              : 'Entries are stored in this browser. Export a .zip to back them up.'
          }
        >
          {vault.kind === 'folder' ? <HardDrive /> : <Globe />}
          <span>{vault.kind === 'folder' ? vault.name : 'Browser storage'}</span>
          {vault.kind === 'browser' && <CloudOff className="gc-storage-warn" />}
        </span>
        <SyncIndicator />
        <SaveIndicator />
        <button className="icon-btn icon-btn-sm" title={`Theme: ${theme} (click for ${nextTheme})`} onClick={() => setTheme(nextTheme)}>
          {themeIcon}
        </button>
      </div>
    </aside>
  );
}
