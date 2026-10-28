/**
 * Protocols: the lab's reference methods (SOPs), stored in Protocols/ as "P-0001 Title.md".
 * Entries, templates and tasks link them in their "Protocols" field; links in the text count too.
 */
import type { Editor } from '@tiptap/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookMarked,
  BookOpen,
  CheckSquare,
  Copy,
  FilePlus2,
  FileText,
  FileType2,
  FileUp,
  History,
  LayoutTemplate,
  Link2,
  MoreHorizontal,
  NotebookPen,
  PanelRight,
  Plus,
  Puzzle,
  Search,
  Trash2,
} from 'lucide-react';
import { getState, navigate, setState, toast, useNotebook } from '../notebook/store';
import {
  createProtocol,
  duplicateDoc,
  linkProtocols,
  patchMeta,
  protocolCopy,
  readDoc,
  releaseVersion,
  savePdfProtocol,
  trashDoc,
} from '../notebook/actions';
import { LAYOUT, PROTOCOL_STATUSES, backlinksOf, nextVersion, type DocMeta } from '../notebook/model';
import { parseMarkdown } from '../markdown/parse';
import type { DocContextValue } from '../editor/context';
import { insertBlocks } from '../editor/insertion';
import { Dialog, MenuButton, confirmDialog, openContextMenu, openDialog, type MenuItemSpec } from './overlay';
import { AutoTextarea, Prop, TagInput } from './fields';
import { OptionSelect, StatusPill, TagPill, statusOf } from './status';
import { EntryPicker } from './pickers';
import { openNewEntryDialog } from './NewEntryDialog';
import { basename, dirname, relative } from '../lib/path';
import { PdfBatchDialog, PdfPicker, conversionSummary, isPdf, pickPdfs, useConvertedPdf, useFileDrop } from './pdfImport';
import { openSourcePane, sourcePathOf } from './PdfView';
import { formatDate, formatRelative } from '../lib/dates';
import type { JSONContent } from '@tiptap/core';
import { NavToggle } from './nav';

export function protocolsById(docs: Record<string, DocMeta>): Map<string, DocMeta> {
  const out = new Map<string, DocMeta>();
  for (const d of Object.values(docs)) if (d.kind === 'protocol' && d.id) out.set(d.id, d);
  return out;
}

/** Open a doc the way it is usually shown: tasks in the side panel, the rest as a page. */
export function openDocMeta(d: DocMeta) {
  if (d.kind === 'card') setState({ peek: d.path });
  else navigate({ name: 'doc', path: d.path });
}

/** Read a protocol next to the page you are on (or as a page when the side panel is busy). */
export function openProtocolSideBySide(d: DocMeta) {
  if (getState().peek) navigate({ name: 'doc', path: d.path });
  else setState({ peek: d.path });
}

export function newEntryWithProtocol(d: DocMeta) {
  openNewEntryDialog({ protocols: [d.id], copyProtocolSteps: true });
}

// ───────────── Linking ─────────────

async function createAndLink(path: string, title: string) {
  const created = await createProtocol({ title: title || 'Untitled protocol', open: false });
  const d = getState().docs[created];
  if (!d) return;
  linkProtocols(path, [d.id]);
  toast(`Protocol ${d.id} created and linked`, 'success', { label: 'Open', run: () => navigate({ name: 'doc', path: created }) });
}

export function openProtocolLinkDialog(meta: DocMeta) {
  const docs = getState().docs;
  const exclude = Object.values(docs)
    .filter((d) => d.kind === 'protocol' && meta.protocols?.includes(d.id))
    .map((d) => d.path);
  openDialog((close) => (
    <EntryPicker
      title="Link a protocol"
      kinds={['protocol']}
      close={close}
      exclude={exclude}
      placeholder="Search protocols by ID, title or tag…"
      empty="No protocols to link. Type a name to create one."
      onPick={(d) => linkProtocols(meta.path, [d.id])}
      onCreate={(title) => createAndLink(meta.path, title)}
      createLabel="New protocol"
    />
  ));
}

