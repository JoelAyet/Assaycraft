import { describe, expect, it } from 'vitest';
import { parseSnapGene, writeSnapGene, isSnapGene } from '../../src/bio/snapgene';
import { parseFasta, parseGenBank, parseLocation } from '../../src/bio/genbank';
import { featureBounds, gcContent, spanLength } from '../../src/bio/types';
import { readSequence } from '../../src/bio/detect';

const GB = `LOCUS       pDemo                    120 bp    DNA     circular SYN 16-OCT-2026
DEFINITION  Demo plasmid for Assaycraft
            second line.
FEATURES             Location/Qualifiers
     source          1..120
                     /organism="synthetic DNA construct"
     promoter        1..20
                     /label=T7\\promoter
     CDS             complement(join(30..50,60..90))
                     /gene="gfp"
                     /note="split CDS on the
                     reverse strand"
     misc_feature    110..10
                     /label="across origin"
                     /ApEinfo_fwdcolor=#ff0000
ORIGIN
        1 atgcatgcat gcatgcatgc atgcatgcat gcatgcatgc atgcatgcat gcatgcatgc
       61 atgcatgcat gcatgcatgc atgcatgcat gcatgcatgc atgcatgcat ggggcccccc
//
`;

describe('GenBank', () => {
  it('parses header, features and sequence', () => {
    const r = parseGenBank(GB);
    expect(r.name).toBe('pDemo');
    expect(r.circular).toBe(true);
    expect(r.length).toBe(120);
    expect(r.description).toBe('Demo plasmid for Assaycraft second line.');
    expect(r.features.map((f) => [f.name, f.type, f.start, f.end, f.strand])).toEqual([
      ['T7 promoter', 'promoter', 0, 20, 1],
      ['gfp', 'CDS', 29, 90, -1],
      ['across origin', 'misc_feature', 109, 10, 0],
    ]);
    expect(r.features[1].segments).toEqual([
      { start: 29, end: 50 },
      { start: 59, end: 90 },
    ]);
    expect(r.features[1].note).toBe('split CDS on the reverse strand');
    expect(r.features[2].color).toBe('#ff0000');
  });

  it('parses locations', () => {
    expect(parseLocation('<1..>50')).toEqual({ segments: [{ start: 0, end: 50 }], strand: 1 });
    expect(parseLocation('42')).toEqual({ segments: [{ start: 41, end: 42 }], strand: 1 });
    expect(parseLocation('complement(5..9)')?.strand).toBe(-1);
    expect(parseLocation('X12345:1..20')).toBeNull();
  });

  it('computes bounds and spans', () => {
    expect(
      featureBounds(
        [
          { start: 100, end: 120 },
          { start: 0, end: 10 },
        ],
        true,
      ),
    ).toEqual({ start: 100, end: 10 });
    expect(
      featureBounds(
        [
          { start: 50, end: 60 },
          { start: 0, end: 10 },
        ],
        false,
      ),
    ).toEqual({ start: 0, end: 60 });
    expect(spanLength(110, 10, 120)).toBe(20);
    expect(spanLength(2, 2, 10)).toBe(10);
    expect(gcContent('GGCCAATT')).toBe(0.5);
  });
});

describe('FASTA', () => {
  it('parses the first record', () => {
    const r = parseFasta('>seq1 my insert\nACGT\nACGT\n>seq2\nTTTT\n');
    expect(r).toMatchObject({ name: 'seq1', description: 'my insert', seq: 'ACGTACGT', length: 8, molecule: 'DNA' });
    expect(parseFasta('>p\nMKTAYIAKQR\n').molecule).toBe('protein');
  });
});

describe('SnapGene', () => {
  it('round-trips through the writer', () => {
    const bytes = writeSnapGene({
      seq: 'ATGC'.repeat(50),
      circular: true,
      features: [
        { name: 'ori', type: 'rep_origin', start: 10, end: 60, strand: 0, color: '#ffff00', segments: [{ start: 10, end: 60 }] },
        { name: 'AmpR', type: 'CDS', start: 190, end: 20, strand: -1, segments: [{ start: 190, end: 20 }] },
      ],
    });
    const buf = bytes.buffer.slice(0, bytes.byteLength) as ArrayBuffer;
    expect(isSnapGene(buf)).toBe(true);
    const r = parseSnapGene(buf, 'pTest');
    expect(r).toMatchObject({ name: 'pTest', circular: true, length: 200, format: 'SnapGene' });
    expect(r.features.map((f) => [f.name, f.type, f.start, f.end, f.strand, f.color])).toEqual([
      ['ori', 'rep_origin', 10, 60, 0, '#ffff00'],
      ['AmpR', 'CDS', 190, 20, -1, undefined],
    ]);
  });

  it('detects formats from content', async () => {
    const dna = writeSnapGene({ seq: 'ACGT', circular: false, features: [] });
    expect((await readSequence(new Blob([dna.slice()]), 'x.dna'))?.format).toBe('SnapGene');
    expect((await readSequence(new Blob([GB]), 'pDemo construct.gb'))?.name).toBe('pDemo construct');
    expect((await readSequence(new Blob(['>a\nAC\n']), 'a.fasta'))?.format).toBe('FASTA');
    expect(await readSequence(new Blob(['hello']), 'notes.txt')).toBeNull();
  });
});
