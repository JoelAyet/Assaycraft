import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  BookMarked,
  BookOpen,
  CalendarDays,
  CheckSquare,
  FilePlus2,
  FileText,
  FlaskConical,
  Home,
  KanbanSquare,
  LayoutTemplate,
  ListTodo,
  NotebookPen,
  Puzzle,
  Search,
  Settings,
  FileUp,
  TestTubes,
  Compass,
  Trash2,
  Smartphone,
} from 'lucide-react';
import { syncSupported } from '../sync/manager';
import { BUILTIN_EXPERIMENTS_BOARD, navigate, setState, useNotebook } from '../notebook/store';
import { boardCards, cardNoun, type DocMeta } from '../notebook/model';
import { startTour } from './Tour';
import { createCard, createNote } from '../notebook/actions';
import { openNewEntryDialog } from './NewEntryDialog';
import { openNewProtocolDialog, pickAndImportPdfs } from './protocols';
import { dirname } from '../lib/path';
import { refFromMeta, shortCitation } from '../literature/model';
import { openPaperDialog } from '../literature/PaperDialog';

/** Where a doc is, under its title: its folder, or for a paper its citation and journal. */
function whereOf(d: DocMeta): string {
  if (d.kind === 'reference') {
    const info = refFromMeta(d);
    return [shortCitation(info), info.journal].filter(Boolean).join(' · ');
  }
  return d.path.split('/').slice(0, -1).join(' / ');
}

interface Result {
  key: string;
  icon: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  run: () => void;
}