/** "Protocols" field of entries, templates and tasks. */
export function LinkedProtocols({ meta, readOnly }: { meta: DocMeta; readOnly: boolean }) {
  const docs = useNotebook((s) => s.docs);
  const byId = useMemo(() => protocolsById(docs), [docs]);
  const ids = meta.protocols ?? [];
  return (
    <div className="gc-tags">
      {ids.map((id) => {
        const d = byId.get(id);
        return (
          <span key={id} className="gc-link-chip is-protocol">
            <button
              onClick={() => d && openProtocolSideBySide(d)}
              title={d ? `Open “${d.title}” side by side` : 'This protocol is not in the notebook'}
              disabled={!d}
            >
              <BookOpen /> <span className="mono">{id}</span>{' '}
              {d ? <span className="gc-link-chip-title">{d.title}</span> : <span className="muted">(missing)</span>}
              {d?.version && <span className="gc-chip-version">v{d.version}</span>}
            </button>
            {!readOnly && (
              <button
                className="gc-tag-x"
                aria-label={`Remove ${id}`}
                onClick={() => patchMeta(meta.path, { protocols: ids.filter((x) => x !== id) })}
              >
                ×
              </button>
            )}
          </span>
        );
      })}
      {!readOnly && (
        <button
          className="gc-add-chip"
          onClick={() => openProtocolLinkDialog(meta)}
          title="Link a protocol"
          aria-label={ids.length ? 'Link a protocol' : undefined}
        >
          <Link2 /> {ids.length ? '' : 'Link protocol'}
        </button>
      )}
      {readOnly && !ids.length && <span className="muted">None</span>}
    </div>
  );
}

// ───────────── Backlinks ─────────────

function backlinkIcon(d: DocMeta) {
  switch (d.kind) {
    case 'template':
      return <LayoutTemplate />;
    case 'subtemplate':
      return <Puzzle />;
    case 'card':
      return <CheckSquare />;
    case 'protocol':
      return <BookOpen />;
    case 'note':
      return <NotebookPen />;
    case 'reference':
      return <BookMarked />;
    default:
      return <FileText />;
  }
}

/** Chips for the docs that link to a doc ("Used in" for protocols, "Linked from" for entries). */
export function Backlinks({ docs, emptyText }: { docs: DocMeta[]; emptyText?: string }) {
  const statuses = useNotebook((s) => s.config.entryStatuses);
  const [all, setAll] = useState(false);
  const sorted = useMemo(
    () =>
      [...docs].sort(
        (a, b) => Number(b.kind === 'entry') - Number(a.kind === 'entry') || (b.date ?? b.modified ?? '').localeCompare(a.date ?? a.modified ?? ''),
      ),
    [docs],
  );
  if (!docs.length) return <span className="muted">{emptyText ?? 'Nothing yet'}</span>;
  const shown = all ? sorted : sorted.slice(0, 8);
  return (
    <span className="gc-tags">
      {shown.map((d) => {
        const st = d.kind === 'entry' ? statusOf(statuses, d.status) : undefined;
        return (
          <button key={d.path} className="gc-backlink" onClick={() => openDocMeta(d)} title={d.path}>
            {st ? <span className={`gc-status-dot tone-${st.color}`} /> : backlinkIcon(d)}
            {d.id && d.kind !== 'template' && d.kind !== 'subtemplate' && d.kind !== 'note' && <span className="mono">{d.id}</span>}
            <span className="gc-link-chip-title">{d.title}</span>
          </button>
        );
      })}
      {sorted.length > shown.length && (
        <button className="gc-add-chip" onClick={() => setAll(true)}>
          +{sorted.length - shown.length} more
        </button>
      )}
    </span>
  );
}

// ───────────── Protocol header ─────────────

function RevisionList({ meta }: { meta: DocMeta }) {
  const [all, setAll] = useState(false);
  const revs = meta.revisions ?? [];
  if (!revs.length) return <span className="muted">No versions released yet</span>;
  const shown = all ? revs : revs.slice(0, 3);
  return (
    <ul className="gc-revisions">
      {shown.map((r) => (
        <li key={r.version + r.date}>
          <span className="pill pill-sq mono">v{r.version}</span>
          <span className="muted">{r.date ? formatDate(r.date) : ''}</span>
          {r.note && <span>{r.note}</span>}
          {r.author && <span className="muted">· {r.author}</span>}
        </li>
      ))}
      {revs.length > shown.length && (
        <li>
          <button className="gc-link-btn" onClick={() => setAll(true)}>
            Show {revs.length - shown.length} older
          </button>
        </li>
      )}
    </ul>
  );
}

