import { describe, expect, it } from 'vitest';
import {
  cleanSequence,
  columnRoles,
  meltingTemp,
  nextStockId,
  parseStockTable,
  sequenceStats,
  stockItems,
  writeStockTable,
  STOCK_TYPES,
} from '../../src/stocks/model';

describe('primer maths', () => {
  it('matches nearest-neighbour Tm from Biopython (SantaLucia 1998, 50 mM Na+, 250 nM primer)', () => {
    // Reference values: Bio.SeqUtils.MeltingTemp.Tm_NN(seq, nn_table=DNA_NN3, Na=50, dnac1=125, dnac2=125, saltcorr=5).
    const ref: [string, number][] = [
      ['ATGGTGAGCAAGGGCGAGGAG', 60.72],
      ['TTACTTGTACAGCTCGTCCATGCC', 58.88],
      ['TAATACGACTCACTATAGGG', 46.78],
      ['GATCAGCTAGCATCGACTAGCATCGA', 59.96],
      // Self-complementary (selfcomp=True, dnac1=250).
      ['GCGCATGCGC', 45.43],
      ['ACGTACGTACGTACGT', 49.94],
      ['AAAAAAAATTTTTTTT', 31.85],
    ];
    for (const [seq, tm] of ref) expect(meltingTemp(seq), seq).toBeCloseTo(tm, 1);
  });

  it('reads sequences however they are written', () => {
    expect(cleanSequence("5'-atg gtg agc-3'")).toBe('ATGGTGAGC');
    expect(cleanSequence('AUGGCU')).toBe('ATGGCT');
    expect(meltingTemp('ATGGTGA')).toBeNull(); // too short
    expect(meltingTemp('ATGGTGAGCNNNAGCAAG')).toBeNull(); // ambiguous bases
    const s = sequenceStats('ATGGTGAGCAAGGGCGAGGAG');
    expect(s.length).toBe(21);
    expect(s.gc).toBeCloseTo(61.9, 1);
    expect(sequenceStats('').length).toBe(0);
  });
});

describe('stock tables', () => {
  const primers = STOCK_TYPES.find((t) => t.id === 'primer')!;

  it('knows which columns are computed from the sequence', () => {
    expect(columnRoles(primers.columns)).toEqual(['id', 'name', 'sequence', 'length', 'gc', 'tm', 'text', 'text', 'text', 'notes']);
    // Without a sequence, "Length" is just a column.
    expect(columnRoles(['ID', 'Name', 'Length'])).toEqual(['id', 'name', 'text']);
  });

  it('is saved as a plain table with Length, GC % and Tm filled in', () => {
    const md = writeStockTable({
      columns: primers.columns,
      rows: [
        ['PR-0001', 'EGFP-fwd', 'ATGGTGAGCAAGGGCGAGGAG', '', '', '', 'EGFP', 'Box 1 · A1', '2026-10-17', 'For | cloning'],
        ['', '', '', '', '', '', '', '', '', ''],
      ],
      before: 'Our primer box.',
      after: '',
    });
    expect(md).toBe(
      [
        'Our primer box.',
        '',
        '| ID | Name | Sequence (5′→3′) | Length (nt) | GC % | Tm (°C) | Target | Location | Date | Notes |',
        '| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |',
        '| PR-0001 | EGFP-fwd | ATGGTGAGCAAGGGCGAGGAG | 21 | 61.9 | 60.7 | EGFP | Box 1 · A1 | 2026-10-17 | For \\| cloning |',
        '',
      ].join('\n'),
    );
    const back = parseStockTable(md);
    expect(back.before).toBe('Our primer box.');
    expect(back.columns).toEqual(primers.columns);
    expect(back.rows).toEqual([
      ['PR-0001', 'EGFP-fwd', 'ATGGTGAGCAAGGGCGAGGAG', '21', '61.9', '60.7', 'EGFP', 'Box 1 · A1', '2026-10-17', 'For | cloning'],
    ]);
  });

  it('starts empty when the file has no table yet', () => {
    const t = parseStockTable('Some notes.\n', ['ID', 'Name']);
    expect(t).toEqual({ columns: ['ID', 'Name'], rows: [], before: 'Some notes.', after: '' });
  });

  it('numbers new stocks after the highest ID', () => {
    expect(nextStockId('PR-', [])).toBe('PR-0001');
    expect(nextStockId('PR-', ['PR-0001', 'PR-0012', 'PL-0099', 'oops'])).toBe('PR-0013');
  });

  it('lists the stocks of a collection for search and links', () => {
    const md = [
      '| ID | Name | Sequence | Tm (°C) | Location |',
      '| --- | --- | --- | --- | --- |',
      '| PR-0001 | EGFP-fwd | ATGGTGAGCAAGGGCGAGGAG |  | Box 1 |',
      '| not an id | Ignored |  |  |  |',
    ].join('\n');
    expect(stockItems(md)).toEqual([{ id: 'PR-0001', name: 'EGFP-fwd', summary: 'ATGGTGAGCAAGGGCGAGGAG · Tm 60.7 °C · Box 1' }]);
  });
});
