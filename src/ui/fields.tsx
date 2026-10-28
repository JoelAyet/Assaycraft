import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  AlignLeft,
  BookOpen,
  BookOpenCheck,
  Globe,
  Newspaper,
  Quote,
  Users,
  Braces,
  CalendarClock,
  CalendarDays,
  CheckCheck,
  CircleDot,
  Clock,
  Clock3,
  FileText,
  Flag,
  Hash,
  History,
  LayoutTemplate,
  Link2,
  Plus,
  Puzzle,
  Tag,
  Target,
  ClipboardCheck,
  Type,
  X,
  type LucideIcon,
  FileType2,
} from 'lucide-react';
import { TagPill } from './status';
import { useNotebook } from '../notebook/store';
import { Popover, usePopover } from './overlay';
import { formatTime, minutesOf, parseTypedTime, LOCALE } from '../lib/dates';

const PROP_ICONS: Record<string, LucideIcon> = {
  Status: CircleDot,
  Reading: BookOpenCheck,
  Date: CalendarDays,
  Dates: CalendarDays,
  Time: Clock,
  Tags: Tag,
  Protocols: BookOpen,
  Template: LayoutTemplate,
  Created: CalendarClock,
  Modified: Clock3,
  'Linked from': Link2,
  Priority: Flag,
  Entries: FileText,
  Description: AlignLeft,
  Purpose: Target,
  Result: ClipboardCheck,
  'Entry title': Type,
  'Asks for': Braces,
  Uses: Puzzle,
  'Used by': LayoutTemplate,
  'Used in': Link2,
  Check: CheckCheck,
  Version: Hash,
  History: History,
  Original: FileType2,
  Authors: Users,
  Journal: Newspaper,
  Year: CalendarDays,
  DOI: Link2,
  PubMed: Link2,
  Link: Globe,
  'Cited in': Quote,
};

/** A labelled row in a doc's property header (with an icon, like Notion's page properties). */
export function Prop({ label, children }: { label: string; children: ReactNode }) {
  const Icon = PROP_ICONS[label.replace(/\s*\(.*\)$/, '')];
  return (
    <div className="gc-prop">
      <span className="gc-prop-label">
        {Icon && <Icon aria-hidden="true" />}
        {label}
      </span>
      <span className="gc-prop-value">{children}</span>
    </div>
  );
}

/** Tags editor with suggestions from tags already used in the notebook. */
export function TagInput({ tags, onChange, disabled }: { tags: string[]; onChange: (tags: string[]) => void; disabled?: boolean }) {
  const docs = useNotebook((s) => s.docs);
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');
  const known = useMemo(() => {
    const set = new Set<string>();
    for (const d of Object.values(docs)) for (const t of d.tags) set.add(t);
    return [...set].sort();
  }, [docs]);
  const add = (raw: string) => {
    const parts = raw
      .split(',')
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean);
    const next = [...tags];
    for (const p of parts) if (!next.some((t) => t.toLowerCase() === p.toLowerCase())) next.push(p);
    if (next.length !== tags.length) onChange(next);
    setValue('');
  };
  const listId = useRef(`tags-${Math.random().toString(36).slice(2)}`).current;
  return (
    <div className="gc-tags">
      {tags.map((t) => (
        <TagPill key={t} tag={t} onRemove={disabled ? undefined : () => onChange(tags.filter((x) => x !== t))} />
      ))}
      {!disabled &&
        (adding ? (
          <>
            <input
              className="gc-tag-input"
              autoFocus
              list={listId}
              value={value}
              placeholder="Add tag…"
              onChange={(e) => {
                if (e.target.value.endsWith(',')) add(e.target.value);
                else setValue(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add(value);
                }
                if (e.key === 'Escape') setAdding(false);
                if (e.key === 'Backspace' && !value && tags.length) onChange(tags.slice(0, -1));
              }}
              onBlur={() => {
                if (value) add(value);
                setAdding(false);
              }}
            />
            <datalist id={listId}>
              {known
                .filter((t) => !tags.includes(t))
                .map((t) => (
                  <option key={t} value={t} />
                ))}
            </datalist>
          </>
        ) : (
          <button className="gc-add-chip" onClick={() => setAdding(true)} aria-label={tags.length ? 'Add tag' : undefined}>
            <Plus /> {tags.length ? '' : 'Add tag'}
          </button>
        ))}
      {disabled && !tags.length && <span className="muted">—</span>}
    </div>
  );
}