export function ProtocolProps({ meta, readOnly }: { meta: DocMeta; readOnly: boolean }) {
  const docs = useNotebook((s) => s.docs);
  const usedIn = useMemo(() => backlinksOf(meta, Object.values(docs)), [docs, meta]);
  const p = meta.path;
  return (
    <div className="gc-props">
      <Prop label="Status">
        <OptionSelect
          options={PROTOCOL_STATUSES}
          value={meta.status}
          onChange={(status) => patchMeta(p, { status })}
          disabled={readOnly}
          placeholder="No status"
        />
      </Prop>
      <Prop label="Version">
        <input
          className="gc-prop-input gc-version-input mono"
          aria-label="Version"
          value={meta.version ?? ''}
          placeholder="1.0"
          disabled={readOnly}
          onChange={(e) => patchMeta(p, { version: e.target.value.trim() || undefined })}
        />
        {!readOnly && (
          <button className="btn btn-ghost btn-sm" onClick={() => openReleaseDialog(meta)} title="Record a new version and what changed">
            <History /> Release new version
          </button>
        )}
      </Prop>
      {meta.source && (
        <Prop label="Original">
          <span className="gc-link-chip gc-source-chip">
            <button onClick={() => openSourcePane(meta.path)} title="Show the original next to the protocol">
              <FileType2 /> <span className="gc-link-chip-title">{basename(sourcePathOf(meta) ?? '')}</span>
            </button>
          </span>
        </Prop>
      )}
      <Prop label="Purpose">
        <AutoTextarea
          className="gc-prop-input"
          value={meta.description ?? ''}
          placeholder="What is this protocol for?"
          disabled={readOnly}
          onChange={(v) => patchMeta(p, { description: v })}
        />
      </Prop>
      <Prop label="Tags">
        <TagInput tags={meta.tags} onChange={(tags) => patchMeta(p, { tags })} disabled={readOnly} />
      </Prop>
      <Prop label="History">
        <RevisionList meta={meta} />
      </Prop>
      <Prop label={`Used in${usedIn.length ? ` (${usedIn.length})` : ''}`}>
        <Backlinks docs={usedIn} emptyText="Not linked yet. Link it from an entry’s Protocols field, or type / → Protocol in any page." />
      </Prop>
      <Prop label="Modified">
        <span className="gc-prop-text muted" title={formatDate(meta.modified, true)}>
          {formatRelative(meta.modified)}
          {meta.author ? ` · created by ${meta.author}` : ''}
        </span>
      </Prop>
    </div>
  );
}

// ───────────── Release a version ─────────────

function ReleaseDialog({ meta, close }: { meta: DocMeta; close: () => void }) {
  const [version, setVersion] = useState(
    meta.revisions?.some((r) => r.version === meta.version) ? nextVersion(meta.version) : (meta.version ?? '1.0'),
  );
  const [note, setNote] = useState('');
  const release = () => {
    const v = version.trim();
    if (!v) return;
    releaseVersion(meta.path, v, note);
    toast(`Released ${meta.id} v${v}`, 'success');
    close();
  };
  return (
    <Dialog
      title="Release a new version"
      icon={<History className="gc-dialog-icon" />}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!version.trim()} onClick={release}>
            Release v{version.trim() || '…'}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          release();
        }}
      >
        <div className="field">
          <label htmlFor="rel-version">Version</label>
          <input id="rel-version" className="input mono" autoFocus value={version} onChange={(e) => setVersion(e.target.value)} />
          <span className="field-hint">Current version: {meta.version ? `v${meta.version}` : 'none'}.</span>
        </div>
        <div className="field">
          <label htmlFor="rel-note">What changed?</label>
          <textarea
            id="rel-note"
            className="textarea"
            rows={3}
            value={note}
            placeholder="e.g. Longer extension time for fragments over 3 kb"
            onChange={(e) => setNote(e.target.value)}
          />
          <span className="field-hint">
            The change is listed in the protocol’s history. Entries that copied the steps keep the version they used.
          </span>
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

