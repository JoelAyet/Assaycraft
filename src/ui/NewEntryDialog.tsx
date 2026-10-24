import { useEffect, useMemo, useState } from 'react';
import { BookOpen, FilePlus2, FileText, LayoutTemplate, Link2 } from 'lucide-react';
import { Dialog, openDialog } from './overlay';
import { EntryPicker, VariableFields } from './pickers';
import { navigate, useNotebook, toast } from '../notebook/store';
import { createEntry, templateVariables } from '../notebook/actions';
import { LAYOUT } from '../notebook/model';
import { fillText, type TemplateVariable } from '../templates/engine';
import { localDate } from '../lib/dates';

const LAST_FOLDER_KEY = 'assaycraft:lastFolder';

function lastFolder(): string | null {
  try {
    return localStorage.getItem(LAST_FOLDER_KEY);
  } catch {
    return null;
  }
}

export function folderLabel(path: string) {
  const parts = path.split('/').slice(1);
  return parts.length ? parts.join(' / ') : 'Projects (top level)';
}

interface Initial {
  folder?: string;
  templatePath?: string | null;
  date?: string;
  time?: string;
  status?: string;
  /** Protocols to link to the new entry. */
  protocols?: string[];
  /** Start with "copy the protocol steps into the entry" ticked. */
  copyProtocolSteps?: boolean;
  title?: string;
  /** The dialog's title, e.g. "Start step 3". */
  heading?: string;
  /** Called with the new entry before it opens (e.g. to link it from a flow). */
  onCreated?: (path: string) => void;
}

