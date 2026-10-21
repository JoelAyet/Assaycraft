import { useMemo, useState } from 'react';
import { BookMarked, Download, FileUp, MoreHorizontal, Plus, Quote, Search, Trash2 } from 'lucide-react';
import { navigate, toast, useNotebook } from '../notebook/store';
import { trashDoc } from '../notebook/actions';
import { backlinksOf, type DocMeta } from '../notebook/model';
import { MenuButton, confirmDialog } from '../ui/overlay';
import { TagPill } from '../ui/status';
import { NavToggle } from '../ui/nav';
import { downloadBlob } from '../lib/download';
import { fullCitation, refFromMeta, shortCitation, toBibtex } from './model';
import { openPaperDialog } from './PaperDialog';

/** What a paper's row shows and is searched by. */
interface Row {
  doc: DocMeta;
  cite: string;
  authors: string;
  where: string;
  citedIn: number;
  hay: string;
}

function copy(text: string, what: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast(`${what} copied`, 'success'),
    () => toast('Could not copy (the browser did not allow it)', 'error'),
  );
}

export function bibtexOf(docs: DocMeta[]): string {
  return docs.map((d) => toBibtex(refFromMeta(d), d.id)).join('\n');
}

function PaperRow({ row }: { row: Row }) {
  const { doc } = row;
  const info = refFromMeta(doc);
  return (
    <div className="gc-note-row gc-paper-row">
      <button className="gc-note-open" onClick={() => navigate({ name: 'doc', path: doc.path })}>
        <span className="gc-paper-cite">{row.cite}</span>
        <span className="gc-note-main">
          <strong>{doc.title}</strong>
          <span className="gc-note-snippet">{[row.authors, row.where].filter(Boolean).join(' · ')}</span>
        </span>
      </button>
      <span className="gc-note-side">
        {doc.tags.map((t) => (
          <TagPill key={t} tag={t} />
        ))}
        <span className="muted gc-note-edited" title="Entries and notes that cite this paper">
          {row.citedIn ? `cited in ${row.citedIn}` : 'not cited yet'}
        </span>
        <MenuButton
          className="icon-btn icon-btn-sm"
          title="Paper options"
          items={[
            { label: 'Copy citation', icon: <Quote />, onSelect: () => copy(fullCitation(info), 'Citation') },
            { label: 'Copy BibTeX', icon: <BookMarked />, onSelect: () => copy(toBibtex(info, doc.id), 'BibTeX') },
            'sep',
            {
              label: 'Move to trash',
              icon: <Trash2 />,
              danger: true,
              onSelect: () =>
                void confirmDialog({
                  title: 'Move to trash?',
                  message: `“${doc.title}” will be moved to the trash, where you can restore it. Citations of it in your entries stay as they are.`,
                  confirmLabel: 'Move to trash',
                  danger: true,
                }).then((ok) => {
                  if (ok) void trashDoc(doc.path);
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

export function LiteraturePage() {
  const docs = useNotebook((s) => s.docs);
  const rows = useMemo<Row[]>(() => {
    const all = Object.values(docs);
    return all
      .filter((d) => d.kind === 'reference')
      .map((doc) => {
        const info = refFromMeta(doc);
        const names = info.authors.map((a) => a.split(',')[0].trim());
        const authors = names.length > 4 ? `${names.slice(0, 3).join(', ')} … ${names[names.length - 1]}` : names.join(', ');
        const where = [info.journal, info.year].filter(Boolean).join(', ');
        return {
          doc,
          cite: shortCitation(info),
          authors,
          where,
          citedIn: backlinksOf(doc, all).length,
          hay: `${doc.id} ${doc.title} ${info.authors.join(' ')} ${where} ${info.doi ?? ''} ${info.pmid ?? ''} ${doc.tags.join(' ')} ${doc.text}`.toLowerCase(),
        };
      })
      .sort((a, b) => a.cite.localeCompare(b.cite) || a.doc.title.localeCompare(b.doc.title));
  }, [docs]);
  const tags = useMemo(() => [...new Set(rows.flatMap((r) => r.doc.tags))].sort((a, b) => a.localeCompare(b)), [rows]);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const shown = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((r) => (!tag || r.doc.tags.includes(tag)) && terms.every((t) => r.hay.includes(t)));
  }, [rows, q, tag]);

  const exportBib = () => {
    const list = shown.length ? shown : rows;
    downloadBlob(new Blob([bibtexOf(list.map((r) => r.doc))], { type: 'application/x-bibtex' }), 'Literature.bib');
  };

  return (
    <div className="gc-page gc-notes-page gc-literature-page">
      <div className="gc-topbar">
        <NavToggle />
        <span className="gc-page-icon">
          <BookMarked />
        </span>
        <span className="gc-topbar-title">Literature</span>
        <span className="spacer" />
        {rows.length > 0 && (
          <MenuButton
            className="icon-btn"
            title="Literature options"
            placement="bottom-end"
            items={[
              { label: 'Import BibTeX or RIS…', icon: <FileUp />, onSelect: () => openPaperDialog({ pasted: '' }) },
              {
                label: q || tag ? `Export ${shown.length === 1 ? 'this paper' : `these ${shown.length} papers`} as BibTeX` : 'Export all as BibTeX',
                icon: <Download />,
                onSelect: exportBib,
              },
            ]}
          >
            <MoreHorizontal />
          </MenuButton>
        )}
        <button className="btn btn-primary btn-sm" onClick={() => openPaperDialog()}>
          <Plus /> Add paper
        </button>
      </div>
      <div className="gc-folder-inner gc-notes-inner">
        <header className="gc-page-head">
          <div className="gc-eyebrow">Library</div>
          <h1 className="gc-page-title">Literature</h1>
          <p className="gc-lede">
            The papers you read and use. Add one by DOI or PubMed ID, keep reading notes on its page, and cite it from any entry or note with{' '}
            <kbd>/</kbd> → Cite a paper.
          </p>
        </header>
        {rows.length > 0 && (
          <div className="gc-table-tools">
            <label className="gc-filter">
              <Search />
              <input value={q} placeholder="Filter papers…" aria-label="Filter papers" onChange={(e) => setQ(e.target.value)} />
            </label>
            {tags.length > 0 && (
              <div className="gc-status-filters">
                <button className={`pill ${tag === null ? 'is-selected' : 'gc-pill-empty'}`} onClick={() => setTag(null)}>
                  All {rows.length}
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
        {shown.length > 0 && (
          <div className="gc-notes-list gc-papers-list" aria-label="Papers">
            {shown.map((r) => (
              <PaperRow key={r.doc.path} row={r} />
            ))}
          </div>
        )}
        {rows.length > 0 && !shown.length && <p className="muted gc-notes-none">No papers match.</p>}
        {!rows.length && (
          <div className="empty-state gc-notes-empty">
            <BookMarked />
            <h3>No papers yet</h3>
            <p>Add papers by DOI or PubMed ID, or import a BibTeX or RIS file from Zotero, Mendeley or EndNote.</p>
            <span className="gc-empty-actions">
              <button className="btn btn-primary" onClick={() => openPaperDialog()}>
                <Plus /> Add paper
              </button>
              <button className="btn" onClick={() => openPaperDialog({ pasted: '' })}>
                <FileUp /> Import BibTeX or RIS
              </button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
