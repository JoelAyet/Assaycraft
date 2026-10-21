export type Strand = 1 | -1 | 0;

export interface SeqSegment {
  /** 0-based, inclusive */
  start: number;
  /** 0-based, exclusive. When end <= start on a circular sequence, the segment wraps the origin. */
  end: number;
}

export interface SeqFeature {
  name: string;
  type: string;
  start: number;
  end: number;
  strand: Strand;
  color?: string;
  segments: SeqSegment[];
  note?: string;
}

export interface SeqPrimer {
  name: string;
  sequence: string;
  start: number;
  end: number;
  strand: Strand;
}

export interface SeqRecord {
  name: string;
  description?: string;
  molecule: 'DNA' | 'RNA' | 'protein';
  circular: boolean;
  seq: string;
  length: number;
  features: SeqFeature[];
  primers: SeqPrimer[];
  format: 'SnapGene' | 'GenBank' | 'FASTA';
}

/** Length of a feature/segment in bases, taking origin wrap-around into account. */
export function spanLength(start: number, end: number, seqLength: number): number {
  return end > start ? end - start : seqLength - start + end;
}

/**
 * Overall start/end of a feature. Segments are in written order; on a circular sequence a
 * descending step means the feature runs across the origin.
 */
export function featureBounds(segments: SeqSegment[], circular: boolean): { start: number; end: number } {
  if (segments.length === 1) return { start: segments[0].start, end: segments[0].end };
  const wraps = circular && segments.some((s, i) => s.end <= s.start || (i > 0 && s.start < segments[i - 1].start));
  if (wraps) return { start: segments[0].start, end: segments[segments.length - 1].end };
  return { start: Math.min(...segments.map((s) => s.start)), end: Math.max(...segments.map((s) => s.end)) };
}

const TYPE_COLORS: Record<string, string> = {
  cds: '#f2b33d',
  gene: '#f2c96b',
  promoter: '#4cbb7f',
  terminator: '#e15b64',
  rep_origin: '#f4dd57',
  origin: '#f4dd57',
  primer_bind: '#57a6e8',
  primer: '#57a6e8',
  protein_bind: '#9b84d6',
  rbs: '#5bc0b8',
  enhancer: '#7bc96f',
  polya_signal: '#e88a5b',
  ltr: '#c7a26b',
  sig_peptide: '#d98cc1',
  misc_feature: '#a3abb8',
  regulatory: '#7fb3d5',
  mrna: '#c6a4e0',
  exon: '#e9b872',
  intron: '#c9c9c9',
};

export function featureColor(f: Pick<SeqFeature, 'type' | 'color'>): string {
  if (f.color && /^#[0-9a-f]{3,8}$/i.test(f.color)) return f.color;
  return TYPE_COLORS[f.type.toLowerCase()] ?? '#a3abb8';
}

export function gcContent(seq: string): number {
  if (!seq) return 0;
  let gc = 0;
  let n = 0;
  for (const ch of seq.toUpperCase()) {
    if (ch === 'G' || ch === 'C' || ch === 'S') gc++;
    if ('ACGTUSWRYKMBDHVN'.includes(ch)) n++;
  }
  return n ? gc / n : 0;
}
