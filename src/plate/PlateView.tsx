import { NodeViewWrapper, useEditorState, type NodeViewProps } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Copy, Eraser, FileText, Grid3x3, Link2, Link2Off, MoreHorizontal, Pencil, Plus, TestTubes, Trash2, X } from 'lucide-react';
import { MenuButton, confirmDialog, openDialog, promptDialog, type MenuItemSpec } from '../ui/overlay';
import { EntryPicker } from '../ui/pickers';
import { StockPicker } from '../stocks/StockPicker';
import { navigate, toast, useNotebook } from '../notebook/store';
import type { DocMeta } from '../notebook/model';
import { rememberInsertionPoint } from '../editor/insertion';
import { toDelimited } from '../sheet/tsv';
import {
  PLATE_FORMATS,
  SAMPLE_COLORS,
  assignWells,
  changeFormat,
  colorFor,
  formatOf,
  normalizePlate,
  plateCounts,
  plateTable,
  removeSample,
  renameSample,
  rowLabel,
  wellList,
  wellName,
  wellsBetween,
  wellsOutside,
  type PlateData,
  type PlateSample,
  type SampleColor,
} from './model';

/** Set by the "insert plate" command so the new plate starts in its "Add sample" field. */
let focusNextPlate = false;
export function focusNextInsertedPlate() {
  focusNextPlate = true;
}

/** What a sample is linked to: a stock (in its collection) or a page with that ID. */
function useLinkTarget() {
  const docs = useNotebook((s) => s.docs);
  return useCallback(
    (ref: string): { label: string; open: () => void } | null => {
      for (const d of Object.values(docs)) {
        if (d.kind !== 'stocks') continue;
        const item = d.stockItems?.find((s) => s.id === ref);
        if (item)
          return { label: item.name ? `${item.id} ${item.name}` : item.id, open: () => navigate({ name: 'stocks', path: d.path, id: item.id }) };
      }
      const doc = Object.values(docs).find((d: DocMeta) => d.id === ref && d.kind !== 'board');
      return doc ? { label: `${doc.id} ${doc.title}`, open: () => navigate({ name: 'doc', path: doc.path }) } : null;
    },
    [docs],
  );
}

const COLOR_NAMES: Record<SampleColor, string> = {
  blue: 'Blue',
  orange: 'Orange',
  green: 'Green',
  purple: 'Purple',
  pink: 'Pink',
  teal: 'Teal',
  yellow: 'Yellow',
  red: 'Red',
  brown: 'Brown',
  gray: 'Gray',
};

/** The brush: a sample's name, or null to empty wells. */
type Brush = string | null;