export function openReleaseDialog(meta: DocMeta) {
  openDialog((close) => <ReleaseDialog meta={meta} close={close} />);
}

// ───────────── New protocol ─────────────

type Start = 'outline' | 'blank' | 'entry' | 'pdf';

function NewProtocolDialog({
  close,
  initialTitle = '',
  initialFile = null,
}: {
  close: () => void;
  initialTitle?: string;
  initialFile?: File | null;
}) {
  const docs = useNotebook((s) => s.docs);
  const entries = useMemo(
    () =>
      Object.values(docs)
        .filter((d) => d.kind === 'entry')
        .sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? ''))
        .slice(0, 200),
    [docs],
  );
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [start, setStart] = useState<Start>(initialFile ? 'pdf' : 'outline');
  const [entry, setEntry] = useState(entries[0]?.path ?? '');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(initialFile);
  const pdf = useConvertedPdf(start === 'pdf' ? file : null);
  // Fill in the name and purpose found in the PDF, unless they were typed.
  const auto = useRef({ title: initialTitle, description: '' });
  useEffect(() => {
    if (!pdf.conv) return;
    if (!title.trim() || title === auto.current.title) setTitle((auto.current.title = pdf.conv.title));
    if (pdf.conv.description && (!description.trim() || description === auto.current.description))
      setDescription((auto.current.description = pdf.conv.description));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf.conv]);
  const ready = start !== 'pdf' || !!pdf.conv;

  const create = async () => {
    setBusy(true);
    try {
      if (start === 'pdf') {
        if (!file || !pdf.conv) return;
        const res = await savePdfProtocol(file, pdf.conv, { title, description, tags });
        toast(
          res.scanned
            ? 'Protocol created from a scanned PDF: its pages were added as images.'
            : `Protocol created from the PDF (${conversionSummary(res.stats)}). Compare it with the original before using it.`,
          'success',
        );
        close();
        return;
      }
      let content: JSONContent | undefined;
      let sourceFolder: string | undefined;
      if (start === 'entry' && entry) {
        const { body } = await readDoc(entry);
        content = parseMarkdown(body).toJSON() as JSONContent;
        sourceFolder = dirname(entry);
      }
      await createProtocol({ title, description, tags, content, sourceFolder, outline: start === 'outline' });
      close();
    } catch (err) {
      toast(`Could not create the protocol: ${(err as Error).message}`, 'error');
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="New protocol"
      icon={<BookOpen className="gc-dialog-icon" />}
      onClose={close}
      wide
      className="gc-create-dialog"
      footer={
        <>
          <span className="muted gc-footer-hint">Saved as a Markdown file in {LAYOUT.protocols}/</span>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !title.trim() || !ready} onClick={() => void create()}>
            {start === 'pdf' && file && !pdf.conv && !pdf.error ? 'Converting…' : 'Create protocol'}
          </button>
        </>
      }
    >
      <div className="gc-create-grid">
        <form
          className="gc-create-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim() && ready) void create();
          }}
        >
          <div className="field">
            <label htmlFor="np-title">Name</label>
            <input
              id="np-title"
              className="input"
              autoFocus
              value={title}
              placeholder="e.g. Western blot transfer (wet)"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="np-desc">Purpose (optional)</label>
            <input
              id="np-desc"
              className="input"
              value={description}
              placeholder="e.g. Transfer proteins from an SDS-PAGE gel to PVDF"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="field">
            <span className="field-label">Tags (optional)</span>
            <TagInput tags={tags} onChange={setTags} />
          </div>
          <fieldset className="gc-choice-group">
            <legend className="field-label">Start from</legend>
            <label className={`gc-choice ${start === 'outline' ? 'active' : ''}`}>
              <input type="radio" name="np-start" checked={start === 'outline'} onChange={() => setStart('outline')} />
              <span>
                <strong>Standard outline</strong>
                <small>Purpose, materials table, numbered procedure, notes and safety</small>
              </span>
            </label>
            <label className={`gc-choice ${start === 'blank' ? 'active' : ''}`}>
              <input type="radio" name="np-start" checked={start === 'blank'} onChange={() => setStart('blank')} />
              <span>
                <strong>Blank page</strong>
                <small>Write it from scratch, or paste it from a document</small>
              </span>
            </label>
            <label className={`gc-choice ${start === 'entry' ? 'active' : ''} ${entries.length ? '' : 'is-disabled'}`}>
              <input type="radio" name="np-start" disabled={!entries.length} checked={start === 'entry'} onChange={() => setStart('entry')} />
              <span>
                <strong>Copy of an entry</strong>
                <small>Turn a method you wrote in an entry into a protocol (its files are copied too)</small>
              </span>
            </label>
            {start === 'entry' && (
              <select className="select gc-choice-extra" aria-label="Entry to copy" value={entry} onChange={(e) => setEntry(e.target.value)}>
                {entries.map((d) => (
                  <option key={d.path} value={d.path}>
                    {d.id} {d.title}
                  </option>
                ))}
              </select>
            )}
            <label className={`gc-choice ${start === 'pdf' ? 'active' : ''}`}>
              <input type="radio" name="np-start" checked={start === 'pdf'} onChange={() => setStart('pdf')} />
              <span>
                <strong>From a PDF</strong>
                <small>Convert a vendor protocol, kit handbook or SOP into an editable protocol. The PDF is kept with it.</small>
              </span>
            </label>
            {start === 'pdf' && (
              <div className="gc-choice-extra">
                <PdfPicker file={file} onFile={setFile} state={pdf} />
              </div>
            )}
          </fieldset>
          <button type="submit" hidden />
        </form>
        {start === 'pdf' ? (
          <aside className="gc-help-panel" aria-label="About converting PDFs">
            <h3>
              <FileType2 /> From PDF to protocol
            </h3>
            <ol className="gc-help-steps">
              <li>
                <strong>The text becomes editable</strong>: headings, numbered steps (with sub-steps), bullet lists, tables, bold and italic, super-
                and subscripts, and links. Two-column layouts are read column by column.
              </li>
              <li>
                <strong>Tables become spreadsheet tables</strong>, so you can add volumes or formulas, e.g. <code>=B2*4</code>.
              </li>
              <li>
                <strong>Figures are saved as images</strong> where they appear. Page headers, footers and page numbers are left out.
              </li>
              <li>
                <strong>The PDF is kept</strong> next to the protocol: open it side by side to check the conversion, then set the status to{' '}
                <em>Active</em>.
              </li>
            </ol>
            <p className="gc-help-note">
              Scanned PDFs have no text to convert: their pages are added as images. Everything happens in your browser; the PDF is not uploaded
              anywhere.
            </p>
          </aside>
        ) : (
          <aside className="gc-help-panel" aria-label="Tips for writing protocols">
            <h3>
              <BookOpen /> Good protocols
            </h3>
            <ol className="gc-help-steps">
              <li>
                <strong>One method per protocol</strong>, written so that a colleague could follow it without asking you.
              </li>
              <li>
                <strong>List the materials</strong> with amounts and catalogue numbers. Tables can calculate, e.g. <code>=B2*4</code>.
              </li>
              <li>
                <strong>Number the steps</strong> and give times, temperatures, speeds and volumes.
              </li>
              <li>
                <strong>Link it where you use it</strong>: in an entry’s <em>Protocols</em> field, in a template (new entries inherit it), or anywhere
                in the text with <kbd>/</kbd> → <em>Protocol</em>.
              </li>
              <li>
                <strong>Release a new version</strong> when you change it, and note what changed. Lock it when it is approved.
              </li>
            </ol>
            <p className="gc-help-note">
              Not the same as a sub-template: a sub-template is a block that is copied into entries (with values to fill in); a protocol is a
              reference that entries link to.
            </p>
          </aside>
        )}
      </div>
    </Dialog>
  );
}

