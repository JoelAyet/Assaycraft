/**
 * Freezers on the Stocks page: the notebook's freezers with their shelves and the boxes on them,
 * and the box picked, place by place (A1, A2…). A place shows the stock whose tube is in it; picking
 * one says what it is, opens it, moves it or takes it out, and an empty one can be given a stock.
 *
 * On an Assaycraft server, a lab's shared space has its own freezers, and someone's own tube in a
 * lab's box shows to the others as taken; that version of this file (in Assaycraft_server) has
 * those. A notebook of one's own has one set of freezers: its space is '' throughout.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Box as BoxIcon, Lock, MoreHorizontal, Pencil, Plus, Snowflake, Trash2, ArrowRightLeft, TestTube } from 'lucide-react';
import { navigate, toast, useNotebook } from '../notebook/store';
import type { DocMeta } from '../notebook/model';
import { Dialog, MenuButton, confirmDialog, openDialog, promptDialog, type MenuItemSpec } from '../ui/overlay';
import { NewButton, ViewBar } from '../ui/PageHeader';
import {
  BOX_SIZES,
  TEMPERATURES,
  addBox,
  addFreezer,
  capacity,
  filled,
  firstFree,
  newFreezerId,
  placeText,
  placesOf,
  posName,
  putTube,
  removeBox,
  removeFreezer,
  renameSlots,
  rowName,
  sameTube,
  takeTube,
  updateBox,
  updateFreezer,
  type Box,
  type Freezer,
  type Freezers,
  type Slot,
} from './freezers';
import { changeFreezers, freezerPath, loadFreezers, moveTubeTo, useFreezers, writeLocation } from './freezerActions';
import { StockPicker } from './StockPicker';
import { stockIcon } from './StocksPage';

/** The notebook's spaces: one, its own (''). */
const SPACES = [''];
export function useSpaces(): string[] {
  return SPACES;
}

/** Read the freezers of every space (once, and again every 20 seconds while `live`). */
export function useAllFreezers(live = false) {
  const spaces = useSpaces();
  useEffect(() => {
    const load = () => void Promise.allSettled(spaces.map((s) => loadFreezers(s)));
    load();
    if (!live) return;
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 20_000);
    window.addEventListener('focus', load);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', load);
    };
  }, [spaces, live]);
}

// ───────────── What is in a place ─────────────

interface Tube {
  slot: Slot;
  /** Someone else's own stock: they alone know what it is. */
  private: boolean;
  collection?: DocMeta;
  name: string;
}

function tubeOf(slot: Slot, docs: Record<string, DocMeta>): Tube {
  // (A tube of someone else's, in a box shared on a server, is not in a notebook of one's own.)
  if (slot.owner) return { slot, private: true, name: '' };
  const byPath = docs[slot.path];
  // Its collection, or (renamed since) the one that has its ID.
  const collection =
    byPath?.kind === 'stocks' && byPath.stockItems?.some((s) => s.id === slot.id)
      ? byPath
      : Object.values(docs).find((d) => d.kind === 'stocks' && d.stockItems?.some((s) => s.id === slot.id));
  return { slot, private: false, collection, name: collection?.stockItems?.find((s) => s.id === slot.id)?.name ?? '' };
}

/** "GS-0012" → ["GS-", "0012"], to show the number large in a small place. */
function idParts(id: string): [string, string] {
  const m = /^(.*?)(\d+)$/.exec(id);
  return m ? [m[1], m[2]] : ['', id];
}

const describe = (pos: string, t: Tube | null) =>
  !t
    ? `${pos}, free`
    : t.private
      ? `${pos}, taken by ${t.slot.owner}`
      : `${pos}, ${t.slot.id}${t.name ? ` ${t.name}` : ''}${t.collection ? '' : ' (no longer in Stocks)'}`;

// ───────────── A box, place by place ─────────────

