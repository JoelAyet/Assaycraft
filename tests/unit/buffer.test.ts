import { describe, expect, it } from 'vitest';
import {
  bufferFromTable,
  bufferMeta,
  bufferTable,
  computeBuffer,
  computeRow,
  formatMass,
  formatVolume,
  normalizeBuffer,
  parseNumber,
  splitQuantity,
  unitId,
  type BufferData,
  type BufferRow,
} from '../../src/buffer/calc';
import type { JSONContent } from '@tiptap/core';
import { bufferToMarkdown } from '../../src/markdown/serialize';
import { parseMarkdown } from '../../src/markdown/parse';
import { collectVariables, fillVariables } from '../../src/templates/engine';

const row = (name: string, stock: string, stockUnit: string, final: string, finalUnit: string): BufferRow => ({
  name,
  stock,
  stockUnit,
  final,
  finalUnit,
});
const text = (r: ReturnType<typeof computeRow>) => (r.kind === 'volume' || r.kind === 'mass' ? r.text : r.kind === 'error' ? `! ${r.message}` : '');

describe('buffer calculator', () => {
  it('reads numbers and units however they are typed', () => {
    expect(parseNumber('1.5')).toBe(1.5);
    expect(parseNumber('1,5')).toBe(1.5);
    expect(parseNumber('2e-3')).toBe(0.002);
    expect(parseNumber('abc')).toBeNaN();
    expect(parseNumber('')).toBeNaN();
    expect(unitId('uM')).toBe('µM');
    expect(unitId('μM')).toBe('µM');
    expect(unitId('mg/ml')).toBe('mg/mL');
    expect(unitId('x')).toBe('X');
    expect(unitId('×')).toBe('X');
    expect(unitId('U/uL')).toBe('U/µL');
    expect(unitId('m')).toBe('M');
    expect(unitId('mm')).toBe('mM');
    expect(unitId('furlongs')).toBeNull();
    expect(splitQuantity('50 mM')).toEqual({ value: '50', unit: 'mM' });
    expect(splitQuantity('0,5M')).toEqual({ value: '0,5', unit: 'M' });
    expect(splitQuantity('58.44 g/mol')).toEqual({ value: '58.44', unit: 'g/mol' });
  });

  it('dilutes stocks with C1·V1 = C2·V2, across units of the same kind', () => {
    const V = 0.05; // 50 mL
    expect(text(computeRow(row('Tris', '1', 'M', '50', 'mM'), V))).toBe('2.5 mL');
    expect(text(computeRow(row('NaCl', '5', 'M', '150', 'mM'), V))).toBe('1.5 mL');
    expect(text(computeRow(row('EDTA', '0.5', 'M', '1', 'mM'), V))).toBe('100 µL');
    expect(text(computeRow(row('DTT', '1', 'M', '1', 'µM'), V))).toBe('50 nL');
    expect(text(computeRow(row('Glycerol', '100', '%', '10', '%'), V))).toBe('5 mL');
    expect(text(computeRow(row('PBS', '10', 'X', '1', 'X'), V))).toBe('5 mL');
    expect(text(computeRow(row('BSA', '10', 'mg/mL', '100', 'µg/mL'), V))).toBe('500 µL');
    expect(text(computeRow(row('BSA', '20', 'ng/µL', '1', 'µg/mL'), V))).toBe('2.5 mL');
    expect(text(computeRow(row('Enzyme', '20', 'U/µL', '50', 'U/mL'), V))).toBe('125 µL');
    // % w/v and mass per volume convert (1 % = 10 g/L).
    expect(text(computeRow(row('SDS', '10', '%', '1', 'mg/mL'), V))).toBe('500 µL');
    expect(text(computeRow(row('Tris', '1', 'M', '50', 'mM'), 0.001))).toBe('50 µL');
    // A 50 µL PCR: 1 µL of dNTPs and 0.5 µL of polymerase, as they are pipetted.
    expect(text(computeRow(row('dNTPs', '10', 'mM', '200', 'µM'), 50e-6))).toBe('1 µL');
    expect(text(computeRow(row('Q5', '2', 'U/µL', '0.02', 'U/µL'), 50e-6))).toBe('0.5 µL');
  });

  it('works out how much powder to weigh from its molar mass', () => {
    expect(text(computeRow(row('NaCl', '58.44', 'g/mol', '150', 'mM'), 0.05))).toBe('438.3 mg');
    expect(text(computeRow(row('Tris base', '121.14', 'g/mol', '1', 'M'), 1))).toBe('121.1 g');
    expect(text(computeRow(row('BSA', '66430', 'g/mol', '1', 'mg/mL'), 0.01))).toBe('10 mg');
    expect(text(computeRow(row('Agarose', '1', 'g/mol', '1', '%'), 0.1))).toBe('1 g');
    expect(text(computeRow(row('?', '58.44', 'g/mol', '1', 'X'), 0.05))).toBe('! A powder can’t be dosed in X');
  });

  it('explains what is wrong instead of giving a number', () => {
    expect(text(computeRow(row('A', '1', 'M', '2', 'M'), 0.05))).toBe('! The final concentration is above the stock');
    expect(text(computeRow(row('A', '1', 'M', '1', 'mg/mL'), 0.05))).toBe('! M and mg/mL don’t convert');
    expect(text(computeRow(row('A', '0', 'M', '1', 'mM'), 0.05))).toBe('! The stock must be above 0');
    expect(text(computeRow(row('A', 'lots', 'M', '1', 'mM'), 0.05))).toBe('! The stock is not a number');
    expect(text(computeRow(row('A', '1', 'M', '', 'mM'), 0.05))).toBe('');
    expect(text(computeRow(row('A', '1', 'M', '1', 'mM'), null))).toBe('');
  });

  it('fills up to the final volume with the solvent', () => {
    const d: BufferData = {
      name: 'Lysis buffer',
      volume: '50',
      volumeUnit: 'mL',
      solvent: 'Water',
      rows: [row('Tris-HCl pH 8.0', '1', 'M', '50', 'mM'), row('NaCl', '5', 'M', '150', 'mM'), row('NaN3', '65.01', 'g/mol', '3', 'mM')],
    };
    const r = computeBuffer(d);
    expect(r.liters).toBe(0.05);
    expect(r.fill?.text).toBe('46 mL'); // solids don't count toward the volume
    expect(r.error).toBeNull();
    const over = computeBuffer({ ...d, rows: [row('Glycerol', '100', '%', '60', '%'), row('Ethanol', '100', '%', '50', '%')] });
    expect(over.error).toBe('The components add up to more than the final volume');
    expect(computeBuffer({ ...d, volume: '' }).fill).toBeNull();
  });

  it('formats amounts with a sensible unit', () => {
    expect(formatVolume(1.5)).toBe('1.5 L');
    expect(formatVolume(0.00025)).toBe('250 µL');
    expect(formatVolume(1 / 30000)).toBe('33.33 µL');
    expect(formatMass(0.0004383)).toBe('438.3 µg');
    // Rounding at a unit's edge, and amounts as they are pipetted.
    expect(formatVolume(9.999999999e-7)).toBe('1 µL');
    expect(formatVolume(0.0009999999999)).toBe('1 mL');
    expect(formatVolume(5e-7)).toBe('0.5 µL');
    expect(formatVolume(1e-7)).toBe('0.1 µL');
    expect(formatVolume(5e-8)).toBe('50 nL');
    expect(formatMass(0.9999999999)).toBe('1 g');
    expect(formatMass(2500)).toBe('2.5 kg');
  });

  it('is saved as a readable table and read back from it', () => {
    const d = normalizeBuffer({
      name: 'Lysis buffer',
      volume: '50',
      volumeUnit: 'mL',
      solvent: 'Milli-Q water',
      rows: [row('Tris-HCl pH 8.0', '1', 'M', '50', 'mM'), row('', '', 'M', '', 'mM'), row('NaCl', '58.44', 'g/mol', '150', 'mM')],
    });
    const table = bufferTable(d);
    expect(table).toEqual([
      ['Component', 'Stock', 'Final', 'Add'],
      ['Tris-HCl pH 8.0', '1 M', '50 mM', '2.5 mL'],
      ['NaCl', '58.44 g/mol', '150 mM', '438.3 mg'],
      ['Milli-Q water', '', '', 'to 50 mL (47.5 mL)'],
    ]);
    expect(bufferMeta(d)).toEqual({ name: 'Lysis buffer', volume: '50 mL', solvent: 'Milli-Q water' });
    const back = bufferFromTable(table, bufferMeta(d));
    expect(back).toEqual({ ...d, rows: [d.rows[0], d.rows[2]] });
  });

  it('reads a table written by hand', () => {
    const d = bufferFromTable(
      [
        ['Reagent', 'Stock', 'Final'],
        ['HEPES', '1 m', '20 mm'],
        ['KCl', '2M', '100 mM'],
      ],
      { volume: '200 ml' },
    );
    expect(d.volume).toBe('200');
    expect(d.volumeUnit).toBe('mL');
    expect(d.solvent).toBe('Water');
    expect(d.rows).toEqual([row('HEPES', '1', 'M', '20', 'mM'), row('KCl', '2', 'M', '100', 'mM')]);
    expect(computeBuffer(d).fill?.text).toBe('186 mL');
  });
});