export function openNewProtocolDialog(opts: { title?: string; file?: File } = {}) {
  openDialog((close) => <NewProtocolDialog close={close} initialTitle={opts.title} initialFile={opts.file ?? null} />);
}

/** Import PDFs as protocols: one opens the New protocol dialog (to review the name), several are imported in a row. */
export function importPdfs(files: File[]) {
  const pdfs = files.filter(isPdf);
  if (!pdfs.length) {
    if (files.length) toast('Only PDF files can be imported as protocols.', 'error');
    return;
  }
  if (pdfs.length < files.length) toast(`${files.length - pdfs.length} file(s) skipped: not PDFs.`, 'info');
  if (pdfs.length === 1) openNewProtocolDialog({ file: pdfs[0] });
  else openDialog((close) => <PdfBatchDialog files={pdfs} close={close} />);
}

export async function pickAndImportPdfs() {
  importPdfs(await pickPdfs());
}

// ───────────── "/ → Protocol" in the editor ─────────────

async function insertProtocol(editor: Editor, ctx: DocContextValue, d: DocMeta, mode: 'link' | 'copy') {
  if (mode === 'link') {
    editor
      .chain()
      .focus()
      .insertContent([
        { type: 'text', text: [d.id, d.title].filter(Boolean).join(' '), marks: [{ type: 'link', attrs: { href: relative(ctx.folder, d.path) } }] },
        { type: 'text', text: ' ' },
      ])
      .run();
  } else {
    const json = await protocolCopy(d.path, { folder: ctx.folder, id: ctx.docId });
    insertBlocks(editor, json.content ?? []);
  }
  linkProtocols(ctx.path, [d.id]);
}