export function BoxGrid({
  box,
  selected,
  onSelect,
  pickFree,
  label,
}: {
  box: Box;
  selected: string | null;
  onSelect: (pos: string) => void;
  /** Choosing where to put a tube: only free places can be chosen. */
  pickFree?: boolean;
  label: string;
}) {
  const docs = useNotebook((s) => s.docs);
  const ref = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(selected ?? 'A1');
  useEffect(() => {
    if (selected) setFocus(selected);
  }, [selected]);
  const move = (e: KeyboardEvent, row: number, col: number) => {
    const d: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const step = d[e.key];
    if (!step) return;
    e.preventDefault();
    const r = Math.min(box.rows - 1, Math.max(0, row + step[0]));
    const c = Math.min(box.cols - 1, Math.max(0, col + step[1]));
    const pos = posName(r, c);
    setFocus(pos);
    ref.current?.querySelector<HTMLButtonElement>(`[data-pos="${pos}"]`)?.focus();
  };
  return (
    <div className="gc-box-scroll">
      <div ref={ref} className="gc-box-grid" role="group" aria-label={label} style={{ '--cols': box.cols } as CSSProperties}>
        <span className="gc-box-corner" aria-hidden="true" />
        {Array.from({ length: box.cols }, (_, c) => (
          <span key={c} className="gc-box-colname" aria-hidden="true">
            {c + 1}
          </span>
        ))}
        {Array.from({ length: box.rows }, (_, r) => (
          <Row key={r} r={r}>
            {Array.from({ length: box.cols }, (_, c) => {
              const pos = posName(r, c);
              const slot = box.slots[pos];
              const t = slot ? tubeOf(slot, docs) : null;
              const [pre, num] = slot ? idParts(slot.id) : ['', ''];
              const state = !t ? 'is-free' : t.private ? 'is-private' : t.collection ? 'is-filled' : 'is-missing';
              return (
                <button
                  key={c}
                  type="button"
                  data-pos={pos}
                  className={`gc-box-cell ${state} ${selected === pos ? 'is-selected' : ''}`}
                  tabIndex={pos === focus ? 0 : -1}
                  aria-label={describe(pos, t)}
                  aria-pressed={selected === pos}
                  title={describe(pos, t)}
                  disabled={pickFree && !!slot}
                  onClick={() => {
                    setFocus(pos);
                    onSelect(pos);
                  }}
                  onKeyDown={(e) => move(e, r, c)}
                >
                  {t?.private ? (
                    <Lock />
                  ) : slot ? (
                    <>
                      <small>{pre}</small>
                      {num}
                    </>
                  ) : null}
                </button>
              );
            })}
          </Row>
        ))}
      </div>
    </div>
  );
}

function Row({ r, children }: { r: number; children: ReactNode }) {
  return (
    <>
      <span className="gc-box-rowname" aria-hidden="true">
        {rowName(r)}
      </span>
      {children}
    </>
  );
}

// ───────────── Dialogs ─────────────