function highlight(text: string, q: string): ReactNode {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

function snippet(text: string, q: string): string | null {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return null;
  const start = Math.max(0, i - 40);
  return (start > 0 ? '…' : '') + text.slice(start, i + q.length + 60) + (i + q.length + 60 < text.length ? '…' : '');
}

function iconFor(d: DocMeta) {
  switch (d.kind) {
    case 'template':
      return <LayoutTemplate />;
    case 'subtemplate':
      return <Puzzle />;
    case 'card':
      return <CheckSquare />;
    case 'board':
      return <KanbanSquare />;
    case 'protocol':
      return <BookOpen />;
    case 'stocks':
      return <TestTubes />;
    case 'note':
      return <NotebookPen />;
    case 'reference':
      return <BookMarked />;
    default:
      return <FileText />;
  }
}

function openDoc(d: DocMeta) {
  if (d.kind === 'card') setState({ peek: d.path });
  else if (d.kind === 'board') navigate({ name: 'board', path: dirname(d.path) });
  else if (d.kind === 'stocks') navigate({ name: 'stocks', path: d.path });
  else navigate({ name: 'doc', path: d.path });
}

function Palette({ close }: { close: () => void }) {
  const docs = useNotebook((s) => s.docs);
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const boards = Object.values(docs).filter((d) => d.kind === 'board');

  const actions: Result[] = useMemo(
    () => [
      { key: 'a:new', icon: <FilePlus2 />, title: 'New entry', sub: 'Blank or from a template', run: () => openNewEntryDialog({}) },
      { key: 'a:newprot', icon: <BookOpen />, title: 'New protocol', run: () => openNewProtocolDialog() },
      { key: 'a:newnote', icon: <NotebookPen />, title: 'New note', sub: 'Meeting notes, ideas, brainstorming', run: () => void createNote() },
      { key: 'a:newpaper', icon: <BookMarked />, title: 'Add a paper', sub: 'By DOI or PubMed ID, or from BibTeX', run: () => openPaperDialog() },
      {
        key: 'a:pdf',
        icon: <FileUp />,
        title: 'Import PDF as protocol',
        sub: 'Convert PDF protocols into editable ones',
        run: () => void pickAndImportPdfs(),
      },
      ...boards.map((b) => ({
        key: 'a:task' + b.path,
        icon: boardCards(b) === 'tasks' ? <ListTodo /> : <KanbanSquare />,
        title: `New ${cardNoun(boardCards(b))} in ${b.title}`,
        run: () => void createCard(dirname(b.path), { open: true }),
      })),
      { key: 'a:home', icon: <Home />, title: 'Go to Home', run: () => navigate({ name: 'home' }) },
      { key: 'a:tour', icon: <Compass />, title: 'Take the tour', sub: 'Where things are, in a minute', run: startTour },
      { key: 'a:cal', icon: <CalendarDays />, title: 'Go to Calendar', run: () => navigate({ name: 'calendar' }) },
      {
        key: 'a:exp',
        icon: <FlaskConical />,
        title: 'Go to Experiments board',
        run: () => navigate({ name: 'board', path: BUILTIN_EXPERIMENTS_BOARD }),
      },
      { key: 'a:prot', icon: <BookOpen />, title: 'Go to Protocols', run: () => navigate({ name: 'protocols' }) },
      { key: 'a:tpl', icon: <LayoutTemplate />, title: 'Go to Templates', run: () => navigate({ name: 'templates' }) },
      { key: 'a:notes', icon: <NotebookPen />, title: 'Go to Notes', run: () => navigate({ name: 'notes' }) },
      { key: 'a:lit', icon: <BookMarked />, title: 'Go to Literature', run: () => navigate({ name: 'literature' }) },
      { key: 'a:trash', icon: <Trash2 />, title: 'Go to Trash', sub: 'Restore deleted pages and folders', run: () => navigate({ name: 'trash' }) },
      { key: 'a:set', icon: <Settings />, title: 'Settings', run: () => navigate({ name: 'settings' }) },
      ...(syncSupported()
        ? [
            {
              key: 'a:phone',
              icon: <Smartphone />,
              title: 'Connect a phone',
              sub: 'Use this notebook on your phone, in sync',
              run: () => navigate({ name: 'phone' }),
            },
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boards.length],
  );

  const results = useMemo<Result[]>(() => {
    const s = q.trim();
    const all = Object.values(docs).filter((d) => d.kind !== 'board' || true);
    if (!s) {
      const recent = all
        .filter((d) => d.kind === 'entry' || d.kind === 'card' || d.kind === 'note')
        .sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? ''))
        .slice(0, 6)
        .map((d) => ({
          key: d.path,
          icon: iconFor(d),
          title: (
            <>
              {d.id && d.kind !== 'note' && <span className="id-chip">{d.id}</span>}
              <span className="gc-pal-text-main">{d.title}</span>
            </>
          ),
          sub: whereOf(d),
          run: () => openDoc(d),
        }));
      return [...recent, ...actions];
    }
    const terms = s.toLowerCase().split(/\s+/).filter(Boolean);
    const scored: { d: DocMeta; score: number; snip: string | null }[] = [];
    for (const d of all) {
      const hasId = d.kind === 'entry' || d.kind === 'card' || d.kind === 'protocol' || d.kind === 'reference';
      const id = hasId ? d.id.toLowerCase() : '\u0000';
      const title = d.title.toLowerCase();
      // Papers are found by their authors and journal too.
      const tags = `${d.tags.join(' ')} ${d.kind === 'reference' ? whereOf(d) + ' ' + refFromMeta(d).authors.join(' ') : ''}`.toLowerCase();
      const text = d.text.toLowerCase();
      let score = 0;
      let ok = true;
      for (const t of terms) {
        if (id === t) score += 100;
        else if (id.includes(t)) score += 40;
        else if (title.startsWith(t)) score += 30;
        else if (title.includes(t)) score += 20;
        else if (tags.includes(t)) score += 12;
        else if (text.includes(t)) score += 4;
        else {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (d.kind === 'entry') score += 2;
      const inTitle = terms.every((t) => title.includes(t) || id.includes(t));
      scored.push({ d, score, snip: inTitle ? null : snippet(d.text, terms[terms.length - 1]) });
    }
    scored.sort((a, b) => b.score - a.score || (b.d.modified ?? '').localeCompare(a.d.modified ?? ''));
    // Single stocks (a primer, a glycerol stock…) open their collection with the row picked out.
    const stockHits: { score: number; result: Result }[] = [];
    for (const c of all) {
      if (c.kind !== 'stocks') continue;
      for (const item of c.stockItems ?? []) {
        const id = item.id.toLowerCase();
        const name = item.name.toLowerCase();
        const rest = item.summary.toLowerCase();
        let score = 0;
        let ok = true;
        for (const t of terms) {
          if (id === t) score += 100;
          else if (id.includes(t)) score += 40;
          else if (name.startsWith(t)) score += 30;
          else if (name.includes(t)) score += 20;
          else if (rest.includes(t)) score += 6;
          else {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        stockHits.push({
          score: score + 1,
          result: {
            key: `${c.path}#${item.id}`,
            icon: <TestTubes />,
            title: (
              <>
                <span className="id-chip">{highlight(item.id, terms[0])}</span>
                <span className="gc-pal-text-main">{highlight(item.name, terms[0])}</span>
              </>
            ),
            sub: <span>{[c.title, item.summary].filter(Boolean).join(' · ')}</span>,
            run: () => navigate({ name: 'stocks', path: c.path, id: item.id }),
          },
        });
      }
    }
    stockHits.sort((a, b) => b.score - a.score);
    const docResults = scored.slice(0, 30).map(({ d, snip }) => ({
      key: d.path,
      icon: iconFor(d),
      title: (
        <>
          {d.id && (d.kind === 'entry' || d.kind === 'card' || d.kind === 'protocol' || d.kind === 'reference') && (
            <span className="id-chip">{highlight(d.id, terms[0])}</span>
          )}
          <span className="gc-pal-text-main">{highlight(d.title, terms[0])}</span>
        </>
      ),
      sub: snip ? <span>{highlight(snip, terms[terms.length - 1])}</span> : whereOf(d),
      run: () => openDoc(d),
    }));
    const actionResults = actions.filter((a) => terms.every((t) => String(a.title).toLowerCase().includes(t)));
    // Stocks that match by ID or name come first; matches deeper in a stock follow the docs.
    const strong = stockHits.filter((h) => h.score >= 20).slice(0, 12);
    const weak = stockHits.filter((h) => h.score < 20).slice(0, 12);
    return [...strong.map((h) => h.result), ...docResults, ...weak.map((h) => h.result), ...actionResults];
  }, [q, docs, actions]);

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.gc-pal-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const run = (r: Result | undefined) => {
    if (!r) return;
    close();
    r.run();
  };

  return createPortal(
    <div
      className="dialog-backdrop gc-palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="gc-palette" role="dialog" aria-label="Search">
        <div className="gc-pal-input">
          <Search />
          <input
            autoFocus
            placeholder="Search entries, protocols, templates, tasks… or type a command"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                run(results[index]);
              } else if (e.key === 'Escape') close();
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="gc-pal-list" ref={listRef}>
          {results.length === 0 && <div className="gc-pal-empty">No results for “{q}”</div>}
          {results.map((r, i) => (
            <button key={r.key} className={`gc-pal-item ${i === index ? 'active' : ''}`} onMouseEnter={() => setIndex(i)} onClick={() => run(r)}>
              <span className="gc-pal-icon">{r.icon}</span>
              <span className="gc-pal-text">
                <span className="gc-pal-title">{r.title}</span>
                {r.sub && <span className="gc-pal-sub">{r.sub}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function CommandPalette() {
  const open = useNotebook((s) => s.paletteOpen);
  if (!open) return null;
  return <Palette close={() => setState({ paletteOpen: false })} />;
}
