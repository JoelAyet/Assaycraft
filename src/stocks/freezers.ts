/**
 * Freezers: where the tubes of a space's stocks are. A space (one's own stocks, or a lab's) keeps
 * them in <stocks folder>/freezers.json: its freezers, each with shelves, and on the shelves boxes
 * with rows A, B, C… and columns 1, 2, 3…. A box records what is in each of its places, so a box
 * shared by a lab shows every tube in it, someone's own included (as taken, without saying what).
 */

export interface Freezer {
  id: string;
  name: string;
  /** "−80 °C". */
  temp: string;
  shelves: number;
}

/**
 * A tube in a box: a stock, by the collection it is in and its ID. Someone's own stock in a lab's box
 * is written in the lab's file as only its owner and `ref`, a random name: which stock it is (its
 * collection and ID) is kept in their own notebook (PRIVATE_PLACES), which the lab's other members
 * cannot read. In memory, for its owner, the slot has both.
 */
export interface Slot {
  /** The stock's collection in the notebook it is in ("Lab/<id>/Stocks/Glycerol stocks.md"). */
  path: string;
  /** Its ID ("GS-0012"). */
  id: string;
  /** Someone's own stock (not shared with the lab): whose, by username. */
  owner?: string;
  /** Someone's own stock in a lab's box: the random name it goes by in the lab's file. */
  ref?: string;
}

/** In one's own Stocks folder: which of one's own stocks each `ref` in a lab's boxes is. */
export const PRIVATE_PLACES = '.freezer-places.json';
export type PrivatePlaces = Record<string, { path: string; id: string }>;

export function parsePlaces(text: string): PrivatePlaces {
  try {
    const raw = (JSON.parse(text) as { refs?: Record<string, { path?: unknown; id?: unknown }> }).refs ?? {};
    const out: PrivatePlaces = {};
    for (const [ref, v] of Object.entries(raw))
      if (v && typeof v.path === 'string' && typeof v.id === 'string') out[ref] = { path: v.path, id: v.id };
    return out;
  } catch {
    return {};
  }
}
export const formatPlaces = (p: PrivatePlaces) => JSON.stringify({ version: 1, refs: p }, null, 2) + '\n';

const newRef = () => `r${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')}`;

/** A lab's freezers as their owner sees them: each of `me`'s own tubes with its collection and ID. */
export function revealOwn(f: Freezers, me: string, places: PrivatePlaces): Freezers {
  if (!me) return f;
  return mapSlots(f, (s) => (s.owner === me && s.ref && places[s.ref] ? { ...s, ...places[s.ref] } : s));
}

/**
 * A lab's freezers as they are written: `me`'s own tubes as their owner and a `ref` only (a new ref
 * for a tube that has none, written down in `places`). `changed` says whether `places` grew.
 */
export function hideOwn(f: Freezers, me: string, places: PrivatePlaces): { freezers: Freezers; places: PrivatePlaces; changed: boolean } {
  const next = { ...places };
  let changed = false;
  const out = mapSlots(f, (s) => {
    if (!me || s.owner !== me || !s.path) return s;
    let ref = s.ref;
    if (!ref || next[ref]?.path !== s.path || next[ref]?.id !== s.id) {
      ref = ref && !next[ref] ? ref : newRef();
      next[ref] = { path: s.path, id: s.id };
      changed = true;
    }
    return { path: '', id: '', owner: s.owner, ref };
  });
  return { freezers: out, places: next, changed };
}

/** Whether a lab's file still names someone's own stock (written before refs): `me`'s, to hide. */
export const namesOwn = (f: Freezers, me: string) => f.boxes.some((b) => Object.values(b.slots).some((s) => s.owner === me && !!s.path && !s.ref));

function mapSlots(f: Freezers, fn: (s: Slot) => Slot): Freezers {
  return { ...f, boxes: f.boxes.map((b) => ({ ...b, slots: Object.fromEntries(Object.entries(b.slots).map(([p, s]) => [p, fn(s)])) })) };
}

export interface Box {
  id: string;
  name: string;
  freezer: string;
  /** 1, 2, 3… from the top. */
  shelf: number;
  rows: number;
  cols: number;
  /** What is where: "B4" → the tube there. */
  slots: Record<string, Slot>;
}

export interface Freezers {
  version: 1;
  freezers: Freezer[];
  boxes: Box[];
}

export const FREEZER_FILE = 'freezers.json';
export const emptyFreezers = (): Freezers => ({ version: 1, freezers: [], boxes: [] });

/** Box sizes people use: 9 × 9 for cryo boxes, 10 × 10, and 8 × 12 like a plate. */
export const BOX_SIZES = [
  { rows: 9, cols: 9, label: '9 × 9 (81 tubes)' },
  { rows: 10, cols: 10, label: '10 × 10 (100 tubes)' },
  { rows: 8, cols: 12, label: '8 × 12 (96 tubes)' },
  { rows: 5, cols: 5, label: '5 × 5 (25 tubes)' },
];