function ProtocolInsertDialog({ close, editor, ctx }: { close: () => void; editor: Editor; ctx: DocContextValue }) {
  const [mode, setMode] = useState<'link' | 'copy'>('link');
  const tracks = ctx.kind !== 'protocol';
  return (
    <EntryPicker
      title="Protocol"
      kinds={['protocol']}
      close={close}
      exclude={[ctx.path]}
      placeholder="Search protocols…"
      empty="No protocols yet. Type a name to create one."
      header={
        <div className="gc-picker-mode">
          <div className="gc-segmented">
            <button className={mode === 'link' ? 'active' : ''} onClick={() => setMode('link')}>
              Link to it
            </button>
            <button className={mode === 'copy' ? 'active' : ''} onClick={() => setMode('copy')}>
              Insert a copy of its steps
            </button>
          </div>
          <span className="field-hint">
            {mode === 'link'
              ? 'Adds a link at the cursor.'
              : 'Copies the protocol here so you can tick off steps and note changes. The original is not modified.'}
            {tracks ? ' The protocol is also added to this page’s Protocols field.' : ''}
          </span>
        </div>
      }
      onPick={(d) => void insertProtocol(editor, ctx, d, mode)}
      onCreate={async (title) => {
        const created = await createProtocol({ title: title || 'Untitled protocol', open: false });
        const d = getState().docs[created];
        if (!d) return;
        await insertProtocol(editor, ctx, d, 'link');
        toast(`Protocol ${d.id} created`, 'success', { label: 'Open', run: () => navigate({ name: 'doc', path: created }) });
      }}
      createLabel="New protocol"
    />
  );
}

export function openProtocolPicker(editor: Editor, ctx: DocContextValue) {
  openDialog((close) => <ProtocolInsertDialog close={close} editor={editor} ctx={ctx} />);
}

// ───────────── Menus ─────────────

export function protocolMenu(d: DocMeta): MenuItemSpec[] {
  return [
    { label: 'Open', icon: <FileText />, onSelect: () => navigate({ name: 'doc', path: d.path }) },
    { label: 'Open in side panel', icon: <PanelRight />, onSelect: () => setState({ peek: d.path }) },
    { label: 'New entry with this protocol', icon: <FilePlus2 />, onSelect: () => newEntryWithProtocol(d) },
    { label: 'Duplicate', icon: <Copy />, onSelect: () => void duplicateDoc(d.path) },
    'sep',
    {
      label: 'Move to trash',
      icon: <Trash2 />,
      danger: true,
      onSelect: () => {
        const used = backlinksOf(d, Object.values(getState().docs)).length;
        void confirmDialog({
          title: 'Move protocol to trash?',
          message: used
            ? `“${d.title}” is linked from ${used} page${used > 1 ? 's' : ''}. Those links will show it as missing.`
            : `“${d.title}” will be moved to the trash, where you can restore it.`,
          confirmLabel: 'Move to trash',
          danger: true,
        }).then((ok) => {
          if (ok) void trashDoc(d.path);
        });
      },
    },
  ];
}

