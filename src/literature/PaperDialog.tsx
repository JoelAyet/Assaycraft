import { useEffect, useMemo, useRef, useState } from 'react';
import { BookMarked, FileUp, Loader2, Search } from 'lucide-react';
import { Dialog, openDialog } from '../ui/overlay';
import { navigate, toast } from '../notebook/store';
import { createReference, findReference, importReferences, patchMeta, syncFileName } from '../notebook/actions';
import type { DocMeta } from '../notebook/model';
import { normalizeAuthor, parseIdentifier, parseReferences, refExtra, refFromMeta, shortCitation, type RefInfo } from './model';
import { lookupReference } from './lookup';

interface Form {
  title: string;
  authors: string;
  year: string;
  journal: string;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
  pmid: string;
  url: string;
}

const EMPTY: Form = { title: '', authors: '', year: '', journal: '', volume: '', issue: '', pages: '', doi: '', pmid: '', url: '' };

function formOf(info: RefInfo): Form {
  return {
    title: info.title,
    authors: info.authors.join('\n'),
    year: info.year ?? '',
    journal: info.journal ?? '',
    volume: info.volume ?? '',
    issue: info.issue ?? '',
    pages: info.pages ?? '',
    doi: info.doi ?? '',
    pmid: info.pmid ?? '',
    url: info.url ?? '',
  };
}

function infoOf(f: Form): RefInfo {
  const t = (s: string) => s.trim() || undefined;
  return {
    title: f.title.replace(/\s+/g, ' ').trim(),
    authors: f.authors.split(/\n|;/).map(normalizeAuthor).filter(Boolean),
    year: t(f.year),
    journal: t(f.journal),
    volume: t(f.volume),
    issue: t(f.issue),
    pages: t(f.pages)?.replace(/(\d)\s*-+\s*(\d)/, '$1–$2'),
    doi: t(f.doi)?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''),
    pmid: t(f.pmid),
    url: t(f.url),
  };
}

interface Props {
  close: () => void;
  /** Editing the details of a paper already in the library. */
  edit?: DocMeta;
  /** Called with the paper added (or the one already in the library), e.g. to cite it. */
  onAdded?: (path: string) => void;
  /** Start on "Paste BibTeX or RIS" with this text. */
  pasted?: string;
  /** What was typed before (in the cite picker): a DOI or PubMed ID is looked up, other text becomes the title. */
  query?: string;
}

