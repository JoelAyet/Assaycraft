import type { Editor } from '@tiptap/core';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BookMarked, BookOpen, CheckSquare, FileText, Link2, Plus, Puzzle, Search, LayoutTemplate } from 'lucide-react';
import { Dialog, openDialog } from './overlay';
import { useNotebook } from '../notebook/store';
import { materializeTemplate, templateVariables } from '../notebook/actions';
import { PROTOCOL_STATUSES, type DocMeta } from '../notebook/model';
import type { DocContextValue } from '../editor/context';
import type { TemplateVariable } from '../templates/engine';
import { relative } from '../lib/path';
import { formatRelative } from '../lib/dates';
import { insertBlocks } from '../editor/insertion';
import { refFromMeta, shortCitation } from '../literature/model';
import { openPaperDialog } from '../literature/PaperDialog';

export function VariableFields({
  variables,
  values,
  onChange,
}: {
  variables: TemplateVariable[];
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  if (!variables.length) return null;
  return (
    <div className="gc-vars">
      <div className="field-label">Fill in the template</div>
      <div className="gc-vars-grid">
        {variables.map((v) => (
          <label key={v.name} className="gc-var">
            <span>{v.name}</span>
            <input
              className="input"
              value={values[v.name] ?? ''}
              placeholder={v.defaultValue || '—'}
              onChange={(e) => onChange({ ...values, [v.name]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <span className="field-hint">Empty fields use the default shown, or stay as {'{{placeholders}}'} you can fill later.</span>
    </div>
  );
}

/** A paper is also found by its authors, journal and year. */
function refWords(d: DocMeta): string {
  if (d.kind !== 'reference') return '';
  const info = refFromMeta(d);
  return `${shortCitation(info)} ${info.authors.join(' ')} ${info.journal ?? ''} ${info.year ?? ''} ${info.doi ?? ''}`;
}

function useFilter<T extends DocMeta>(items: T[], q: string) {
  return useMemo(() => {
    // Every word typed must match somewhere ("doudna 2012").
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return items;
    return items.filter((d) => {
      const hay = `${d.id} ${d.title} ${d.tags.join(' ')} ${d.description ?? ''} ${refWords(d)}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [items, q]);
}

// ───────────── Sub-template picker ─────────────

function SubtemplatePicker({ close, editor, ctx }: { close: () => void; editor: Editor; ctx: DocContextValue }) {
  const docs = useNotebook((s) => s.docs);
  const inTemplate = ctx.kind === 'template' || ctx.kind === 'subtemplate';
  const all = useMemo(
    () =>
      Object.values(docs)
        .filter((d) => (d.kind === 'subtemplate' || d.kind === 'template') && d.path !== ctx.path)
        .sort((a, b) => (a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind === 'subtemplate' ? -1 : 1)),
    [docs, ctx.path],
  );
  const [q, setQ] = useState('');
  const list = useFilter(all, q);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<'reference' | 'copy'>(inTemplate ? 'reference' : 'copy');
  const [chosen, setChosen] = useState<DocMeta | null>(null);
  const [vars, setVars] = useState<TemplateVariable[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const insertCopy = async (d: DocMeta, vals: Record<string, string> | null) => {
    setBusy(true);
    try {
      const title = useNotebook.getState().docs[ctx.path]?.title ?? '';
      const json = await materializeTemplate(d.path, vals, { folder: ctx.folder, id: ctx.docId, title });
      insertBlocks(editor, json.content ?? []);
      close();
    } finally {
      setBusy(false);
    }
  };

  const choose = async (d: DocMeta) => {
    if (inTemplate && mode === 'reference') {
      insertBlocks(editor, { type: 'include', attrs: { ref: d.id, name: d.title } });
      close();
      return;
    }
    if (inTemplate) return insertCopy(d, null);
    const { variables } = await templateVariables(d.path);
    if (!variables.length) return insertCopy(d, {});
    setChosen(d);
    setVars(variables);
    setValues({});
  };

  if (chosen) {
    return (
      <Dialog
        title={`Insert “${chosen.title}”`}
        icon={<Puzzle className="gc-dialog-icon" />}
        onClose={close}
        footer={
          <>
            <button className="btn" onClick={() => setChosen(null)}>
              Back
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={() => void insertCopy(chosen, values)}>
              Insert
            </button>
          </>
        }
      >
        <VariableFields variables={vars} values={values} onChange={setValues} />
      </Dialog>
    );
  }

  return (
    <Dialog title="Insert a sub-template" icon={<Puzzle className="gc-dialog-icon" />} onClose={close}>
      <div className="gc-picker-search">
        <Search />
        <input
          className="input"
          autoFocus
          placeholder="Search sub-templates…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setIndex((i) => Math.min(list.length - 1, i + 1));
            if (e.key === 'ArrowUp') setIndex((i) => Math.max(0, i - 1));
            if (e.key === 'Enter' && list[index]) void choose(list[index]);
          }}
        />
      </div>
      {inTemplate && (
        <div className="gc-segmented">
          <button className={mode === 'reference' ? 'active' : ''} onClick={() => setMode('reference')}>
            Linked (stays in sync)
          </button>
          <button className={mode === 'copy' ? 'active' : ''} onClick={() => setMode('copy')}>
            Copy (edit freely)
          </button>
        </div>
      )}
      <div className="gc-picker-list">
        {list.length === 0 && (
          <div className="empty-state">No sub-templates yet. Create one from the Templates page or save a selection as a sub-template.</div>
        )}
        {list.map((d, i) => (
          <button
            key={d.path}
            className={`gc-picker-item ${i === index ? 'active' : ''}`}
            onMouseEnter={() => setIndex(i)}
            onClick={() => void choose(d)}
          >
            {d.kind === 'subtemplate' ? <Puzzle /> : <LayoutTemplate />}
            <span className="gc-picker-main">
              <span className="gc-picker-title">
                <span className="gc-picker-name">{d.title}</span>
              </span>
              {d.description && <span className="gc-picker-desc">{d.description}</span>}
            </span>
            <span className="pill pill-sq">{d.kind === 'subtemplate' ? 'sub-template' : 'template'}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

export function openSubtemplatePicker(editor: Editor, ctx: DocContextValue) {
  openDialog((close) => <SubtemplatePicker close={close} editor={editor} ctx={ctx} />);
}

// ───────────── Entry picker (links, moving, linking cards and protocols) ─────────────

function pickerIcon(d: DocMeta) {
  if (d.kind === 'protocol') return <BookOpen />;
  if (d.kind === 'card') return <CheckSquare />;
  if (d.kind === 'reference') return <BookMarked />;
  return <FileText />;
}

function pickerDesc(d: DocMeta): string {
  if (d.kind === 'protocol') {
    const status = PROTOCOL_STATUSES.find((s) => s.id === d.status)?.name;
    return [d.version && `v${d.version}`, status, d.description].filter(Boolean).join(' · ');
  }
  if (d.kind === 'reference') {
    const info = refFromMeta(d);
    return [shortCitation(info), info.journal].filter(Boolean).join(' · ');
  }
  return d.path.split('/').slice(1, -1).join(' / ');
}

export function EntryPicker({
  title,
  onPick,
  close,
  exclude,
  kinds = ['entry'],
  header,
  placeholder = 'Search by ID, title or tag…',
  empty = 'Nothing found',
  onCreate,
  createLabel = 'Create',
}: {
  title: string;
  onPick: (d: DocMeta) => void;
  close: () => void;
  exclude?: string[];
  kinds?: DocMeta['kind'][];
  /** Shown above the list (e.g. a mode switch). */
  header?: ReactNode;
  placeholder?: string;
  empty?: ReactNode;
  /** Offer to create a new doc named after the search text. */
  onCreate?: (title: string) => void | Promise<void>;
  createLabel?: string;
}) {
  const docs = useNotebook((s) => s.docs);
  const all = useMemo(
    () =>
      Object.values(docs)
        .filter((d) => kinds.includes(d.kind) && !exclude?.includes(d.path))
        .sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? '')),
    [docs, exclude, kinds],
  );
  const [q, setQ] = useState('');
  const list = useFilter(all, q).slice(0, 80);
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('.gc-picker-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  const create = onCreate
    ? () => {
        close();
        void onCreate(q.trim());
      }
    : undefined;
  return (
    <Dialog title={title} icon={<Link2 className="gc-dialog-icon" />} onClose={close}>
      <div className="gc-picker-search">
        <Search />
        <input
          className="input"
          autoFocus
          placeholder={placeholder}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setIndex((i) => Math.min(list.length - 1, i + 1));
            if (e.key === 'ArrowUp') setIndex((i) => Math.max(0, i - 1));
            if (e.key === 'Enter') {
              if (list[index]) {
                onPick(list[index]);
                close();
              } else if (create && q.trim()) create();
            }
          }}
        />
      </div>
      {header}
      <div className="gc-picker-list" ref={listRef}>
        {list.length === 0 && <div className="empty-state">{all.length && q.trim() ? `Nothing matches “${q.trim()}”.` : empty}</div>}
        {list.map((d, i) => (
          <button
            key={d.path}
            className={`gc-picker-item ${i === index ? 'active' : ''}`}
            onMouseEnter={() => setIndex(i)}
            onClick={() => {
              onPick(d);
              close();
            }}
          >
            {pickerIcon(d)}
            <span className="gc-picker-main">
              <span className="gc-picker-title">
                {d.id && <span className="id-chip">{d.id}</span>} <span className="gc-picker-name">{d.title}</span>
              </span>
              <span className="gc-picker-desc">{pickerDesc(d)}</span>
            </span>
            <span className="muted gc-picker-when">{formatRelative(d.modified)}</span>
          </button>
        ))}
      </div>
      {create && (
        <button className="gc-picker-create" onClick={create}>
          <Plus /> {q.trim() ? `${createLabel} “${q.trim()}”` : `${createLabel}…`}
        </button>
      )}
    </Dialog>
  );
}

/** The picker closes after inserting, taking the focus with it: give it back so typing goes on. */
function refocusAfterDialog(editor: Editor) {
  requestAnimationFrame(() => {
    if (!editor.isDestroyed) editor.commands.focus();
  });
}

export function openEntryLinkPicker(editor: Editor, ctx: DocContextValue) {
  openDialog((close) => (
    <EntryPicker
      title="Link to an entry, task or protocol"
      close={close}
      exclude={[ctx.path]}
      kinds={['entry', 'card', 'protocol']}
      onPick={(d) => {
        const href = relative(ctx.folder, d.path);
        const text = d.id ? `${d.id} ${d.title}` : d.title;
        editor
          .chain()
          .focus()
          .insertContent([
            { type: 'text', text, marks: [{ type: 'link', attrs: { href } }] },
            { type: 'text', text: ' ' },
          ])
          .run();
        refocusAfterDialog(editor);
      }}
    />
  ));
}

/** Insert a citation: a link to the paper's page, written as "Jinek et al., 2012". */
function insertCitation(editor: Editor, ctx: DocContextValue, d: DocMeta) {
  const href = relative(ctx.folder, d.path);
  editor
    .chain()
    .focus()
    .insertContent([
      { type: 'text', text: shortCitation(refFromMeta(d)), marks: [{ type: 'link', attrs: { href } }] },
      { type: 'text', text: ' ' },
    ])
    .run();
  refocusAfterDialog(editor);
}

export function openCitePicker(editor: Editor, ctx: DocContextValue) {
  const cite = (path: string) => {
    const d = useNotebook.getState().docs[path];
    if (d) insertCitation(editor, ctx, d);
  };
  openDialog((close) => (
    <EntryPicker
      title="Cite a paper"
      close={close}
      kinds={['reference']}
      placeholder="Search by author, title, journal or year…"
      empty="No papers in your Literature yet. Add one below."
      onCreate={(q) => openPaperDialog({ onAdded: cite, query: q })}
      createLabel="Add a paper"
      onPick={(d) => insertCitation(editor, ctx, d)}
    />
  ));
}
