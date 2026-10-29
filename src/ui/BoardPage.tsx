import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckSquare,
  ListTodo,
  Folder,
  KanbanSquare,
  Link2,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  Settings,
  Trash2,
  Workflow,
} from 'lucide-react';
import { BUILTIN_EXPERIMENTS_BOARD, getState, navigate, setState, toast, useNotebook } from '../notebook/store';
import { LAYOUT, boardCards, cardNoun, slugify, type ColorName, type DocMeta, type StatusOption } from '../notebook/model';
import { createCard, patchMeta, projectOf, trashBoard, trashDoc } from '../notebook/actions';
import { MenuButton, Popover, confirmDialog, openContextMenu, promptDialog, type MenuItemSpec } from './overlay';
import { ColorPicker, PriorityPill, TagPill } from './status';
import { openNewEntryDialog } from './NewEntryDialog';
import { entryMenu } from './Sidebar';
import { dirname, join } from '../lib/path';
import { localDate, LOCALE } from '../lib/dates';
import { FilterField, NewButton, PageHead, PhoneBar, ViewBar } from './PageHeader';
import { entriesById, flowProgress } from '../flow/model';

const CARD_MIME = 'application/x-assaycraft-card';

function dueInfo(due: string | undefined, done: boolean): { label: string; tone: string } | null {
  if (!due) return null;
  const today = localDate();
  const d = new Date(due + 'T00:00:00');
  const label = d.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' });
  if (done) return { label, tone: 'gray' };
  if (due < today) return { label, tone: 'red' };
  const tomorrow = localDate(new Date(Date.now() + 86400000));
  if (due === today) return { label: 'Today', tone: 'orange' };
  if (due === tomorrow) return { label: 'Tomorrow', tone: 'yellow' };
  return { label, tone: 'gray' };
}

interface KanbanProps {
  columns: StatusOption[];
  items: DocMeta[];
  sortItems: (a: DocMeta, b: DocMeta) => number;
  onDrop: (doc: DocMeta, column: string, before: DocMeta | null, after: DocMeta | null) => void;
  renderCard: (doc: DocMeta, done: boolean) => ReactNode;
  onOpen: (doc: DocMeta) => void;
  cardMenu: (doc: DocMeta) => MenuItemSpec[];
  columnMenu?: (col: StatusOption, index: number) => MenuItemSpec[];
  onAddColumn?: () => void;
  onAdd: (column: string, title?: string) => void;
  quickAdd: boolean;
  /** What one card is called ("task", "card"). */
  noun?: string;
  doneColumn?: string;
}

function QuickAdd({ onAdd, noun = 'card' }: { onAdd: (title: string) => void; noun?: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  if (!open)
    return (
      <button className="gc-col-add" onClick={() => setOpen(true)}>
        <Plus /> New
      </button>
    );
  return (
    <form
      className="gc-quick-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onAdd(value.trim());
        setValue('');
      }}
    >
      <textarea
        className="textarea"
        autoFocus
        rows={2}
        placeholder={`${noun[0].toUpperCase() + noun.slice(1)} title… (Enter to add)`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (value.trim()) onAdd(value.trim());
            setValue('');
          }
          if (e.key === 'Escape') {
            setOpen(false);
            setValue('');
          }
        }}
        onBlur={() => {
          if (!value.trim()) setOpen(false);
        }}
      />
    </form>
  );
}