/** Temperatures to choose from (any other can be typed). */
export const TEMPERATURES = ['−80 °C', '−20 °C', '4 °C', 'Liquid nitrogen'];

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** The freezers of a freezers.json, ignoring anything in it that does not fit. */
export function parseFreezers(text: string): Freezers {
  let raw: Partial<Freezers>;
  try {
    raw = JSON.parse(text) as Partial<Freezers>;
  } catch {
    return emptyFreezers();
  }
  const freezers = (Array.isArray(raw.freezers) ? raw.freezers : [])
    .filter((f) => f && str(f.id))
    .map((f) => ({ id: str(f.id), name: str(f.name) || 'Freezer', temp: str(f.temp), shelves: clampInt(f.shelves, 1, 20, 4) }));
  const ids = new Set(freezers.map((f) => f.id));
  const boxes = (Array.isArray(raw.boxes) ? raw.boxes : [])
    .filter((b) => b && str(b.id) && ids.has(str(b.freezer)))
    .map((b) => {
      const rows = clampInt(b.rows, 1, 26, 9);
      const cols = clampInt(b.cols, 1, 24, 9);
      const slots: Record<string, Slot> = {};
      for (const [pos, s] of Object.entries(b.slots && typeof b.slots === 'object' ? b.slots : {})) {
        const at = parsePos(pos);
        if (!at || at.row >= rows || at.col >= cols || !s || (!str(s.id) && !str(s.ref))) continue;
        slots[posName(at.row, at.col)] = {
          path: str(s.path),
          id: str(s.id),
          ...(str(s.owner) ? { owner: str(s.owner) } : {}),
          ...(str(s.ref) ? { ref: str(s.ref) } : {}),
        };
      }
      const freezer = freezers.find((f) => f.id === str(b.freezer))!;
      return { id: str(b.id), name: str(b.name) || 'Box', freezer: freezer.id, shelf: clampInt(b.shelf, 1, freezer.shelves, 1), rows, cols, slots };
    });
  return { version: 1, freezers, boxes };
}

/** Whether a text is a freezers file at all (so that one that is not is never taken for an empty one). */
export function isFreezersText(text: string): boolean {
  try {
    const raw: unknown = JSON.parse(text);
    return !!raw && typeof raw === 'object' && !Array.isArray(raw);
  } catch {
    return false;
  }
}

export function formatFreezers(f: Freezers): string {
  return JSON.stringify(f, null, 2) + '\n';
}

/** Row 0 → "A", 25 → "Z". */
export const rowName = (row: number) => String.fromCharCode(65 + row);
export const posName = (row: number, col: number) => `${rowName(row)}${col + 1}`;
export function parsePos(pos: string): { row: number; col: number } | null {
  const m = /^([A-Z])(\d{1,2})$/.exec(pos.trim().toUpperCase());
  if (!m) return null;
  const col = Number(m[2]) - 1;
  return col < 0 ? null : { row: m[1].charCodeAt(0) - 65, col };
}

/** Every place of a box, row by row: A1, A2… */
export function positions(box: Pick<Box, 'rows' | 'cols'>): string[] {
  const out: string[] = [];
  for (let r = 0; r < box.rows; r++) for (let c = 0; c < box.cols; c++) out.push(posName(r, c));
  return out;
}

export const capacity = (box: Box) => box.rows * box.cols;
export const filled = (box: Box) => Object.keys(box.slots).length;

/** The first free place of a box, row by row, or null when it is full. */
export function firstFree(box: Box): string | null {
  return positions(box).find((p) => !box.slots[p]) ?? null;
}

export const newFreezerId = (prefix: 'f' | 'b') => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Where a stock's tubes are, in these freezers. */
export function placesOf(f: Freezers, id: string, path?: string): { box: Box; pos: string; freezer: Freezer }[] {
  const out: { box: Box; pos: string; freezer: Freezer }[] = [];
  for (const box of f.boxes)
    for (const [pos, s] of Object.entries(box.slots))
      if (s.id === id && (path === undefined || s.path === path)) out.push({ box, pos, freezer: f.freezers.find((x) => x.id === box.freezer)! });
  return out;
}

/** "Glycerol box 1 · B4": what a stock's Location says once it is put in a box. */
export const locationText = (box: Pick<Box, 'name'>, pos: string) => `${box.name} · ${pos}`;

/** "−80 °C freezer A › Shelf 2 › Glycerol box 1 › B4" */
export function placeText(freezer: Freezer | undefined, box: Box, pos?: string): string {
  return [freezer?.name, `Shelf ${box.shelf}`, box.name, pos].filter(Boolean).join(' › ');
}

// ───────────── Changes ─────────────
// Each takes the freezers as they are in the file now and returns them changed (the file is read
// again right before every change, so two people filling one box do not undo each other).

