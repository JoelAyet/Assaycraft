import { describe, expect, it } from 'vitest';
import { adjustFormula, evaluateSheet, findRefs, shiftFormula, SheetEvaluator } from '../../src/sheet/formula';
import { colIndex, colName } from '../../src/sheet/refs';
import { deleteRows, insertRows, insertCols, deleteCols } from '../../src/sheet/model';
import { parseDelimited, toDelimited } from '../../src/sheet/tsv';

const calc = (formula: string, cells: string[][] = [[]]) => {
  const grid = cells.map((r) => [...r]);
  grid.push([formula]);
  return evaluateSheet(grid)[grid.length - 1][0];
};

describe('formula engine', () => {
  it('does arithmetic with Excel precedence', () => {
    expect(calc('=1+2*3')).toBe('7');
    expect(calc('=(1+2)*3')).toBe('9');
    expect(calc('=2^3^2')).toBe('64'); // left-assoc like Excel
    expect(calc('=-2^2')).toBe('4'); // negation binds tighter than ^
    expect(calc('=10%')).toBe('0.1');
    expect(calc('=0.1+0.2')).toBe('0.3');
    expect(calc('=1/3')).toBe('0.333333333333');
    expect(calc('="a"&"b"&1')).toBe('ab1');
    expect(calc('=1/0')).toBe('#DIV/0!');
  });

  it('resolves references and ranges', () => {
    const cells = [
      ['Vol', 'n'],
      ['5', '2'],
      ['2.5', '4'],
    ];
    expect(calc('=A2*B2+A3*B3', cells)).toBe('20');
    expect(calc('=SUM(A2:B3)', cells)).toBe('13.5');
    expect(calc('=SUM($A$2:A3)', cells)).toBe('7.5');
    expect(calc('=AVERAGE(B2:B3)', cells)).toBe('3');
    expect(calc('=COUNT(A1:B3)', cells)).toBe('4');
    expect(calc('=COUNTA(A1:B3)', cells)).toBe('6');
    expect(calc('=SUMPRODUCT(A2:A3,B2:B3)', cells)).toBe('20');
  });

  it('ignores text in ranges but errors on text arithmetic', () => {
    const cells = [
      ['a', '1'],
      ['b', '2'],
    ];
    expect(calc('=SUM(A1:B2)', cells)).toBe('3');
    expect(calc('=A1+1', cells)).toBe('#VALUE!');
    expect(calc('=A5+1', cells)).toBe('1'); // empty cell counts as 0
  });

  it('supports statistics and rounding', () => {
    const cells = [['2'], ['4'], ['4'], ['4'], ['5'], ['5'], ['7'], ['9']];
    expect(calc('=STDEVP(A1:A8)', cells)).toBe('2');
    expect(calc('=ROUND(STDEV(A1:A8),3)', cells)).toBe('2.138');
    expect(calc('=MEDIAN(A1:A8)', cells)).toBe('4.5');
    expect(calc('=ROUND(1.005,2)')).toBe('1.01');
    expect(calc('=ROUND(-2.5,0)')).toBe('-3');
    expect(calc('=ROUNDUP(1.21,1)')).toBe('1.3');
    expect(calc('=ROUNDDOWN(-1.29,1)')).toBe('-1.2');
    expect(calc('=MOD(-3,2)')).toBe('1');
  });

  it('supports logic and conditional aggregates', () => {
    const cells = [['1'], ['5'], ['10'], ['x']];
    expect(calc('=IF(A2>3,"high","low")', cells)).toBe('high');
    expect(calc('=IF(A1>3,"high")', cells)).toBe('FALSE');
    expect(calc('=COUNTIF(A1:A4,">=5")', cells)).toBe('2');
    expect(calc('=SUMIF(A1:A4,"<>5")', cells)).toBe('11');
    expect(calc('=COUNTIF(A1:A4,"x")', cells)).toBe('1');
    expect(calc('=IFERROR(1/0,"n/a")')).toBe('n/a');
    expect(calc('=AND(1,TRUE)')).toBe('TRUE');
    expect(calc('=OR(0,FALSE)')).toBe('FALSE');
  });

  it('accepts semicolons as argument separators', () => {
    expect(calc('=SUM(1;2;3)')).toBe('6');
  });

  it('reports errors', () => {
    expect(calc('=FOO(1)')).toBe('#NAME?');
    expect(calc('=1+')).toBe('#ERROR!');
    expect(calc('=SQRT(-1)')).toBe('#NUM!');
    const ev = new SheetEvaluator([['=B1', '=A1']]);
    expect(ev.display(0, 0)).toBe('#CYCLE!');
  });

  it('computes chains of formulas', () => {
    const cells = [['=B1*2', '=C1+1', '3']];
    expect(evaluateSheet(cells)[0]).toEqual(['8', '4', '3']);
  });
});