function PaperDialog({ close, edit, onAdded, pasted, query: typed = '' }: Props) {
  const typedId = !!parseIdentifier(typed);
  const [mode, setMode] = useState<'lookup' | 'paste'>(pasted !== undefined ? 'paste' : 'lookup');
  const [form, setForm] = useState<Form>(edit ? formOf(refFromMeta(edit)) : typed && !typedId ? { ...EMPTY, title: typed } : EMPTY);
  const [query, setQuery] = useState(typedId ? typed : '');
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState('');
  const [abstract, setAbstract] = useState('');
  const [keepAbstract, setKeepAbstract] = useState(true);
  const [busy, setBusy] = useState(false);
  const [bib, setBib] = useState(pasted ?? '');
  const fileInput = useRef<HTMLInputElement>(null);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const info = useMemo(() => infoOf(form), [form]);
  const duplicate = useMemo(() => {
    if (edit || (!info.title && !info.doi && !info.pmid)) return undefined;
    return findReference(info);
  }, [info, edit]);
  const parsed = useMemo(() => (mode === 'paste' && bib.trim() ? parseReferences(bib) : []), [mode, bib]);

  const lookup = async () => {
    if (!query.trim() || looking) return;
    setLooking(true);
    setError('');
    try {
      const found = await lookupReference(query);
      setForm(formOf(found));
      setAbstract(found.abstract ?? '');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLooking(false);
    }
  };

  // A DOI or PubMed ID typed in the cite picker is looked up straight away.
  useEffect(() => {
    if (typedId) void lookup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = (path: string) => {
    close();
    if (onAdded) onAdded(path);
  };

  const save = async () => {
    if (!info.title || busy) return;
    setBusy(true);
    try {
      if (edit) {
        patchMeta(edit.path, { title: info.title, extra: { ...edit.extra, ...refExtra(info) } }, 0);
        if (info.title !== edit.title) await syncFileName(edit.path);
        close();
        return;
      }
      const path = await createReference({ ...info, abstract: keepAbstract && abstract ? abstract : undefined });
      done(path);
      if (!onAdded) toast(`Added ${shortCitation(info)}`, 'success', { label: 'Open', run: () => navigate({ name: 'doc', path }) });
    } catch (err) {
      toast(`Could not save the paper: ${(err as Error).message}`, 'error');
      setBusy(false);
    }
  };

  const importAll = async () => {
    if (!parsed.length || busy) return;
    setBusy(true);
    try {
      const { added, skipped } = await importReferences(parsed);
      close();
      const n = (k: number) => `${k} paper${k === 1 ? '' : 's'}`;
      toast(
        added.length
          ? `Imported ${n(added.length)}${skipped ? ` (${n(skipped)} already in your library)` : ''}`
          : `All ${n(skipped)} are already in your library`,
        'success',
      );
      if (onAdded && added.length) onAdded(added[0]);
    } catch (err) {
      toast(`Could not import: ${(err as Error).message}`, 'error');
      setBusy(false);
    }
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setBib(await file.text());
  };

  const field = (k: keyof Form, label: string, opts: { placeholder?: string; span?: 2 | 3 | 4; mono?: boolean } = {}) => (
    <div className={`field ${opts.span ? `gc-paper-span${opts.span}` : ''}`}>
      <label htmlFor={`paper-${k}`}>{label}</label>
      <input id={`paper-${k}`} className={`input ${opts.mono ? 'mono' : ''}`} value={form[k]} placeholder={opts.placeholder} onChange={set(k)} />
    </div>
  );

  return (
    <Dialog
      title={edit ? 'Edit paper details' : 'Add a paper'}
      icon={<BookMarked className="gc-dialog-icon" />}
      onClose={close}
      wide
      className="gc-paper-dialog"
      footer={
        <>
          <span className="muted gc-footer-hint">Saved as a Markdown file in Literature</span>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          {mode === 'paste' && !edit ? (
            <button className="btn btn-primary" disabled={!parsed.length || busy} onClick={() => void importAll()}>
              {parsed.length > 1 ? `Import ${parsed.length} papers` : 'Import paper'}
            </button>
          ) : (
            <button className="btn btn-primary" disabled={!info.title || busy} onClick={() => void save()}>
              {edit ? 'Save' : 'Add paper'}
            </button>
          )}
        </>
      }
    >
      {!edit && (
        <div className="gc-segmented" role="tablist" aria-label="How to add">
          <button role="tab" aria-selected={mode === 'lookup'} className={mode === 'lookup' ? 'active' : ''} onClick={() => setMode('lookup')}>
            DOI or PubMed ID
          </button>
          <button role="tab" aria-selected={mode === 'paste'} className={mode === 'paste' ? 'active' : ''} onClick={() => setMode('paste')}>
            BibTeX or RIS
          </button>
        </div>
      )}
      {mode === 'paste' && !edit ? (
        <div className="gc-paper-paste">
          <div className="field">
            <label htmlFor="paper-bib">Paste references</label>
            <textarea
              id="paper-bib"
              className="textarea mono"
              rows={9}
              autoFocus
              value={bib}
              placeholder={
                '@article{Jinek2012,\n  title = {A programmable dual-RNA–guided DNA endonuclease…},\n  author = {Jinek, Martin and Chylinski, Krzysztof and …},\n  …\n}'
              }
              onChange={(e) => setBib(e.target.value)}
            />
            <span className="field-hint">
              Export them from Zotero, Mendeley, EndNote or Google Scholar (BibTeX .bib or RIS .ris), or use a journal’s “Download citation”.
            </span>
          </div>
          <div className="gc-paper-paste-tools">
            <button className="btn btn-sm" onClick={() => fileInput.current?.click()}>
              <FileUp /> Choose a file…
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".bib,.ris,.txt,.bibtex"
              hidden
              onChange={(e) => {
                void readFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            {bib.trim() && (
              <span className={parsed.length ? 'muted' : 'gc-paper-error'} role="status">
                {parsed.length
                  ? `${parsed.length} paper${parsed.length === 1 ? '' : 's'}: ${parsed
                      .slice(0, 3)
                      .map((p) => shortCitation(p))
                      .join(' · ')}${parsed.length > 3 ? ' …' : ''}`
                  : 'No references found in this text.'}
              </span>
            )}
          </div>
        </div>
      ) : (
        <>
          {!edit && (
            <form
              className="gc-paper-lookup"
              onSubmit={(e) => {
                e.preventDefault();
                void lookup();
              }}
            >
              <input
                className="input gc-paper-query"
                autoFocus
                value={query}
                aria-label="DOI or PubMed ID"
                placeholder="DOI or PubMed ID"
                onChange={(e) => setQuery(e.target.value)}
              />
              <button className="btn" type="submit" disabled={!query.trim() || looking}>
                {looking ? <Loader2 className="gc-spin" /> : <Search />} Look up
              </button>
            </form>
          )}
          {!edit && (
            <p className={error ? 'gc-paper-error' : 'field-hint gc-paper-note'} role={error ? 'alert' : undefined}>
              {error || 'Such as 10.1126/science.1225829 or 22745249. Only this is sent, to Crossref or PubMed. Or fill in the details by hand.'}
            </p>
          )}
          {duplicate && (
            <div className="gc-paper-dup" role="status">
              <span>
                Already in your library as <strong>{shortCitation(refFromMeta(duplicate))}</strong>.
              </span>
              <button
                className="btn btn-sm"
                onClick={() => {
                  if (onAdded) done(duplicate.path);
                  else {
                    close();
                    navigate({ name: 'doc', path: duplicate.path });
                  }
                }}
              >
                {onAdded ? 'Use that one' : 'Open it'}
              </button>
            </div>
          )}
          <div className="gc-paper-form">
            <div className="field gc-paper-wide">
              <label htmlFor="paper-title">Title</label>
              <textarea id="paper-title" className="textarea gc-paper-title" rows={2} value={form.title} onChange={set('title')} />
            </div>
            <div className="field gc-paper-wide">
              <label htmlFor="paper-authors">Authors</label>
              <textarea
                id="paper-authors"
                className="textarea"
                // Tall enough for every author (up to ten lines, then it scrolls).
                rows={Math.min(10, Math.max(3, form.authors.split('\n').length))}
                value={form.authors}
                placeholder={'One per line: Jinek, Martin\nChylinski, Krzysztof'}
                onChange={set('authors')}
              />
            </div>
            {field('journal', 'Journal', { span: 3 })}
            {field('year', 'Year')}
            {field('volume', 'Volume')}
            {field('issue', 'Issue')}
            {field('pages', 'Pages', { span: 2 })}
            {field('doi', 'DOI', { span: 2, mono: true })}
            {field('pmid', 'PubMed ID', { span: 2, mono: true })}
            {field('url', 'Link', { span: 4, placeholder: 'https://…' })}
          </div>
          {abstract && !edit && (
            <label className="checkbox gc-paper-abstract">
              <input type="checkbox" checked={keepAbstract} onChange={(e) => setKeepAbstract(e.target.checked)} />
              Add the abstract to the paper’s page
            </label>
          )}
        </>
      )}
    </Dialog>
  );
}

export function openPaperDialog(opts: Omit<Props, 'close'> = {}) {
  openDialog((close) => <PaperDialog close={close} {...opts} />);
}