// ───────────── Protocols page ─────────────

type SortKey = 'id' | 'title' | 'version' | 'status' | 'used' | 'modified';

export function ProtocolsPage() {
  const docs = useNotebook((s) => s.docs);
  const all = useMemo(() => Object.values(docs), [docs]);
  const protocols = useMemo(() => all.filter((d) => d.kind === 'protocol'), [all]);
  const usage = useMemo(() => new Map(protocols.map((p) => [p.path, backlinksOf(p, all).length])), [protocols, all]);
  const tags = useMemo(() => [...new Set(protocols.flatMap((p) => p.tags))].sort((a, b) => a.localeCompare(b)), [protocols]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'title', dir: 1 });

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const filtered = protocols.filter(
      (d) =>
        (!statusFilter || d.status === statusFilter) &&
        (!tagFilter || d.tags.includes(tagFilter)) &&
        (!s || `${d.id} ${d.title} ${d.tags.join(' ')} ${d.description ?? ''} ${d.text}`.toLowerCase().includes(s)),
    );
    const val = (d: DocMeta): string => {
      switch (sort.key) {
        case 'id':
          return d.id;
        case 'version':
          return d.version ?? '';
        case 'status':
          return String(PROTOCOL_STATUSES.findIndex((x) => x.id === d.status)).padStart(3, '0');
        case 'used':
          return String(usage.get(d.path) ?? 0).padStart(6, '0');
        case 'modified':
          return d.modified ?? '';
        default:
          return d.title.toLowerCase();
      }
    };
    return filtered.sort((a, b) => val(a).localeCompare(val(b), undefined, { numeric: true }) * sort.dir);
  }, [protocols, q, statusFilter, tagFilter, sort, usage]);

  const head = (key: SortKey, label: string, cls = '') => (
    <th className={cls}>
      <button
        className="gc-th-btn"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'modified' || key === 'used' ? -1 : 1 }))}
      >
        {label}
        {sort.key === key && (sort.dir === 1 ? <ArrowUp /> : <ArrowDown />)}
      </button>
    </th>
  );

  const drop = useFileDrop(importPdfs);

  return (
    <div className={`gc-page gc-protocols-page ${drop.over ? 'is-drop-target' : ''}`} {...drop.props}>
      {drop.over && (
        <div className="gc-drop-overlay" aria-hidden="true">
          <FileUp />
          <strong>Drop PDFs to import them as protocols</strong>
        </div>
      )}
      <div className="gc-topbar">
        <NavToggle />
        <span className="gc-page-icon">
          <BookOpen />
        </span>
        <span className="gc-topbar-title">Protocols</span>
        <span className="spacer" />
        <button
          className="btn btn-sm"
          onClick={() => void pickAndImportPdfs()}
          title="Convert PDF protocols into editable protocols"
          aria-label="Import PDF"
        >
          <FileUp /> <span className="gc-btn-label">Import PDF</span>
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => openNewProtocolDialog()}>
          <Plus /> New protocol
        </button>
      </div>
      <div className="gc-folder-inner">
        <header className="gc-page-head">
          <h1 className="gc-page-title">Protocols</h1>
          <p className="gc-lede">Your lab’s reference methods, versioned, and linked from every entry that follows them.</p>
        </header>
        <div className="gc-explainer">
          <div>
            <BookOpen />
            <strong>Protocols</strong> are your lab’s reference methods (SOPs): one Markdown file each in <code>{LAYOUT.protocols}/</code>, with a
            version, a status and a history of changes.
          </div>
          <div>
            <Link2 />
            <strong>Link them</strong> from an entry’s <em>Protocols</em> field or with <code>/</code> → <em>Protocol</em>. Link them in a template
            and every new entry from it is linked too. Click a linked protocol to read it side by side.
          </div>
          <div>
            <History />
            <strong>Version them</strong>: <em>Release new version</em> records what changed. Entries can keep a copy of the steps they followed, and
            each protocol lists where it is used.
          </div>
          <div>
            <FileUp />
            <strong>Import PDFs</strong>: vendor protocols and kit handbooks become editable protocols, with their steps, tables and figures. Drop
            them here or use <em>Import PDF</em>.
          </div>
        </div>
        <div className="gc-table-tools">
          <label className="gc-filter">
            <Search />
            <input value={q} placeholder="Filter protocols…" onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="gc-status-filters">
            <button className={`pill ${statusFilter === null ? 'is-selected' : 'gc-pill-empty'}`} onClick={() => setStatusFilter(null)}>
              All {protocols.length}
            </button>
            {PROTOCOL_STATUSES.map((s) => (
              <button
                key={s.id}
                className={`pill ${statusFilter === s.id ? `tone-${s.color}` : 'gc-pill-empty'}`}
                onClick={() => setStatusFilter(statusFilter === s.id ? null : s.id)}
              >
                {s.name} {protocols.filter((p) => p.status === s.id).length}
              </button>
            ))}
          </div>
          {tags.length > 0 && (
            <select
              className="select gc-tag-filter"
              aria-label="Filter by tag"
              value={tagFilter ?? ''}
              onChange={(e) => setTagFilter(e.target.value || null)}
            >
              <option value="">All tags</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">
            <BookOpen />
            <h3>{protocols.length ? 'No matching protocols' : 'No protocols yet'}</h3>
            {!protocols.length && (
              <>
                <p>
                  Write your lab’s methods once, then link them from your entries. You can also import PDFs, or turn an entry into a protocol from its
                  ⋯ menu.
                </p>
                <div className="gc-empty-actions">
                  <button className="btn btn-primary" onClick={() => openNewProtocolDialog()}>
                    <Plus /> New protocol
                  </button>
                  <button className="btn" onClick={() => void pickAndImportPdfs()}>
                    <FileUp /> Import PDF
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <table className="gc-table gc-protocol-table">
            <thead>
              <tr>
                {head('id', 'ID', 'col-id')}
                {head('title', 'Protocol')}
                {head('version', 'Version', 'col-version')}
                {head('status', 'Status', 'col-status')}
                <th className="col-tags">Tags</th>
                {head('used', 'Used in', 'col-used')}
                {head('modified', 'Modified', 'col-mod')}
                <th className="col-menu" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.path} onClick={() => navigate({ name: 'doc', path: d.path })} onContextMenu={(e) => openContextMenu(e, protocolMenu(d))}>
                  <td className="col-id">
                    <span className="id-chip">{d.id}</span>
                  </td>
                  <td className="col-title">
                    <span className="gc-cell-title">
                      {d.title}
                      {d.source && (
                        <span className="gc-pdf-badge" title={`Imported from ${basename(d.source)}`}>
                          PDF
                        </span>
                      )}
                    </span>
                    {d.description && <span className="gc-cell-sub">{d.description}</span>}
                  </td>
                  <td className="col-version mono">{d.version ? `v${d.version}` : ''}</td>
                  <td className="col-status">
                    <StatusPill status={statusOf(PROTOCOL_STATUSES, d.status)} />
                  </td>
                  <td className="col-tags">
                    <span className="gc-tags">
                      {d.tags.slice(0, 3).map((t) => (
                        <TagPill key={t} tag={t} />
                      ))}
                    </span>
                  </td>
                  <td className="col-used muted">{usage.get(d.path) || '—'}</td>
                  <td className="col-mod muted">{formatRelative(d.modified)}</td>
                  <td className="col-menu" onClick={(e) => e.stopPropagation()}>
                    <MenuButton items={() => protocolMenu(d)} className="icon-btn icon-btn-sm" title="Protocol options">
                      <MoreHorizontal />
                    </MenuButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