describe('buffers in templates', () => {
  const d: BufferData = {
    name: 'Lysis buffer',
    volume: '{{Volume|50}}',
    volumeUnit: 'mL',
    solvent: 'Water',
    rows: [row('NaCl', '5', 'M', '{{Salt|150}}', 'mM')],
  };
  it('keep their {{variables}} in the file, defaults included', () => {
    const md = bufferToMarkdown(d) + '\n';
    expect(md).toContain('"volume":"{{Volume|50}} mL"');
    expect(md).toContain('| NaCl | 5 M | {{Salt\\|150}} mM |');
    const back = parseMarkdown(md).toJSON().content![0].attrs!.data as BufferData;
    expect(back.volume).toBe('{{Volume|50}}');
    expect(back.volumeUnit).toBe('mL');
    expect(back.rows[0]).toEqual(row('NaCl', '5', 'M', '{{Salt|150}}', 'mM'));
  });
  it('ask for them, and calculate once they are filled in', () => {
    const json = parseMarkdown(bufferToMarkdown(d) + '\n').toJSON() as JSONContent;
    expect(collectVariables(json).map((v) => `${v.name}|${v.defaultValue}`)).toEqual(['Volume|50', 'Salt|150']);
    const filled = fillVariables(json, { Volume: '20' }).content![0].attrs!.data as BufferData;
    expect(filled.volume).toBe('20');
    expect(filled.rows[0].final).toBe('150');
    expect(text(computeBuffer(filled).rows[0])).toBe('600 µL');
  });
});
