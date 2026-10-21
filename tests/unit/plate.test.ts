import { describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { parseMarkdown } from '../../src/markdown/parse';
import { plateToMarkdown, serializeMarkdown } from '../../src/markdown/serialize';
import { docSchema } from '../../src/editor/schema';
import { collectVariables, fillVariables } from '../../src/templates/engine';
import { bodyFacts, toPlainText } from '../../src/notebook/text';
import {
  assignWells,
  changeFormat,
  newPlate,
  normalizePlate,
  plateCounts,
  plateFromTable,
  plateRefs,
  removeSample,
  renameSample,
  wellIndex,
  wellList,
  wellsBetween,
  wellsOutside,
  formatOf,
  type PlateData,
} from '../../src/plate/model';

const roundTrip = (md: string) => serializeMarkdown(parseMarkdown(md));
const plateNode = (md: string) => (parseMarkdown(md).toJSON() as JSONContent).content!.find((n) => n.type === 'plate')!;

function elisa(): PlateData {
  let d: PlateData = {
    ...newPlate(96),
    name: 'ELISA 1',
    samples: [
      { name: 'Blank', color: 'gray' },
      { name: 'WT', color: 'blue', ref: 'GS-0001' },
      { name: 'ΔlacZ', color: 'orange', ref: 'GS-0002' },
    ],
  };
  d = assignWells(d, wellsBetween([0, 0], [7, 0]), 'Blank');
  d = assignWells(d, wellsBetween([0, 1], [2, 3]), 'WT');
  d = assignWells(d, ['H12'], 'ΔlacZ');
  return d;
}

describe('plate layouts', () => {
  it('knows its formats and wells', () => {
    expect(formatOf(384)).toEqual({ wells: 384, rows: 16, cols: 24 });
    expect(formatOf(7)).toEqual({ wells: 96, rows: 8, cols: 12 });
    expect(wellIndex('h12', formatOf(96))).toEqual([7, 11]);
    expect(wellIndex('I1', formatOf(96))).toBeNull();
    expect(wellIndex('P24', formatOf(384))).toEqual([15, 23]);
    expect(wellsBetween([1, 2], [0, 1])).toEqual(['A2', 'A3', 'B2', 'B3']);
  });

  it('puts samples in wells, counts them, renames and removes them', () => {
    const d = elisa();
    expect(plateCounts(d)).toEqual({ bySample: { Blank: 8, WT: 9, ΔlacZ: 1 }, used: 18 });
    const renamed = renameSample(d, 'WT', 'Wild type');
    expect(renamed.wells.B2).toBe('Wild type');
    expect(renamed.samples[1]).toEqual({ name: 'Wild type', color: 'blue', ref: 'GS-0001' });
    // A name that is taken is refused.
    expect(renameSample(d, 'WT', 'Blank')).toBe(d);
    const removed = removeSample(d, 'Blank');
    expect(removed.samples.map((s) => s.name)).toEqual(['WT', 'ΔlacZ']);
    expect(plateCounts(removed).used).toBe(10);
    expect(assignWells(d, ['A1', 'B2'], null).wells.A1).toBeUndefined();
  });

  it('keeps the wells that still exist when the format changes', () => {
    const d = elisa();
    expect(wellsOutside(d, 24)).toBe(5);
    const small = changeFormat(d, 24);
    expect(small.format).toBe(24);
    expect(Object.keys(small.wells).sort()).toEqual(['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4', 'D1'].sort());
    expect(changeFormat(d, 384).wells).toEqual(d.wells);
  });

  it('is saved as a comment and a table of wells, and read back', () => {
    const md = plateToMarkdown(elisa());
    const lines = md.split('\n');
    expect(lines[0]).toBe(
      '<!-- gc:plate {"name":"ELISA 1","format":96,"samples":[{"name":"Blank","color":"gray"},{"name":"WT","color":"blue","ref":"GS-0001"},{"name":"ΔlacZ","color":"orange","ref":"GS-0002"}]} -->',
    );
    expect(lines[1]).toBe('|   | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |');
    expect(lines[3]).toBe('| A | Blank | WT | WT | WT |   |   |   |   |   |   |   |   |');
    expect(lines[10]).toBe('| H | Blank |   |   |   |   |   |   |   |   |   |   | ΔlacZ |');
    expect(lines).toHaveLength(11);
    const body = `## Plate\n\n${md}\n\nRead at 450 nm.\n`;
    expect(roundTrip(body)).toBe(body);
    expect(plateNode(body).attrs!.data).toEqual(elisa());
  });

  it('reads a table edited by hand: new names become samples, the format comes from its size', () => {
    const d = plateFromTable(
      [
        ['', '1', '2', '3'],
        ['A', 'WT', 'WT', 'KO'],
        ['B', 'Blank', '', 'KO \\| rep 2'],
      ],
      null,
    );
    expect(d.format).toBe(6);
    expect(d.samples.map((s) => [s.name, s.color])).toEqual([
      ['WT', 'blue'],
      ['KO', 'orange'],
      ['Blank', 'gray'],
      ['KO | rep 2', 'green'],
    ]);
    expect(d.wells).toEqual({ A1: 'WT', A2: 'WT', A3: 'KO', B1: 'Blank', B3: 'KO | rep 2' });
    // Rubbish in the comment is ignored, wells outside the plate are dropped.
    expect(normalizePlate({ format: 96, samples: [{ name: '', color: 'nope' } as never], wells: { Z9: 'x', A1: ' WT ' } })).toEqual({
      name: '',
      format: 96,
      samples: [{ name: 'WT', color: 'blue' }],
      wells: { A1: 'WT' },
    });
  });

  it('a 384-well plate round-trips too', () => {
    const d = assignWells({ ...newPlate(384), samples: [{ name: 'S', color: 'teal' }] }, ['P24', 'A1'], 'S');
    const md = plateToMarkdown(d);
    expect(md.split('\n')).toHaveLength(2 + 1 + 16);
    expect(plateNode(md).attrs!.data).toEqual(d);
  });

  it('lists its wells for a plate reader, and counts the stocks it uses', () => {
    const list = wellList(elisa(), (ref) => `${ref} (stock)`);
    expect(list[0]).toEqual(['Well', 'Sample', 'Linked to']);
    expect(list).toHaveLength(97);
    expect(list[2]).toEqual(['A2', 'WT', 'GS-0001 (stock)']);
    expect(list[96]).toEqual(['H12', 'ΔlacZ', 'GS-0002 (stock)']);
    const body = `Samples from [PR-0001 EGFP-fwd](../../Stocks/Primers.md#PR-0001).\n\n${plateToMarkdown(elisa())}\n`;
    expect(plateRefs(body)).toEqual(['GS-0001', 'GS-0002']);
    expect(bodyFacts(body).refs).toEqual(['Primers', 'PR-0001', 'GS-0001', 'GS-0002']);
  });

  it('shows in previews and search as its name and samples, not every well', () => {
    const body = `Supernatants from day 2.\n\n${plateToMarkdown(elisa())}\n\nRead at 450 nm.\n`;
    expect(toPlainText(body)).toBe('Supernatants from day 2. ELISA 1, 96-well plate: Blank, WT, ΔlacZ. Read at 450 nm.');
    // A table edited by hand: its new names count, and an unnamed plate says what it is.
    const hand = '<!-- gc:plate {"format":24,"samples":[]} -->\n|   | 1 | 2 |\n| --- | --- | --- |\n| A | WT | KO \\| 2 |\n';
    expect(toPlainText(hand)).toBe('24-well plate: WT, KO 2.');
  });

  it('fills {{variables}} in a template’s plate, in its samples and wells alike', () => {
    const d = assignWells(
      { ...newPlate(96), name: 'Screen of {{Strain}}', samples: [{ name: '{{Strain}}', color: 'blue' }] },
      ['A1', 'A2'],
      '{{Strain}}',
    );
    const json = parseMarkdown(`${plateToMarkdown(d)}\n`).toJSON() as JSONContent;
    expect(collectVariables(json).map((v) => v.name)).toEqual(['Strain']);
    const filled = fillVariables(json, { strain: 'BY4741' });
    const out = serializeMarkdown(docSchema().nodeFromJSON(filled));
    expect(out).toContain('"name":"Screen of BY4741"');
    expect(out).toContain('| A | BY4741 | BY4741 |');
    expect(out).not.toContain('{{');
  });
});