export function addFreezer(f: Freezers, freezer: Freezer): Freezers {
  return { ...f, freezers: [...f.freezers, freezer] };
}

export function updateFreezer(f: Freezers, id: string, patch: Partial<Omit<Freezer, 'id'>>): Freezers {
  const freezers = f.freezers.map((x) => (x.id === id ? { ...x, ...patch } : x));
  const shelves = freezers.find((x) => x.id === id)?.shelves ?? 1;
  // Fewer shelves: boxes on the ones gone go to the lowest left.
  return { ...f, freezers, boxes: f.boxes.map((b) => (b.freezer === id && b.shelf > shelves ? { ...b, shelf: shelves } : b)) };
}

/** Remove a freezer; refused (null) while a box is in it. */
export function removeFreezer(f: Freezers, id: string): Freezers | null {
  if (f.boxes.some((b) => b.freezer === id)) return null;
  return { ...f, freezers: f.freezers.filter((x) => x.id !== id) };
}

export function addBox(f: Freezers, box: Box): Freezers {
  return { ...f, boxes: [...f.boxes, box] };
}

export function updateBox(f: Freezers, id: string, patch: Partial<Pick<Box, 'name' | 'freezer' | 'shelf'>>): Freezers {
  return { ...f, boxes: f.boxes.map((b) => (b.id === id ? { ...b, ...patch } : b)) };
}

/** Remove a box; refused (null) while a tube is in it. */
export function removeBox(f: Freezers, id: string): Freezers | null {
  const box = f.boxes.find((b) => b.id === id);
  if (box && filled(box)) return null;
  return { ...f, boxes: f.boxes.filter((b) => b.id !== id) };
}

/**
 * Put a tube in a place. Refused (null) when someone else's tube is there already (the file changed
 * since the box was shown); the same stock there already is fine.
 */
export function putTube(f: Freezers, boxId: string, pos: string, slot: Slot): Freezers | null {
  const box = f.boxes.find((b) => b.id === boxId);
  const at = parsePos(pos);
  if (!box || !at || at.row >= box.rows || at.col >= box.cols) return null;
  const there = box.slots[pos];
  if (there && !(there.id === slot.id && there.path === slot.path)) return null;
  return { ...f, boxes: f.boxes.map((b) => (b.id === boxId ? { ...b, slots: { ...b.slots, [pos]: slot } } : b)) };
}

export function takeTube(f: Freezers, boxId: string, pos: string): Freezers {
  return {
    ...f,
    boxes: f.boxes.map((b) => {
      if (b.id !== boxId || !b.slots[pos]) return b;
      const slots = { ...b.slots };
      delete slots[pos];
      return { ...b, slots };
    }),
  };
}

/** Whether two slots hold the same tube (someone else's own tube is known by its owner and `ref` only). */
export const sameTube = (a: Slot | undefined, b: Slot | undefined) =>
  !!a && !!b && a.id === b.id && a.path === b.path && (a.owner ?? '') === (b.owner ?? '') && (a.ref ?? '') === (b.ref ?? '');

/**
 * Move a tube to another place, in its box or another one. Refused (null) when it is no longer where
 * it was (someone took it out or moved it meanwhile), or when the place it goes to has been taken.
 * Anyone who can change the box can: someone else's own tube moves as it is, without saying what it is.
 */
export function moveTube(f: Freezers, from: { box: string; pos: string }, to: { box: string; pos: string }, tube: Slot): Freezers | null {
  const source = f.boxes.find((b) => b.id === from.box);
  const target = f.boxes.find((b) => b.id === to.box);
  const at = parsePos(to.pos);
  if (!source || !target || !at || at.row >= target.rows || at.col >= target.cols) return null;
  const there = source.slots[from.pos];
  if (!sameTube(there, tube)) return null;
  if (from.box === to.box && from.pos === to.pos) return f;
  if (target.slots[to.pos]) return null;
  return putTube(takeTube(f, from.box, from.pos), to.box, to.pos, there);
}

/**
 * A collection moved or renamed: its tubes follow it. `owner` is whose own stock each now is (no
 * one's once the collection is the lab's).
 */
export function renameSlots(f: Freezers, from: string, to: string, owner?: string): Freezers {
  if (!f.boxes.some((b) => Object.values(b.slots).some((s) => s.path === from))) return f;
  // Still someone's own: it keeps the name it goes by in the lab's file.
  const moved = (s: Slot): Slot => ({ path: to, id: s.id, ...(owner ? { owner, ...(s.ref ? { ref: s.ref } : {}) } : {}) });
  return {
    ...f,
    boxes: f.boxes.map((b) => ({
      ...b,
      slots: Object.fromEntries(Object.entries(b.slots).map(([p, s]) => [p, s.path === from ? moved(s) : s])),
    })),
  };
}