/** A plate map: which sample (or standard, control, blank…) goes in which well. Drag across wells to fill them. */
export function PlateView({ node, updateAttributes, editor, getPos, deleteNode }: NodeViewProps) {
  const editable = useEditorState({ editor, selector: (s) => s.editor.isEditable });
  const data = useMemo(() => normalizePlate(node.attrs.data as PlateData), [node.attrs.data]);
  const format = formatOf(data.format);
  const counts = useMemo(() => plateCounts(data), [data]);
  const linkTarget = useLinkTarget();
  const rootRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const [brush, setBrush] = useState<Brush>(() => data.samples[0]?.name ?? null);
  const [drag, setDrag] = useState<{ from: [number, number]; to: [number, number] } | null>(null);
  const [focusWell, setFocusWell] = useState<[number, number]>([0, 0]);
  const [newName, setNewName] = useState('');
  // The sample whose wells stand out: the one pointed at, or (read-only, where there is no brush) the one picked.
  const [hoverSpot, setHoverSpot] = useState<string | null>(null);
  const [pinSpot, setPinSpot] = useState<string | null>(null);

  const current = useCallback((): PlateData => {
    const pos = getPos();
    const n = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null;
    return normalizePlate((n && n.type.name === 'plate' ? n.attrs.data : node.attrs.data) as PlateData);
  }, [editor, getPos, node.attrs.data]);
  const update = useCallback((fn: (d: PlateData) => PlateData) => updateAttributes({ data: fn(current()) }), [current, updateAttributes]);

  useEffect(() => {
    if (focusNextPlate && editable) {
      focusNextPlate = false;
      requestAnimationFrame(() => addRef.current?.focus());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paint = (wells: string[]) => {
    if (!editable) return;
    // The latest samples (a sample just added may not have reached this render yet).
    if (brush !== null && !current().samples.some((s) => s.name === brush)) {
      toast('Add a sample first, then drag across the wells it goes in.');
      addRef.current?.focus();
      return;
    }
    update((d) => {
      // A single click on a well that already has this sample empties it.
      if (wells.length === 1 && brush !== null && d.wells[wells[0]] === brush) return assignWells(d, wells, null);
      return assignWells(d, wells, brush);
    });
  };

  // ── Dragging across wells ──
  const wellAt = (e: PointerEvent): [number, number] | null => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-well]');
    if (!el || !rootRef.current?.contains(el)) return null;
    return [Number(el.dataset.r), Number(el.dataset.c)];
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!editable || e.button !== 0) return;
    const at = wellAt(e);
    if (!at) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ from: at, to: at });
    setFocusWell(at);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const at = wellAt(e);
    if (at && (at[0] !== drag.to[0] || at[1] !== drag.to[1])) setDrag({ ...drag, to: at });
  };
  const onUp = () => {
    if (!drag) return;
    paint(wellsBetween(drag.from, drag.to));
    setDrag(null);
  };
  const inDrag = (r: number, c: number) =>
    !!drag &&
    r >= Math.min(drag.from[0], drag.to[0]) &&
    r <= Math.max(drag.from[0], drag.to[0]) &&
    c >= Math.min(drag.from[1], drag.to[1]) &&
    c <= Math.max(drag.from[1], drag.to[1]);

  // ── Keyboard: arrows move between wells, Space or Enter fills one ──
  const focusAt = (r: number, c: number) => {
    setFocusWell([r, c]);
    // At once (every well is already there), so held or quick keys never act on the old well.
    rootRef.current?.querySelector<HTMLElement>(`[data-well="${wellName(r, c)}"]`)?.focus();
  };
  const onWellKey = (e: KeyboardEvent<HTMLButtonElement>, r: number, c: number) => {
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      focusAt(Math.min(format.rows - 1, Math.max(0, r + m[0])), Math.min(format.cols - 1, Math.max(0, c + m[1])));
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      paint([wellName(r, c)]);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (editable) update((d) => assignWells(d, [wellName(r, c)], null));
    }
  };

  // ── Samples ──
  const addSample = (name: string, ref?: string) => {
    const n = name.trim();
    if (!n) return;
    const d = current();
    if (d.samples.some((s) => s.name === n)) {
      setBrush(n);
      return;
    }
    update((x) => ({ ...x, samples: [...x.samples, { name: n, color: colorFor(n, x.samples), ...(ref ? { ref } : {}) }] }));
    setBrush(n);
  };
  const setSample = (name: string, patch: Partial<PlateSample>) =>
    update((d) => ({ ...d, samples: d.samples.map((s) => (s.name === name ? { ...s, ...patch } : s)) }));
  const linkStock = (sample?: PlateSample) =>
    openDialog((close) => (
      <StockPicker
        close={close}
        onPick={({ item }) => {
          if (sample) setSample(sample.name, { ref: item.id });
          else addSample(item.name || item.id, item.id);
        }}
      />
    ));
  const linkEntry = (sample: PlateSample) =>
    openDialog((close) => (
      <EntryPicker
        title={`Link “${sample.name}” to an entry`}
        close={close}
        kinds={['entry']}
        onPick={(d) => setSample(sample.name, { ref: d.id })}
      />
    ));
  const rename = (sample: PlateSample) =>
    void promptDialog({ title: 'Rename sample', label: 'Name', defaultValue: sample.name, confirmLabel: 'Rename' }).then((name) => {
      if (!name || name === sample.name) return;
      if (current().samples.some((s) => s.name === name)) return toast(`There is already a sample called “${name}”.`, 'error');
      update((d) => renameSample(d, sample.name, name));
      if (brush === sample.name) setBrush(name);
    });

  const sampleMenu = (s: PlateSample): MenuItemSpec[] => [
    { label: 'Rename…', icon: <Pencil />, onSelect: () => rename(s) },
    { label: s.ref ? 'Link to another stock…' : 'Link to a stock…', icon: <TestTubes />, onSelect: () => linkStock(s) },
    { label: 'Link to an entry…', icon: <FileText />, onSelect: () => linkEntry(s) },
    ...(s.ref ? [{ label: 'Unlink', icon: <Link2Off />, onSelect: () => setSample(s.name, { ref: undefined }) } as MenuItemSpec] : []),
    { heading: 'Color' },
    {
      row: SAMPLE_COLORS.map((c) => ({
        label: COLOR_NAMES[c],
        checked: c === s.color,
        icon: <span className={`gc-plate-swatch c-${c}`} aria-hidden="true" />,
        onSelect: () => setSample(s.name, { color: c }),
      })),
    },
    'sep',
    {
      label: counts.bySample[s.name] ? `Remove (empties ${counts.bySample[s.name]} well${counts.bySample[s.name] === 1 ? '' : 's'})` : 'Remove',
      icon: <Trash2 />,
      danger: true,
      onSelect: () => {
        update((d) => removeSample(d, s.name));
        if (brush === s.name) setBrush(current().samples[0]?.name ?? null);
      },
    },
  ];

  const copy = async (rows: string[][], what: string) => {
    try {
      await navigator.clipboard.writeText(toDelimited(rows));
      toast(`${what} copied. Paste it into Excel or a plate reader’s layout.`);
    } catch {
      toast('Could not copy to the clipboard.', 'error');
    }
  };
  const setFormat = (wells: number) => {
    const lost = wellsOutside(current(), wells);
    const apply = () => update((d) => changeFormat(d, wells));
    if (!lost) return apply();
    void confirmDialog({
      title: `Make it a ${wells}-well plate?`,
      message: `${lost} filled well${lost === 1 ? ' is' : 's are'} outside a ${wells}-well plate and will be emptied.`,
      confirmLabel: 'Change plate',
    }).then((ok) => ok && apply());
  };
  const menu = (): MenuItemSpec[] => [
    {
      label: 'Copy well list (Well, Sample, Linked to)',
      icon: <Copy />,
      onSelect: () =>
        void copy(
          wellList(current(), (r) => linkTarget(r)?.label ?? r),
          'Well list',
        ),
    },
    { label: 'Copy plate map', icon: <Grid3x3 />, onSelect: () => void copy(plateTable(current()), 'Plate map') },
    ...(editable
      ? ([
          { label: 'Add a sample from Stocks…', icon: <TestTubes />, onSelect: () => linkStock() },
          { label: 'Empty all wells', icon: <Eraser />, disabled: !counts.used, onSelect: () => update((d) => ({ ...d, wells: {} })) },
          'sep',
          { label: 'Delete plate', icon: <Trash2 />, danger: true, onSelect: () => deleteNode() },
        ] as MenuItemSpec[])
      : []),
  ];

  const ro = !editable;
  const indexOf = (name: string) => data.samples.findIndex((s) => s.name === name);
  const size = format.wells >= 384 ? 'is-384' : format.wells >= 96 ? 'is-96' : 'is-small';
  const spot = hoverSpot ?? (ro ? pinSpot : null);
  const picked = (name: string) => (ro ? pinSpot === name : brush === name);
  // A long list of samples goes under the plate, in columns, rather than far down beside it.
  const many = data.samples.length > (format.wells >= 384 ? 10 : 16);
  const brushSample = brush === null ? undefined : data.samples.find((s) => s.name === brush);

  return (
    <NodeViewWrapper
      className={`gc-plate ${size}`}
      onFocus={() => {
        const pos = getPos();
        if (typeof pos === 'number') rememberInsertionPoint(editor, pos + node.nodeSize);
      }}
    >
      <div ref={rootRef} contentEditable={false}>
        <div className="gc-buffer-bar gc-plate-bar">
          <Grid3x3 className="gc-plate-icon" aria-hidden="true" />
          <input
            className="gc-buffer-name"
            value={data.name}
            placeholder={ro ? 'Plate' : 'Plate name, e.g. ELISA plate 1'}
            readOnly={ro}
            aria-label="Plate name"
            onChange={(e) => update((d) => ({ ...d, name: e.target.value }))}
          />
          <span className="gc-plate-used">
            {counts.used} of {format.wells} wells
          </span>
          <select
            className="gc-buffer-unit gc-plate-format"
            value={data.format}
            disabled={ro}
            aria-label="Plate format"
            onChange={(e) => setFormat(Number(e.target.value))}
          >
            {PLATE_FORMATS.map((f) => (
              <option key={f.wells} value={f.wells}>
                {f.wells} wells
              </option>
            ))}
          </select>
          <MenuButton items={menu} className="icon-btn icon-btn-sm" title="Plate options">
            <MoreHorizontal />
          </MenuButton>
        </div>

        <div className={`gc-plate-body ${many ? 'is-many' : ''}`}>
          <div className="gc-plate-scroll">
            <div
              className={`gc-plate-grid ${ro ? 'is-readonly' : ''} ${spot ? 'has-spot' : ''}`}
              style={{ gridTemplateColumns: `auto repeat(${format.cols}, var(--well))` }}
              role="grid"
              aria-label={`${data.name || 'Plate'}: ${format.rows} rows × ${format.cols} columns`}
              aria-readonly={ro}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={() => setDrag(null)}
            >
              <div role="row" className="gc-plate-row">
                <span className="gc-plate-corner" aria-hidden="true" />
                {Array.from({ length: format.cols }, (_, c) => (
                  <button
                    key={`c${c}`}
                    className="gc-plate-head"
                    disabled={ro}
                    aria-label={`Fill column ${c + 1}`}
                    onClick={() => paint(Array.from({ length: format.rows }, (_, r) => wellName(r, c)))}
                  >
                    {c + 1}
                  </button>
                ))}
              </div>
              {Array.from({ length: format.rows }, (_, r) => (
                <div key={r} role="row" className="gc-plate-row">
                  <button
                    className="gc-plate-head"
                    disabled={ro}
                    aria-label={`Fill row ${rowLabel(r)}`}
                    onClick={() => paint(Array.from({ length: format.cols }, (_, c) => wellName(r, c)))}
                  >
                    {rowLabel(r)}
                  </button>
                  {Array.from({ length: format.cols }, (_, c) => {
                    const w = wellName(r, c);
                    const name = data.wells[w];
                    const s = name ? data.samples[indexOf(name)] : undefined;
                    const focusable = focusWell[0] === r && focusWell[1] === c;
                    // While dragging, the wells show what they are about to become.
                    const shown = inDrag(r, c) ? brushSample : s;
                    const look = shown ? `c-${shown.color}` : 'is-empty';
                    return (
                      <button
                        key={w}
                        role="gridcell"
                        data-well={w}
                        data-r={r}
                        data-c={c}
                        tabIndex={focusable ? 0 : -1}
                        className={`gc-well ${look} ${inDrag(r, c) ? 'is-drag' : ''} ${spot && name === spot ? 'is-spot' : ''}`}
                        aria-label={`${w}: ${name ?? 'empty'}`}
                        data-tip={w}
                        data-tip-desc={name ? name + (s?.ref ? ` · ${linkTarget(s.ref)?.label ?? s.ref}` : '') : 'Empty'}
                        onKeyDown={(e) => onWellKey(e, r, c)}
                        onFocus={() => setFocusWell([r, c])}
                      >
                        {shown && format.wells <= 96 ? indexOf(shown.name) + 1 : ''}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="gc-plate-samples" aria-label="Samples">
            {!ro && (
              <button
                className={`gc-plate-sample gc-plate-eraser ${brush === null ? 'is-brush' : ''}`}
                aria-pressed={brush === null}
                onClick={() => setBrush(null)}
              >
                <span className="gc-plate-swatch is-empty" aria-hidden="true">
                  <Eraser />
                </span>
                <span className="gc-plate-sample-name">Empty wells</span>
              </button>
            )}
            {data.samples.map((s, i) => {
              const link = s.ref ? linkTarget(s.ref) : null;
              return (
                <div
                  key={s.name}
                  className={`gc-plate-sample-row ${picked(s.name) ? 'is-brush' : ''}`}
                  // A mouse only: a finger's last tap would otherwise "point" at whatever scrolls under it.
                  onPointerEnter={(e) => e.pointerType === 'mouse' && setHoverSpot(s.name)}
                  onPointerLeave={() => setHoverSpot(null)}
                >
                  <button
                    className="gc-plate-sample"
                    aria-pressed={picked(s.name)}
                    title={ro ? `Show where ${s.name} is` : `Fill wells with ${s.name}`}
                    onClick={() => (ro ? setPinSpot((p) => (p === s.name ? null : s.name)) : setBrush(s.name))}
                    onFocus={() => setHoverSpot(s.name)}
                    onBlur={() => setHoverSpot(null)}
                  >
                    <span className={`gc-plate-swatch c-${s.color}`} aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="gc-plate-sample-name">{s.name}</span>
                    <span className="sr-only">, {counts.bySample[s.name] ?? 0} wells</span>
                  </button>
                  {s.ref && (
                    <button
                      className={`gc-plate-link ${link ? '' : 'is-missing'}`}
                      title={link ? `Open ${link.label}` : `${s.ref} is not in this notebook`}
                      onClick={() => link?.open()}
                    >
                      <Link2 /> {s.ref}
                    </button>
                  )}
                  {/* After the link, so the counts line up down the list. */}
                  <span className="gc-plate-sample-count" aria-hidden="true">
                    {counts.bySample[s.name] ?? 0}
                  </span>
                  {!ro && (
                    <MenuButton items={() => sampleMenu(s)} className="icon-btn icon-btn-sm" title={`Options for ${s.name}`}>
                      <MoreHorizontal />
                    </MenuButton>
                  )}
                </div>
              );
            })}
            {!ro && (
              <form
                className="gc-plate-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  addSample(newName);
                  setNewName('');
                }}
              >
                <Plus aria-hidden="true" />
                <input
                  ref={addRef}
                  value={newName}
                  placeholder={data.samples.length ? 'Add sample' : 'Add a sample, e.g. WT'}
                  aria-label="Add sample"
                  onChange={(e) => setNewName(e.target.value)}
                />
                {newName && (
                  <button type="button" className="icon-btn icon-btn-sm" aria-label="Clear" onClick={() => setNewName('')}>
                    <X />
                  </button>
                )}
              </form>
            )}
            {!ro && (
              <button className="gc-plate-from-stocks" onClick={() => linkStock()}>
                <TestTubes /> Add from Stocks…
              </button>
            )}
          </div>
        </div>
        {!ro && (
          <p className="gc-plate-hint">
            {data.samples.length ? (
              <>Pick a sample, then click or drag across wells. Click a row letter or column number to fill it; click a well again to empty it.</>
            ) : (
              <>Add your samples, standards and blanks on the right, then drag across the wells each one goes in.</>
            )}
          </p>
        )}
      </div>
    </NodeViewWrapper>
  );
}
