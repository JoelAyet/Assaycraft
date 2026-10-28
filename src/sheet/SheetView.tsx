import { NodeViewWrapper, useEditorState, type NodeViewProps } from '@tiptap/react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { ArrowDownAZ, ArrowUpAZ, Columns3, Download, FileUp, MoreHorizontal, Plus, Rows3, Snowflake, Table2, Trash2 } from 'lucide-react';
import { useDocContext } from '../editor/context';
import { MenuButton, openContextMenu, type MenuItemSpec } from '../ui/overlay';
import { canInsertRefAt, evaluateSheet, findRefs, isFormula, parseLiteral, shiftFormula } from './formula';
import { cellName, colName, inRect, rectOf, type Rect } from './refs';
import {
  CELL_COLORS,
  DEFAULT_COL_WIDTH,
  deleteCols,
  deleteRows,
  ensureSize,
  insertCols,
  insertRows,
  normalizeSheet,
  setCellColor,
  setCells,
  setFreeze,
  sortByColumn,
  type SheetData,
} from './model';
import { parseDelimited, sniffDelimiter, toDelimited } from './tsv';
import { fillText } from '../templates/engine';
import { downloadBlob, pickFiles } from '../lib/download';
import { rememberInsertionPoint } from '../editor/insertion';

type Pos = { r: number; c: number };
type DOMRectLike = { left: number; top: number; width: number; height: number };
interface Editing {
  r: number;
  c: number;
  value: string;
  /** "enter": started by typing (arrows commit); "edit": F2/double-click (arrows move the caret) */
  mode: 'enter' | 'edit';
  source: 'cell' | 'bar';
}

const REF_COLORS = ['#2563eb', '#db2777', '#16a34a', '#9333ea', '#ea580c', '#0891b2'];
const ROW_HEAD = 38;

/** Internal clipboard so copy/paste inside Assaycraft keeps formulas (shifted like Excel). */
let clipboard: { text: string; cells: string[][]; origin: Pos } | null = null;
/** Set by the "insert table" command so the new sheet starts in edit mode. */
let focusNextSheet = false;
export function focusNextInsertedSheet() {
  focusNextSheet = true;
}

function sub(grid: string[][], r: Rect): string[][] {
  const out: string[][] = [];
  for (let i = r.r1; i <= r.r2; i++) out.push(grid[i]?.slice(r.c1, r.c2 + 1) ?? []);
  return out;
}

function fromTextField(e: { target: EventTarget }): boolean {
  return !!(e.target as HTMLElement).closest?.('input, textarea');
}