describe('reference rewriting', () => {
  it('shifts relative references when filling', () => {
    expect(shiftFormula('=A2*B2', 1, 0)).toBe('=A3*B3');
    expect(shiftFormula('=$A$2*B$2+$C3', 2, 1)).toBe('=$A$2*C$2+$C5');
    expect(shiftFormula('=SUM(A1:A3)', 0, 1)).toBe('=SUM(B1:B3)');
    expect(shiftFormula('=A1', -1, 0)).toBe('=#REF!');
    expect(shiftFormula('="A1"&A1', 1, 0)).toBe('="A1"&A2');
  });

  it('adjusts references when rows are inserted or deleted', () => {
    expect(adjustFormula('=SUM(B2:B5)', 'row', 3, 1)).toBe('=SUM(B2:B6)');
    expect(adjustFormula('=B7', 'row', 3, 2)).toBe('=B9');
    expect(adjustFormula('=B2', 'row', 3, 2)).toBe('=B2');
    expect(adjustFormula('=SUM(B2:B5)', 'row', 2, -1)).toBe('=SUM(B2:B4)');
    expect(adjustFormula('=B3', 'row', 2, -1)).toBe('=#REF!');
    expect(adjustFormula('=SUM(B3:B4)', 'row', 2, -2)).toBe('=SUM(#REF!)');
    expect(adjustFormula('=SUM(B2:B5)', 'row', 1, -2)).toBe('=SUM(B2:B3)');
    expect(adjustFormula('=C1', 'col', 0, 1)).toBe('=D1');
  });

  it('keeps sheets consistent through structural edits', () => {
    const sheet = { rows: [['a'], ['1'], ['2'], ['=SUM(A2:A3)']] };
    const ins = insertRows(sheet, 2);
    expect(ins.rows.map((r) => r[0])).toEqual(['a', '1', '', '2', '=SUM(A2:A4)']);
    const del = deleteRows(ins, 1);
    expect(del.rows.map((r) => r[0])).toEqual(['a', '', '2', '=SUM(A2:A3)']);
    const cols = deleteCols(insertCols({ rows: [['=B1', 'x']] }, 0), 0);
    expect(cols.rows[0]).toEqual(['=B1', 'x']);
  });

  it('finds references for highlighting', () => {
    expect(findRefs('=A1+SUM(B2:C3)')).toEqual([
      { start: 1, end: 3, r1: 0, c1: 0, r2: 0, c2: 0 },
      { start: 8, end: 13, r1: 1, c1: 1, r2: 2, c2: 2 },
    ]);
  });

  it('converts column names', () => {
    expect(colName(0)).toBe('A');
    expect(colName(25)).toBe('Z');
    expect(colName(26)).toBe('AA');
    expect(colIndex('AB')).toBe(27);
  });
});

describe('TSV / CSV', () => {
  it('parses Excel clipboard text', () => {
    expect(parseDelimited('a\tb\r\n1\t"x\ny"\r\n')).toEqual([
      ['a', 'b'],
      ['1', 'x\ny'],
    ]);
    expect(parseDelimited('a,"b,""c"""\n', ',')).toEqual([['a', 'b,"c"']]);
  });

  it('writes TSV that round-trips', () => {
    const rows = [
      ['a', 'b\tc'],
      ['"q"', 'x\ny'],
    ];
    expect(parseDelimited(toDelimited(rows))).toEqual(rows);
  });
});
