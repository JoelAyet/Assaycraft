import { NodeViewWrapper, useEditorState, type NodeViewProps } from '@tiptap/react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarPlus,
  ExternalLink,
  FileText,
  LayoutTemplate,
  Link2,
  Lock,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Trash2,
  Unlink,
  Workflow,
  X,
} from 'lucide-react';
import { MenuButton, Popover, openDialog, usePopover, type MenuItemSpec } from '../ui/overlay';
import { MiniCalendar } from '../ui/MiniCalendar';
import { patchMeta } from '../notebook/actions';
import { EntryPicker } from '../ui/pickers';
import { StatusPill, statusOf } from '../ui/status';
import { openNewEntryDialog } from '../ui/NewEntryDialog';
import { useDocContext } from '../editor/context';
import { rememberInsertionPoint } from '../editor/insertion';
import { navigate, useNotebook } from '../notebook/store';
import { LAYOUT, type DocMeta } from '../notebook/model';
import { dirname, isInside, relative } from '../lib/path';
import { entriesById, flowProgress, normalizeFlow, type FlowData, type FlowStep } from './model';
import { LOCALE, localDate } from '../lib/dates';

/** Set by the "insert flow" command so a new flow starts with the cursor in its first step. */
let focusNextFlow = false;
export function focusNextInsertedFlow() {
  focusNextFlow = true;
}

const CARD_MIN = 200;
const ARROW = 28;

/** As many cards per row as fit, so rows snake back and forth like a lab plan on a whiteboard. */
function useColumns() {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(3);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setCols(Math.max(1, Math.min(4, Math.floor((el.clientWidth + ARROW) / (CARD_MIN + ARROW)))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, cols };
}

const shortDay = (ymd: string) => new Date(ymd + 'T00:00:00').toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' });

function dateText(d: DocMeta): string {
  if (!d.date) return '';
  return d.end && d.end !== d.date ? `${shortDay(d.date)} – ${shortDay(d.end)}` : shortDay(d.date);
}

/** A step's day, picked on a small calendar: when a planned step is to start, or its entry's date once started. */
function StepDateButton({
  value,
  step,
  onPick,
  disabled,
}: {
  value?: string;
  step: number;
  onPick: (ymd: string | undefined) => void;
  disabled?: boolean;
}) {
  const p = usePopover();
  return (
    <>
      <button
        ref={p.ref}
        className="btn btn-sm gc-flow-setdate"
        disabled={disabled}
        aria-label={value ? `Day of step ${step}: ${shortDay(value)}. Change it` : `Set a day for step ${step}`}
        title={value ? 'Change the day' : 'Set the day it starts'}
        onClick={p.toggle}
      >
        <CalendarPlus /> <span className="gc-flow-setdate-label">{value ? shortDay(value) : 'Set date'}</span>
      </button>
      {p.open && (
        <Popover anchor={p.ref.current} onClose={p.close}>
          <MiniCalendar
            value={value}
            label={`Day of step ${step}`}
            onPick={(ymd) => {
              p.close();
              onPick(ymd);
            }}
          />
          {value && (
            <button
              className="menu-item"
              onClick={() => {
                p.close();
                onPick(undefined);
              }}
            >
              <X /> No date
            </button>
          )}
        </Popover>
      )}
    </>
  );
}

/** onNext: Enter adds the name and clears the field for the next one (it stays put, so no keystroke is lost). */
function StepTitleInput({
  value,
  onDone,
  onNext,
  label,
}: {
  value: string;
  onDone: (title: string | null) => void;
  onNext?: (title: string) => void;
  label: string;
}) {
  const [v, setV] = useState(value);
  const done = useRef(false);
  const finish = (title: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(title);
  };
  return (
    <input
      className="gc-flow-input"
      autoFocus
      aria-label={label}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (onNext && v.trim()) {
            onNext(v.trim());
            setV('');
          } else finish(v.trim() || null);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(null);
        }
      }}
      onBlur={() => finish(v.trim() || null)}
    />
  );
}