function FreezerDialog({ freezer, close, onSave }: { freezer?: Freezer; close: () => void; onSave: (f: Omit<Freezer, 'id'>) => Promise<void> }) {
  const [name, setName] = useState(freezer?.name ?? '');
  const [temp, setTemp] = useState(freezer?.temp ?? '−80 °C');
  const [shelves, setShelves] = useState(String(freezer?.shelves ?? 5));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await onSave({ name: name.trim() || `${temp} freezer`, temp: temp.trim(), shelves: Math.min(20, Math.max(1, Number(shelves) || 1)) });
      close();
    } catch (err) {
      toast(`Could not save the freezer: ${(err as Error).message}`, 'error');
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={freezer ? `Edit ${freezer.name}` : 'New freezer'}
      icon={<Snowflake className="gc-dialog-icon" />}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {freezer ? 'Save freezer' : 'Add freezer'}
          </button>
        </>
      }
    >
      <form
        className="gc-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label htmlFor="fz-name">Name</label>
          <input
            id="fz-name"
            className="input"
            value={name}
            placeholder={`${temp} freezer, room 204`}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="fz-temp">Temperature</label>
          <input id="fz-temp" className="input" list="fz-temps" value={temp} onChange={(e) => setTemp(e.target.value)} />
          <datalist id="fz-temps">
            {TEMPERATURES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor="fz-shelves">Shelves</label>
          <input id="fz-shelves" className="input" type="number" min={1} max={20} value={shelves} onChange={(e) => setShelves(e.target.value)} />
          <span className="field-hint">Or racks: numbered from the top.</span>
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function BoxDialog({
  freezers,
  box,
  at,
  close,
  onSave,
}: {
  freezers: Freezers;
  box?: Box;
  /** A new box: the freezer (and shelf) to start with. */
  at?: { freezer: string; shelf?: number };
  close: () => void;
  onSave: (b: { name: string; freezer: string; shelf: number; rows: number; cols: number }) => Promise<void>;
}) {
  const [name, setName] = useState(box?.name ?? `Box ${freezers.boxes.length + 1}`);
  const [freezer, setFreezer] = useState(box?.freezer ?? at?.freezer ?? freezers.freezers[0]?.id ?? '');
  const [shelf, setShelf] = useState(box?.shelf ?? at?.shelf ?? 1);
  const [size, setSize] = useState(0);
  const [busy, setBusy] = useState(false);
  const shelves = freezers.freezers.find((f) => f.id === freezer)?.shelves ?? 1;
  const save = async () => {
    setBusy(true);
    try {
      await onSave({ name: name.trim() || 'Box', freezer, shelf: Math.min(shelf, shelves), rows: BOX_SIZES[size].rows, cols: BOX_SIZES[size].cols });
      close();
    } catch (err) {
      toast(`Could not save the box: ${(err as Error).message}`, 'error');
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={box ? `Edit ${box.name}` : 'New box'}
      icon={<BoxIcon className="gc-dialog-icon" />}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !freezer} onClick={() => void save()}>
            {box ? 'Save box' : 'Add box'}
          </button>
        </>
      }
    >
      <form
        className="gc-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label htmlFor="bx-name">Name</label>
          <input id="bx-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="gc-form-row">
          <div className="field">
            <label htmlFor="bx-freezer">Freezer</label>
            <select id="bx-freezer" className="input" value={freezer} onChange={(e) => setFreezer(e.target.value)}>
              {freezers.freezers.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="bx-shelf">Shelf</label>
            <select id="bx-shelf" className="input" value={Math.min(shelf, shelves)} onChange={(e) => setShelf(Number(e.target.value))}>
              {Array.from({ length: shelves }, (_, i) => (
                <option key={i} value={i + 1}>
                  Shelf {i + 1}
                </option>
              ))}
            </select>
          </div>
        </div>
        {!box && (
          <div className="field">
            <label htmlFor="bx-size">Size</label>
            <select id="bx-size" className="input" value={size} onChange={(e) => setSize(Number(e.target.value))}>
              {BOX_SIZES.map((s, i) => (
                <option key={i} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
            <span className="field-hint">Rows are lettered A, B, C…, columns numbered 1, 2, 3….</span>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** Which spaces' freezers a stock can go in (a notebook of one's own has one). */
export const freezerSpacesFor = (_collectionPath: string, spaces: string[]) => spaces;

/** Put a stock's tube in a place, and say so in its Location. */
export async function placeTube(space: string, box: Box, pos: string, collection: DocMeta, id: string) {
  const slot: Slot = { path: collection.path, id };
  await changeFreezers(space, (f) => putTube(f, box.id, pos, slot), `${pos} has just been taken by someone else.`);
  await writeLocation(collection.path, id, box, pos);
}

/** Take a tube out; the stock's Location says where its other tube is, if it has one. */
async function takeOut(space: string, box: Box, pos: string, slot: Slot) {
  // Only the tube that was shown there: not one put in its place meanwhile.
  await changeFreezers(
    space,
    (f) => (sameTube(f.boxes.find((b) => b.id === box.id)?.slots[pos], slot) ? takeTube(f, box.id, pos) : null),
    'It was moved or taken out meanwhile.',
  );
  const all = useFreezers.getState();
  const other = Object.values(all).flatMap((f) => (f ? placesOf(f, slot.id, slot.path) : []))[0];
  await writeLocation(slot.path, slot.id, other?.box ?? null, other?.pos);
}

/** A collection renamed: its tubes follow it. */
export async function retargetTubes(from: string, to: string) {
  const all = useFreezers.getState();
  for (const [space, f] of Object.entries(all)) {
    if (!f?.boxes.some((b) => Object.values(b.slots).some((s) => s.path === from))) continue;
    await changeFreezers(space, (x) => renameSlots(x, from, to)).catch((err) => console.warn('Could not move the tubes of', from, err));
  }
}

/** Choose a box and a free place in it for a stock (from its details). */
export function openPlaceDialog(collection: DocMeta, id: string) {
  openDialog((close) => <PlaceDialog collection={collection} id={id} close={close} />);
}

function PlaceDialog({ collection, id, close }: { collection: DocMeta; id: string; close: () => void }) {
  const spaces = useSpaces();
  const all = useFreezers();
  const allowed = freezerSpacesFor(collection.path, spaces);
  const options = allowed.flatMap((space) =>
    (all[space]?.boxes ?? []).map((box) => ({ space, box, freezer: all[space]!.freezers.find((f) => f.id === box.freezer) })),
  );
  const [pick, setPick] = useState(0);
  const chosen = options[pick];
  const [pos, setPos] = useState<string | null>(chosen ? firstFree(chosen.box) : null);
  const [busy, setBusy] = useState(false);
  const choose = (i: number) => {
    setPick(i);
    setPos(options[i] ? firstFree(options[i].box) : null);
  };
  const save = async () => {
    if (!chosen || !pos) return;
    setBusy(true);
    try {
      // The stock's details show where it is now: no message over them.
      await placeTube(chosen.space, chosen.box, pos, collection, id);
      close();
    } catch (err) {
      toast(`Could not put it there: ${(err as Error).message}`, 'error');
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={`Put ${id} in a box`}
      icon={<Snowflake className="gc-dialog-icon" />}
      onClose={close}
      wide
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !pos} onClick={() => void save()}>
            {pos ? `Put in ${pos}` : 'Put in the box'}
          </button>
        </>
      }
    >
      {options.length === 0 ? (
        <div className="empty-state">
          <Snowflake />
          <p>No boxes yet. Add a freezer and its boxes under Stocks → Freezers.</p>
          <button
            className="btn btn-sm"
            onClick={() => {
              close();
              navigate({ name: 'stocks', path: freezerPath(allowed[0] ?? '') });
            }}
          >
            Open Freezers
          </button>
        </div>
      ) : (
        <div className="gc-place">
          <div className="field">
            <label htmlFor="pl-box">Box</label>
            <select id="pl-box" className="input" value={pick} onChange={(e) => choose(Number(e.target.value))}>
              {options.map((o, i) => (
                <option key={o.box.id} value={i}>
                  {placeText(o.freezer, o.box)} ({capacity(o.box) - filled(o.box)} free)
                </option>
              ))}
            </select>
          </div>
          {chosen && <BoxGrid box={chosen.box} selected={pos} onSelect={setPos} pickFree label={`Free places in ${chosen.box.name}`} />}
          {chosen && !firstFree(chosen.box) && <p className="muted">This box is full.</p>}
        </div>
      )}
    </Dialog>
  );
}

/** Move a tube to another place: of its box, or of another box of the same freezers. */
function MoveDialog({ space, box, pos, tube, close }: { space: string; box: Box; pos: string; tube: Tube; close: () => void }) {
  const freezers = useFreezers((s) => s[space]);
  const boxes = freezers?.boxes ?? [];
  const [boxId, setBoxId] = useState(box.id);
  const chosen = boxes.find((b) => b.id === boxId) ?? box;
  const [to, setTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const what = tube.private ? `${tube.slot.owner}’s tube` : tube.slot.id;
  const save = async () => {
    if (!to) return;
    setBusy(true);
    try {
      await moveTubeTo(space, { box, pos }, { box: chosen, pos: to }, tube.slot);
      // Within the box, the grid shows it; into another box, say where it went.
      if (chosen.id !== box.id) toast(`${what} is in ${chosen.name}, ${to}.`, 'success');
      close();
    } catch (err) {
      toast(`Could not move it: ${(err as Error).message}`, 'error');
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={`Move ${what}`}
      icon={<ArrowRightLeft className="gc-dialog-icon" />}
      onClose={close}
      wide
      footer={
        <>
          <span className="muted gc-footer-hint">
            From {box.name}, {pos}
          </span>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !to} onClick={() => void save()}>
            {to ? `Move to ${to}` : 'Pick a free place'}
          </button>
        </>
      }
    >
      <div className="gc-place">
        <div className="field">
          <label htmlFor="mv-box">Box</label>
          <select
            id="mv-box"
            className="input"
            value={chosen.id}
            onChange={(e) => {
              setBoxId(e.target.value);
              setTo(null);
            }}
          >
            {boxes.map((b) => (
              <option key={b.id} value={b.id}>
                {placeText(
                  freezers?.freezers.find((f) => f.id === b.freezer),
                  b,
                )}{' '}
                ({capacity(b) - filled(b)} free)
              </option>
            ))}
          </select>
        </div>
        <BoxGrid box={chosen} selected={to} onSelect={setTo} pickFree label={`Free places in ${chosen.name}`} />
        {!firstFree(chosen) && <p className="muted">This box is full.</p>}
      </div>
    </Dialog>
  );
}

// ───────────── The view ─────────────

export function FreezerView({ space, boxId, tabs }: { space: string; boxId?: string; tabs: ReactNode }) {
  const freezers = useFreezers((s) => s[space]);
  const docs = useNotebook((s) => s.docs);
  const readOnly = false;
  const spaces = useSpaces();
  const [pos, setPos] = useState<string | null>(null);
  useAllFreezers(true);

  const box = freezers?.boxes.find((b) => b.id === boxId) ?? freezers?.boxes[0];
  const freezer = box ? freezers?.freezers.find((f) => f.id === box.freezer) : undefined;
  useEffect(() => setPos(null), [box?.id]);
  const show = (b: Box) => navigate({ name: 'stocks', path: freezerPath(space), id: b.id }, { replace: true });

  const run = (what: string, p: Promise<unknown>) => p.catch((err: Error) => toast(`Could not ${what}: ${err.message}`, 'error'));
  const newFreezer = () =>
    openDialog((close) => (
      <FreezerDialog close={close} onSave={async (f) => void (await changeFreezers(space, (x) => addFreezer(x, { id: newFreezerId('f'), ...f })))} />
    ));
  const newBox = (at?: { freezer: string; shelf?: number }) => {
    if (!freezers?.freezers.length) return newFreezer();
    openDialog((close) => (
      <BoxDialog
        freezers={freezers}
        at={at}
        close={close}
        onSave={async (b) => {
          const id = newFreezerId('b');
          await changeFreezers(space, (x) => addBox(x, { id, ...b, slots: {} }));
          navigate({ name: 'stocks', path: freezerPath(space), id }, { replace: true });
        }}
      />
    ));
  };

  const freezerMenu = (f: Freezer): MenuItemSpec[] => [
    { label: 'New box here…', icon: <Plus />, onSelect: () => newBox({ freezer: f.id }) },
    {
      label: 'Edit…',
      icon: <Pencil />,
      onSelect: () =>
        openDialog((close) => (
          <FreezerDialog freezer={f} close={close} onSave={async (p) => void (await changeFreezers(space, (x) => updateFreezer(x, f.id, p)))} />
        )),
    },
    'sep',
    {
      label: 'Delete freezer',
      icon: <Trash2 />,
      danger: true,
      disabled: !!freezers?.boxes.some((b) => b.freezer === f.id),
      hint: freezers?.boxes.some((b) => b.freezer === f.id) ? 'Move or delete its boxes first' : undefined,
      onSelect: () =>
        void confirmDialog({ title: `Delete ${f.name}?`, message: 'It has no boxes in it.', confirmLabel: 'Delete freezer', danger: true }).then(
          (ok) =>
            ok &&
            run(
              'delete the freezer',
              changeFreezers(space, (x) => removeFreezer(x, f.id), 'Boxes were put in it meanwhile.'),
            ),
        ),
    },
  ];

  const boxMenu = (b: Box): MenuItemSpec[] => [
    {
      label: 'Rename…',
      icon: <Pencil />,
      onSelect: () =>
        void promptDialog({ title: 'Rename box', label: 'Name', defaultValue: b.name }).then(
          (n) =>
            n?.trim() &&
            run(
              'rename the box',
              changeFreezers(space, (x) => updateBox(x, b.id, { name: n.trim() })),
            ),
        ),
    },
    {
      label: 'Move to another shelf…',
      icon: <ArrowRightLeft />,
      onSelect: () =>
        freezers &&
        openDialog((close) => (
          <BoxDialog
            freezers={freezers}
            box={b}
            close={close}
            onSave={async (p) => void (await changeFreezers(space, (x) => updateBox(x, b.id, { name: p.name, freezer: p.freezer, shelf: p.shelf })))}
          />
        )),
    },
    'sep',
    {
      label: 'Delete box',
      icon: <Trash2 />,
      danger: true,
      disabled: filled(b) > 0,
      hint: filled(b) > 0 ? 'Take its tubes out first' : undefined,
      onSelect: () =>
        void confirmDialog({ title: `Delete ${b.name}?`, message: 'It is empty.', confirmLabel: 'Delete box', danger: true }).then(
          (ok) =>
            ok &&
            run(
              'delete the box',
              changeFreezers(space, (x) => removeBox(x, b.id), 'Tubes were put in it meanwhile.'),
            ),
        ),
    },
  ];

  const putHere = (b: Box, at: string) =>
    openDialog((close) => (
      <StockPicker
        close={close}
        title={`What is in ${b.name}, ${at}?`}
        filter={(c) => freezerSpacesFor(c.path, spaces).includes(space)}
        onPick={({ item, collection }) => void run('put it there', placeTube(space, b, at, collection, item.id))}
      />
    ));

  const moveFrom = (b: Box, at: string, t: Tube) => openDialog((close) => <MoveDialog space={space} box={b} pos={at} tube={t} close={close} />);
  const takeOutTheirs = (b: Box, at: string, t: Tube) =>
    void confirmDialog({
      title: `Take ${t.slot.owner}’s tube out?`,
      message: `${at} in ${b.name} becomes free. It is ${t.slot.owner}’s own stock: their stocks will say it is no longer in this box.`,
      confirmLabel: 'Take out',
    }).then((ok) => ok && run('take it out', takeOut(space, b, at, t.slot)));

  const tube = box && pos && box.slots[pos] ? tubeOf(box.slots[pos], docs) : null;

  return (
    <div className="gc-freezer-body">
      <ViewBar
        tools={
          !readOnly && (
            <NewButton
              what={freezers?.freezers.length ? 'box' : 'freezer'}
              onClick={() => newBox(box ? { freezer: box.freezer, shelf: box.shelf } : undefined)}
              more={[{ label: 'New freezer…', icon: <Snowflake />, onSelect: newFreezer }]}
            />
          )
        }
      >
        {tabs}
      </ViewBar>
      {!freezers ? (
        <div className="gc-stock-loading" />
      ) : freezers.freezers.length === 0 ? (
        <div className="empty-state">
          <Snowflake />
          <h3>No freezers yet</h3>
          <p>
            Add your −80 °C and −20 °C freezers, then the boxes on their shelves. Each box shows which stock is in each place, and each stock where
            its tubes are.
          </p>
          {!readOnly && (
            <button className="btn btn-primary" onClick={newFreezer}>
              <Plus /> New freezer
            </button>
          )}
        </div>
      ) : (
        <div className="gc-freezer">
          <nav className="gc-freezer-tree" aria-label="Freezers">
            {freezers.freezers.map((f) => (
              <section key={f.id} className="gc-freezer-unit">
                <header className="gc-freezer-unit-head">
                  <Snowflake />
                  <span className="gc-freezer-unit-name">
                    <strong>{f.name}</strong>
                    <small>{[f.temp, `${f.shelves} shelves`].filter(Boolean).join(' · ')}</small>
                  </span>
                  {!readOnly && (
                    <MenuButton items={() => freezerMenu(f)} className="icon-btn icon-btn-sm" title={`${f.name} options`}>
                      <MoreHorizontal />
                    </MenuButton>
                  )}
                </header>
                <ol className="gc-freezer-shelves">
                  {Array.from({ length: f.shelves }, (_, i) => i + 1).map((n) => {
                    const boxes = freezers.boxes.filter((b) => b.freezer === f.id && b.shelf === n);
                    return (
                      <li key={n} className={boxes.length ? undefined : 'is-empty'}>
                        <span className="gc-freezer-shelf">Shelf {n}</span>
                        {boxes.length === 0 && <span className="gc-freezer-none">No boxes</span>}
                        {boxes.map((b) => (
                          <button
                            key={b.id}
                            className={`gc-freezer-box ${b.id === box?.id ? 'active' : ''}`}
                            aria-current={b.id === box?.id ? 'true' : undefined}
                            onClick={() => show(b)}
                          >
                            <BoxIcon />
                            <span className="gc-freezer-box-name">{b.name}</span>
                            <span className="gc-freezer-count">
                              {filled(b)}/{capacity(b)}
                            </span>
                          </button>
                        ))}
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </nav>
          {!box ? (
            <div className="empty-state gc-box-empty">
              <BoxIcon />
              <h3>No boxes yet</h3>
              <p>Add a box to a shelf, then put stocks in its places.</p>
              {!readOnly && (
                <button className="btn btn-primary" onClick={() => newBox()}>
                  <Plus /> New box
                </button>
              )}
            </div>
          ) : (
            <section className="gc-box" aria-label={box.name}>
              <header className="gc-box-head">
                <div>
                  <h2>{box.name}</h2>
                  <span className="muted">
                    {freezer?.name} › Shelf {box.shelf} · {filled(box)} of {capacity(box)} places taken
                  </span>
                </div>
                {!readOnly && (
                  <MenuButton items={() => boxMenu(box)} className="icon-btn" title={`${box.name} options`}>
                    <MoreHorizontal />
                  </MenuButton>
                )}
              </header>
              <BoxGrid box={box} selected={pos} onSelect={setPos} label={`Places in ${box.name}`} />
              <div className="gc-box-place" aria-live="polite">
                {!pos ? (
                  <p className="muted">Pick a place to see what is in it, or to put a stock there.</p>
                ) : !tube ? (
                  <>
                    <span className="gc-box-place-pos">{pos}</span>
                    <span className="gc-box-place-what muted">Free</span>
                    {!readOnly && (
                      <button className="btn btn-sm btn-primary" onClick={() => putHere(box, pos)}>
                        <TestTube /> Put a stock here…
                      </button>
                    )}
                  </>
                ) : tube.private ? (
                  <>
                    <span className="gc-box-place-pos">{pos}</span>
                    <span className="gc-box-place-what">
                      <Lock /> {tube.slot.owner}’s own stock: only they see what it is.
                    </span>
                    {/* The box is the lab's: anyone in it can rearrange it, without seeing what the tube is. */}
                    {!readOnly && (
                      <>
                        <button className="btn btn-sm" onClick={() => moveFrom(box, pos, tube)}>
                          <ArrowRightLeft /> Move…
                        </button>
                        <button className="btn btn-sm" onClick={() => takeOutTheirs(box, pos, tube)}>
                          Take out
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <span className="gc-box-place-pos">{pos}</span>
                    <span className="gc-box-place-what">
                      {tube.collection && stockIcon(tube.collection.extra.stock)}
                      <span className="id-chip">{tube.slot.id}</span>
                      <span className="gc-box-place-name">{tube.name || (tube.collection ? '' : 'No longer in Stocks')}</span>
                      {tube.collection && <small className="muted">{tube.collection.title}</small>}
                    </span>
                    {tube.collection && (
                      <button className="btn btn-sm" onClick={() => navigate({ name: 'stocks', path: tube.collection!.path, id: tube.slot.id })}>
                        Open stock
                      </button>
                    )}
                    {!readOnly && (
                      <>
                        <button className="btn btn-sm" onClick={() => moveFrom(box, pos, tube)}>
                          <ArrowRightLeft /> Move…
                        </button>
                        <button className="btn btn-sm" onClick={() => void run('take it out', takeOut(space, box, pos, tube.slot))}>
                          Take out
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/** Where a stock's tubes are, in any space's freezers. */
export function useTubePlaces(collectionPath: string, id: string) {
  const all = useFreezers();
  return useMemo(
    () =>
      Object.entries(all).flatMap(([space, f]) =>
        f ? placesOf(f, id, collectionPath).map((p) => ({ ...p, space, text: placeText(p.freezer, p.box, p.pos) })) : [],
      ),
    [all, collectionPath, id],
  );
}
