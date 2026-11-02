import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { X } from 'lucide-react';

// ───────────── Popover ─────────────

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'right-start';

interface PopoverProps {
  anchor: HTMLElement | DOMRect | null;
  onClose: () => void;
  placement?: Placement;
  children: ReactNode;
  className?: string;
  width?: number;
}

export function Popover({ anchor, onClose, placement = 'bottom-start', children, className, width }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = placement === 'bottom-end' ? r.right - w : placement === 'right-start' ? r.right + 4 : r.left;
    let top = placement === 'top-start' ? r.top - h - 4 : placement === 'right-start' ? r.top : r.bottom + 4;
    if (top + h > vh - 8) top = Math.max(8, r.top - h - 4);
    if (top < 8) top = 8;
    left = Math.min(Math.max(8, left), vw - w - 8);
    setPos({ left, top });
  }, [anchor, placement]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchor instanceof HTMLElement && anchor.contains(t)) return;
      // A popover opened from this one (a time list in a reminder's popover) is part of it.
      const other = (t as Element).closest?.('.popover');
      if (other && other !== ref.current && ref.current && other.compareDocumentPosition(ref.current) & Node.DOCUMENT_POSITION_PRECEDING) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      className={`popover ${className ?? ''}`}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Open/close state for a popover anchored to a button. */
export function usePopover<T extends HTMLElement = HTMLButtonElement>(): {
  ref: RefObject<T | null>;
  open: boolean;
  toggle: () => void;
  close: () => void;
  setOpen: (v: boolean) => void;
} {
  const ref = useRef<T>(null);
  const [open, setOpen] = useState(false);
  return { ref, open, setOpen, toggle: () => setOpen((o) => !o), close: () => setOpen(false) };
}