function htmlTable(cells: string[][]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
  return `<table>${cells.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
}

function tableFromHtml(html: string): string[][] | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  return Array.from(table.querySelectorAll('tr')).map((tr) => Array.from(tr.querySelectorAll('td,th')).map((td) => (td.textContent ?? '').trim()));
}

/** Arithmetic series detection for the fill handle: [1, 2] → 3, 4, … */
function seriesStep(values: string[]): number | null {
  if (values.length < 2 || values.some((v) => isFormula(v) || v.trim() === '')) return null;
  const nums = values.map((v) => parseLiteral(v));
  if (nums.some((n) => typeof n !== 'number')) return null;
  const ns = nums as number[];
  const step = ns[1] - ns[0];
  for (let i = 2; i < ns.length; i++) if (Math.abs(ns[i] - ns[i - 1] - step) > 1e-9) return null;
  return step;
}

export function SheetView({ node, updateAttributes, editor, getPos, deleteNode }: NodeViewProps) {
  const ctx = useDocContext();
  const editable = useEditorState({ editor, selector: (s) => s.editor.isEditable });
  const data = useMemo(() => normalizeSheet(node.attrs.data as SheetData), [node.attrs.data]);
  const nRows = data.rows.length;
  const nCols = data.rows[0].length;
  const templateMode = ctx.kind === 'template' || ctx.kind === 'subtemplate';
  const display = useMemo(
    () => evaluateSheet(templateMode ? data.rows.map((r) => r.map((c) => fillText(c, {}))) : data.rows),
    [data.rows, templateMode],
  );

  const [sel, setSel] = useState<{ a: Pos; f: Pos } | null>(null);
  const [editing, setEditingState] = useState<Editing | null>(null);
  const [active, setActive] = useState(false);
  const [fillRect, setFillRect] = useState<Rect | null>(null);
  const [liveWidths, setLiveWidths] = useState<(number | null)[] | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const barRef = useRef<HTMLInputElement>(null);
  const editingRef = useRef<Editing | null>(null);
  const selRef = useRef(sel);
  selRef.current = sel;
  const drag = useRef<'select' | 'fill' | 'point' | null>(null);
  const point = useRef<{ start: number; len: number; anchor: Pos } | null>(null);

  const setEditing = (e: Editing | null) => {
    editingRef.current = e;
    setEditingState(e);
  };

  /** Latest data straight from the document (props may lag behind a just-dispatched change). */
  const current = useCallback((): SheetData => {
    const pos = getPos();
    const n = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null;
    return normalizeSheet((n && n.type.name === 'spreadsheet' ? n.attrs.data : node.attrs.data) as SheetData);
  }, [editor, getPos, node.attrs.data]);

  const write = useCallback((next: SheetData) => updateAttributes({ data: next }), [updateAttributes]);

  const clamp = useCallback(
    (p: Pos, d: SheetData = data): Pos => ({
      r: Math.max(0, Math.min(d.rows.length - 1, p.r)),
      c: Math.max(0, Math.min(d.rows[0].length - 1, p.c)),
    }),
    [data],
  );

  const focusGrid = () => containerRef.current?.focus({ preventScroll: true });

  const scrollToCell = (p: Pos) => {
    requestAnimationFrame(() => {
      const td = containerRef.current?.querySelector<HTMLElement>(`td[data-r="${p.r}"][data-c="${p.c}"]`);
      td?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  };

  const select = (a: Pos, f: Pos = a, d?: SheetData) => {
    const ca = clamp(a, d);
    const cf = clamp(f, d);
    setSel({ a: ca, f: cf });
    scrollToCell(cf);
  };

  const rect = sel ? rectOf(sel.a, sel.f) : null;

  // New tables start in edit mode on the first header cell.
  useEffect(() => {
    if (focusNextSheet && editable) {
      focusNextSheet = false;
      setSel({ a: { r: 0, c: 0 }, f: { r: 0, c: 0 } });
      setEditing({ r: 0, c: 0, value: '', mode: 'enter', source: 'cell' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!editing || editing.source !== 'cell') return;
    const el = inputRef.current;
    if (el && document.activeElement !== el) {
      el.focus({ preventScroll: true });
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [editing]);

  const startEdit = (p: Pos, mode: Editing['mode'], initial?: string, source: Editing['source'] = 'cell') => {
    if (!editable) return;
    const raw = current().rows[p.r]?.[p.c] ?? '';
    setEditing({ r: p.r, c: p.c, value: initial ?? raw, mode, source });
    setSel({ a: p, f: p });
  };

  const commitEdit = (move?: { dr: number; dc: number }, keepFocus = true) => {
    const e = editingRef.current;
    if (!e) return;
    let d = current();
    if ((d.rows[e.r]?.[e.c] ?? '') !== e.value) {
      d = setCells(d, [{ r: e.r, c: e.c, v: e.value }]);
      write(d);
    }
    setEditing(null);
    point.current = null;
    if (move) {
      let r = e.r + move.dr;
      let c = e.c + move.dc;
      if (c >= d.rows[0].length) {
        c = 0;
        r += 1;
      }
      if (c < 0) {
        c = d.rows[0].length - 1;
        r -= 1;
      }
      if (r >= d.rows.length) {
        if (move.dc > 0) {
          // Tab past the last cell adds a row, like tables in word processors.
          d = insertRows(d, d.rows.length);
          write(d);
        } else r = d.rows.length - 1;
      }
      select({ r, c }, { r, c }, d);
    }
    if (keepFocus) focusGrid();
  };

  const cancelEdit = () => {
    setEditing(null);
    point.current = null;
    focusGrid();
  };

  const clearRect = (r: Rect) => {
    const updates: { r: number; c: number; v: string }[] = [];
    for (let i = r.r1; i <= r.r2; i++) for (let j = r.c1; j <= r.c2; j++) updates.push({ r: i, c: j, v: '' });
    write(setCells(current(), updates));
  };

  /** Copy `src` over `dest` (repeating the pattern), shifting formulas and continuing number series. */
  const fillInto = (src: Rect, dest: Rect) => {
    const d = current();
    const vertical = dest.c1 === src.c1 && dest.c2 === src.c2;
    const mod = (a: number, n: number) => ((a % n) + n) % n;
    const fmt = (n: number) => String(Number(n.toPrecision(12)));
    const updates: { r: number; c: number; v: string }[] = [];
    if (vertical) {
      const h = src.r2 - src.r1 + 1;
      for (let c = dest.c1; c <= dest.c2; c++) {
        const line = Array.from({ length: h }, (_, i) => d.rows[src.r1 + i]?.[c] ?? '');
        const step = seriesStep(line);
        for (let r = dest.r1; r <= dest.r2; r++) {
          if (r >= src.r1 && r <= src.r2) continue;
          if (step !== null) updates.push({ r, c, v: fmt((parseLiteral(line[0]) as number) + step * (r - src.r1)) });
          else {
            const sr = src.r1 + mod(r - src.r1, h);
            const raw = d.rows[sr]?.[c] ?? '';
            updates.push({ r, c, v: isFormula(raw) ? shiftFormula(raw, r - sr, 0) : raw });
          }
        }
      }
    } else {
      const w = src.c2 - src.c1 + 1;
      for (let r = dest.r1; r <= dest.r2; r++) {
        const line = Array.from({ length: w }, (_, i) => d.rows[r]?.[src.c1 + i] ?? '');
        const step = seriesStep(line);
        for (let c = dest.c1; c <= dest.c2; c++) {
          if (c >= src.c1 && c <= src.c2) continue;
          if (step !== null) updates.push({ r, c, v: fmt((parseLiteral(line[0]) as number) + step * (c - src.c1)) });
          else {
            const sc = src.c1 + mod(c - src.c1, w);
            const raw = d.rows[r]?.[sc] ?? '';
            updates.push({ r, c, v: isFormula(raw) ? shiftFormula(raw, 0, c - sc) : raw });
          }
        }
      }
    }
    write(setCells(d, updates));
  };

  const fillDown = () => {
    if (!rect) return;
    if (rect.r2 > rect.r1) fillInto({ ...rect, r2: rect.r1 }, rect);
    else if (rect.r1 > 0) fillInto({ ...rect, r1: rect.r1 - 1, r2: rect.r1 - 1 }, { ...rect, r1: rect.r1 - 1 });
  };
  const fillRight = () => {
    if (!rect) return;
    if (rect.c2 > rect.c1) fillInto({ ...rect, c2: rect.c1 }, rect);
    else if (rect.c1 > 0) fillInto({ ...rect, c1: rect.c1 - 1, c2: rect.c1 - 1 }, { ...rect, c1: rect.c1 - 1 });
  };

  const exitToEditor = () => {
    setSel(null);
    const pos = getPos();
    if (typeof pos === 'number')
      editor
        .chain()
        .focus(pos + node.nodeSize)
        .run();
  };

  // ───────────── keyboard (grid) ─────────────

  const onGridKeyDown = (e: ReactKeyboardEvent) => {
    if (editingRef.current || fromTextField(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key;
    if (mod && key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) editor.commands.redo();
      else editor.commands.undo();
      return;
    }
    if (mod && key.toLowerCase() === 'y') {
      e.preventDefault();
      editor.commands.redo();
      return;
    }
    if (!sel) return;
    const f = sel.f;
    const go = (r: number, c: number) => {
      e.preventDefault();
      const nf = clamp({ r, c });
      if (e.shiftKey) setSel({ a: sel.a, f: nf });
      else select(nf);
      scrollToCell(nf);
    };
    switch (key) {
      case 'ArrowUp':
        return go(mod ? 0 : f.r - 1, f.c);
      case 'ArrowDown':
        return go(mod ? nRows - 1 : f.r + 1, f.c);
      case 'ArrowLeft':
        return go(f.r, mod ? 0 : f.c - 1);
      case 'ArrowRight':
        return go(f.r, mod ? nCols - 1 : f.c + 1);
      case 'Home':
        return go(mod ? 0 : f.r, 0);
      case 'End':
        return go(mod ? nRows - 1 : f.r, nCols - 1);
      case 'Tab': {
        e.preventDefault();
        let r = f.r;
        let c = f.c + (e.shiftKey ? -1 : 1);
        if (c >= nCols) {
          c = 0;
          r++;
        }
        if (c < 0) {
          c = nCols - 1;
          r--;
        }
        if (r >= nRows || r < 0) return exitToEditor();
        return select({ r, c });
      }
      case 'Enter':
      case 'F2':
        e.preventDefault();
        return startEdit(f, 'edit');
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        if (editable && rect) clearRect(rect);
        return;
      case 'Escape':
        e.preventDefault();
        return exitToEditor();
    }
    if (mod && key.toLowerCase() === 'a') {
      e.preventDefault();
      setSel({ a: { r: 0, c: 0 }, f: { r: nRows - 1, c: nCols - 1 } });
      return;
    }
    if (mod && key.toLowerCase() === 'd' && editable) {
      e.preventDefault();
      return fillDown();
    }
    if (mod && key.toLowerCase() === 'r' && editable) {
      e.preventDefault();
      return fillRight();
    }
    if (!mod && !e.altKey && key.length === 1 && editable) {
      e.preventDefault();
      startEdit(f, 'enter', key);
    }
  };

  // ───────────── keyboard (cell editor) ─────────────

  const onEditKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const ed = editingRef.current;
    if (!ed) return;
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      return cancelEdit();
    }
    if (e.key === 'Enter' && e.altKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const s = el.selectionStart ?? ed.value.length;
      const v = ed.value.slice(0, s) + '\n' + ed.value.slice(el.selectionEnd ?? s);
      setEditing({ ...ed, value: v });
      requestAnimationFrame(() => el.setSelectionRange(s + 1, s + 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      return commitEdit({ dr: e.shiftKey ? -1 : 1, dc: 0 });
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      return commitEdit({ dr: 0, dc: e.shiftKey ? -1 : 1 });
    }
    if (ed.mode === 'enter' && ed.source === 'cell' && e.key.startsWith('Arrow')) {
      const el = e.currentTarget;
      if (ed.value.startsWith('=') && canInsertRefAt(ed.value, el.selectionStart ?? 0)) return; // let the user keep typing a formula
      e.preventDefault();
      const dr = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      const dc = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      return commitEdit({ dr, dc });
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') e.stopPropagation();
  };

  // ───────────── mouse ─────────────

  const insertAtCaret = (text: string, from?: number, to?: number) => {
    const ed = editingRef.current;
    const el = ed?.source === 'bar' ? barRef.current : inputRef.current;
    if (!ed || !el) return null;
    const start = from ?? el.selectionStart ?? ed.value.length;
    const end = to ?? el.selectionEnd ?? start;
    const v = ed.value.slice(0, start) + text + ed.value.slice(end);
    setEditing({ ...ed, value: v, mode: 'edit' });
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      el.setSelectionRange(start + text.length, start + text.length);
    });
    return { start, len: text.length };
  };

  const onCellMouseDown = (e: ReactMouseEvent, r: number, c: number) => {
    if (e.button === 2) {
      if (!rect || !inRect(rect, r, c)) select({ r, c });
      return;
    }
    const ed = editingRef.current;
    if (ed) {
      const el = ed.source === 'bar' ? barRef.current : inputRef.current;
      const caret = el?.selectionStart ?? ed.value.length;
      if (ed.value.startsWith('=') && canInsertRefAt(ed.value, caret) && !(ed.r === r && ed.c === c)) {
        e.preventDefault();
        const ins = insertAtCaret(cellName(r, c));
        if (ins) {
          point.current = { ...ins, anchor: { r, c } };
          drag.current = 'point';
        }
        return;
      }
      if (ed.r === r && ed.c === c) return;
      commitEdit(undefined, false);
    }
    e.preventDefault();
    focusGrid();
    if (e.shiftKey && sel) setSel({ a: sel.a, f: { r, c } });
    else setSel({ a: { r, c }, f: { r, c } });
    drag.current = 'select';
  };

  const onCellEnter = (r: number, c: number) => {
    if (drag.current === 'select') setSel((s) => (s ? { a: s.a, f: { r, c } } : s));
    else if (drag.current === 'fill' && rect) {
      const below = r - rect.r2;
      const above = rect.r1 - r;
      const right = c - rect.c2;
      const left = rect.c1 - c;
      const v = Math.max(below, above);
      const h = Math.max(right, left);
      if (v <= 0 && h <= 0) setFillRect(null);
      else if (v >= h) setFillRect(below > 0 ? { ...rect, r2: r } : { ...rect, r1: r });
      else setFillRect(right > 0 ? { ...rect, c2: c } : { ...rect, c1: c });
    } else if (drag.current === 'point' && point.current) {
      const p = point.current;
      const ref =
        p.anchor.r === r && p.anchor.c === c
          ? cellName(r, c)
          : `${cellName(Math.min(p.anchor.r, r), Math.min(p.anchor.c, c))}:${cellName(Math.max(p.anchor.r, r), Math.max(p.anchor.c, c))}`;
      const ins = insertAtCaret(ref, p.start, p.start + p.len);
      if (ins) point.current = { ...p, len: ins.len };
    }
  };

  useEffect(() => {
    const up = () => {
      if (drag.current === 'fill' && fillRect && rect) fillInto(rect, fillRect);
      if (drag.current === 'fill' && fillRect) setSel({ a: { r: fillRect.r1, c: fillRect.c1 }, f: { r: fillRect.r2, c: fillRect.c2 } });
      drag.current = null;
      setFillRect(null);
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  });

  const selectColumn = (e: ReactMouseEvent, c: number) => {
    e.preventDefault();
    if (editingRef.current) commitEdit(undefined, false);
    focusGrid();
    const a = e.shiftKey && sel ? { r: 0, c: sel.a.c } : { r: 0, c };
    setSel({ a, f: { r: nRows - 1, c } });
  };
  const selectRow = (e: ReactMouseEvent, r: number) => {
    e.preventDefault();
    if (editingRef.current) commitEdit(undefined, false);
    focusGrid();
    const a = e.shiftKey && sel ? { r: sel.a.r, c: 0 } : { r, c: 0 };
    setSel({ a, f: { r, c: nCols - 1 } });
  };

  const widths = liveWidths ?? data.widths ?? [];
  const widthOf = (c: number) => widths[c] ?? DEFAULT_COL_WIDTH;

  const startResize = (e: ReactMouseEvent, c: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthOf(c);
    const base = Array.from({ length: nCols }, (_, i) => (data.widths?.[i] ?? null) as number | null);
    let latest = base;
    const move = (ev: MouseEvent) => {
      latest = [...base];
      latest[c] = Math.max(48, Math.round(startW + ev.clientX - startX));
      setLiveWidths(latest);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setLiveWidths(null);
      if (editable) write({ ...current(), widths: latest });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // ───────────── clipboard ─────────────

  const onCopy = (e: React.ClipboardEvent, cut = false) => {
    if (editingRef.current || !rect || fromTextField(e)) return;
    e.preventDefault();
    const raw = sub(current().rows, rect);
    const vals = sub(display, rect);
    const text = toDelimited(vals);
    e.clipboardData.setData('text/plain', text);
    e.clipboardData.setData('text/html', htmlTable(vals));
    clipboard = { text, cells: raw, origin: { r: rect.r1, c: rect.c1 } };
    if (cut && editable) clearRect(rect);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (editingRef.current || !sel || !editable || fromTextField(e)) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    const html = e.clipboardData.getData('text/html');
    let cells: string[][] | null = null;
    let origin: Pos | null = null;
    // Our own copy (or an empty system clipboard, e.g. when clipboard access is restricted).
    if (clipboard && (clipboard.text === text || (!text && !html))) {
      cells = clipboard.cells;
      origin = clipboard.origin;
    } else if (text) cells = parseDelimited(text);
    else cells = tableFromHtml(html);
    if (!cells || !cells.length) return;
    const r0 = rect!.r1;
    const c0 = rect!.c1;
    const single = cells.length === 1 && cells[0].length === 1;
    const target: Rect = single ? rect! : { r1: r0, c1: c0, r2: r0 + cells.length - 1, c2: c0 + Math.max(...cells.map((x) => x.length)) - 1 };
    const updates: { r: number; c: number; v: string }[] = [];
    for (let r = target.r1; r <= target.r2; r++) {
      for (let c = target.c1; c <= target.c2; c++) {
        const sr = single ? 0 : r - r0;
        const sc = single ? 0 : c - c0;
        const v = cells[sr]?.[sc] ?? '';
        const shifted = origin && isFormula(v) ? shiftFormula(v, r - (origin.r + sr), c - (origin.c + sc)) : v;
        updates.push({ r, c, v: shifted });
      }
    }
    const next = setCells(ensureSize(current(), target.r2 + 1, target.c2 + 1), updates);
    write(next);
    setSel({ a: { r: target.r1, c: target.c1 }, f: { r: target.r2, c: target.c2 } });
  };

  // ───────────── structure ─────────────

  const withData = (fn: (d: SheetData) => SheetData) => {
    if (!editable) return;
    write(fn(current()));
  };

  const exportCsv = () => {
    const blob = new Blob([toDelimited(display, ',')], { type: 'text/csv' });
    const name = (display[0]?.[0] || 'table').replace(/[^\w.-]+/g, '_').slice(0, 40);
    downloadBlob(blob, `${name}.csv`);
  };

  const importCsv = async () => {
    const [file] = await pickFiles({ accept: '.csv,.tsv,.txt,text/csv,text/tab-separated-values', multiple: false });
    if (!file) return;
    const text = await file.text();
    const rows = parseDelimited(text, file.name.endsWith('.tsv') ? '\t' : sniffDelimiter(text));
    if (rows.length) write(normalizeSheet({ rows }));
  };

  const contextItems = (): MenuItemSpec[] => {
    const r = rect ?? { r1: 0, c1: 0, r2: 0, c2: 0 };
    const nr = r.r2 - r.r1 + 1;
    const nc = r.c2 - r.c1 + 1;
    const items: MenuItemSpec[] = [];
    if (editable) {
      items.push(
        { label: `Insert ${nr > 1 ? nr + ' rows' : 'row'} above`, icon: <Rows3 />, onSelect: () => withData((d) => insertRows(d, r.r1, nr)) },
        { label: `Insert ${nr > 1 ? nr + ' rows' : 'row'} below`, icon: <Rows3 />, onSelect: () => withData((d) => insertRows(d, r.r2 + 1, nr)) },
        { label: `Insert ${nc > 1 ? nc + ' columns' : 'column'} left`, icon: <Columns3 />, onSelect: () => withData((d) => insertCols(d, r.c1, nc)) },
        {
          label: `Insert ${nc > 1 ? nc + ' columns' : 'column'} right`,
          icon: <Columns3 />,
          onSelect: () => withData((d) => insertCols(d, r.c2 + 1, nc)),
        },
        'sep',
        {
          label: `Delete ${nr > 1 ? nr + ' rows' : 'row'}`,
          icon: <Trash2 />,
          disabled: nr >= nRows,
          onSelect: () => withData((d) => deleteRows(d, r.r1, nr)),
        },
        {
          label: `Delete ${nc > 1 ? nc + ' columns' : 'column'}`,
          icon: <Trash2 />,
          disabled: nc >= nCols,
          onSelect: () => withData((d) => deleteCols(d, r.c1, nc)),
        },
        'sep',
        { label: `Sort by ${colName(r.c1)} (A → Z)`, icon: <ArrowDownAZ />, onSelect: () => withData((d) => sortByColumn(d, r.c1, 1, display)) },
        { label: `Sort by ${colName(r.c1)} (Z → A)`, icon: <ArrowUpAZ />, onSelect: () => withData((d) => sortByColumn(d, r.c1, -1, display)) },
        'sep',
        { label: 'Fill down', hint: 'Ctrl+D', onSelect: fillDown },
        { label: 'Fill right', hint: 'Ctrl+R', onSelect: fillRight },
        { label: 'Clear cells', hint: 'Del', onSelect: () => rect && clearRect(rect) },
        'sep',
        { heading: 'Cell colour' },
        {
          row: [
            {
              label: 'No colour',
              icon: <span className="gc-cell-swatch is-none" />,
              onSelect: () => withData((d) => setCellColor(d, r, null)),
            },
            ...CELL_COLORS.map((color) => ({
              label: `Fill ${color}`,
              icon: <span className="gc-cell-swatch" data-bg={color} />,
              checked: data.colors?.[cellName(r.r1, r.c1)] === color,
              onSelect: () => withData((d) => setCellColor(d, r, color)),
            })),
          ],
        },
        'sep',
        data.freeze === r.c2 + 1
          ? { label: 'Unfreeze columns', icon: <Snowflake />, onSelect: () => withData((d) => setFreeze(d, 0)) }
          : {
              label: r.c2 === 0 ? 'Freeze column A' : `Freeze columns A–${colName(r.c2)}`,
              icon: <Snowflake />,
              onSelect: () => withData((d) => setFreeze(d, r.c2 + 1)),
            },
        'sep',
      );
    }
    items.push({ label: 'Export as CSV', icon: <Download />, onSelect: exportCsv });
    return items;
  };

  const tableMenu = (): MenuItemSpec[] => [
    ...(editable
      ? [
          { label: 'Add row', icon: <Rows3 />, onSelect: () => withData((d) => insertRows(d, d.rows.length)) } as MenuItemSpec,
          { label: 'Add column', icon: <Columns3 />, onSelect: () => withData((d) => insertCols(d, d.rows[0].length)) } as MenuItemSpec,
          { label: 'Import CSV / TSV…', icon: <FileUp />, onSelect: importCsv } as MenuItemSpec,
          (data.freeze
            ? { label: 'Unfreeze columns', icon: <Snowflake />, onSelect: () => withData((d) => setFreeze(d, 0)) }
            : { label: 'Freeze column A', icon: <Snowflake />, onSelect: () => withData((d) => setFreeze(d, 1)) }) as MenuItemSpec,
        ]
      : []),
    { label: 'Export as CSV', icon: <Download />, onSelect: exportCsv },
    ...(editable ? (['sep', { label: 'Delete table', icon: <Trash2 />, danger: true, onSelect: () => deleteNode() }] as MenuItemSpec[]) : []),
  ];

  // ───────────── render ─────────────

  const editRefs = useMemo(() => (editing && editing.value.startsWith('=') ? findRefs(editing.value) : []), [editing]);
  const refColor = (r: number, c: number): string | null => {
    for (let i = 0; i < editRefs.length; i++) {
      const x = editRefs[i];
      if (r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2) return REF_COLORS[i % REF_COLORS.length];
    }
    return null;
  };

  // Selection / fill rectangles are drawn as overlays measured from the cells.
  const [boxes, setBoxes] = useState<{ sel: DOMRectLike | null; fill: DOMRectLike | null }>({ sel: null, fill: null });
  useLayoutEffect(() => {
    const root = containerRef.current;
    const measure = (r: Rect | null): DOMRectLike | null => {
      if (!root || !r) return null;
      const a = root.querySelector<HTMLElement>(`td[data-r="${r.r1}"][data-c="${r.c1}"]`);
      const b = root.querySelector<HTMLElement>(`td[data-r="${r.r2}"][data-c="${r.c2}"]`);
      if (!a || !b) return null;
      const table = a.closest('table') as HTMLElement;
      const left = table.offsetLeft + a.offsetLeft;
      const top = table.offsetTop + a.offsetTop;
      return {
        left,
        top,
        width: table.offsetLeft + b.offsetLeft + b.offsetWidth - left,
        height: table.offsetTop + b.offsetTop + b.offsetHeight - top,
      };
    };
    const showSelNow = active || !!editing;
    const next = { sel: showSelNow ? measure(rect) : null, fill: measure(fillRect) };
    setBoxes((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  });

  const focusRaw = sel ? (data.rows[sel.f.r]?.[sel.f.c] ?? '') : '';
  const barValue = editing ? editing.value : focusRaw;
  const nameBox = rect
    ? rect.r1 === rect.r2 && rect.c1 === rect.c2
      ? cellName(rect.r1, rect.c1)
      : `${cellName(rect.r1, rect.c1)}:${cellName(rect.r2, rect.c2)}`
    : '';
  const totalWidth = ROW_HEAD + Array.from({ length: nCols }, (_, c) => widthOf(c)).reduce((a, b) => a + b, 0);
  // Frozen columns stay in view when the table scrolls sideways: each sticks where the ones before it end.
  const frozen = Math.min(data.freeze ?? 0, nCols);
  const stickLeft = (c: number) => ROW_HEAD + Array.from({ length: c }, (_, i) => widthOf(i)).reduce((a, b) => a + b, 0);
  const showSel = active || !!editing;

  return (
    <NodeViewWrapper
      className={`gc-sheet ${showSel ? 'is-active' : ''}`}
      onFocus={() => {
        setActive(true);
        const pos = getPos();
        if (typeof pos === 'number') rememberInsertionPoint(editor, pos + node.nodeSize);
      }}
      onBlur={(e: React.FocusEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          if (editingRef.current) commitEdit(undefined, false);
          setActive(false);
        }
      }}
    >
      <div className="gc-sheet-bar" contentEditable={false}>
        <Table2 className="gc-sheet-icon" />
        <span className="gc-sheet-name mono">{nameBox || `${nRows}×${nCols}`}</span>
        <input
          ref={barRef}
          className="gc-sheet-formula mono"
          value={barValue}
          placeholder={sel ? (editable ? 'Type a value or =formula' : '') : 'Select a cell'}
          disabled={!sel || !editable}
          onFocus={() => {
            if (sel && !editingRef.current) startEdit(sel.f, 'edit', undefined, 'bar');
            else if (editingRef.current) setEditing({ ...editingRef.current, source: 'bar' });
          }}
          onChange={(e) => editingRef.current && setEditing({ ...editingRef.current, value: e.target.value })}
          onKeyDown={onEditKeyDown}
        />
        {editable && (
          <>
            <button className="icon-btn icon-btn-sm" title="Add row" onClick={() => withData((d) => insertRows(d, d.rows.length))}>
              <Rows3 />
            </button>
            <button className="icon-btn icon-btn-sm" title="Add column" onClick={() => withData((d) => insertCols(d, d.rows[0].length))}>
              <Columns3 />
            </button>
          </>
        )}
        <MenuButton items={tableMenu} className="icon-btn icon-btn-sm" title="Table options">
          <MoreHorizontal />
        </MenuButton>
      </div>
      <div
        ref={containerRef}
        className="gc-sheet-scroll"
        tabIndex={0}
        contentEditable={false}
        onKeyDown={onGridKeyDown}
        onCopy={(e) => onCopy(e)}
        onCut={(e) => onCopy(e, true)}
        onPaste={onPaste}
        onContextMenu={(e) => openContextMenu(e, contextItems())}
      >
        <table className={`gc-sheet-grid ${frozen ? 'has-frozen' : ''}`} style={{ width: totalWidth }}>
          <colgroup>
            <col style={{ width: ROW_HEAD }} />
            {Array.from({ length: nCols }, (_, c) => (
              <col key={c} style={{ width: widthOf(c) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                className="gc-corner"
                onMouseDown={(e) => {
                  e.preventDefault();
                  focusGrid();
                  setSel({ a: { r: 0, c: 0 }, f: { r: nRows - 1, c: nCols - 1 } });
                }}
              />
              {Array.from({ length: nCols }, (_, c) => (
                <th
                  key={c}
                  className={`gc-colhead ${showSel && rect && c >= rect.c1 && c <= rect.c2 ? 'is-hl' : ''} ${c < frozen ? 'is-frozen' : ''} ${c === frozen - 1 ? 'is-frozen-edge' : ''}`}
                  style={c < frozen ? { left: stickLeft(c) } : undefined}
                  onMouseDown={(e) => selectColumn(e, c)}
                >
                  {colName(c)}
                  {editable && <span className="gc-resize" onMouseDown={(e) => startResize(e, c)} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, r) => (
              <tr key={r} className={r === 0 ? 'gc-header-row' : undefined}>
                <th className={`gc-rowhead ${showSel && rect && r >= rect.r1 && r <= rect.r2 ? 'is-hl' : ''}`} onMouseDown={(e) => selectRow(e, r)}>
                  {r + 1}
                </th>
                {row.map((raw, c) => {
                  const shown = display[r]?.[c] ?? '';
                  const isEditing = editing?.source === 'cell' && editing.r === r && editing.c === c;
                  const inSel = showSel && rect ? inRect(rect, r, c) : false;
                  const inFill = fillRect ? inRect(fillRect, r, c) && !(rect && inRect(rect, r, c)) : false;
                  const isFocus = showSel && sel?.f.r === r && sel?.f.c === c;
                  const num = r > 0 && shown !== '' && typeof parseLiteral(shown) === 'number';
                  const err = shown.startsWith('#') && isFormula(raw);
                  const rc = editing ? refColor(r, c) : null;
                  const multi = !!rect && (rect.r1 !== rect.r2 || rect.c1 !== rect.c2);
                  const cls = [
                    inSel && multi && !isFocus ? 'in-sel' : '',
                    inFill ? 'in-fill' : '',
                    num ? 'is-num' : '',
                    err ? 'is-err' : '',
                    isEditing ? 'is-editing' : '',
                    c < frozen ? 'is-frozen' : '',
                    c === frozen - 1 ? 'is-frozen-edge' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <td
                      key={c}
                      data-r={r}
                      data-c={c}
                      className={cls}
                      data-bg={data.colors?.[cellName(r, c)]}
                      style={{
                        ...(rc ? { boxShadow: `inset 0 0 0 2px ${rc}` } : {}),
                        ...(c < frozen ? { left: stickLeft(c) } : {}),
                      }}
                      title={isFormula(raw) ? raw : undefined}
                      onMouseDown={(e) => onCellMouseDown(e, r, c)}
                      onMouseEnter={() => onCellEnter(r, c)}
                      onDoubleClick={() => startEdit({ r, c }, 'edit')}
                    >
                      {isEditing ? (
                        <textarea
                          ref={inputRef}
                          className="gc-cell-input"
                          aria-label={`Cell ${cellName(r, c)}`}
                          value={editing.value}
                          rows={Math.max(1, editing.value.split('\n').length)}
                          spellCheck={false}
                          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                          onKeyDown={onEditKeyDown}
                          onMouseDown={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="gc-cell-text">{shown}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {boxes.sel && (
          <div className="gc-sel-box" style={{ left: boxes.sel.left, top: boxes.sel.top, width: boxes.sel.width, height: boxes.sel.height }}>
            {!editing && editable && (
              <span
                className="gc-fill-handle"
                title="Drag to fill"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  drag.current = 'fill';
                }}
              />
            )}
          </div>
        )}
        {boxes.fill && (
          <div className="gc-fill-box" style={{ left: boxes.fill.left, top: boxes.fill.top, width: boxes.fill.width, height: boxes.fill.height }} />
        )}
        {editable && (
          <>
            <button
              className="gc-add-row"
              title="Add row"
              onClick={() => withData((d) => insertRows(d, d.rows.length))}
              style={{ width: totalWidth }}
            >
              <Plus />
            </button>
            <button className="gc-add-col" title="Add column" onClick={() => withData((d) => insertCols(d, d.rows[0].length))}>
              <Plus />
            </button>
          </>
        )}
      </div>
    </NodeViewWrapper>
  );
}
