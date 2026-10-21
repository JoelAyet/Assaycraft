import { memo, useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CircleDashed,
  Columns3,
  Copy,
  Dna,
  Download,
  FileClock,
  FileText,
  FileUp,
  Hash,
  Microscope,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Search,
  Sprout,
  Target,
  TestTube,
  TestTubes,
  Trash2,
  X,
} from 'lucide-react';
import { NavToggle } from '../ui/nav';
import { openVersionHistory } from '../history/HistoryDialog';
import { Dialog, MenuButton, confirmDialog, openContextMenu, openDialog, promptDialog, type MenuItemSpec } from '../ui/overlay';
import { navigate, toast, useNotebook } from '../notebook/store';
import { LAYOUT, type DocMeta } from '../notebook/model';
import {
  createStockCollection,
  flushWrite,
  patchMeta,
  readDoc,
  registerOpenDoc,
  renameStockCollection,
  touchDoc,
  trashDoc,
} from '../notebook/actions';
import { downloadBlob, pickFiles } from '../lib/download';
import { parseDelimited, sniffDelimiter, toDelimited } from '../sheet/tsv';
import {
  STOCK_ID_RE,
  STOCK_TYPES,
  TM_CONDITIONS,
  columnRoles,
  isComputed,
  nextStockId,
  parseStockTable,
  stockType,
  withComputed,
  writeStockTable,
  type ColumnRole,
  type StockTable,
} from './model';

const TYPE_ICONS: Record<string, ReactNode> = {
  primer: <Dna />,
  plasmid: <CircleDashed />,
  glycerol: <TestTube />,
  seed: <Sprout />,
  antibody: <Target />,
  'cell-line': <Microscope />,
  other: <Package />,
};
export const stockIcon = (type?: unknown) => TYPE_ICONS[String(type ?? 'other')] ?? <Package />;
export const collectionType = (m: DocMeta) => stockType(String(m.extra.stock ?? ''));
export const collectionPrefix = (m: DocMeta) => String(m.extra.prefix ?? '').trim() || collectionType(m).prefix;

const TM_HELP = `Worked out from the sequence: nearest-neighbour (SantaLucia 1998), ${TM_CONDITIONS.sodium * 1000} mM Na⁺, ${TM_CONDITIONS.primer * 1e9} nM primer`;
const COMPUTED_HELP: Partial<Record<ColumnRole, string>> = {
  length: 'Worked out from the sequence',
  gc: 'Worked out from the sequence',
  tm: TM_HELP,
};

function columnWidth(role: ColumnRole, name: string): number {
  if (role === 'id') return 104;
  if (role === 'sequence') return 280;
  if (role === 'notes') return 220;
  if (role === 'name') return 170;
  if (isComputed(role)) return 82;
  return /date/i.test(name) ? 118 : 140;
}

// ───────────── New collection ─────────────

export function openNewCollectionDialog() {
  openDialog((close) => <NewCollectionDialog close={close} />);
}

function NewCollectionDialog({ close }: { close: () => void }) {
  const [typeId, setTypeId] = useState('primer');
  const type = stockType(typeId);
  const [title, setTitle] = useState<string | null>(null);
  const [prefix, setPrefix] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      await createStockCollection({ type: type.id, title: title ?? type.name, prefix: prefix ?? type.prefix });
      close();
    } catch (err) {
      toast(`Could not create the collection: ${(err as Error).message}`, 'error');
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="New stock collection"
      icon={<TestTubes className="gc-dialog-icon" />}
      onClose={close}
      wide
      footer={
        <>
          <span className="muted gc-footer-hint">
            Saved as a table in <code>{LAYOUT.stocks}/</code>
          </span>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void create()}>
            Create collection
          </button>
        </>
      }
    >
      <div className="gc-new-entry-grid">
        <div className="gc-template-list gc-stock-types" role="listbox" aria-label="Kind of stock">
          {STOCK_TYPES.map((t) => (
            <button
              key={t.id}
              role="option"
              aria-selected={t.id === typeId}
              className={`gc-template-option ${t.id === typeId ? 'active' : ''}`}
              onClick={() => setTypeId(t.id)}
            >
              {stockIcon(t.id)}
              <span>
                <strong>{t.name}</strong>
                <small>{t.description}</small>
              </span>
            </button>
          ))}
        </div>
        <form
          className="gc-new-entry-form"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="field">
            <label htmlFor="sc-title">Name</label>
            <input id="sc-title" className="input" value={title ?? type.name} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="sc-prefix">ID prefix</label>
            <input
              id="sc-prefix"
              className="input mono"
              value={prefix ?? type.prefix}
              onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
            />
            <span className="field-hint">
              Stocks are numbered <span className="mono">{(prefix ?? type.prefix) || type.prefix}0001</span>,{' '}
              <span className="mono">{(prefix ?? type.prefix) || type.prefix}0002</span>…
            </span>
          </div>
          <div className="field">
            <span className="field-label">Columns</span>
            <div className="gc-stock-colpreview">
              {type.columns.map((c) => (
                <span key={c} className={`pill pill-sq ${isComputed(columnRoles(type.columns)[type.columns.indexOf(c)]) ? 'tone-teal' : ''}`}>
                  {c}
                </span>
              ))}
            </div>
            <span className="field-hint">You can rename, add and remove columns later.</span>
          </div>
          <button type="submit" hidden />
        </form>
      </div>
    </Dialog>
  );
}

