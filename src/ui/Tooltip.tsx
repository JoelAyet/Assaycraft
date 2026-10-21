import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Quick tooltips for buttons that are only an icon: a name, what it does and its shortcut, shown
 * after a short pause under the mouse (the browser's own title tooltips take a second or more and
 * are easy to miss). Mark a button with data-tip="Bold", and optionally data-tip-desc and data-tip-key.
 */
const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent);

/** "Mod+Shift+S" → "⌘⇧S" on a Mac, "Ctrl+Shift+S" elsewhere. */
export function shortcutLabel(keys: string): string {
  if (!isMac()) return keys.replace(/Mod/g, 'Ctrl');
  return keys
    .replace(/Mod\+?/g, '⌘')
    .replace(/Shift\+?/g, '⇧')
    .replace(/Alt\+?/g, '⌥');
}

/** Attributes for a button with a tooltip (its accessible name is the tooltip's name). */
export function tip(name: string, desc?: string, keys?: string) {
  return {
    'aria-label': name,
    'data-tip': name,
    ...(desc ? { 'data-tip-desc': desc } : {}),
    ...(keys ? { 'data-tip-key': shortcutLabel(keys), 'aria-keyshortcuts': keys.replace(/Mod/g, isMac() ? 'Meta' : 'Control') } : {}),
  };
}

interface Shown {
  name: string;
  desc?: string;
  keys?: string;
  x: number;
  y: number;
  above: boolean;
}

export function TooltipHost() {
  const [shown, setShown] = useState<Shown | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLElement | null = null;
    const hide = () => {
      clearTimeout(timer);
      current = null;
      setShown(null);
    };
    const over = (e: PointerEvent) => {
      // Not on touch, and not while dragging (across plate wells, say).
      if (e.pointerType !== 'mouse' || e.buttons) return;
      const el = (e.target as Element | null)?.closest<HTMLElement>('[data-tip]') ?? null;
      if (el === current) return;
      hide();
      if (!el) return;
      current = el;
      timer = setTimeout(() => {
        if (!current?.isConnected) return;
        const r = current.getBoundingClientRect();
        const above = r.bottom + 90 > window.innerHeight;
        setShown({
          name: current.dataset.tip ?? '',
          desc: current.dataset.tipDesc,
          keys: current.dataset.tipKey,
          x: Math.min(window.innerWidth - 130, Math.max(130, r.left + r.width / 2)),
          y: above ? r.top - 8 : r.bottom + 8,
          above,
        });
      }, 350);
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    window.addEventListener('scroll', hide, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);
  if (!shown) return null;
  return createPortal(
    <div className={`gc-tip ${shown.above ? 'is-above' : ''}`} role="tooltip" style={{ left: shown.x, top: shown.y }}>
      <span className="gc-tip-head">
        <strong>{shown.name}</strong>
        {shown.keys && <kbd>{shown.keys}</kbd>}
      </span>
      {shown.desc && <span className="gc-tip-desc">{shown.desc}</span>}
    </div>,
    document.body,
  );
}
