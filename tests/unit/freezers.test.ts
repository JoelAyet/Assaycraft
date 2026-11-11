/** Freezers, their shelves and boxes, and the tubes in the boxes (Stocks → Freezers). */
import { describe, expect, it } from 'vitest';
import {
  addBox,
  addFreezer,
  emptyFreezers,
  firstFree,
  formatFreezers,
  isFreezersText,
  moveTube,
  parseFreezers,
  parsePos,
  placesOf,
  placeText,
  posName,
  putTube,
  removeBox,
  removeFreezer,
  renameSlots,
  takeTube,
  updateFreezer,
  type Freezers,
} from '../../src/stocks/freezers';

describe('freezers', () => {
  const start = (): Freezers => {
    let f = addFreezer(emptyFreezers(), { id: 'f1', name: '−80 °C A', temp: '−80 °C', shelves: 4 });
    f = addBox(f, { id: 'b1', name: 'Glycerol box 1', freezer: 'f1', shelf: 2, rows: 9, cols: 9, slots: {} });
    return f;
  };
  const tube = { path: 'Lab/ab/Stocks/Glycerol stocks.md', id: 'GS-0001' };

  it('name places A1…I9, row by row', () => {
    expect(posName(0, 0)).toBe('A1');
    expect(posName(1, 3)).toBe('B4');
    expect(parsePos('b4')).toEqual({ row: 1, col: 3 });
    expect(parsePos('4B')).toBe(null);
    expect(firstFree(start().boxes[0])).toBe('A1');
  });

  it('put a tube in a free place, and refuse a place someone just took', () => {
    const f = putTube(start(), 'b1', 'A1', tube)!;
    expect(f.boxes[0].slots.A1).toEqual(tube);
    expect(firstFree(f.boxes[0])).toBe('A2');
    expect(putTube(f, 'b1', 'A1', { path: 'Stocks/Primers.md', id: 'PR-0001', owner: 'ana' })).toBe(null);
    expect(putTube(f, 'b1', 'J1', tube)).toBe(null);
    expect(placesOf(f, 'GS-0001', tube.path).map((p) => p.pos)).toEqual(['A1']);
    const p = placesOf(f, 'GS-0001')[0];
    expect(placeText(p.freezer, p.box, p.pos)).toBe('−80 °C A › Shelf 2 › Glycerol box 1 › A1');
    expect(takeTube(f, 'b1', 'A1').boxes[0].slots).toEqual({});
  });

  it('move a tube to another place or box: anyone’s, as it is, and only while it is still there', () => {
    let f = addBox(start(), { id: 'b2', name: 'Box 2', freezer: 'f1', shelf: 1, rows: 5, cols: 5, slots: {} });
    // The lab's stock in A1, and someone's own tube in A2, known to the others by its owner and a random name.
    const theirs = { path: '', id: '', owner: 'ana', ref: 'r0123456789abcdef01234567' };
    f = putTube(putTube(f, 'b1', 'A1', tube)!, 'b1', 'A2', theirs)!;
    const moved = moveTube(f, { box: 'b1', pos: 'A1' }, { box: 'b1', pos: 'C3' }, tube)!;
    expect(moved.boxes[0].slots).toEqual({ C3: tube, A2: theirs });
    // To another box, someone else's tube: it moves whole, still without saying what it is.
    const across = moveTube(moved, { box: 'b1', pos: 'A2' }, { box: 'b2', pos: 'B2' }, theirs)!;
    expect(across.boxes[0].slots).toEqual({ C3: tube });
    expect(across.boxes[1].slots).toEqual({ B2: theirs });
    // Refused: a place that is taken, one outside the box, and a tube no longer where it was.
    expect(moveTube(f, { box: 'b1', pos: 'A1' }, { box: 'b1', pos: 'A2' }, tube)).toBe(null);
    expect(moveTube(f, { box: 'b1', pos: 'A1' }, { box: 'b2', pos: 'F1' }, tube)).toBe(null);
    expect(moveTube(moved, { box: 'b1', pos: 'A1' }, { box: 'b1', pos: 'D4' }, tube)).toBe(null);
    expect(moveTube(f, { box: 'b1', pos: 'A2' }, { box: 'b1', pos: 'D4' }, { ...theirs, ref: 'rffffffffffffffffffffffff' })).toBe(null);
    // To where it is already: nothing changes.
    expect(moveTube(f, { box: 'b1', pos: 'A1' }, { box: 'b1', pos: 'A1' }, tube)).toBe(f);
  });

  it('tell a freezers file from one that is damaged (which is never taken for an empty one and written over)', () => {
    expect(isFreezersText(formatFreezers(start()))).toBe(true);
    expect(isFreezersText('{}')).toBe(true);
    for (const bad of ['{"version": 1, "freezers": [', 'not a file of ours', '[]', 'null', '3']) expect(isFreezersText(bad), bad).toBe(false);
  });

  it('keep boxes and freezers that still hold something', () => {
    const f = putTube(start(), 'b1', 'A1', tube)!;
    expect(removeBox(f, 'b1')).toBe(null);
    expect(removeFreezer(f, 'f1')).toBe(null);
    expect(removeBox(start(), 'b1')!.boxes).toEqual([]);
    // Fewer shelves: the box comes down to the last one left.
    expect(updateFreezer(start(), 'f1', { shelves: 1 }).boxes[0].shelf).toBe(1);
  });

  it('follow a collection that is shared or taken back', () => {
    const f = putTube(start(), 'b1', 'B2', { path: 'Stocks/Primers.md', id: 'PR-0001', owner: 'ana' })!;
    const shared = renameSlots(f, 'Stocks/Primers.md', 'Lab/ab/Stocks/Primers.md');
    expect(shared.boxes[0].slots.B2).toEqual({ path: 'Lab/ab/Stocks/Primers.md', id: 'PR-0001' });
    expect(renameSlots(shared, 'Lab/ab/Stocks/Primers.md', 'Stocks/Primers.md', 'ana').boxes[0].slots.B2.owner).toBe('ana');
  });

  it('read back what they wrote, and ignore what does not fit', () => {
    const f = putTube(start(), 'b1', 'C3', tube)!;
    expect(parseFreezers(formatFreezers(f))).toEqual(f);
    expect(parseFreezers('not json')).toEqual(emptyFreezers());
    const odd = JSON.stringify({
      freezers: [{ id: 'f1', name: 'A', shelves: 99 }],
      boxes: [
        { id: 'b1', freezer: 'f1', rows: 2, cols: 2, slots: { A1: tube, Z9: tube, B2: { id: '' } } },
        { id: 'b2', freezer: 'gone' },
      ],
    });
    const parsed = parseFreezers(odd);
    expect(parsed.freezers[0].shelves).toBe(20);
    expect(parsed.boxes).toHaveLength(1);
    expect(Object.keys(parsed.boxes[0].slots)).toEqual(['A1']);
  });
});