function Kanban({
  columns,
  items,
  sortItems,
  onDrop,
  renderCard,
  onOpen,
  cardMenu,
  columnMenu,
  onAddColumn,
  onAdd,
  quickAdd,
  doneColumn,
  noun,
}: KanbanProps) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [indicator, setIndicator] = useState<{ col: string; index: number } | null>(null);
  const colRefs = useRef(new Map<string, HTMLDivElement>());
  const known = new Set(columns.map((c) => c.id));
  const orphan = items.filter((d) => !d.status || !known.has(d.status));
  const allColumns: StatusOption[] = orphan.length ? [{ id: '__none__', name: 'No status', color: 'gray' }, ...columns] : columns;
  const grouped = useMemo(() => {
    const m = new Map<string, DocMeta[]>();
    for (const c of allColumns) m.set(c.id, []);
    for (const d of items) {
      const key = d.status && known.has(d.status) ? d.status : '__none__';
      m.get(key)?.push(d);
    }
    for (const list of m.values()) list.sort(sortItems);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, columns, sortItems]);

  const indexAt = (col: string, y: number): number => {
    const el = colRefs.current.get(col);
    if (!el) return 0;
    const cards = Array.from(el.querySelectorAll<HTMLElement>('.gc-card:not(.is-dragging)'));
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return cards.length;
  };

  const handleDrop = (e: DragEvent, col: string) => {
    e.preventDefault();
    const path = e.dataTransfer.getData(CARD_MIME);
    setIndicator(null);
    setDragging(null);
    const doc = items.find((d) => d.path === path);
    if (!doc || col === '__none__') return;
    const list = (grouped.get(col) ?? []).filter((d) => d.path !== path);
    const idx = indexAt(col, e.clientY);
    onDrop(doc, col, list[idx] ?? null, list[idx - 1] ?? null);
  };

  return (
    <div className="gc-kanban">
      {allColumns.map((col, ci) => {
        const list = grouped.get(col.id) ?? [];
        return (
          <section
            key={col.id}
            data-col-id={col.id}
            className={`gc-col ${indicator?.col === col.id ? 'is-over' : ''}`}
            style={{ ['--col-tone' as string]: `var(--c-${col.color})` }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(CARD_MIME) || col.id === '__none__') return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const index = indexAt(col.id, e.clientY);
              if (indicator?.col !== col.id || indicator.index !== index) setIndicator({ col: col.id, index });
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setIndicator((i) => (i?.col === col.id ? null : i));
            }}
            onDrop={(e) => handleDrop(e, col.id)}
          >
            <header className="gc-col-head">
              <span className={`gc-col-title pill tone-${col.color}`}>
                <span className="dot" />
                {col.name}
              </span>
              <span className="gc-col-count">{list.length}</span>
              <span className="spacer" />
              {columnMenu && col.id !== '__none__' && (
                <MenuButton items={() => columnMenu(col, ci - (orphan.length ? 1 : 0))} className="icon-btn icon-btn-sm" title="Column options">
                  <MoreHorizontal />
                </MenuButton>
              )}
            </header>
            <div
              className="gc-col-body"
              ref={(el) => {
                if (el) colRefs.current.set(col.id, el);
              }}
            >
              {list.map((d, i) => (
                <div key={d.path}>
                  {indicator?.col === col.id && indicator.index === i && dragging !== d.path && <div className="gc-drop-line" />}
                  <article
                    className={`gc-card ${dragging === d.path ? 'is-dragging' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(CARD_MIME, d.path);
                      e.dataTransfer.effectAllowed = 'move';
                      setTimeout(() => setDragging(d.path), 0);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setIndicator(null);
                    }}
                    onClick={() => onOpen(d)}
                    onContextMenu={(e) => openContextMenu(e, cardMenu(d))}
                  >
                    {renderCard(d, col.id === doneColumn)}
                  </article>
                </div>
              ))}
              {indicator?.col === col.id && indicator.index >= list.filter((d) => d.path !== dragging).length && <div className="gc-drop-line" />}
              {quickAdd && col.id !== '__none__' ? (
                <QuickAdd noun={noun} onAdd={(title) => onAdd(col.id, title)} />
              ) : (
                col.id !== '__none__' && (
                  <button className="gc-col-add" onClick={() => onAdd(col.id)}>
                    <Plus /> New
                  </button>
                )
              )}
            </div>
          </section>
        );
      })}
      {onAddColumn && (
        <button className="gc-col-new" onClick={onAddColumn}>
          <Plus /> Add column
        </button>
      )}
    </div>
  );
}

function orderBetween(before: DocMeta | null, after: DocMeta | null): number {
  const b = before?.order;
  const a = after?.order;
  if (a !== undefined && b !== undefined) return (a + b) / 2;
  if (a !== undefined) return a + 1;
  if (b !== undefined) return b - 1;
  return 1;
}

function useFiltered(items: DocMeta[], q: string) {
  return useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((d) => `${d.id} ${d.title} ${d.tags.join(' ')} ${d.text}`.toLowerCase().includes(s));
  }, [items, q]);
}

// ───────────── Experiments board (notebook entries by status) ─────────────

/** The board's columns are the notebook's entry statuses, set in Settings. */
function editStatuses() {
  navigate({ name: 'settings' });
  setTimeout(() => document.getElementById('settings-statuses')?.scrollIntoView({ block: 'start' }), 60);
}

function ExperimentsBoard() {
  const docs = useNotebook((s) => s.docs);
  const byId = useMemo(() => entriesById(Object.values(docs)), [docs]);
  const statuses = useNotebook((s) => s.config.entryStatuses);
  const folders = useNotebook((s) => s.folders);
  const [q, setQ] = useState('');
  const [project, setProject] = useState<string>('');
  const projects = folders.filter((f) => f.split('/').length === 2);
  const entries = useMemo(
    () => Object.values(docs).filter((d) => d.kind === 'entry' && (!project || d.path.startsWith(project + '/'))),
    [docs, project],
  );
  const items = useFiltered(entries, q);
  const sort = useMemo(
    () => (a: DocMeta, b: DocMeta) => (b.date ?? b.created ?? '').localeCompare(a.date ?? a.created ?? '') || b.id.localeCompare(a.id),
    [],
  );
  return (
    <div className="gc-page gc-board-page">
      <PhoneBar />
      <div className="gc-page-inner is-wide gc-board-head">
        <PageHead title="Experiments" lede="Every entry, by status. Drag a card to another column to change its status." />
        <ViewBar
          tools={
            <>
              <FilterField value={q} onChange={setQ} placeholder="Filter entries…" />
              <MenuButton items={[{ label: 'Edit statuses…', icon: <Settings />, onSelect: editStatuses }]} title="Board options">
                <MoreHorizontal />
              </MenuButton>
              <NewButton what="entry" onClick={() => openNewEntryDialog({ folder: project || undefined })} />
            </>
          }
        >
          <select className="select gc-select-sm" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p.split('/')[1]}
              </option>
            ))}
          </select>
        </ViewBar>
      </div>
      <Kanban
        columns={statuses}
        items={items}
        sortItems={sort}
        quickAdd={false}
        doneColumn="completed"
        onDrop={(doc, column) => {
          if (doc.status !== column) patchMeta(doc.path, { status: column }, 200);
        }}
        onAdd={(column) => openNewEntryDialog({ status: column, folder: project || undefined })}
        onOpen={(d) => navigate({ name: 'doc', path: d.path })}
        cardMenu={entryMenu}
        renderCard={(d) => (
          <>
            <div className="gc-card-top">
              <span className="id-chip">{d.id}</span>
              {d.locked && <span className="muted gc-card-lock">locked</span>}
            </div>
            <div className="gc-card-title">{d.title}</div>
            <div className="gc-card-meta">
              {projectOf(d.path) && (
                <span>
                  <Folder /> {projectOf(d.path)}
                </span>
              )}
              {(d.date ?? d.created) && (
                <span>
                  <CalendarClock />{' '}
                  {new Date((d.date ?? d.created!.slice(0, 10)) + 'T00:00:00').toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' })}
                </span>
              )}
              {d.tasks && (
                <span>
                  <CheckSquare /> {d.tasks.done}/{d.tasks.total}
                </span>
              )}
              {!!d.flow?.length && (
                <span title="Flow: steps completed">
                  <Workflow /> {flowProgress(d.flow, byId).done}/{d.flow.length}
                </span>
              )}
            </div>
            {d.tags.length > 0 && (
              <div className="gc-card-tags">
                {d.tags.slice(0, 4).map((t) => (
                  <TagPill key={t} tag={t} />
                ))}
              </div>
            )}
          </>
        )}
      />
    </div>
  );
}

// ───────────── Task boards (Markdown cards in Boards/<name>/) ─────────────

function ColumnColor({ col, onPick }: { col: StatusOption; onPick: (c: ColorName) => void }) {
  return <ColorPicker value={col.color} onChange={onPick} />;
}

function TaskBoard({ folder }: { folder: string }) {
  const boardPath = join(folder, LAYOUT.boardFile);
  const board = useNotebook((s) => s.docs[boardPath]);
  const docs = useNotebook((s) => s.docs);
  const [q, setQ] = useState('');
  const [colorFor, setColorFor] = useState<string | null>(null);
  const cards = useMemo(() => Object.values(docs).filter((d) => d.kind === 'card' && dirname(d.path) === folder), [docs, folder]);
  const items = useFiltered(cards, q);
  const sort = useMemo(() => (a: DocMeta, b: DocMeta) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id), []);

  if (!board)
    return (
      <div className="gc-page">
        <div className="empty-state">
          <KanbanSquare />
          <h3>Board not found</h3>
          <button className="btn" onClick={() => navigate({ name: 'home' })}>
            Go home
          </button>
        </div>
      </div>
    );

  const columns = board.columns ?? [];
  const setColumns = (next: StatusOption[]) => patchMeta(boardPath, { columns: next }, 200);
  const cardsAre = boardCards(board);
  const noun = cardNoun(cardsAre);
  const doneColumn = columns[columns.length - 1]?.id;

  const columnMenu = (col: StatusOption, index: number): MenuItemSpec[] => [
    {
      label: 'Rename',
      icon: <Pencil />,
      onSelect: () =>
        void promptDialog({ title: 'Rename column', label: 'Name', defaultValue: col.name }).then((name) => {
          if (name) void setColumns(columns.map((c) => (c.id === col.id ? { ...c, name } : c)));
        }),
    },
    {
      label: 'Color',
      icon: <Palette />,
      onSelect: () => setColorFor(col.id),
    },
    { label: 'Move left', icon: <ArrowLeft />, disabled: index === 0, onSelect: () => setColumns(swap(columns, index, index - 1)) },
    {
      label: 'Move right',
      icon: <ArrowRight />,
      disabled: index === columns.length - 1,
      onSelect: () => setColumns(swap(columns, index, index + 1)),
    },
    'sep',
    {
      label: 'Delete column',
      icon: <Trash2 />,
      danger: true,
      disabled: columns.length <= 1,
      onSelect: () => {
        const rest = columns.filter((c) => c.id !== col.id);
        const inCol = cards.filter((c) => c.status === col.id);
        void confirmDialog({
          title: `Delete “${col.name}”?`,
          message: inCol.length ? `Its ${inCol.length} card(s) will move to “${rest[0].name}”.` : 'The column is empty.',
          confirmLabel: 'Delete column',
          danger: true,
        }).then((ok) => {
          if (!ok) return;
          for (const c of inCol) patchMeta(c.path, { status: rest[0].id }, 200);
          setColumns(rest);
        });
      },
    },
  ];

  const boardMenu: MenuItemSpec[] = [
    {
      label: 'Rename board',
      icon: <Pencil />,
      onSelect: () =>
        void promptDialog({ title: 'Rename board', label: 'Name', defaultValue: board.title }).then((title) => {
          if (title) void patchMeta(boardPath, { title }, 200);
        }),
    },
    {
      label: 'Edit description',
      icon: <Pencil />,
      onSelect: () =>
        void promptDialog({ title: 'Board description', label: 'Description', defaultValue: board.description ?? '' }).then(
          (d) => d !== null && patchMeta(boardPath, { description: d }, 200),
        ),
    },
    {
      label: cardsAre === 'tasks' ? 'Track things instead of tasks' : 'Use for tasks with due dates',
      icon: cardsAre === 'tasks' ? <KanbanSquare /> : <ListTodo />,
      onSelect: () => {
        const next = cardsAre === 'tasks' ? 'items' : 'tasks';
        patchMeta(boardPath, { extra: { ...board.extra, cards: next } }, 0);
        toast(
          next === 'tasks'
            ? `${board.title} now holds tasks: give them due dates to see them on the calendar.`
            : `${board.title} now tracks things: its cards no longer show on the calendar or as open tasks.`,
          'success',
        );
      },
    },
    'sep',
    {
      label: 'Delete board',
      icon: <Trash2 />,
      danger: true,
      onSelect: () =>
        void confirmDialog({
          title: 'Delete board?',
          message: `“${board.title}” and its ${cards.length} card(s) will be moved to the trash, where you can restore them.`,
          confirmLabel: 'Delete board',
          danger: true,
        }).then((ok) => {
          if (!ok) return;
          // Home once it is gone, unless you have moved on meanwhile (a big board takes a moment to move).
          void trashBoard(folder).then(() => {
            const r = getState().route;
            if (r.name === 'board' && r.path === folder) navigate({ name: 'home' });
          });
        }),
    },
  ];

  const cardMenu = (d: DocMeta): MenuItemSpec[] => [
    { label: 'Open', icon: <Pencil />, onSelect: () => setState({ peek: d.path }) },
    { label: 'Open as page', icon: <KanbanSquare />, onSelect: () => navigate({ name: 'doc', path: d.path }) },
    'sep',
    ...columns
      .filter((c) => c.id !== d.status)
      .map((c) => ({ label: `Move to ${c.name}`, onSelect: () => patchMeta(d.path, { status: c.id }, 200) })),
    'sep',
    { label: 'Delete', icon: <Trash2 />, danger: true, onSelect: () => void trashDoc(d.path) },
  ];

  return (
    <div className="gc-page gc-board-page">
      <PhoneBar />
      <div className="gc-page-inner is-wide gc-board-head">
        <PageHead title={board.title} lede={board.description || undefined} />
        <ViewBar
          tools={
            <>
              <FilterField value={q} onChange={setQ} placeholder="Filter cards…" />
              <MenuButton items={boardMenu} title="Board options">
                <MoreHorizontal />
              </MenuButton>
              <NewButton what={noun} onClick={() => void createCard(folder, { status: columns[0]?.id, open: true })} />
            </>
          }
        />
      </div>
      <Kanban
        columns={columns}
        items={items}
        sortItems={sort}
        quickAdd
        noun={noun}
        doneColumn={doneColumn}
        onDrop={(doc, column, before, after) => {
          const order = orderBetween(before, after);
          if (doc.status !== column || doc.order !== order) patchMeta(doc.path, { status: column, order }, 200);
        }}
        onAdd={(column, title) => void createCard(folder, { status: column, title, open: !title })}
        onOpen={(d) => setState({ peek: d.path })}
        cardMenu={cardMenu}
        columnMenu={columnMenu}
        onAddColumn={() =>
          void promptDialog({ title: 'New column', label: 'Name', placeholder: 'e.g. Waiting for reagents' }).then((name) => {
            if (!name) return;
            let id = slugify(name);
            while (columns.some((c) => c.id === id)) id += '-2';
            setColumns([...columns, { id, name, color: 'purple' }]);
          })
        }
        renderCard={(d, done) => {
          // Things to track have no due date or priority (a board turned from tasks may still store them).
          const due = cardsAre === 'tasks' ? dueInfo(d.due, done) : null;
          const priority = cardsAre === 'tasks' ? d.priority : undefined;
          const linked = (d.links ?? []).length;
          return (
            <>
              <div className={`gc-card-title ${done ? 'is-done' : ''}`}>{d.title}</div>
              {(priority || d.tags.length > 0) && (
                <div className="gc-card-tags">
                  <PriorityPill priority={priority} />
                  {d.tags.slice(0, 3).map((t) => (
                    <TagPill key={t} tag={t} />
                  ))}
                </div>
              )}
              <div className="gc-card-meta">
                {due && (
                  <span className={`gc-due tone-text-${due.tone}`}>
                    <CalendarClock /> {due.label}
                  </span>
                )}
                {d.tasks && (
                  <span>
                    <CheckSquare /> {d.tasks.done}/{d.tasks.total}
                  </span>
                )}
                {linked > 0 && (
                  <span title={(d.links ?? []).join(', ')}>
                    <Link2 /> {linked === 1 ? d.links![0] : `${linked} entries`}
                  </span>
                )}
                <span className="gc-card-id">{d.id}</span>
              </div>
            </>
          );
        }}
      />
      {colorFor && (
        <Popover
          anchor={document.querySelector<HTMLElement>(`[data-col-id="${colorFor}"] .gc-col-head`) ?? new DOMRect(window.innerWidth / 2, 120, 0, 0)}
          onClose={() => setColorFor(null)}
        >
          <div className="menu-label">Column color</div>
          <ColumnColor
            col={columns.find((c) => c.id === colorFor)!}
            onPick={(color) => {
              setColumns(columns.map((c) => (c.id === colorFor ? { ...c, color } : c)));
              setColorFor(null);
            }}
          />
        </Popover>
      )}
    </div>
  );
}

function swap<T>(arr: T[], i: number, j: number): T[] {
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export function BoardPage({ path }: { path: string }) {
  if (path === BUILTIN_EXPERIMENTS_BOARD) return <ExperimentsBoard />;
  return <TaskBoard folder={path} />;
}
