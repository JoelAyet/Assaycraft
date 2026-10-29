import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  BookMarked,
  BookOpen,
  ChevronRight,
  ExternalLink,
  Pencil,
  Quote,
  Lightbulb,
  Copy,
  History,
  FileClock,
  FileDown,
  FilePlus2,
  FolderInput,
  KanbanSquare,
  LayoutTemplate,
  ListTodo,
  Lock,
  LockOpen,
  MoreHorizontal,
  NotebookPen,
  Printer,
  Blocks,
  Scissors,
  Trash2,
  Link2,
  X,
  FileText,
  FileType2,
  Columns2,
  ArrowRight,
  Check,
  Play,
  Workflow,
} from 'lucide-react';
import { DocEditor } from '../editor/DocEditor';
import { useMarqueeSelect } from '../editor/blockSelect';
import { DocIndex } from './DocIndex';
import { openVersionHistory } from '../history/HistoryDialog';
import { navigate, toast, useNotebook, BUILTIN_EXPERIMENTS_BOARD } from '../notebook/store';
import {
  createTemplate,
  duplicateDoc,
  flushWrite,
  linkFlowStep,
  patchMeta,
  readDoc,
  saveAsProtocol,
  saveEntryAsTemplate,
  syncFileName,
  takeFreshTitle,
  templateVariables,
  trashDoc,
} from '../notebook/actions';
import { LAYOUT, PRIORITIES, backlinksOf, boardCards, cardNoun, type DocMeta } from '../notebook/model';
import { Backlinks, LinkedProtocols, ProtocolProps, newEntryWithProtocol, openReleaseDialog } from './protocols';
import { SourcePane, closeSourcePane, openSourcePane, useSourcePane } from './PdfView';
import { MenuButton, confirmDialog, openDialog, promptDialog, type MenuItemSpec } from './overlay';
import { OptionSelect } from './status';
import { AutoTextarea, DateField, Prop, TagInput, TimeField, TitleInput } from './fields';
import { moveDocWithPrompt } from './Sidebar';
import { openNewEntryDialog } from './NewEntryDialog';
import { EntryPicker } from './pickers';
import { basename, dirname, isInside } from '../lib/path';
import { formatDate, formatRelative } from '../lib/dates';
import { downloadBlob } from '../lib/download';
import type { TemplateIssue, TemplateVariable } from '../templates/engine';
import { TemplateCheck, TemplateGuide } from './templateHelp';
import { entriesById, flowOfStep } from '../flow/model';
import { NavToggle } from './nav';
import { READING_STATUSES, fullCitation, readingStatus, refFromMeta, toBibtex } from '../literature/model';
import { openPaperDialog } from '../literature/PaperDialog';

function useTitle(meta: DocMeta) {
  const [title, setTitle] = useState(meta.title);
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!editing.current) setTitle(meta.title);
  }, [meta.title]);
  const pathRef = useRef(meta.path);
  pathRef.current = meta.path;
  const commit = useCallback(() => {
    editing.current = false;
    if (timer.current) clearTimeout(timer.current);
    void syncFileName(pathRef.current);
  }, []);
  const change = (v: string) => {
    editing.current = true;
    setTitle(v);
    patchMeta(pathRef.current, { title: v });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      editing.current = false;
      void syncFileName(pathRef.current);
    }, 1800);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return { title, change, commit };
}

function EntryProps({ meta, readOnly }: { meta: DocMeta; readOnly: boolean }) {
  const statuses = useNotebook((s) => s.config.entryStatuses);
  const inFlow = useNotebook((s) => !!flowOfStep(meta.id, Object.values(s.docs)));
  const p = meta.path;
  return (
    <div className="gc-props">
      <Prop label="Status">
        <OptionSelect
          options={statuses}
          value={meta.status}
          onChange={(status) => patchMeta(p, { status })}
          disabled={readOnly}
          placeholder="No status"
        />
      </Prop>
      <Prop label="Date">
        <DateField value={meta.date} onChange={(date) => patchMeta(p, { date })} disabled={readOnly} />
        <span className="gc-prop-sep">→</span>
        <DateField value={meta.end} min={meta.date} onChange={(end) => patchMeta(p, { end })} disabled={readOnly} placeholder="End date" />
      </Prop>
      <Prop label="Time">
        <TimeField value={meta.time} onChange={(time) => patchMeta(p, { time })} disabled={readOnly} />
        {(meta.time || meta.endTime) && (
          <>
            <span className="gc-prop-sep">→</span>
            <TimeField
              value={meta.endTime}
              // On the same day the end comes after the start.
              after={meta.end && meta.end !== meta.date ? undefined : meta.time}
              onChange={(endTime) => patchMeta(p, { endTime })}
              disabled={readOnly}
              placeholder="End time"
            />
          </>
        )}
      </Prop>
      {(inFlow || meta.result) && (
        <Prop label="Result">
          <AutoTextarea
            className="gc-prop-input"
            value={meta.result ?? ''}
            placeholder="The outcome in one line, e.g. 12 colonies, 3 picked"
            disabled={readOnly}
            onChange={(result) => patchMeta(p, { result: result || undefined })}
          />
        </Prop>
      )}
      <Prop label="Tags">
        <TagInput tags={meta.tags} onChange={(tags) => patchMeta(p, { tags })} disabled={readOnly} />
      </Prop>
      <Prop label="Protocols">
        <LinkedProtocols meta={meta} readOnly={readOnly} />
      </Prop>
      {meta.template && (
        <Prop label="Template">
          <span className="gc-prop-text">
            <LayoutTemplate className="gc-inline-icon" /> {meta.template}
          </span>
        </Prop>
      )}
      <Prop label="Created">
        <span className="gc-prop-text muted">
          {formatDate(meta.created, true)}
          {meta.author ? ` · ${meta.author}` : ''}
        </span>
      </Prop>
      <Prop label="Modified">
        <span className="gc-prop-text muted" title={formatDate(meta.modified, true)}>
          {formatRelative(meta.modified)}
        </span>
      </Prop>
      <LinkedFrom meta={meta} />
    </div>
  );
}

