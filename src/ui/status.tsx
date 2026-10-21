import { Check } from 'lucide-react';
import { Popover, usePopover } from './overlay';
import { COLOR_NAMES, PRIORITIES, type ColorName, type Priority, type StatusOption } from '../notebook/model';

export function statusOf(statuses: StatusOption[], id: string | undefined): StatusOption | undefined {
  if (!id) return undefined;
  return statuses.find((s) => s.id === id) ?? { id, name: id, color: 'gray' };
}

export function StatusPill({ status, className = '' }: { status: StatusOption | undefined; className?: string }) {
  if (!status) return <span className={`pill tone-gray ${className}`}>No status</span>;
  return (
    <span className={`pill tone-${status.color} ${className}`}>
      <span className="dot" />
      {status.name}
    </span>
  );
}

/** A pill that opens a list of options when clicked. */
export function OptionSelect({
  options,
  value,
  onChange,
  disabled,
  placeholder = 'Empty',
  allowEmpty,
}: {
  options: { id: string; name: string; color: ColorName }[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
  allowEmpty?: boolean;
}) {
  const p = usePopover();
  const current = options.find((o) => o.id === value);
  return (
    <>
      <button
        ref={p.ref}
        className={`pill ${current ? `tone-${current.color}` : 'gc-pill-empty'}`}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          p.toggle();
        }}
      >
        {current && <span className="dot" />}
        {current?.name ?? placeholder}
      </button>
      {p.open && (
        <Popover anchor={p.ref.current} onClose={p.close}>
          {options.map((o) => (
            <button
              key={o.id}
              className="menu-item"
              onClick={() => {
                onChange(o.id);
                p.close();
              }}
            >
              <span className={`pill tone-${o.color}`}>
                <span className="dot" />
                {o.name}
              </span>
              {o.id === value && <Check className="gc-check" />}
            </button>
          ))}
          {allowEmpty && (
            <>
              <div className="menu-sep" />
              <button
                className="menu-item"
                onClick={() => {
                  onChange(undefined);
                  p.close();
                }}
              >
                <span className="muted">Clear</span>
              </button>
            </>
          )}
        </Popover>
      )}
    </>
  );
}

export function PriorityPill({ priority }: { priority: Priority | undefined }) {
  const p = PRIORITIES.find((x) => x.id === priority);
  if (!p) return null;
  return <span className={`pill pill-sq tone-${p.color}`}>{p.name}</span>;
}

export function ColorPicker({ value, onChange }: { value: ColorName; onChange: (c: ColorName) => void }) {
  return (
    <div className="gc-colors">
      {COLOR_NAMES.map((c) => (
        <button key={c} className={`gc-color-swatch tone-${c} ${c === value ? 'active' : ''}`} title={c} aria-label={c} onClick={() => onChange(c)}>
          {c === value && <Check />}
        </button>
      ))}
    </div>
  );
}

/** Deterministic color for a tag name. */
export function tagColor(tag: string): ColorName {
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const palette: ColorName[] = ['blue', 'green', 'purple', 'orange', 'teal', 'pink', 'yellow', 'brown', 'red'];
  return palette[h % palette.length];
}

export function TagPill({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  return (
    <span className={`pill pill-sq tone-${tagColor(tag)} gc-tag`}>
      {tag}
      {onRemove && (
        <button className="gc-tag-x" onClick={onRemove} aria-label={`Remove ${tag}`}>
          ×
        </button>
      )}
    </span>
  );
}