/** A flow: the steps of a series of experiments, each one an entry once it is started. */
export function FlowView({ node, updateAttributes, editor, getPos, deleteNode }: NodeViewProps) {
  const ctx = useDocContext();
  const editable = useEditorState({ editor, selector: (s) => s.editor.isEditable });
  const data = useMemo(() => normalizeFlow(node.attrs.data as FlowData), [node.attrs.data]);
  const docs = useNotebook((s) => s.docs);
  const statuses = useNotebook((s) => s.config.entryStatuses);
  const byId = useMemo(() => entriesById(Object.values(docs)), [docs]);
  const templates = useMemo(() => Object.values(docs).filter((d) => d.kind === 'template'), [docs]);
  const templateOf = (s: FlowStep) => (s.template ? templates.find((t) => t.id === s.template || t.title === s.template) : undefined);
  const { ref: rootRef, cols } = useColumns();
  const [renaming, setRenaming] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const inTemplate = ctx.kind === 'template' || ctx.kind === 'subtemplate';
  const canStart = editable && !inTemplate;

  /** Latest data straight from the document (props may lag behind a change just made). */
  const current = useCallback((): FlowData => {
    const pos = getPos();
    const n = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null;
    return normalizeFlow((n && n.type.name === 'flow' ? n.attrs.data : node.attrs.data) as FlowData);
  }, [editor, getPos, node.attrs.data]);
  const update = useCallback((fn: (d: FlowData) => FlowData) => updateAttributes({ data: fn(current()) }), [current, updateAttributes]);
  const setStep = (i: number, step: FlowStep) => update((d) => ({ steps: d.steps.map((s, j) => (j === i ? step : s)) }));
  const move = (i: number, by: number) =>
    update((d) => {
      const steps = [...d.steps];
      const [s] = steps.splice(i, 1);
      steps.splice(i + by, 0, s);
      return { steps };
    });

  // A step's entry renamed or moved since: bring the link (and the title kept in the file) up to date.
  useEffect(() => {
    if (!editable) return;
    const d = current();
    let changed = false;
    const steps = d.steps.map((step) => {
      const entry = step.ref ? byId.get(step.ref) : undefined;
      if (!entry) return step;
      const href = relative(ctx.folder, entry.path);
      if (step.href === href && step.title === entry.title) return step;
      changed = true;
      return { ...step, href, title: entry.title };
    });
    if (changed) updateAttributes({ data: { steps } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byId, ctx.folder, editable]);

  useEffect(() => {
    if (focusNextFlow && editable) {
      focusNextFlow = false;
      setAdding(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const linkStep = (i: number, entry: DocMeta) => {
    const step = current().steps[i];
    if (!step) return;
    setStep(i, { title: entry.title, ref: entry.id, href: relative(ctx.folder, entry.path), ...(step.template ? { template: step.template } : {}) });
  };

  const start = (i: number) => {
    const step = current().steps[i];
    if (!step) return;
    openNewEntryDialog({
      heading: `Start step ${i + 1}`,
      title: step.title,
      // On the day planned for it, if there is one.
      ...(step.date ? { date: step.date, status: step.date > localDate() ? 'planned' : 'in-progress' } : {}),
      templatePath: templateOf(step)?.path ?? null,
      folder: isInside(ctx.path, LAYOUT.projects) ? dirname(ctx.path) : undefined,
      onCreated: (path) => {
        const entry = useNotebook.getState().docs[path];
        if (entry) linkStep(i, entry);
      },
    });
  };

  const pickTemplate = (i: number) =>
    openDialog((close) => (
      <EntryPicker
        title={`Template for step ${i + 1}`}
        kinds={['template']}
        close={close}
        placeholder="Search templates…"
        empty="No entry templates yet. Make one on the Templates page."
        onPick={(t) => setStep(i, { ...current().steps[i], template: t.id || t.title })}
      />
    ));

  const pickEntry = (i: number) =>
    openDialog((close) => (
      <EntryPicker
        title={`Link an entry to step ${i + 1}`}
        close={close}
        exclude={[ctx.path]}
        placeholder="Search entries by ID, title or tag…"
        onPick={(d) => linkStep(i, d)}
      />
    ));

  const stepMenu = (i: number, step: FlowStep, entry: DocMeta | undefined): MenuItemSpec[] => {
    const n = current().steps.length;
    const items: MenuItemSpec[] = [];
    if (entry) items.push({ label: 'Open entry', icon: <ExternalLink />, onSelect: () => navigate({ name: 'doc', path: entry.path }) });
    if (step.ref)
      items.push({
        label: 'Unlink entry',
        icon: <Unlink />,
        onSelect: () => setStep(i, { title: entry?.title ?? step.title, template: step.template }),
      });
    else {
      items.push(
        { label: 'Rename', icon: <Pencil />, onSelect: () => setRenaming(i) },
        { label: step.template ? 'Change template…' : 'Start from a template…', icon: <LayoutTemplate />, onSelect: () => pickTemplate(i) },
      );
      if (step.template) items.push({ label: 'No template', icon: <X />, onSelect: () => setStep(i, { title: step.title }) });
      if (!inTemplate) items.push({ label: 'Link an existing entry…', icon: <Link2 />, onSelect: () => pickEntry(i) });
    }
    items.push(
      'sep',
      { label: 'Move earlier', icon: <ArrowUp />, disabled: i === 0, onSelect: () => move(i, -1) },
      { label: 'Move later', icon: <ArrowDown />, disabled: i === n - 1, onSelect: () => move(i, 1) },
      'sep',
      { label: 'Remove step', icon: <Trash2 />, danger: true, onSelect: () => update((d) => ({ steps: d.steps.filter((_, j) => j !== i) })) },
    );
    return items;
  };

  const card = (step: FlowStep, i: number) => {
    const entry = step.ref ? byId.get(step.ref) : undefined;
    const missing = !!step.ref && !entry;
    const title = entry?.title || step.title || 'Untitled step';
    const tpl = templateOf(step);
    const state = entry ? (entry.status === 'completed' ? 'is-done' : 'is-started') : missing ? 'is-missing' : 'is-planned';
    return (
      <div className={`gc-flow-card ${state}`} data-step={i + 1}>
        <div className="gc-flow-card-head">
          <span className="gc-flow-num" aria-hidden="true">
            {i + 1}
          </span>
          {entry?.locked && <Lock className="gc-flow-lock" aria-label="Locked" />}
          {renaming === i ? (
            <StepTitleInput
              value={step.title}
              label={`Name of step ${i + 1}`}
              onDone={(t) => {
                setRenaming(null);
                if (t) setStep(i, { ...current().steps[i], title: t });
              }}
            />
          ) : entry ? (
            <button className="gc-flow-title" onClick={() => navigate({ name: 'doc', path: entry.path })} title={`Open ${entry.id}`}>
              {title}
            </button>
          ) : editable && !step.ref ? (
            <button className="gc-flow-title is-plain" onClick={() => setRenaming(i)} title="Rename">
              {title}
            </button>
          ) : (
            <span className="gc-flow-title is-plain">{title}</span>
          )}
          {editable && (
            <MenuButton items={() => stepMenu(i, step, entry)} className="icon-btn icon-btn-sm gc-flow-menu" title={`Step ${i + 1} options`}>
              <MoreHorizontal />
            </MenuButton>
          )}
        </div>
        <div className="gc-flow-card-body">
          {entry ? (
            <>
              <StatusPill status={statusOf(statuses, entry.status)} />
              {dateText(entry) && <span className="gc-flow-date">{dateText(entry)}</span>}
            </>
          ) : missing ? (
            <span className="pill tone-red">Entry not found</span>
          ) : (
            !inTemplate && (
              <>
                <span className="pill gc-flow-planned">Not started</span>
                {step.date && <span className="gc-flow-date">Planned {shortDay(step.date)}</span>}
              </>
            )
          )}
          {!entry && tpl ? (
            <span className="gc-flow-tpl" title="New entry starts from this template">
              <LayoutTemplate /> {tpl.title}
            </span>
          ) : (
            inTemplate && (
              <span className="gc-flow-tpl" title="New entry starts empty">
                <FileText /> Blank entry
              </span>
            )
          )}
        </div>
        {entry?.result && <p className="gc-flow-result">{entry.result}</p>}
        <div className="gc-flow-card-foot">
          {step.ref && <span className="id-chip">{step.ref}</span>}
          {!step.ref && canStart && (
            <button className="btn btn-sm gc-flow-start" onClick={() => start(i)} aria-label={`Start step ${i + 1}: ${title}`}>
              <Play /> Start
            </button>
          )}
          {canStart && !missing && (
            <StepDateButton
              step={i + 1}
              value={entry ? entry.date : step.date}
              disabled={!!entry?.locked}
              onPick={(date) => {
                if (entry) patchMeta(entry.path, { date: date ?? entry.date });
                else {
                  const { date: _old, ...rest } = current().steps[i];
                  void _old;
                  setStep(i, date ? { ...rest, date } : rest);
                }
              }}
            />
          )}
        </div>
      </div>
    );
  };

  const addCard = (
    <div className="gc-flow-card is-add">
      {adding ? (
        <StepTitleInput
          value=""
          label="New step"
          // Enter adds the step and stays in the field, to type the next one.
          onNext={(t) => update((d) => ({ steps: [...d.steps, { title: t }] }))}
          onDone={(t) => {
            if (t) update((d) => ({ steps: [...d.steps, { title: t }] }));
            setAdding(false);
          }}
        />
      ) : (
        <button className="gc-flow-add" onClick={() => setAdding(true)}>
          <Plus /> Add step
        </button>
      )}
    </div>
  );

  // Rows of `cols` slots; odd rows run right to left, so each row starts under the end of the last.
  const slots = [
    ...data.steps.map((s, i) => ({ key: `s${i}`, el: card(s, i), step: true })),
    ...(editable ? [{ key: 'add', el: addCard, step: false }] : []),
  ];
  const rows: (typeof slots)[] = [];
  for (let i = 0; i < slots.length; i += cols) rows.push(slots.slice(i, i + cols));
  const template = Array.from({ length: cols }, () => 'minmax(0, 1fr)').join(` ${ARROW}px `);
  const column = (r: number, k: number) => 2 * (r % 2 ? cols - 1 - k : k) + 1;
  const progress = flowProgress(data.steps, byId);

  return (
    <NodeViewWrapper
      className={`gc-flow ${inTemplate ? 'is-template' : ''}`}
      onFocus={() => {
        const pos = getPos();
        if (typeof pos === 'number') rememberInsertionPoint(editor, pos + node.nodeSize);
      }}
    >
      <div contentEditable={false}>
        <div className="gc-flow-head">
          <Workflow className="gc-flow-icon" />
          <span className="gc-flow-name">Flow</span>
          {data.steps.length > 0 && !inTemplate && (
            <span className="gc-flow-progress" title="Steps whose entry is completed">
              <span className="gc-flow-bar">
                <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </span>
              {progress.done} of {progress.total} done
            </span>
          )}
          <span className="spacer" />
          {editable && (
            <MenuButton
              className="icon-btn icon-btn-sm"
              title="Flow options"
              items={[
                { label: 'Add step', icon: <Plus />, onSelect: () => setAdding(true) },
                'sep',
                { label: 'Delete flow', icon: <Trash2 />, danger: true, onSelect: () => deleteNode() },
              ]}
            >
              <MoreHorizontal />
            </MenuButton>
          )}
        </div>
        <div className="gc-flow-grid" ref={rootRef}>
          {!slots.length && <p className="gc-flow-empty">No steps yet.</p>}
          {rows.map((row, r) => (
            <Fragment key={r}>
              <div className={`gc-flow-row ${r % 2 ? 'is-rev' : ''}`} style={{ gridTemplateColumns: template }}>
                {row.map((slot, k) => (
                  <Fragment key={slot.key}>
                    <div className="gc-flow-slot" style={{ gridColumn: column(r, k), gridRow: 1 }}>
                      {slot.el}
                    </div>
                    {k < row.length - 1 && (
                      <span
                        className={`gc-flow-arrow ${row[k + 1].step ? '' : 'is-faint'}`}
                        style={{ gridColumn: Math.min(column(r, k), column(r, k + 1)) + 1, gridRow: 1 }}
                        aria-hidden="true"
                      >
                        {r % 2 ? <ArrowLeft /> : <ArrowRight />}
                      </span>
                    )}
                  </Fragment>
                ))}
              </div>
              {r < rows.length - 1 && (
                <div className="gc-flow-turn" style={{ gridTemplateColumns: template }} aria-hidden="true">
                  <span className={rows[r + 1][0].step ? '' : 'is-faint'} style={{ gridColumn: column(r, cols - 1) }}>
                    <ArrowDown />
                  </span>
                </div>
              )}
            </Fragment>
          ))}
        </div>
      </div>
    </NodeViewWrapper>
  );
}