function NewEntryDialog({ close, initial }: { close: () => void; initial: Initial }) {
  const docs = useNotebook((s) => s.docs);
  const folders = useNotebook((s) => s.folders);
  const statuses = useNotebook((s) => s.config.entryStatuses);
  const templates = useMemo(
    () =>
      Object.values(docs)
        .filter((d) => d.kind === 'template')
        .sort((a, b) => a.title.localeCompare(b.title)),
    [docs],
  );
  const [tpl, setTpl] = useState<string | null>(initial.templatePath ?? null);
  const [title, setTitle] = useState(initial.title ?? '');
  const [titleTouched, setTitleTouched] = useState(!!initial.title);
  const defaultFolder = initial.folder ?? (lastFolder() && folders.includes(lastFolder()!) ? lastFolder()! : (folders[0] ?? LAYOUT.projects));
  const [folder, setFolder] = useState(defaultFolder);
  const [date, setDate] = useState(initial.date ?? localDate());
  const [time, setTime] = useState(initial.time ?? '');
  const [status, setStatus] = useState(initial.status ?? 'in-progress');
  const [vars, setVars] = useState<TemplateVariable[]>([]);
  const [pattern, setPattern] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [protocols, setProtocols] = useState<string[]>(initial.protocols ?? []);
  const [copySteps, setCopySteps] = useState(!!initial.copyProtocolSteps);
  const [busy, setBusy] = useState(false);
  const protocolDocs = useMemo(
    () =>
      new Map(
        Object.values(docs)
          .filter((d) => d.kind === 'protocol')
          .map((d) => [d.id, d]),
      ),
    [docs],
  );

  useEffect(() => {
    let cancelled = false;
    setVars([]);
    setPattern('');
    if (!tpl) return;
    void templateVariables(tpl).then(({ variables, titlePattern }) => {
      if (cancelled) return;
      setVars(variables);
      setPattern(titlePattern);
    });
    return () => {
      cancelled = true;
    };
  }, [tpl]);

  const template = tpl ? docs[tpl] : null;
  const inherited = (template?.protocols ?? []).filter((id) => !protocols.includes(id));
  const firstProtocol = protocols.length ? protocolDocs.get(protocols[0]) : undefined;
  const suggested = useMemo(() => {
    if (!template) return firstProtocol?.title ?? '';
    if (pattern && pattern !== '{{title}}') {
      const filled = fillText(pattern, values);
      return filled.includes('{{') ? '' : filled;
    }
    return '';
  }, [template, pattern, values, firstProtocol]);

  const addProtocol = () =>
    openDialog((closePicker) => (
      <EntryPicker
        title="Link a protocol"
        kinds={['protocol']}
        close={closePicker}
        exclude={[...protocols, ...(template?.protocols ?? [])].map((id) => protocolDocs.get(id)?.path ?? '')}
        placeholder="Search protocols…"
        empty="No protocols yet. Create them on the Protocols page."
        onPick={(d) => setProtocols((cur) => (cur.includes(d.id) ? cur : [...cur, d.id]))}
      />
    ));
  const shownTitle = titleTouched ? title : suggested;

  const create = async () => {
    setBusy(true);
    try {
      try {
        localStorage.setItem(LAST_FOLDER_KEY, folder);
      } catch {
        /* ignore */
      }
      const path = await createEntry({
        folder,
        title: shownTitle || template?.title || 'Untitled experiment',
        templatePath: tpl ?? undefined,
        values,
        date,
        time,
        status,
        protocols,
        copyProtocolSteps: copySteps,
        open: !initial.onCreated,
      });
      close();
      if (initial.onCreated) {
        initial.onCreated(path);
        navigate({ name: 'doc', path });
      }
    } catch (err) {
      toast(`Could not create the entry: ${(err as Error).message}`, 'error');
      setBusy(false);
    }
  };

  const allFolders = [LAYOUT.projects, ...folders];

  return (
    <Dialog
      title={initial.heading ?? 'New entry'}
      icon={<FilePlus2 className="gc-dialog-icon" />}
      onClose={close}
      wide
      className="gc-new-entry"
      footer={
        <>
          <span className="muted gc-footer-hint">Saved as a Markdown file in {folderLabel(folder)}</span>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void create()}>
            {initial.onCreated ? 'Start' : 'Create entry'}
          </button>
        </>
      }
    >
      <div className="gc-new-entry-grid">
        <div className="gc-template-list" role="listbox" aria-label="Template">
          <button className={`gc-template-option ${tpl === null ? 'active' : ''}`} onClick={() => setTpl(null)}>
            <FileText />
            <span>
              <strong>Blank entry</strong>
              <small>Start from an empty page</small>
            </span>
          </button>
          {templates.map((t) => (
            <button key={t.path} className={`gc-template-option ${tpl === t.path ? 'active' : ''}`} onClick={() => setTpl(t.path)}>
              <LayoutTemplate />
              <span>
                <strong>{t.title}</strong>
                {t.description && <small>{t.description}</small>}
              </span>
            </button>
          ))}
          {!templates.length && <p className="muted gc-template-empty">No templates yet. Make one on the Templates page.</p>}
        </div>
        <form
          className="gc-new-entry-form"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="field">
            <label htmlFor="ne-title">Title</label>
            <input
              id="ne-title"
              className="input"
              autoFocus
              value={shownTitle}
              placeholder={template?.title ?? 'Untitled experiment'}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleTouched(true);
              }}
            />
          </div>
          <div className="gc-form-row">
            <div className="field">
              <label htmlFor="ne-folder">Project / folder</label>
              <select id="ne-folder" className="select" value={folder} onChange={(e) => setFolder(e.target.value)}>
                {allFolders.map((f) => (
                  <option key={f} value={f}>
                    {folderLabel(f)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ne-status">Status</label>
              <select id="ne-status" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ne-date">Experiment date</label>
              <input id="ne-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ne-time">Time (optional)</label>
              <input id="ne-time" type="time" className="input" value={time} step={300} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <span className="field-label">Protocols</span>
            <div className="gc-tags">
              {inherited.map((id) => (
                <span key={id} className="gc-link-chip is-protocol" title="Linked by the template">
                  <button type="button" disabled>
                    <BookOpen /> <span className="mono">{id}</span>{' '}
                    <span className="gc-link-chip-title">{protocolDocs.get(id)?.title ?? '(missing)'}</span>
                    <span className="gc-chip-version">template</span>
                  </button>
                </span>
              ))}
              {protocols.map((id) => (
                <span key={id} className="gc-link-chip is-protocol">
                  <button type="button" disabled>
                    <BookOpen /> <span className="mono">{id}</span>{' '}
                    <span className="gc-link-chip-title">{protocolDocs.get(id)?.title ?? '(missing)'}</span>
                  </button>
                  <button
                    type="button"
                    className="gc-tag-x"
                    aria-label={`Remove ${id}`}
                    onClick={() => setProtocols(protocols.filter((x) => x !== id))}
                  >
                    ×
                  </button>
                </span>
              ))}
              <button type="button" className="gc-add-chip" onClick={addProtocol}>
                <Link2 /> Link protocol
              </button>
            </div>
            {protocols.length > 0 && (
              <label className="checkbox gc-check">
                <input type="checkbox" checked={copySteps} onChange={(e) => setCopySteps(e.target.checked)} />
                Copy the protocol steps into the entry, to tick them off and note changes
              </label>
            )}
          </div>
          <VariableFields variables={vars} values={values} onChange={setValues} />
          <button type="submit" hidden />
        </form>
      </div>
    </Dialog>
  );
}

export function openNewEntryDialog(initial: Initial = {}) {
  openDialog((close) => <NewEntryDialog close={close} initial={initial} />);
}