// ───────────── Columns ─────────────

interface ColumnDraft {
  name: string;
  /** Index of the column it came from (null for a new one). */
  from: number | null;
}

function ColumnsDialog({ table, close, onSave }: { table: StockTable; close: () => void; onSave: (t: StockTable) => void }) {
  const [cols, setCols] = useState<ColumnDraft[]>(table.columns.map((name, from) => ({ name, from })));
  const [adding, setAdding] = useState('');
  const idCol = columnRoles(table.columns).indexOf('id');
  const move = (i: number, d: number) =>
    setCols((c) => {
      const next = [...c];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });
  const add = () => {
    const name = adding.trim();
    if (!name) return;
    setCols((c) => [...c, { name, from: null }]);
    setAdding('');
  };
  const save = () => {
    const kept = cols.filter((c) => c.name.trim());
    onSave({
      ...table,
      columns: kept.map((c) => c.name.trim()),
      rows: table.rows.map((row) => kept.map((c) => (c.from == null ? '' : (row[c.from] ?? '')))),
    });
    close();
  };
  return (
    <Dialog
      title="Columns"
      icon={<Columns3 className="gc-dialog-icon" />}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save columns
          </button>
        </>
      }
    >
      <p className="muted gc-stock-dialog-note">
        Columns named <strong>Sequence</strong>, <strong>Length</strong>, <strong>GC %</strong> and <strong>Tm</strong> are filled in from the
        sequence. Removing a column removes what it holds.
      </p>
      <div className="gc-stock-cols">
        {cols.map((c, i) => (
          <div key={i} className="gc-stock-col-row">
            <input
              className="input"
              value={c.name}
              aria-label={`Name of column ${i + 1}`}
              disabled={c.from === idCol}
              onChange={(e) => setCols((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))}
            />
            <button className="icon-btn icon-btn-sm" title="Move up" aria-label={`Move ${c.name} up`} disabled={i <= 1} onClick={() => move(i, -1)}>
              <ArrowUp />
            </button>
            <button
              className="icon-btn icon-btn-sm"
              title="Move down"
              aria-label={`Move ${c.name} down`}
              disabled={i === 0 || i === cols.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown />
            </button>
            <button
              className="icon-btn icon-btn-sm"
              title="Remove column"
              aria-label={`Remove ${c.name}`}
              disabled={c.from === idCol}
              onClick={() => setCols((x) => x.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </button>
          </div>
        ))}
      </div>
      <form
        className="gc-stock-col-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          className="input"
          value={adding}
          placeholder="New column, e.g. Supplier"
          aria-label="New column"
          onChange={(e) => setAdding(e.target.value)}
        />
        <button className="btn" type="submit" disabled={!adding.trim()}>
          <Plus /> Add column
        </button>
      </form>
    </Dialog>
  );
}

// ───────────── One row ─────────────

interface RowProps {
  row: string[];
  index: number;
  roles: ColumnRole[];
  columns: string[];
  selected: boolean;
  flash: boolean;
  onEdit: (index: number, col: number, value: string) => void;
  onSelect: (id: string) => void;
  onKey: (e: KeyboardEvent<HTMLInputElement>, index: number, col: number) => void;
  onPaste: (e: ClipboardEvent<HTMLInputElement>, index: number, col: number) => void;
  onMenu: (e: React.MouseEvent, index: number) => void;
}

const StockRow = memo(function StockRow({ row, index, roles, columns, selected, flash, onEdit, onSelect, onKey, onPaste, onMenu }: RowProps) {
  const shown = withComputed(row, roles);
  const id = row[roles.indexOf('id')] ?? '';
  const name = row[roles.indexOf('name')] || id;
  return (
    <tr className={`${selected ? 'is-selected' : ''} ${flash ? 'is-flash' : ''}`} data-stock={id} onContextMenu={(e) => onMenu(e, index)}>
      {roles.map((role, c) => {
        if (role === 'id')
          return (
            <td key={c} className="col-id">
              <button className="id-chip gc-stock-id" title="Show everything about this stock" onClick={() => onSelect(id)}>
                {id || '—'}
              </button>
            </td>
          );
        if (isComputed(role))
          return (
            <td key={c} className="col-computed" title={COMPUTED_HELP[role]}>
              {shown[c] || <span className="gc-stock-none">—</span>}
            </td>
          );
        return (
          <td key={c} className={`col-${role}`}>
            <input
              className={role === 'sequence' ? 'mono' : undefined}
              data-cell={`${index}:${c}`}
              value={row[c] ?? ''}
              spellCheck={role === 'notes' || role === 'text'}
              aria-label={`${columns[c]} of ${name}`}
              onChange={(e) => onEdit(index, c, e.target.value)}
              onFocus={() => onSelect('')}
              onKeyDown={(e) => onKey(e, index, c)}
              onPaste={(e) => onPaste(e, index, c)}
            />
          </td>
        );
      })}
    </tr>
  );
});

// ───────────── Details ─────────────

function StockDetail({
  meta,
  table,
  index,
  close,
  remove,
}: {
  meta: DocMeta;
  table: StockTable;
  index: number;
  close: () => void;
  remove: () => void;
}) {
  const docs = useNotebook((s) => s.docs);
  const roles = columnRoles(table.columns);
  const row = withComputed(table.rows[index], roles);
  const id = row[roles.indexOf('id')] ?? '';
  const name = row[roles.indexOf('name')] ?? '';
  const usedIn = useMemo(() => Object.values(docs).filter((d) => d.kind !== 'stocks' && d.refs?.includes(id)), [docs, id]);
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied.`);
    } catch {
      toast('Could not copy to the clipboard.', 'error');
    }
  };
  return (
    <aside className="gc-stock-detail" aria-label={`${id} ${name}`}>
      <header className="gc-stock-detail-head">
        <span className="gc-stock-detail-icon">{stockIcon(meta.extra.stock)}</span>
        <div>
          <span className="id-chip">{id}</span>
          <h2>{name || 'Unnamed'}</h2>
          <span className="muted">{meta.title}</span>
        </div>
        <button className="icon-btn" aria-label="Close the details" onClick={close}>
          <X />
        </button>
      </header>
      <dl className="gc-stock-fields">
        {table.columns.map((col, c) => {
          const role = roles[c];
          if (role === 'id' || role === 'name') return null;
          const value = row[c] ?? '';
          return (
            <div key={c} className={`gc-stock-field is-${role}`}>
              <dt title={COMPUTED_HELP[role]}>{col}</dt>
              <dd>
                {role === 'sequence' && value ? (
                  <>
                    <code className="gc-stock-seq">{value}</code>
                    <button className="btn btn-sm" onClick={() => void copy(value, 'Sequence')}>
                      <Copy /> Copy sequence
                    </button>
                  </>
                ) : value ? (
                  value
                ) : (
                  <span className="gc-stock-none">—</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <section className="gc-stock-used">
        <h3>Used in</h3>
        {usedIn.length ? (
          usedIn.map((d) => (
            <button key={d.path} className="gc-stock-used-item" onClick={() => navigate({ name: 'doc', path: d.path })}>
              <FileText />
              {d.id && <span className="id-chip">{d.id}</span>}
              <span className="gc-stock-used-title">{d.title}</span>
            </button>
          ))
        ) : (
          <p className="muted">
            Not linked from any entry yet. In an entry, type <kbd>/</kbd> and choose <em>Stock</em> to link it.
          </p>
        )}
      </section>
      <footer className="gc-stock-detail-foot">
        <button className="btn btn-sm" onClick={() => void copy(id, 'ID')}>
          <Hash /> Copy ID
        </button>
        <button className="btn btn-sm gc-stock-delete" onClick={remove}>
          <Trash2 /> Delete
        </button>
      </footer>
    </aside>
  );
}

// ───────────── One collection ─────────────

function Collection({ meta, target }: { meta: DocMeta; target?: string }) {
  const type = collectionType(meta);
  const prefix = collectionPrefix(meta);
  const path = meta.path;
  const [table, setTable] = useState<StockTable | null>(null);
  const tableRef = useRef<StockTable | null>(null);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(target ?? null);
  const [flash, setFlash] = useState<string | null>(null);
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { body } = await readDoc(path);
    const t = parseStockTable(body, type.columns);
    tableRef.current = t;
    setTable(t);
    return body;
  }, [path, type.columns]);

  // A collection that is being created has no file yet (mtime 0): wait for it.
  const written = meta.mtime > 0;
  useEffect(() => {
    if (!written) return;
    let alive = true;
    let unregister = () => {};
    load()
      .then((body) => {
        if (!alive) return;
        unregister = registerOpenDoc(
          path,
          () => writeStockTable(tableRef.current ?? parseStockTable(body, type.columns)),
          () => void load().catch(() => undefined),
          body,
        );
      })
      .catch((err: Error) => alive && toast(`Could not open ${meta.title}: ${err.message}`, 'error'));
    return () => {
      alive = false;
      void flushWrite(path).finally(() => unregister());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, written]);

  // Opened from a link: pick the stock out.
  useEffect(() => {
    if (!target || !table) return;
    setSelected(target);
    setFlash(target);
    requestAnimationFrame(() => rootRef.current?.querySelector(`tr[data-stock="${CSS.escape(target)}"]`)?.scrollIntoView({ block: 'center' }));
    const t = setTimeout(() => setFlash(null), 2400);
    return () => clearTimeout(t);
  }, [target, table === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = useCallback(
    (fn: (t: StockTable) => StockTable) => {
      if (!tableRef.current) return;
      const next = fn(tableRef.current);
      tableRef.current = next;
      setTable(next);
      touchDoc(path);
    },
    [path],
  );

  const roles = useMemo(() => (table ? columnRoles(table.columns) : []), [table]);
  const idCol = roles.indexOf('id');
  const editable = useMemo(() => roles.map((r, i) => (r !== 'id' && !isComputed(r) ? i : -1)).filter((i) => i >= 0), [roles]);

  const focusCell = (r: number, c: number) =>
    requestAnimationFrame(() => {
      const el = rootRef.current?.querySelector<HTMLInputElement>(`[data-cell="${r}:${c}"]`);
      el?.focus();
      el?.select();
    });

  const newRow = (t: StockTable, ids: string[]) => {
    const row = t.columns.map(() => '');
    if (idCol >= 0) row[idCol] = nextStockId(prefix, ids);
    return row;
  };

  const addRow = (focusCol?: number) => {
    const t = tableRef.current;
    if (!t) return;
    const ids = t.rows.map((r) => r[idCol] ?? '');
    const at = t.rows.length;
    change((x) => ({ ...x, rows: [...x.rows, newRow(x, ids)] }));
    setQ('');
    setSort(null);
    focusCell(at, focusCol ?? editable[0] ?? 0);
  };

  const onEdit = useCallback(
    (index: number, col: number, value: string) =>
      change((t) => ({ ...t, rows: t.rows.map((r, i) => (i === index ? r.map((v, c) => (c === col ? value : v)) : r)) })),
    [change],
  );

  const removeRow = (index: number) => {
    const t = tableRef.current;
    if (!t) return;
    const row = t.rows[index];
    change((x) => ({ ...x, rows: x.rows.filter((_, i) => i !== index) }));
    setSelected(null);
    toast(`Deleted ${row[idCol] || 'the row'}.`, 'info', {
      label: 'Undo',
      run: () => change((x) => ({ ...x, rows: [...x.rows.slice(0, index), row, ...x.rows.slice(index)] })),
    });
  };

  const select = useCallback(
    (id: string) => {
      if (!id) return;
      setSelected(id);
      navigate({ name: 'stocks', path, id }, { replace: true });
    },
    [path],
  );

  const view = useMemo(() => {
    if (!table) return [];
    const s = q.trim().toLowerCase();
    const items = table.rows.map((row, i) => ({ row, i, shown: withComputed(row, roles) }));
    const filtered = s ? items.filter((x) => x.shown.some((v) => v.toLowerCase().includes(s))) : items;
    if (!sort) return filtered;
    return [...filtered].sort((a, b) => (a.shown[sort.col] ?? '').localeCompare(b.shown[sort.col] ?? '', undefined, { numeric: true }) * sort.dir);
  }, [table, q, roles, sort]);

  const onKey = useCallback(
    (e: KeyboardEvent<HTMLInputElement>, index: number, col: number) => {
      const pos = view.findIndex((v) => v.i === index);
      if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.altKey)) {
        e.preventDefault();
        if (pos < view.length - 1) focusCell(view[pos + 1].i, col);
        else if (e.key === 'Enter') addRow(col);
      } else if (e.key === 'ArrowUp' && pos > 0) {
        e.preventDefault();
        focusCell(view[pos - 1].i, col);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view],
  );

  /** Rows copied from Excel fill the cells from here on, adding stocks as needed. */
  const onPaste = useCallback(
    (e: ClipboardEvent<HTMLInputElement>, index: number, col: number) => {
      const text = e.clipboardData.getData('text/plain');
      if (!/[\t\n]/.test(text.trim())) return;
      e.preventDefault();
      const cells = parseDelimited(text.replace(/\n$/, ''), '\t');
      const start = editable.indexOf(col);
      let added = 0;
      change((t) => {
        const rows = [...t.rows];
        const ids = rows.map((r) => r[idCol] ?? '');
        cells.forEach((line, k) => {
          let row = rows[index + k];
          if (!row) {
            row = newRow(t, ids);
            ids.push(row[idCol] ?? '');
            added++;
          } else row = [...row];
          line.forEach((v, j) => {
            const c = editable[start + j];
            if (c != null) row[c] = v.trim();
          });
          rows[index + k] = row;
        });
        return { ...t, rows };
      });
      toast(`Pasted ${cells.length} ${cells.length === 1 ? 'row' : 'rows'}${added ? `, ${added} new` : ''}.`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [change, editable, idCol],
  );

  const importCsv = async () => {
    const [f] = await pickFiles({ accept: '.csv,.tsv,.txt' });
    if (!f || !tableRef.current) return;
    const text = await f.text();
    const [header = [], ...lines] = parseDelimited(text, sniffDelimiter(text)).filter((r) => r.some((c) => c.trim()));
    let added = 0;
    change((t) => {
      const columns = [...t.columns];
      const map = header.map((h) => {
        const i = columns.findIndex((c) => c.trim().toLowerCase() === h.trim().toLowerCase());
        if (i >= 0) return i;
        columns.push(h.trim());
        return columns.length - 1;
      });
      const rows = t.rows.map((r) => [...r, ...columns.slice(r.length).map(() => '')]);
      const ids = rows.map((r) => r[idCol] ?? '');
      for (const line of lines) {
        const row = columns.map(() => '');
        line.forEach((v, j) => (row[map[j]] = v.trim()));
        if (idCol >= 0 && (!STOCK_ID_RE.test(row[idCol]) || ids.includes(row[idCol]))) row[idCol] = nextStockId(prefix, ids);
        ids.push(row[idCol]);
        rows.push(row);
        added++;
      }
      return { ...t, columns, rows };
    });
    toast(`Imported ${added} ${added === 1 ? type.item : type.name.toLowerCase()}.`, 'success');
  };

  const exportCsv = () => {
    const t = tableRef.current;
    if (!t) return;
    const csv = toDelimited([t.columns, ...t.rows.map((r) => withComputed(r, roles))], ',');
    downloadBlob(new Blob([csv], { type: 'text/csv' }), `${meta.title}.csv`);
  };

  const menu = (): MenuItemSpec[] => [
    {
      label: 'Rename…',
      icon: <Pencil />,
      onSelect: () =>
        void promptDialog({ title: 'Rename collection', label: 'Name', defaultValue: meta.title }).then(async (n) => {
          if (n && n.trim() !== meta.title)
            navigate({ name: 'stocks', path: await renameStockCollection(path, n), id: selected ?? undefined }, { replace: true });
        }),
    },
    {
      label: 'ID prefix…',
      icon: <Hash />,
      onSelect: () =>
        void promptDialog({
          title: 'ID prefix',
          label: 'New stocks are numbered with',
          defaultValue: prefix,
          hint: 'Existing IDs stay as they are, so links to them keep working.',
        }).then((p) => {
          const next = p
            ?.trim()
            .toUpperCase()
            .replace(/[^A-Z0-9-]/g, '');
          if (next) patchMeta(path, { extra: { ...meta.extra, prefix: next } });
        }),
    },
    {
      label: 'Columns…',
      icon: <Columns3 />,
      onSelect: () =>
        tableRef.current && openDialog((close) => <ColumnsDialog table={tableRef.current!} close={close} onSave={(t) => change(() => t)} />),
    },
    'sep',
    { label: 'Import CSV / TSV…', icon: <FileUp />, onSelect: () => void importCsv() },
    { label: 'Export as CSV', icon: <Download />, onSelect: exportCsv },
    { label: 'Version history…', icon: <FileClock />, onSelect: () => openVersionHistory(path) },
    'sep',
    {
      label: 'Delete collection',
      icon: <Trash2 />,
      danger: true,
      onSelect: () =>
        void confirmDialog({
          title: `Delete ${meta.title}?`,
          message: 'The collection moves to the notebook’s trash. Links to its stocks will stop working.',
          confirmLabel: 'Delete collection',
          danger: true,
        }).then(async (ok) => {
          if (!ok) return;
          await trashDoc(path);
          navigate({ name: 'stocks' }, { replace: true });
        }),
    },
  ];

  const onMenu = useCallback(
    (e: React.MouseEvent, index: number) => {
      if ((e.target as HTMLElement).closest('input')) return;
      const id = tableRef.current?.rows[index]?.[idCol] ?? '';
      openContextMenu(e, [
        { label: 'Show details', icon: <TestTube />, onSelect: () => select(id) },
        { label: 'Delete', icon: <Trash2 />, danger: true, onSelect: () => removeRow(index) },
      ]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idCol, select],
  );

  const closeDetail = () => {
    setSelected(null);
    navigate({ name: 'stocks', path }, { replace: true });
  };

  if (!table) return <div className="gc-stock-loading" />;
  const selIndex = selected ? table.rows.findIndex((r) => r[idCol] === selected) : -1;
  const width = table.columns.reduce((sum, c, i) => sum + columnWidth(roles[i], c), 0);

  return (
    <div ref={rootRef} className={`gc-stock-body ${selIndex >= 0 ? 'has-detail' : ''}`}>
      <div className="gc-stock-main">
        <div className="gc-table-tools">
          <label className="gc-filter">
            <Search />
            <input
              value={q}
              placeholder={`Filter ${meta.title.toLowerCase()}…`}
              aria-label={`Filter ${meta.title}`}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <span className="muted gc-stock-count">
            {q.trim() ? `${view.length} of ${table.rows.length}` : `${table.rows.length} ${table.rows.length === 1 ? type.item : 'stocks'}`}
          </span>
          <span className="spacer" />
          <span className="gc-stock-actions">
            <button
              className="btn btn-sm"
              onClick={() => openDialog((close) => <ColumnsDialog table={tableRef.current!} close={close} onSave={(t) => change(() => t)} />)}
            >
              <Columns3 /> <span className="gc-btn-label">Columns</span>
            </button>
            <MenuButton items={menu} className="icon-btn" title={`${meta.title} options`}>
              <MoreHorizontal />
            </MenuButton>
          </span>
        </div>
        <div className="gc-stock-scroll">
          <table className="gc-stock-table" style={{ minWidth: width }}>
            <colgroup>
              {table.columns.map((c, i) => (
                <col key={i} style={{ width: columnWidth(roles[i], c) }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {table.columns.map((c, i) => (
                  <th key={i} className={`col-${isComputed(roles[i]) ? 'computed' : roles[i]}`} title={COMPUTED_HELP[roles[i]]}>
                    <button
                      className="gc-th-btn"
                      onClick={() => setSort((s) => (s?.col === i ? (s.dir === 1 ? { col: i, dir: -1 } : null) : { col: i, dir: 1 }))}
                    >
                      {c}
                      {sort?.col === i && (sort.dir === 1 ? <ArrowUp /> : <ArrowDown />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.map(({ row, i }) => (
                <StockRow
                  key={row[idCol] || i}
                  row={row}
                  index={i}
                  roles={roles}
                  columns={table.columns}
                  selected={row[idCol] === selected}
                  flash={row[idCol] === flash}
                  onEdit={onEdit}
                  onSelect={select}
                  onKey={onKey}
                  onPaste={onPaste}
                  onMenu={onMenu}
                />
              ))}
            </tbody>
          </table>
          {view.length === 0 && (
            <div className="gc-stock-empty">
              {table.rows.length ? (
                'No stocks match the filter.'
              ) : (
                <>
                  <span>No {type.name.toLowerCase()} yet.</span>
                  <span className="muted">Add them one by one, paste rows from Excel, or import a CSV file.</span>
                </>
              )}
            </div>
          )}
        </div>
        <button className="gc-stock-add" onClick={() => addRow()}>
          <Plus /> Add {type.item}
        </button>
      </div>
      {selIndex >= 0 && (
        <>
          <div className="gc-stock-backdrop" aria-hidden="true" onClick={closeDetail} />
          <StockDetail meta={meta} table={table} index={selIndex} close={closeDetail} remove={() => removeRow(selIndex)} />
        </>
      )}
    </div>
  );
}

// ───────────── The page ─────────────

export function StocksPage({ path, id }: { path?: string; id?: string }) {
  const docs = useNotebook((s) => s.docs);
  const collections = useMemo(
    () =>
      Object.values(docs)
        .filter((d) => d.kind === 'stocks')
        .sort((a, b) => a.title.localeCompare(b.title)),
    [docs],
  );
  const current = (path && docs[path]?.kind === 'stocks' ? docs[path] : null) ?? collections[0] ?? null;
  const type = current ? collectionType(current) : null;

  return (
    <div className="gc-page gc-stocks-page">
      <div className="gc-topbar">
        <NavToggle />
        <span className="gc-page-icon">
          <TestTubes />
        </span>
        <span className="gc-topbar-title">Stocks</span>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={openNewCollectionDialog} aria-label="New collection">
          <Plus /> <span className="gc-btn-label">New collection</span>
        </button>
      </div>
      <div className="gc-folder-inner gc-stocks-inner">
        <header className="gc-page-head">
          <div className="gc-eyebrow">Inventory</div>
          <h1 className="gc-page-title">Stocks</h1>
          <p className="gc-lede">Primers, plasmids, glycerol stocks, seeds… one table per collection, linked from the entries that use them.</p>
        </header>
        {!current ? (
          <div className="empty-state">
            <TestTubes />
            <h3>No stock collections yet</h3>
            <p>Keep track of your primers, plasmids, glycerol stocks or seeds, and link them from your entries.</p>
            <div className="gc-empty-actions">
              <button className="btn btn-primary" onClick={openNewCollectionDialog}>
                <Plus /> New collection
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="gc-stock-tabs" role="tablist" aria-label="Collections">
              {collections.map((c) => (
                <button
                  key={c.path}
                  role="tab"
                  aria-selected={c.path === current.path}
                  className={`gc-stock-tab ${c.path === current.path ? 'active' : ''}`}
                  onClick={() => navigate({ name: 'stocks', path: c.path })}
                >
                  {stockIcon(c.extra.stock)}
                  <span>{c.title}</span>
                  <span className="gc-stock-tab-count">{c.stockItems?.length ?? 0}</span>
                </button>
              ))}
              <button className="gc-stock-tab is-new" onClick={openNewCollectionDialog}>
                <Plus /> <span>New collection</span>
              </button>
            </div>
            {type && (
              <p className="muted gc-stock-about">
                {stockIcon(current.extra.stock)}
                <span>
                  {type.description} Link a stock from an entry with <kbd>/</kbd> → <em>Stock</em>.
                </span>
              </p>
            )}
            <Collection key={current.path} meta={current} target={current.path === path ? id : undefined} />
          </>
        )}
      </div>
    </div>
  );
}