/** Compact date field: shows the date, opens the native picker, can be cleared. */
export function DateField({
  value,
  onChange,
  disabled,
  placeholder = 'Set date',
  min,
}: {
  value?: string;
  onChange: (v: string | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
  min?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState(value ?? '');
  useEffect(() => setLocal(value ?? ''), [value]);
  const label = value
    ? new Date(value + 'T00:00:00').toLocaleDateString(LOCALE, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
    : placeholder;
  return (
    <span className={`gc-date ${value ? '' : 'is-empty'}`}>
      <button
        className="gc-date-btn"
        disabled={disabled}
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          try {
            el.showPicker();
          } catch {
            el.focus();
          }
        }}
      >
        <CalendarDays />
        {label}
      </button>
      <input
        ref={ref}
        type="date"
        className="gc-date-native"
        value={local}
        min={min}
        tabIndex={-1}
        onChange={(e) => {
          setLocal(e.target.value);
          onChange(e.target.value || undefined);
        }}
      />
      {value && !disabled && (
        <button className="gc-date-clear" title="Clear date" onClick={() => onChange(undefined)}>
          <X />
        </button>
      )}
    </span>
  );
}

/** "1.5 h", "45 min": how long from one time to the next. */
function duration(from: string, to: string): string {
  const m = minutesOf(to) - minutesOf(from);
  return m < 60 ? `${m} min` : `${Number((m / 60).toFixed(2))} h`;
}

/**
 * A time of day: a button that opens the times of the day in half hours, and a box to type one
 * ("14:30", "2pm"). For an end time, `after` is the start time: the list starts after it, with durations.
 */
export function TimeField({
  value,
  onChange,
  disabled,
  placeholder = 'Add time',
  after,
}: {
  value?: string;
  onChange: (v: string | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
  after?: string;
}) {
  const p = usePopover();
  const [typed, setTyped] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const slots = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`).filter(
    (t) => !after || minutesOf(t) > minutesOf(after),
  );
  // Open on the time set, else an hour after the start, else 9:00.
  const focus = value ?? (after ? slots[1] : '09:00');
  useEffect(() => {
    if (!p.open) return;
    setTyped('');
    const el = list.current?.querySelector<HTMLElement>(`[data-time="${focus}"]`) ?? list.current?.querySelector<HTMLElement>('[data-time]');
    if (el && list.current) list.current.scrollTop = el.offsetTop - list.current.offsetTop - 4;
  }, [p.open, focus]);
  const pick = (t: string | undefined) => {
    onChange(t);
    p.close();
  };
  const typedTime = parseTypedTime(typed);
  return (
    <span className={`gc-date gc-time ${value ? '' : 'is-empty'}`}>
      <button ref={p.ref} className="gc-date-btn" disabled={disabled} onClick={p.toggle} aria-expanded={p.open}>
        <Clock />
        {value ? formatTime(value) : placeholder}
      </button>
      {p.open && (
        <Popover anchor={p.ref.current} onClose={p.close} className="gc-time-pop">
          <form
            className="gc-time-type"
            onSubmit={(e) => {
              e.preventDefault();
              if (typedTime) pick(typedTime);
            }}
          >
            <input
              className="input"
              autoFocus
              aria-label="Type a time"
              placeholder="Type a time, e.g. 14:30"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </form>
          <div ref={list} className="gc-time-list" role="listbox" aria-label="Times">
            {slots.map((t) => (
              <button key={t} type="button" role="option" aria-selected={t === value} data-time={t} className="menu-item" onClick={() => pick(t)}>
                {formatTime(t)}
                {after && <span className="muted gc-time-dur">{duration(after, t)}</span>}
              </button>
            ))}
          </div>
        </Popover>
      )}
      {value && !disabled && (
        <button className="gc-date-clear" title="Clear time" onClick={() => onChange(undefined)}>
          <X />
        </button>
      )}
    </span>
  );
}

/** Text input that commits on blur/Enter and auto-grows (for titles). */
/** Grow a textarea to fit its text, again whenever its width changes (side panel, phone rotation). */
function useFitHeight(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = '0px';
      el.style.height = el.scrollHeight + 'px';
    };
    fit();
    let width = el.clientWidth;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      // Next frame: resizing inside the observer's callback would trigger it again in the same frame.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [ref, value]);
}

export function TitleInput({
  value,
  onChange,
  onCommit,
  placeholder,
  disabled,
  className = '',
  selectOnMount,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit?: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** A page just created: select its title, so typing replaces it. */
  selectOnMount?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useFitHeight(ref, value);
  useEffect(() => {
    if (!selectOnMount) return;
    ref.current?.focus();
    ref.current?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={`gc-title-input ${className}`}
      value={value}
      placeholder={placeholder}
      readOnly={disabled}
      spellCheck
      onChange={(e) => onChange(e.target.value.replace(/\n/g, ' '))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit?.();
          const prose = e.currentTarget.closest('.gc-doc, .gc-peek')?.querySelector<HTMLElement>('.ProseMirror');
          prose?.focus();
        }
      }}
      onBlur={() => onCommit?.()}
    />
  );
}

/** Single-line-looking text field that grows to show all of its text. */
export function AutoTextarea({
  value,
  onChange,
  placeholder,
  className = '',
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useFitHeight(ref, value);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={`gc-auto-textarea ${className}`}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, ' '))}
      onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
    />
  );
}
