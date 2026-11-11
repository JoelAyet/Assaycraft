/**
 * Reading and changing the notebook's freezers (Stocks/freezers.json). Every change reads the file
 * again first and applies itself to what is there, so a change made meanwhile (on a connected phone,
 * say) is kept.
 *
 * On an Assaycraft server, a lab's space has freezers of its own, shared by its people; that
 * version of this file (in Assaycraft_server) handles those too. A notebook of one's own has one
 * set of freezers: its space is '' throughout.
 */
import { create } from 'zustand';
import { getState } from '../notebook/store';
import { LAYOUT } from '../notebook/model';
import { join } from '../lib/path';
import { isNotFound } from '../fs/types';
import { setStockCell } from '../notebook/actions';
import {
  FREEZER_FILE,
  emptyFreezers,
  formatFreezers,
  isFreezersText,
  locationText,
  moveTube,
  parseFreezers,
  type Box,
  type Freezers,
  type Slot,
} from './freezers';

/** Where a space keeps its freezers (a notebook of one's own has one space, ''). */
export const freezerPath = (_space = '') => join(LAYOUT.stocks, FREEZER_FILE);
export const isFreezerPath = (path: string | undefined) => !!path && (path === FREEZER_FILE || path.endsWith(`/${FREEZER_FILE}`));

/** The freezers, as last read (by space). */
export const useFreezers = create<Record<string, Freezers | undefined>>(() => ({}));

export async function loadFreezers(space = ''): Promise<Freezers> {
  const v = getState().vault;
  if (!v) return emptyFreezers();
  let f: Freezers;
  try {
    f = parseFreezers(await v.readText(freezerPath(space)));
  } catch (err) {
    if (!isNotFound(err)) throw err;
    f = emptyFreezers();
  }
  useFreezers.setState({ [space]: f });
  return f;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Change the freezers. `change` gets them as they are in the file now; returning null refuses (the
 * reason is thrown as an error).
 */
export function changeFreezers(space: string, change: (f: Freezers) => Freezers | null, refused = 'That cannot be done now.'): Promise<Freezers> {
  const run = async () => {
    const v = getState().vault;
    if (!v) throw new Error('No notebook is open');
    if (!(await v.exists(LAYOUT.stocks))) await v.mkdir(LAYOUT.stocks);
    let text: string | null = null;
    try {
      text = await v.readText(freezerPath(space));
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    // A file that cannot be read as freezers (damaged by another program) is not written over: that
    // would put this one change in place of every box it held.
    if (text !== null && text.trim() && !isFreezersText(text))
      throw new Error('the freezers file (freezers.json) cannot be read; nothing was changed');
    const now = text === null ? emptyFreezers() : parseFreezers(text);
    useFreezers.setState({ [space]: now });
    const next = change(now);
    if (!next) throw new Error(refused);
    await v.write(freezerPath(space), formatFreezers(next));
    useFreezers.setState({ [space]: next });
    return next;
  };
  const next = queue.catch(() => undefined).then(run);
  queue = next;
  return next;
}

/** A Location this wrote ("Glycerol box 1 · B4"), as against one typed by hand. */
const WRITTEN_LOCATION = / · [A-Z]\d{1,2}$/;

/** The stock's Location column says where its tube is now ("Glycerol box 1 · B4"), when it can. */
export async function writeLocation(path: string, id: string, box: Pick<Box, 'name'> | null, pos?: string) {
  if (!getState().docs[path]) return;
  await setStockCell(
    path,
    id,
    (columns) => columns.findIndex((c) => /^location$/i.test(c.trim())),
    (old) => {
      // A Location typed by hand is kept when the tube is taken out; one this wrote is cleared.
      if (!box) return WRITTEN_LOCATION.test(old) ? '' : old;
      return locationText(box, pos ?? '');
    },
  ).catch((err) => console.warn('Could not write the location of', id, err));
}

/** Move a tube to another place of the boxes; its stock's Location follows. */
export async function moveTubeTo(space: string, from: { box: Box; pos: string }, to: { box: Box; pos: string }, tube: Slot) {
  await changeFreezers(
    space,
    (f) => moveTube(f, { box: from.box.id, pos: from.pos }, { box: to.box.id, pos: to.pos }, tube),
    `It was moved or taken out meanwhile, or ${to.pos} has just been taken.`,
  );
  await writeLocation(tube.path, tube.id, to.box, to.pos);
}