export interface MenuEntry {
  label: string;
  icon?: ReactNode;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/** A row of small icon-only choices (colors, say): each named by its label, which shows as a tooltip. */
export interface MenuRow {
  row: (MenuEntry & { checked?: boolean })[];
}

export type MenuItemSpec = MenuEntry | 'sep' | { heading: string } | MenuRow;

export function MenuList({ items, onClose }: { items: MenuItemSpec[]; onClose: () => void }) {
  return (
    <div role="menu">
      {items.map((it, i) => {
        if (it === 'sep') return <div key={i} className="menu-sep" />;
        if ('heading' in it)
          return (
            <div key={i} className="menu-label">
              {it.heading}
            </div>
          );
        if ('row' in it)
          return (
            <div key={i} className="menu-row" role="group">
              {it.row.map((r, j) => (
                <button
                  key={j}
                  role={r.checked === undefined ? 'menuitem' : 'menuitemradio'}
                  aria-checked={r.checked}
                  aria-label={r.label}
                  data-tip={r.label}
                  className={`menu-row-item ${r.checked ? 'is-checked' : ''}`}
                  disabled={r.disabled}
                  onClick={() => {
                    onClose();
                    r.onSelect();
                  }}
                >
                  {r.icon}
                </button>
              ))}
            </div>
          );
        return (
          <button
            key={i}
            role="menuitem"
            className={`menu-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
          >
            {it.icon}
            <span>{it.label}</span>
            {it.hint && <span className="menu-hint">{it.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** A button that opens a menu. */
export function MenuButton({
  items,
  children,
  className = 'icon-btn',
  title,
  label,
  placement = 'bottom-end',
}: {
  items: MenuItemSpec[] | (() => MenuItemSpec[]);
  children: ReactNode;
  className?: string;
  /** Its name, shown as a tooltip too. */
  title?: string;
  /** Its name without a tooltip, for a button whose words already say what it is. */
  label?: string;
  placement?: Placement;
}) {
  const p = usePopover();
  return (
    <>
      <button
        ref={p.ref}
        className={className}
        title={label ? undefined : title}
        aria-label={label ?? title}
        onClick={(e) => {
          e.stopPropagation();
          p.toggle();
        }}
      >
        {children}
      </button>
      {p.open && (
        <Popover anchor={p.ref.current} onClose={p.close} placement={placement}>
          <MenuList items={typeof items === 'function' ? items() : items} onClose={p.close} />
        </Popover>
      )}
    </>
  );
}

/** Context menu at the mouse position. */
const useContextMenu = create<{ at: DOMRect | null; items: MenuItemSpec[] }>(() => ({ at: null, items: [] }));

export function openContextMenu(e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuItemSpec[]) {
  e.preventDefault();
  useContextMenu.setState({ at: new DOMRect(e.clientX, e.clientY, 0, 0), items });
}

export function ContextMenuHost() {
  const { at, items } = useContextMenu();
  if (!at) return null;
  const close = () => useContextMenu.setState({ at: null });
  return (
    <Popover anchor={at} onClose={close}>
      <MenuList items={items} onClose={close} />
    </Popover>
  );
}

// ───────────── Dialogs ─────────────

interface DialogEntry {
  id: number;
  render: (close: () => void) => ReactNode;
}

const useDialogs = create<{ stack: DialogEntry[] }>(() => ({ stack: [] }));
let dialogSeq = 0;

export function openDialog(render: (close: () => void) => ReactNode): () => void {
  const id = ++dialogSeq;
  const close = () => useDialogs.setState((s) => ({ stack: s.stack.filter((d) => d.id !== id) }));
  useDialogs.setState((s) => ({ stack: [...s.stack, { id, render }] }));
  return close;
}

export function DialogHost() {
  const stack = useDialogs((s) => s.stack);
  return (
    <>
      {stack.map((d) => {
        const close = () => useDialogs.setState((s) => ({ stack: s.stack.filter((x) => x.id !== d.id) }));
        return <div key={d.id}>{d.render(close)}</div>;
      })}
    </>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Dialogs open now: while there is one, the page behind it cannot be reached (inert). */
let openModals = 0;
function setBackgroundInert(on: boolean) {
  // Everything the app shows, except the toasts (whose Undo or Try again stay at hand).
  for (const el of document.querySelectorAll<HTMLElement>('#root > *:not(.toasts)')) el.inert = on;
}

/**
 * Keyboard focus belongs to the dialog on top: it starts there, Tab and Shift+Tab go round inside it
 * (a menu opened from it keeps its own), and on closing it goes back to what opened the dialog.
 */
function useModalFocus(backdrop: RefObject<HTMLDivElement | null>, dialog: RefObject<HTMLDivElement | null>) {
  // What had focus before the dialog (read while it renders, before a field of it takes focus).
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    openModals++;
    setBackgroundInert(true);
    // A field with autoFocus already has it; otherwise the dialog itself.
    if (!d.contains(document.activeElement)) d.focus({ preventScroll: true });
    const onTop = () => {
      const all = document.querySelectorAll('.dialog-backdrop');
      return all[all.length - 1] === backdrop.current;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !onTop()) return;
      const active = document.activeElement;
      if (active instanceof Element && !d.contains(active) && active.closest('.popover, .gc-palette, .gc-tour, .toasts')) return;
      const items = [...d.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      e.preventDefault();
      if (!items.length) return d.focus();
      const at = active instanceof HTMLElement ? items.indexOf(active) : -1;
      const next = at < 0 ? (e.shiftKey ? items.length - 1 : 0) : (at + (e.shiftKey ? -1 : 1) + items.length) % items.length;
      items[next].focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      openModals = Math.max(0, openModals - 1);
      if (!openModals) setBackgroundInert(false);
      // Back to what opened it, unless the dialog's work already put focus somewhere (a new page's
      // title). Not into the text of a page: its editor puts the cursor back where it was itself
      // (focusing the text from here would move the cursor to its start).
      // After the key or click that closed it is done: back on the opener during that Enter, the
      // same keystroke would press it again.
      setTimeout(() => {
        const now = document.activeElement;
        const lost = !now || now === document.body || !now.isConnected || d.contains(now);
        if (lost && opener?.isConnected && !opener.isContentEditable && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
      });
    };
  }, [backdrop, dialog, opener]);
}

export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide,
  className,
  icon,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  className?: string;
  icon?: ReactNode;
}) {
  const backdrop = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalFocus(backdrop, box);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const all = document.querySelectorAll('.dialog-backdrop');
      if (all[all.length - 1] !== backdrop.current) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div
      ref={backdrop}
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        tabIndex={-1}
        className={`dialog ${wide ? 'dialog-wide' : ''} ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dialog-header">
          {icon}
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function confirmDialog(opts: { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    openDialog((close) => {
      const done = (v: boolean) => {
        close();
        resolve(v);
      };
      return (
        <Dialog
          title={opts.title}
          onClose={() => done(false)}
          footer={
            <>
              <button className="btn" onClick={() => done(false)}>
                Cancel
              </button>
              <button className={`btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`} autoFocus onClick={() => done(true)}>
                {opts.confirmLabel ?? 'OK'}
              </button>
            </>
          }
        >
          <div style={{ color: 'var(--text-2)' }}>{opts.message}</div>
        </Dialog>
      );
    });
  });
}

function PromptBody({
  opts,
  done,
}: {
  opts: { title: string; label?: string; defaultValue?: string; placeholder?: string; confirmLabel?: string; hint?: string };
  done: (v: string | null) => void;
}) {
  const [value, setValue] = useState(opts.defaultValue ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useRef(`prompt-${Math.random().toString(36).slice(2)}`).current;
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  return (
    <Dialog
      title={opts.title}
      onClose={() => done(null)}
      footer={
        <>
          <button className="btn" onClick={() => done(null)}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!value.trim()} onClick={() => done(value.trim())}>
            {opts.confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) done(value.trim());
        }}
      >
        <div className="field">
          {opts.label && <label htmlFor={id}>{opts.label}</label>}
          <input id={id} ref={inputRef} className="input" value={value} placeholder={opts.placeholder} onChange={(e) => setValue(e.target.value)} />
          {opts.hint && <span className="field-hint">{opts.hint}</span>}
        </div>
      </form>
    </Dialog>
  );
}

export function promptDialog(opts: {
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  hint?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    openDialog((close) => (
      <PromptBody
        opts={opts}
        done={(v) => {
          close();
          resolve(v);
        }}
      />
    ));
  });
}
