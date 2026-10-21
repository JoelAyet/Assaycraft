import { extname, stem } from '../lib/path';
import { parseFasta, parseGenBank } from './genbank';
import { isSnapGene, parseSnapGene } from './snapgene';
import type { SeqRecord } from './types';

const SNAPGENE = ['.dna', '.prot', '.rna'];
const GENBANK = ['.gb', '.gbk', '.gbff', '.genbank', '.gp', '.gpk', '.ape'];
const FASTA = ['.fa', '.fasta', '.fas', '.fna', '.ffn', '.faa', '.fsa', '.seq'];

export const SEQUENCE_EXTENSIONS = [...SNAPGENE, ...GENBANK, ...FASTA];

export function isSequenceFile(name: string): boolean {
  return SEQUENCE_EXTENSIONS.includes(extname(name));
}

/** Parse a sequence file (SnapGene, GenBank or FASTA). Returns null when it cannot be read. */
export async function readSequence(blob: Blob, fileName: string): Promise<SeqRecord | null> {
  const buf = await blob.arrayBuffer();
  const base = stem(fileName);
  try {
    if (isSnapGene(buf)) return parseSnapGene(buf, base);
    const text = new TextDecoder().decode(buf);
    const head = text.trimStart();
    if (head.startsWith('LOCUS')) {
      const rec = parseGenBank(text, base);
      // Prefer the file name: GenBank LOCUS names are often truncated to 16 characters.
      return { ...rec, name: base || rec.name };
    }
    if (head.startsWith('>')) return parseFasta(text, base);
    if (FASTA.includes(extname(fileName)) && /^[ACGTUNRYKMSWBDHV\s]+$/i.test(head.slice(0, 2000))) return parseFasta('>' + base + '\n' + text, base);
  } catch (err) {
    console.warn('Could not parse sequence', fileName, err);
  }
  return null;
}