/** On a phone a flow's steps scroll sideways: open with the current one in view (once, not on every save). */
function showCurrentStep(list: HTMLOListElement | null) {
  const current = list?.querySelector<HTMLElement>('.is-current');
  if (list && current && list.scrollWidth > list.clientWidth) list.scrollLeft = current.offsetLeft - list.offsetLeft - 12;
}

/**
 * In an entry that is a step of a flow: which flow, every step (the ones started can be opened), and
 * the next step, to open it or, when it has not been started, to start it from here.
 */
function FlowBar({ meta }: { meta: DocMeta }) {
  const docs = useNotebook((s) => s.docs);
  const found = useMemo(() => flowOfStep(meta.id, Object.values(docs)), [docs, meta.id]);
  const byId = useMemo(() => entriesById(Object.values(docs)), [docs]);
  if (!found) return null;
  const { parent, index } = found;
  const steps = parent.flow!;
  const entryOf = (i: number) => (steps[i]?.ref ? byId.get(steps[i].ref!) : undefined);
  const done = steps.filter((_, i) => entryOf(i)?.status === 'completed').length;
  const next = steps[index + 1];
  const nextEntry = entryOf(index + 1);
  const nextTitle = nextEntry?.title || next?.title || `Step ${index + 2}`;

  const startNext = () => {
    const i = index + 1;
    const step = steps[i];
    if (!step) return;
    const template = step.template
      ? Object.values(docs).find((d) => d.kind === 'template' && (d.id === step.template || d.title === step.template))
      : undefined;
    openNewEntryDialog({
      heading: `Start step ${i + 1}`,
      title: step.title,
      templatePath: template?.path ?? null,
      folder: isInside(parent.path, LAYOUT.projects) ? dirname(parent.path) : undefined,
      onCreated: (path) => {
        const entry = useNotebook.getState().docs[path];
        if (entry)
          void linkFlowStep(parent.path, i, entry).catch((err: Error) =>
            toast(`Could not add it to ${parent.title}'s flow: ${err.message}`, 'error'),
          );
      },
    });
  };

  return (
    <nav className="gc-flowbar" aria-label="Flow">
      <div className="gc-flowbar-head">
        <Workflow className="gc-flowbar-icon" />
        <span className="gc-flowbar-where">
          Step {index + 1} of {steps.length} in{' '}
          <button className="gc-flowbar-parent" onClick={() => navigate({ name: 'doc', path: parent.path })}>
            {parent.id && parent.kind === 'entry' && <span className="mono">{parent.id}</span>} {parent.title}
          </button>
        </span>
        <span className="gc-flowbar-count">
          {done} of {steps.length} done
        </span>
      </div>
      <ol className="gc-flowbar-steps" ref={showCurrentStep} key={meta.id}>
        {steps.map((s, i) => {
          const entry = entryOf(i);
          const state = i === index ? 'is-current' : entry ? (entry.status === 'completed' ? 'is-done' : 'is-started') : 'is-planned';
          const label = entry?.title || s.title || `Step ${i + 1}`;
          const inner = (
            <>
              <span className="gc-flowbar-num" aria-hidden="true">
                {entry?.status === 'completed' && i !== index ? <Check /> : i + 1}
              </span>
              <span className="gc-flowbar-label">{label}</span>
            </>
          );
          return (
            <li key={i} className={`gc-flowbar-chip ${state}`}>
              {entry && i !== index ? (
                <button
                  onClick={() => navigate({ name: 'doc', path: entry.path })}
                  title={`Step ${i + 1}: ${entry.id} ${entry.title}`}
                  aria-label={`Step ${i + 1}: ${label}`}
                >
                  {inner}
                </button>
              ) : (
                <span
                  aria-current={i === index ? 'step' : undefined}
                  title={i === index ? 'This entry' : `Step ${i + 1}, not started yet`}
                  aria-label={`Step ${i + 1}: ${label}${i === index ? ' (this entry)' : ', not started'}`}
                >
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {next && (
        <div className="gc-flowbar-next">
          {nextEntry ? (
            <button className="btn btn-sm" onClick={() => navigate({ name: 'doc', path: nextEntry.path })}>
              <span className="gc-flowbar-next-title">Next: {nextTitle}</span>
              <ArrowRight />
            </button>
          ) : !parent.locked && !next.ref ? (
            <button className="btn btn-sm btn-primary" onClick={startNext} aria-label={`Start step ${index + 2}: ${nextTitle}`}>
              <Play />
              <span className="gc-flowbar-next-title">
                Start step {index + 2}: {nextTitle}
              </span>
            </button>
          ) : (
            <span className="muted">Next: {nextTitle} (not started)</span>
          )}
        </div>
      )}
    </nav>
  );
}

/** A note has only a date and tags: it belongs to no project and has no status. */
function NoteProps({ meta }: { meta: DocMeta }) {
  const p = meta.path;
  return (
    <div className="gc-props">
      <Prop label="Date">
        <DateField value={meta.date} onChange={(date) => patchMeta(p, { date })} />
      </Prop>
      <Prop label="Tags">
        <TagInput tags={meta.tags} onChange={(tags) => patchMeta(p, { tags })} />
      </Prop>
      <Prop label="Modified">
        <span className="gc-prop-text muted" title={formatDate(meta.modified, true)}>
          {formatRelative(meta.modified)}
        </span>
      </Prop>
    </div>
  );
}

function copyText(text: string, what: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast(`${what} copied`, 'success'),
    () => toast('Could not copy (the browser did not allow it)', 'error'),
  );
}

/** "Jinek, Martin" → "Martin Jinek". */
const givenFirst = (a: string) =>
  a
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .reverse()
    .join(' ');

function ReferenceProps({ meta, readOnly }: { meta: DocMeta; readOnly: boolean }) {
  const p = meta.path;
  const info = refFromMeta(meta);
  const docs = useNotebook((s) => s.docs);
  const citedIn = useMemo(() => backlinksOf(meta, Object.values(docs)), [docs, meta]);
  const [allAuthors, setAllAuthors] = useState(false);
  const authors = allAuthors || info.authors.length <= 10 ? info.authors : info.authors.slice(0, 8);
  let where = [info.year, info.volume && `${info.volume}${info.issue ? `(${info.issue})` : ''}`].filter(Boolean).join('; ');
  if (info.pages) where += `${where ? ': ' : ''}${info.pages}`;
  return (
    <div className="gc-props">
      <Prop label="Reading">
        <OptionSelect
          options={READING_STATUSES}
          value={readingStatus(meta)}
          disabled={readOnly}
          onChange={(status) => patchMeta(p, { status: status ?? 'to-read' })}
        />
      </Prop>
      <Prop label="Authors">
        <span className="gc-prop-text gc-paper-authors">
          {authors.length ? authors.map(givenFirst).join(', ') : <span className="muted">None given</span>}
          {authors.length < info.authors.length && (
            <button className="gc-add-chip" onClick={() => setAllAuthors(true)}>
              +{info.authors.length - authors.length} more
            </button>
          )}
        </span>
      </Prop>
      {(info.journal || where) && (
        // A web page or a book has no journal: then this row is only its year.
        <Prop label={info.journal ? 'Journal' : 'Year'}>
          <span className="gc-prop-text">{[info.journal, where].filter(Boolean).join(', ')}</span>
        </Prop>
      )}
      {info.doi && (
        <Prop label="DOI">
          <a className="gc-prop-text gc-ext-link mono" href={`https://doi.org/${info.doi}`} target="_blank" rel="noopener noreferrer">
            {info.doi} <ExternalLink />
          </a>
        </Prop>
      )}
      {info.pmid && (
        <Prop label="PubMed">
          <a
            className="gc-prop-text gc-ext-link mono"
            href={`https://pubmed.ncbi.nlm.nih.gov/${info.pmid}/`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {info.pmid} <ExternalLink />
          </a>
        </Prop>
      )}
      {info.url && !info.doi && (
        <Prop label="Link">
          <a className="gc-prop-text gc-ext-link" href={info.url} target="_blank" rel="noopener noreferrer">
            {info.url.replace(/^https?:\/\//, '')} <ExternalLink />
          </a>
        </Prop>
      )}
      <Prop label="Tags">
        <TagInput tags={meta.tags} disabled={readOnly} onChange={(tags) => patchMeta(p, { tags })} />
      </Prop>
      <Prop label="Cited in">
        <Backlinks docs={citedIn} emptyText="Not cited yet. In an entry or a note, type / and choose Cite a paper." />
      </Prop>
      <div className="gc-paper-actions">
        <button className="btn btn-sm" onClick={() => copyText(fullCitation(info), 'Citation')}>
          <Quote /> Copy citation
        </button>
        <button className="btn btn-sm" onClick={() => copyText(toBibtex(info, meta.id), 'BibTeX')}>
          <BookMarked /> Copy BibTeX
        </button>
        {!readOnly && (
          <button className="btn btn-sm" onClick={() => openPaperDialog({ edit: meta })}>
            <Pencil /> Edit details
          </button>
        )}
      </div>
    </div>
  );
}

/** Other pages that link to this one (only shown when there are some). */
function LinkedFrom({ meta }: { meta: DocMeta }) {
  const docs = useNotebook((s) => s.docs);
  const from = useMemo(() => backlinksOf(meta, Object.values(docs)), [docs, meta]);
  if (!from.length) return null;
  return (
    <Prop label="Linked from">
      <Backlinks docs={from} />
    </Prop>
  );
}

export function LinkedEntries({ meta, readOnly }: { meta: DocMeta; readOnly: boolean }) {
  const docs = useNotebook((s) => s.docs);
  const links = meta.links ?? [];
  const byId = (id: string) => Object.values(docs).find((d) => d.id === id && d.kind === 'entry');
  return (
    <div className="gc-tags">
      {links.map((id) => {
        const d = byId(id);
        return (
          <span key={id} className="gc-link-chip">
            <button onClick={() => d && navigate({ name: 'doc', path: d.path })} title={d?.title}>
              <FileText /> <span className="mono">{id}</span>{' '}
              {d ? <span className="gc-link-chip-title">{d.title}</span> : <span className="muted">(missing)</span>}
            </button>
            {!readOnly && (
              <button className="gc-tag-x" aria-label="Remove link" onClick={() => patchMeta(meta.path, { links: links.filter((x) => x !== id) })}>
                ×
              </button>
            )}
          </span>
        );
      })}
      {!readOnly && (
        <button
          className="gc-add-chip"
          title="Link an entry"
          aria-label={links.length ? 'Link an entry' : undefined}
          onClick={() =>
            openDialog((close) => (
              <EntryPicker
                title="Link an entry"
                close={close}
                onPick={(d) => {
                  if (d.id && !links.includes(d.id)) patchMeta(meta.path, { links: [...links, d.id] });
                }}
              />
            ))
          }
        >
          <Link2 /> {links.length ? '' : 'Link entry'}
        </button>
      )}
    </div>
  );
}

export function CardProps({ meta, readOnly }: { meta: DocMeta; readOnly: boolean }) {
  const board = useNotebook((s) => s.docs[`${dirname(meta.path)}/${LAYOUT.boardFile}`]);
  const p = meta.path;
  const columns = board?.columns ?? [];
  const isTask = boardCards(board) === 'tasks';
  return (
    <div className="gc-props">
      <Prop label="Status">
        <OptionSelect
          options={columns}
          value={meta.status}
          onChange={(status) => patchMeta(p, { status })}
          disabled={readOnly}
          placeholder="No status"
        />
      </Prop>
      {isTask && (
        <Prop label="Priority">
          <OptionSelect
            options={PRIORITIES}
            value={meta.priority}
            onChange={(priority) => patchMeta(p, { priority: priority as DocMeta['priority'] })}
            disabled={readOnly}
            placeholder="None"
            allowEmpty
          />
        </Prop>
      )}
      {isTask && (
        <Prop label="Dates">
          <DateField value={meta.start} onChange={(start) => patchMeta(p, { start })} disabled={readOnly} placeholder="Start" />
          <span className="gc-prop-sep">→</span>
          <DateField value={meta.due} min={meta.start} onChange={(due) => patchMeta(p, { due })} disabled={readOnly} placeholder="Due date" />
        </Prop>
      )}
      <Prop label="Tags">
        <TagInput tags={meta.tags} onChange={(tags) => patchMeta(p, { tags })} disabled={readOnly} />
      </Prop>
      <Prop label="Entries">
        <LinkedEntries meta={meta} readOnly={readOnly} />
      </Prop>
      <Prop label="Protocols">
        <LinkedProtocols meta={meta} readOnly={readOnly} />
      </Prop>
      <Prop label="Created">
        <span className="gc-prop-text muted">{formatDate(meta.created, true)}</span>
      </Prop>
    </div>
  );
}

function TemplateProps({ meta }: { meta: DocMeta }) {
  const docs = useNotebook((s) => s.docs);
  // null until the template has been read: saying it has no variables before then would be wrong.
  const [vars, setVars] = useState<TemplateVariable[] | null>(null);
  const [issues, setIssues] = useState<TemplateIssue[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      void templateVariables(meta.path)
        .then(({ variables, issues: found }) => {
          if (cancelled) return;
          setVars(variables);
          setIssues(found);
        })
        .catch(() => undefined);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [meta.path, meta.mtime]);
  const usedBy = Object.values(docs).filter((d) => (d.kind === 'template' || d.kind === 'subtemplate') && meta.id && d.includes?.includes(meta.id));
  const includes = (meta.includes ?? []).map((id) => Object.values(docs).find((d) => d.id === id)).filter(Boolean) as DocMeta[];
  const entryTitle = typeof meta.extra.entryTitle === 'string' ? meta.extra.entryTitle : '';
  return (
    <div className="gc-props">
      <Prop label="Description">
        <AutoTextarea
          className="gc-prop-input"
          value={meta.description ?? ''}
          placeholder="What is this template for?"
          onChange={(v) => patchMeta(meta.path, { description: v })}
        />
      </Prop>
      {meta.kind === 'template' && (
        <Prop label="Entry title">
          <input
            className="gc-prop-input mono"
            value={entryTitle}
            placeholder="e.g. Cloning of {{Construct}}"
            onChange={(e) => patchMeta(meta.path, { extra: { ...meta.extra, entryTitle: e.target.value || undefined } })}
          />
        </Prop>
      )}
      <Prop label="Tags">
        <TagInput tags={meta.tags} onChange={(tags) => patchMeta(meta.path, { tags })} />
      </Prop>
      {meta.kind === 'template' && (
        <Prop label="Protocols">
          <LinkedProtocols meta={meta} readOnly={false} />
        </Prop>
      )}
      <Prop label="Asks for">
        <span className="gc-tags">
          {vars === null ? (
            <span className="muted">Reading the template…</span>
          ) : vars.length ? (
            vars.map((v) => (
              <span key={v.name} className="pill pill-sq tone-purple mono">{`{{${v.name}${v.defaultValue ? '|' + v.defaultValue : ''}}}`}</span>
            ))
          ) : (
            <span className="muted">
              No variables. Write {'{{Name}}'} or {'{{Name|default}}'} anywhere.
            </span>
          )}
        </span>
      </Prop>
      {includes.length > 0 && (
        <Prop label="Uses">
          <span className="gc-tags">
            {includes.map((d) => (
              <button key={d.path} className="pill pill-sq tone-blue" onClick={() => navigate({ name: 'doc', path: d.path })}>
                <Blocks className="gc-inline-icon" /> {d.title}
              </button>
            ))}
          </span>
        </Prop>
      )}
      {issues && (
        <Prop label="Check">
          <TemplateCheck issues={issues} variables={vars ?? []} />
        </Prop>
      )}
      {meta.kind === 'subtemplate' && (
        <Prop label="Used by">
          <span className="gc-tags">
            {usedBy.length ? (
              usedBy.map((d) => (
                <button key={d.path} className="pill pill-sq tone-blue" onClick={() => navigate({ name: 'doc', path: d.path })}>
                  <LayoutTemplate className="gc-inline-icon" /> {d.title}
                </button>
              ))
            ) : (
              <span className="muted">Not used by any template yet</span>
            )}
          </span>
        </Prop>
      )}
    </div>
  );
}

function kindLabel(meta: DocMeta, board: DocMeta | undefined) {
  switch (meta.kind) {
    case 'template':
      return { icon: <LayoutTemplate />, text: 'Entry template' };
    case 'subtemplate':
      return { icon: <Blocks />, text: 'Sub-template' };
    case 'card':
      return boardCards(board) === 'tasks' ? { icon: <ListTodo />, text: 'Task' } : { icon: <KanbanSquare />, text: 'Card' };
    case 'protocol':
      return { icon: <BookOpen />, text: 'Protocol' };
    case 'note':
      return { icon: <NotebookPen />, text: 'Note' };
    case 'reference':
      return { icon: <BookMarked />, text: 'Paper' };
    default:
      return null;
  }
}

export function Breadcrumbs({ meta }: { meta: DocMeta }) {
  const docs = useNotebook((s) => s.docs);
  const crumbs: { label: string; onClick?: () => void }[] = [];
  const parts = meta.path.split('/');
  if (meta.kind === 'entry') {
    crumbs.push({ label: 'Projects', onClick: () => navigate({ name: 'folder', path: LAYOUT.projects }) });
    for (let i = 2; i < parts.length; i++) {
      const p = parts.slice(0, i).join('/');
      crumbs.push({ label: parts[i - 1], onClick: () => navigate({ name: 'folder', path: p }) });
    }
  } else if (meta.kind === 'protocol') {
    crumbs.push({ label: 'Protocols', onClick: () => navigate({ name: 'protocols' }) });
  } else if (meta.kind === 'note') {
    crumbs.push({ label: 'Notes', onClick: () => navigate({ name: 'notes' }) });
  } else if (meta.kind === 'reference') {
    crumbs.push({ label: 'Literature', onClick: () => navigate({ name: 'literature' }) });
  } else if (meta.kind === 'card') {
    const board = docs[`${dirname(meta.path)}/${LAYOUT.boardFile}`];
    crumbs.push({ label: 'Boards' });
    crumbs.push({ label: board?.title ?? basename(dirname(meta.path)), onClick: () => navigate({ name: 'board', path: dirname(meta.path) }) });
  } else {
    crumbs.push({ label: 'Templates', onClick: () => navigate({ name: 'templates' }) });
    if (meta.kind === 'subtemplate') crumbs.push({ label: 'Sub-templates', onClick: () => navigate({ name: 'templates' }) });
  }
  return (
    <nav className="gc-crumbs" aria-label="Breadcrumbs">
      {crumbs.map((c, i) => (
        <span key={i} className="gc-crumb">
          {c.onClick ? <button onClick={c.onClick}>{c.label}</button> : <span>{c.label}</span>}
          <ChevronRight />
        </span>
      ))}
      <span className="gc-crumb is-current">
        {meta.kind === 'entry' || meta.kind === 'card' || meta.kind === 'protocol' || meta.kind === 'reference' ? meta.id || meta.title : meta.title}
      </span>
    </nav>
  );
}

export function DocHeader({ meta, readOnly, compact }: { meta: DocMeta; readOnly: boolean; compact?: boolean }) {
  const { title, change, commit } = useTitle(meta);
  const [fresh] = useState(() => takeFreshTitle(meta.path));
  const board = useNotebook((s) => (meta.kind === 'card' ? s.docs[`${dirname(meta.path)}/${LAYOUT.boardFile}`] : undefined));
  const kind = kindLabel(meta, board);
  return (
    <header className={`gc-doc-header ${compact ? 'is-compact' : ''}`}>
      <div className="gc-doc-kicker">
        {meta.id && meta.kind !== 'template' && meta.kind !== 'subtemplate' && meta.kind !== 'note' && <span className="id-chip">{meta.id}</span>}
        {kind && (
          <span className="gc-kind">
            {kind.icon}
            {kind.text}
          </span>
        )}
        {meta.kind === 'protocol' && meta.version && <span className="gc-kind gc-kind-plain mono">v{meta.version}</span>}
        {meta.locked && (
          <span className="gc-kind gc-kind-locked">
            <Lock /> Locked
          </span>
        )}
      </div>
      <TitleInput
        value={title}
        onChange={change}
        onCommit={commit}
        disabled={readOnly}
        selectOnMount={fresh}
        placeholder={
          meta.kind === 'card'
            ? `Untitled ${cardNoun(boardCards(board))}`
            : meta.kind === 'entry'
              ? 'Untitled experiment'
              : meta.kind === 'protocol'
                ? 'Untitled protocol'
                : meta.kind === 'note'
                  ? 'Untitled note'
                  : meta.kind === 'reference'
                    ? 'Title of the paper'
                    : 'Untitled template'
        }
      />
      {meta.kind === 'entry' && <EntryProps meta={meta} readOnly={readOnly} />}
      {meta.kind === 'protocol' && <ProtocolProps meta={meta} readOnly={readOnly} />}
      {meta.kind === 'card' && <CardProps meta={meta} readOnly={readOnly} />}
      {meta.kind === 'note' && <NoteProps meta={meta} />}
      {meta.kind === 'reference' && <ReferenceProps meta={meta} readOnly={readOnly} />}
      {(meta.kind === 'template' || meta.kind === 'subtemplate') && <TemplateProps meta={meta} />}
    </header>
  );
}

export function docMenu(meta: DocMeta, editor: Editor | null): MenuItemSpec[] {
  const items: MenuItemSpec[] = [];
  const isEntry = meta.kind === 'entry';
  const isTpl = meta.kind === 'template' || meta.kind === 'subtemplate';
  const isProtocol = meta.kind === 'protocol';
  if (isProtocol) {
    items.push(
      { label: 'New entry with this protocol', icon: <FilePlus2 />, onSelect: () => newEntryWithProtocol(meta) },
      { label: 'Release new version…', icon: <History />, disabled: !!meta.locked, onSelect: () => openReleaseDialog(meta) },
      { label: 'Duplicate', icon: <Copy />, onSelect: () => void duplicateDoc(meta.path) },
    );
  }
  if (isEntry) {
    items.push(
      { label: 'Duplicate', icon: <Copy />, onSelect: () => void duplicateDoc(meta.path) },
      {
        label: 'Save as template',
        icon: <LayoutTemplate />,
        onSelect: () => void saveEntryAsTemplate(meta.path, 'template').then(() => toast('Template created', 'success')),
      },
      {
        label: 'Save as sub-template',
        icon: <Blocks />,
        onSelect: () => void saveEntryAsTemplate(meta.path, 'subtemplate').then(() => toast('Sub-template created', 'success')),
      },
      {
        label: 'Save as protocol',
        icon: <BookOpen />,
        onSelect: () => void saveAsProtocol(meta.path).then(() => toast('Protocol created. Link it from your entries with / → Protocol.', 'success')),
      },
    );
  }
  if ((isEntry || isTpl || isProtocol) && editor) {
    items.push({
      label: 'Save selection as sub-template…',
      icon: <Scissors />,
      disabled: editor.state.selection.empty,
      onSelect: () => {
        const slice = editor.state.selection.content();
        const content = { type: 'doc', content: slice.content.toJSON() as object[] };
        void promptDialog({
          title: 'New sub-template from selection',
          label: 'Name',
          placeholder: 'e.g. Western blot transfer',
          hint: 'The selection becomes a reusable block. Then replace values that change between runs with {{variables}}.',
        }).then((name) => {
          if (!name) return;
          void createTemplate({ kind: 'subtemplate', title: name, content, sourceFolder: dirname(meta.path), open: false }).then(() =>
            toast(`Sub-template “${name}” created. Insert it anywhere with / → Sub-template.`, 'success'),
          );
        });
      },
    });
  }
  if (isEntry) items.push({ label: 'Move to…', icon: <FolderInput />, onSelect: () => moveDocWithPrompt(meta.path) });
  items.push(
    'sep',
    { label: 'Version history…', icon: <FileClock />, onSelect: () => openVersionHistory(meta.path) },
    {
      label: 'Download Markdown',
      icon: <FileDown />,
      onSelect: () =>
        void flushWrite(meta.path)
          .then(() => readDoc(meta.path))
          .then(async () => {
            const vault = useNotebook.getState().vault!;
            downloadBlob(await vault.readBlob(meta.path), basename(meta.path));
          }),
    },
    { label: 'Print / save as PDF', icon: <Printer />, onSelect: () => window.print() },
    {
      label: 'Copy file location',
      icon: <Copy />,
      onSelect: () => void navigator.clipboard.writeText(meta.path).then(() => toast('Copied: ' + meta.path, 'success')),
    },
    'sep',
    {
      label: 'Move to trash',
      icon: <Trash2 />,
      danger: true,
      onSelect: () =>
        void confirmDialog({
          title: 'Move to trash?',
          message: `“${meta.title}” will be moved to the trash, where you can restore it.`,
          confirmLabel: 'Move to trash',
          danger: true,
        }).then((ok) => {
          if (ok) void trashDoc(meta.path);
        }),
    },
  );
  return items;
}

export function DocPage({ path }: { path: string }) {
  const docKey = useNotebook((s) => s.docKeys[path] ?? path);
  return <DocLoader key={docKey} path={path} />;
}

function DocLoader({ path }: { path: string }) {
  const meta = useNotebook((s) => s.docs[path]);
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    readDoc(path)
      .then(({ meta: m, body: b }) => {
        if (cancelled) return;
        if (!useNotebook.getState().docs[path]) useNotebook.setState((s) => ({ docs: { ...s.docs, [path]: m } }));
        setBody(b);
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (error)
    return (
      <div className="gc-page">
        <div className="empty-state">
          <X />
          <h3>This page could not be opened</h3>
          <p>{error}</p>
          <button className="btn" onClick={() => navigate({ name: 'home' })}>
            Go home
          </button>
        </div>
      </div>
    );
  if (body === null || !meta)
    return (
      <div className="gc-page gc-page-loading">
        <div className="spinner" />
      </div>
    );
  return <DocView meta={meta} body={body} />;
}

/** Shown on a protocol imported from a PDF until it is no longer a draft. */
function ImportedBanner({ meta, sourceOpen }: { meta: DocMeta; sourceOpen: boolean }) {
  const [hidden, setHidden] = useState(false);
  if (hidden || meta.status !== 'draft' || !meta.source) return null;
  return (
    <div className="gc-import-banner" role="note">
      <FileType2 />
      <span>
        Converted from a PDF. Check it against the original, fix what the conversion missed, then set the status to <strong>Active</strong>.
      </span>
      {!sourceOpen && (
        <button className="btn btn-sm" onClick={() => openSourcePane(meta.path)}>
          <Columns2 /> Compare with the PDF
        </button>
      )}
      <button className="icon-btn icon-btn-sm" aria-label="Hide this message" title="Hide" onClick={() => setHidden(true)}>
        <X />
      </button>
    </div>
  );
}

function DocView({ meta, body }: { meta: DocMeta; body: string }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  // Drag in the page's margins to select whole blocks.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  useMarqueeSelect(meta.locked ? null : editor, scrollEl);
  const sourceOpen = useSourcePane((s) => s.path === meta.path) && !!meta.source;
  useEffect(() => () => closeSourcePane(), []);
  // Tips start open on an empty template, where they help most.
  const [guide, setGuide] = useState(() => !body.trim());
  const readOnly = !!meta.locked;
  const isTpl = meta.kind === 'template' || meta.kind === 'subtemplate';
  const isProtocol = meta.kind === 'protocol';
  const toggleLock = () => {
    if (meta.locked) patchMeta(meta.path, { locked: undefined }, 0);
    else if (isProtocol)
      void confirmDialog({
        title: 'Lock this protocol?',
        message: 'Locked protocols are read-only until you unlock them. Use this for an approved version; it is marked Active.',
        confirmLabel: 'Lock protocol',
      }).then((ok) => {
        if (ok) void patchMeta(meta.path, { locked: true, status: meta.status === 'retired' ? meta.status : 'active' }, 0);
      });
    else
      void confirmDialog({
        title: 'Lock this entry?',
        message: 'Locked entries are read-only until you unlock them. Use this when an experiment is finished and signed off.',
        confirmLabel: 'Lock entry',
      }).then((ok) => {
        if (ok) void patchMeta(meta.path, { locked: true, status: meta.kind === 'entry' && meta.status !== 'failed' ? 'completed' : meta.status }, 0);
      });
  };
  return (
    <div className="gc-page gc-doc-page">
      <div className="gc-topbar">
        <NavToggle />
        <Breadcrumbs meta={meta} />
        <span className="spacer" />
        {meta.kind === 'template' && (
          <button
            className="btn btn-primary btn-sm"
            aria-label="New entry from template"
            onClick={() => openNewEntryDialog({ templatePath: meta.path })}
          >
            <FilePlus2 /> <span className="gc-btn-label">New entry from template</span>
          </button>
        )}
        {isProtocol && meta.source && (
          <button
            className={`btn btn-sm ${sourceOpen ? '' : 'btn-ghost'}`}
            aria-pressed={sourceOpen}
            onClick={() => (sourceOpen ? closeSourcePane() : openSourcePane(meta.path))}
            title="Show the original PDF next to the protocol"
            aria-label="Original PDF"
          >
            <Columns2 /> <span className="gc-btn-label">Original PDF</span>
          </button>
        )}
        {isProtocol && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => newEntryWithProtocol(meta)}
            title="New entry that follows this protocol"
            aria-label="New entry with protocol"
          >
            <FilePlus2 /> <span className="gc-btn-label">New entry with protocol</span>
          </button>
        )}
        {meta.kind === 'card' && (
          <button className="btn btn-sm" aria-label="Open board" onClick={() => navigate({ name: 'board', path: dirname(meta.path) })}>
            <KanbanSquare /> <span className="gc-btn-label">Open board</span>
          </button>
        )}
        {meta.kind === 'entry' && isInside(meta.path, LAYOUT.projects) && (
          <button
            className="btn btn-ghost btn-sm"
            title="See all experiments by status"
            aria-label="Board"
            onClick={() => navigate({ name: 'board', path: BUILTIN_EXPERIMENTS_BOARD })}
          >
            <KanbanSquare /> <span className="gc-btn-label">Board</span>
          </button>
        )}
        {(meta.kind === 'entry' || meta.kind === 'card' || isProtocol) && (
          <button
            className={`btn btn-sm ${meta.locked ? '' : 'btn-ghost'}`}
            onClick={toggleLock}
            title={meta.locked ? 'Unlock to edit' : 'Lock (make read-only)'}
            aria-label={meta.locked ? 'Unlock' : 'Lock'}
          >
            {meta.locked ? <LockOpen /> : <Lock />} <span className="gc-btn-label">{meta.locked ? 'Unlock' : 'Lock'}</span>
          </button>
        )}
        <MenuButton items={() => docMenu(meta, editor)} title="More actions">
          <MoreHorizontal />
        </MenuButton>
      </div>
      <div className={`gc-doc-body ${sourceOpen ? 'has-source' : ''}`}>
        <div className="gc-doc-scroll" ref={setScrollEl}>
          <article className={`gc-doc ${isTpl ? 'is-template' : ''}`}>
            <DocHeader meta={meta} readOnly={readOnly} />
            {meta.kind === 'entry' && <FlowBar meta={meta} />}
            {isProtocol && <ImportedBanner meta={meta} sourceOpen={sourceOpen} />}
            {isTpl && (
              <>
                <div className="gc-template-hint">
                  <LayoutTemplate />
                  <span>
                    You are editing a {meta.kind === 'template' ? 'template' : 'sub-template'}. New entries get a copy of this content.{' '}
                    {meta.kind === 'template'
                      ? 'Insert sub-templates with “/ → Sub-template” to compose protocols that stay in sync.'
                      : 'Changes apply to templates that use it, from the next entry on.'}
                  </span>
                  <button className="btn btn-sm gc-hint-btn" aria-expanded={guide} onClick={() => setGuide(!guide)}>
                    <Lightbulb /> {guide ? 'Hide tips' : 'How to build it'}
                  </button>
                </div>
                {guide && (
                  <div className="gc-help-panel gc-guide-inline">
                    <TemplateGuide kind={meta.kind === 'subtemplate' ? 'subtemplate' : 'template'} />
                  </div>
                )}
              </>
            )}
            {readOnly && (
              <div className="gc-locked-banner">
                <Lock /> {isProtocol ? 'This protocol is locked (approved) and read-only.' : 'This entry is locked and read-only.'}
                <button className="btn btn-sm" onClick={toggleLock}>
                  Unlock
                </button>
              </div>
            )}
            <DocEditor path={meta.path} meta={meta} initialBody={body} readOnly={readOnly} onEditor={setEditor} />
          </article>
        </div>
        {sourceOpen && <SourcePane meta={meta} />}
        {!sourceOpen && <DocIndex editor={editor} meta={meta} />}
      </div>
    </div>
  );
}
