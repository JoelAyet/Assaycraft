import { NodeViewWrapper, useEditorState, type NodeViewProps } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Beaker, Copy, MoreHorizontal, Plus, Scale, Trash2, X } from 'lucide-react';
import { MenuButton, type MenuItemSpec } from '../ui/overlay';
import { toast } from '../notebook/store';
import { rememberInsertionPoint } from '../editor/insertion';
import { toDelimited } from '../sheet/tsv';
import {
  UNIT_GROUPS,
  VOLUME_UNITS,
  bufferTable,
  computeBuffer,
  emptyRow,
  normalizeBuffer,
  splitQuantity,
  unitId,
  type BufferData,
  type BufferRow,
  type RowResult,
} from './calc';

/** Set by the "insert buffer" command so the new buffer starts with the cursor in its first row. */
let focusNextBuffer = false;
export function focusNextInsertedBuffer() {
  focusNextBuffer = true;
}

type Field = 'name' | 'stock' | 'final';
const FIELDS: Field[] = ['name', 'stock', 'final'];

function UnitSelect({
  value,
  onChange,
  stock,
  disabled,
  label,
}: {
  value: string;
  onChange: (unit: string) => void;
  stock: boolean;
  disabled: boolean;
  label: string;
}) {
  const groups = stock ? UNIT_GROUPS : UNIT_GROUPS.filter((g) => !g.ids.includes('g/mol'));
  const known = groups.some((g) => g.ids.includes(value));
  return (
    <select className="gc-buffer-unit" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={label}>
      {!known && <option value={value}>{value || 'unit'}</option>}
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.ids.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function Amount({ result, template }: { result: RowResult; template: boolean }) {
  if (template || result.kind === 'empty') return <span className="gc-buffer-none">—</span>;
  if (result.kind === 'error')
    return (
      <span className="gc-buffer-err" title={result.message}>
        {result.message}
      </span>
    );
  return (
    <span className={`gc-buffer-amount ${result.kind === 'mass' ? 'is-mass' : ''}`}>
      {result.kind === 'mass' && <Scale aria-label="Weigh" />}
      {result.text}
    </span>
  );
}

/** Buffer / dilution calculator: components with their stock and final concentrations → what to add. */
export function BufferView({ node, updateAttributes, editor, getPos, deleteNode }: NodeViewProps) {
  const editable = useEditorState({ editor, selector: (s) => s.editor.isEditable });
  const data = useMemo(() => normalizeBuffer(node.attrs.data as BufferData), [node.attrs.data]);
  const result = useMemo(() => computeBuffer(data), [data]);
  const rootRef = useRef<HTMLDivElement>(null);
  const hasVars = (s: string) => s.includes('{{');

  /** Latest data straight from the document (props may lag behind a change just made). */
  const current = useCallback((): BufferData => {
    const pos = getPos();
    const n = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null;
    return normalizeBuffer((n && n.type.name === 'buffer' ? n.attrs.data : node.attrs.data) as BufferData);
  }, [editor, getPos, node.attrs.data]);

  const update = useCallback((fn: (d: BufferData) => BufferData) => updateAttributes({ data: fn(current()) }), [current, updateAttributes]);
  const setRow = (i: number, patch: Partial<BufferRow>) => update((d) => ({ ...d, rows: d.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  const focusCell = (r: number, field: Field) => {
    requestAnimationFrame(() => {
      const el = rootRef.current?.querySelector<HTMLInputElement>(`[data-cell="${r}:${field}"]`);
      el?.focus();
      el?.select();
    });
  };

  const addRow = (at?: number, field: Field = 'name') => {
    const d = current();
    const i = at ?? d.rows.length;
    update((x) => ({ ...x, rows: [...x.rows.slice(0, i), emptyRow(), ...x.rows.slice(i)] }));
    focusCell(i, field);
  };

  const removeRow = (i: number) =>
    update((d) => {
      const rows = d.rows.filter((_, j) => j !== i);
      return { ...d, rows: rows.length ? rows : [emptyRow()] };
    });

  useEffect(() => {
    if (focusNextBuffer && editable) {
      focusNextBuffer = false;
      focusCell(0, 'name');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Enter and the up/down arrows move between rows, like a spreadsheet. */
  const onCellKey = (e: KeyboardEvent<HTMLInputElement>, r: number, field: Field) => {
    const last = r === current().rows.length - 1;
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.altKey)) {
      e.preventDefault();
      if (!last) focusCell(r + 1, field);
      else if (e.key === 'Enter') addRow(undefined, field);
    } else if (e.key === 'ArrowUp' && r > 0) {
      e.preventDefault();
      focusCell(r - 1, field);
    }
  };

  /** Paste rows copied from Excel: component, stock, final (units may be in the cells or next to them). */
  const onPaste = (e: ClipboardEvent<HTMLInputElement>, r: number, field: Field) => {
    const text = e.clipboardData.getData('text/plain');
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const lines = text
      .replace(/\r/g, '')
      .split('\n')
      .filter((l) => l.trim());
    const parsed = lines.map((line) => {
      const cells = line.split('\t').map((c) => c.trim());
      const out: string[] = [];
      // "1" + "M" in two cells → "1 M"
      for (let i = 0; i < cells.length; i++) {
        if (unitId(cells[i]) && out.length && /\d$/.test(out[out.length - 1])) out[out.length - 1] += ` ${cells[i]}`;
        else out.push(cells[i]);
      }
      return out;
    });
    const start = FIELDS.indexOf(field);
    update((d) => {
      const rows = [...d.rows];
      parsed.forEach((cells, k) => {
        const row = { ...(rows[r + k] ?? emptyRow()) };
        cells.forEach((cell, j) => {
          const f = FIELDS[start + j];
          if (f === 'name') row.name = cell;
          else if (f === 'stock' || f === 'final') {
            const q = splitQuantity(cell);
            row[f] = q.value;
            const u = unitId(q.unit);
            if (u && (f === 'stock' || u !== 'g/mol')) row[f === 'stock' ? 'stockUnit' : 'finalUnit'] = u;
          }
        });
        rows[r + k] = row;
      });
      return { ...d, rows };
    });
    toast(`Pasted ${parsed.length} ${parsed.length === 1 ? 'row' : 'rows'}.`);
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(toDelimited(bufferTable(current())));
      toast('Copied. Paste it into Excel or a table.');
    } catch {
      toast('Could not copy to the clipboard.', 'error');
    }
  };

  const menu = (): MenuItemSpec[] => [
    ...(editable ? [{ label: 'Add component', icon: <Plus />, onSelect: () => addRow() } as MenuItemSpec] : []),
    { label: 'Copy as a table', icon: <Copy />, onSelect: () => void copyText() },
    ...(editable ? (['sep', { label: 'Delete buffer', icon: <Trash2 />, danger: true, onSelect: () => deleteNode() }] as MenuItemSpec[]) : []),
  ];

  const ro = !editable;
  const template = (r: BufferRow) => hasVars(r.stock) || hasVars(r.final) || hasVars(data.volume);
  const label = (r: BufferRow, i: number) => r.name.trim() || `component ${i + 1}`;

  return (
    <NodeViewWrapper
      className="gc-buffer"
      onFocus={() => {
        const pos = getPos();
        if (typeof pos === 'number') rememberInsertionPoint(editor, pos + node.nodeSize);
      }}
    >
      <div ref={rootRef} contentEditable={false}>
        <div className="gc-buffer-bar">
          <Beaker className="gc-buffer-icon" aria-hidden="true" />
          <input
            className="gc-buffer-name"
            value={data.name}
            placeholder={ro ? 'Buffer' : 'Buffer name, e.g. Lysis buffer'}
            readOnly={ro}
            aria-label="Buffer name"
            onChange={(e) => update((d) => ({ ...d, name: e.target.value }))}
          />
          <label className="gc-buffer-volume">
            <span>Final volume</span>
            <input
              className="gc-buffer-num"
              inputMode="decimal"
              value={data.volume}
              placeholder="50"
              readOnly={ro}
              aria-label="Final volume"
              onChange={(e) => update((d) => ({ ...d, volume: e.target.value }))}
            />
            <select
              className="gc-buffer-unit"
              value={data.volumeUnit}
              disabled={ro}
              aria-label="Unit of the final volume"
              onChange={(e) => update((d) => ({ ...d, volumeUnit: e.target.value }))}
            >
              {VOLUME_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <MenuButton items={menu} className="icon-btn icon-btn-sm" title="Buffer options">
            <MoreHorizontal />
          </MenuButton>
        </div>

        <div className="gc-buffer-scroll">
          <table className="gc-buffer-grid">
            <thead>
              <tr>
                <th className="col-name">Component</th>
                <th className="col-qty">Stock</th>
                <th className="col-qty">Final</th>
                <th className="col-add">Add</th>
                {editable && <th className="col-x" aria-label="Remove" />}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i}>
                  <td className="col-name">
                    <input
                      data-cell={`${i}:name`}
                      value={r.name}
                      placeholder={ro ? '' : i === 0 ? 'e.g. Tris-HCl pH 8.0' : 'Component'}
                      readOnly={ro}
                      aria-label={`Component ${i + 1}`}
                      onChange={(e) => setRow(i, { name: e.target.value })}
                      onKeyDown={(e) => onCellKey(e, i, 'name')}
                      onPaste={(e) => onPaste(e, i, 'name')}
                    />
                  </td>
                  <td className="col-qty" data-label="Stock">
                    <div className="gc-buffer-qty">
                      <input
                        className="gc-buffer-num"
                        data-cell={`${i}:stock`}
                        inputMode="decimal"
                        value={r.stock}
                        placeholder={ro ? '' : r.stockUnit === 'g/mol' ? 'MW' : '1'}
                        readOnly={ro}
                        aria-label={r.stockUnit === 'g/mol' ? `Molar mass of ${label(r, i)}` : `Stock of ${label(r, i)}`}
                        onChange={(e) => setRow(i, { stock: e.target.value })}
                        onKeyDown={(e) => onCellKey(e, i, 'stock')}
                        onPaste={(e) => onPaste(e, i, 'stock')}
                      />
                      <UnitSelect
                        value={r.stockUnit}
                        stock
                        disabled={ro}
                        label={`Stock unit of ${label(r, i)}`}
                        onChange={(u) => setRow(i, { stockUnit: u })}
                      />
                    </div>
                  </td>
                  <td className="col-qty" data-label="Final">
                    <div className="gc-buffer-qty">
                      <input
                        className="gc-buffer-num"
                        data-cell={`${i}:final`}
                        inputMode="decimal"
                        value={r.final}
                        placeholder={ro ? '' : '50'}
                        readOnly={ro}
                        aria-label={`Final concentration of ${label(r, i)}`}
                        onChange={(e) => setRow(i, { final: e.target.value })}
                        onKeyDown={(e) => onCellKey(e, i, 'final')}
                        onPaste={(e) => onPaste(e, i, 'final')}
                      />
                      <UnitSelect
                        value={r.finalUnit}
                        stock={false}
                        disabled={ro}
                        label={`Final unit of ${label(r, i)}`}
                        onChange={(u) => setRow(i, { finalUnit: u })}
                      />
                    </div>
                  </td>
                  <td className="col-add">
                    <Amount result={result.rows[i]} template={template(r)} />
                  </td>
                  {editable && (
                    <td className="col-x">
                      <button
                        className="icon-btn icon-btn-sm"
                        title="Remove this component"
                        aria-label={`Remove ${label(r, i)}`}
                        onClick={() => removeRow(i)}
                      >
                        <X />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {(editable || data.solvent.trim()) && (
                <tr className="gc-buffer-fill">
                  <td className="col-name">
                    <input
                      value={data.solvent}
                      placeholder="Solvent (none)"
                      readOnly={ro}
                      aria-label="Fill up with"
                      onChange={(e) => update((d) => ({ ...d, solvent: e.target.value }))}
                    />
                  </td>
                  <td colSpan={2} className="gc-buffer-to">
                    {data.solvent.trim() ? `up to ${data.volume || '…'} ${data.volumeUnit}` : 'Nothing fills it up'}
                  </td>
                  <td className="col-add">
                    {data.solvent.trim() && result.fill && !hasVars(data.volume) ? (
                      <span className="gc-buffer-amount">{result.fill.text}</span>
                    ) : (
                      <span className="gc-buffer-none">—</span>
                    )}
                  </td>
                  {editable && <td className="col-x" />}
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {result.error && (
          <p className="gc-buffer-warning" role="alert">
            {result.error}.
          </p>
        )}
        {result.liters == null && !hasVars(data.volume) && <p className="gc-buffer-warning">Set the final volume to see the amounts.</p>}
        {editable && (
          <button className="gc-buffer-add" onClick={() => addRow()}>
            <Plus /> Add component
          </button>
        )}
      </div>
    </NodeViewWrapper>
  );
}
