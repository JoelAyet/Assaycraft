import { featureBounds, type SeqFeature, type SeqRecord, type SeqSegment, type Strand } from './types';

interface Loc {
  segments: SeqSegment[];
  strand: Strand;
}

/** Parse a GenBank location: 10..200, complement(5..9), join(1..3,7..9), <1..>50, 42, 4^5 */
export function parseLocation(spec: string): Loc | null {
  const s = spec.replace(/\s+/g, '');
  const walk = (expr: string, strand: Strand): Loc | null => {
    const fn = /^(complement|join|order)\((.*)\)$/.exec(expr);
    if (fn) {
      if (fn[1] === 'complement') {
        const inner = walk(fn[2], strand === -1 ? 1 : -1);
        return inner && { segments: inner.segments, strand: inner.strand };
      }
      const parts = splitTopLevel(fn[2]).map((p) => walk(p, strand));
      if (parts.some((p) => !p)) return null;
      const segments = (parts as Loc[]).flatMap((p) => p.segments);
      const strands = new Set((parts as Loc[]).map((p) => p.strand));
      return { segments, strand: strands.size === 1 ? (parts as Loc[])[0].strand : strand };
    }
    if (expr.includes(':')) return null; // remote reference
    const range = /^<?(\d+)(?:\.\.>?(\d+)|\^(\d+))?>?$/.exec(expr);
    if (!range) return null;
    const a = parseInt(range[1], 10);
    const b = range[2] ? parseInt(range[2], 10) : a;
    return { segments: [{ start: a - 1, end: b }], strand };
  };
  return walk(s, 1);
}

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const NAME_QUALIFIERS = ['label', 'gene', 'product', 'standard_name', 'locus_tag', 'protein_id', 'note', 'allele'];

export function parseGenBank(text: string, fallbackName = 'sequence'): SeqRecord {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let name = fallbackName;
  let circular = false;
  let molecule: SeqRecord['molecule'] = 'DNA';
  let description: string | undefined;
  const features: SeqFeature[] = [];
  let seq = '';
  let section: 'header' | 'features' | 'origin' = 'header';
  let current: { type: string; loc: string; quals: [string, string][] } | null = null;
  let lastKey: string | null = null;

  const flush = () => {
    if (!current) return;
    const loc = parseLocation(current.loc);
    if (loc && loc.segments.length && current.type !== 'source') {
      const q = new Map<string, string>();
      for (const [k, v] of current.quals) if (!q.has(k)) q.set(k, v);
      const label = q.get('label');
      if (label) q.set('label', label.replace(/\\/g, ' '));
      const nameQ = NAME_QUALIFIERS.map((k) => q.get(k)).find((v) => v && v.length < 80);
      const colorQ = q.get('ApEinfo_fwdcolor') ?? q.get('ApEinfo_revcolor') ?? /#[0-9a-f]{6}/i.exec(current.quals.map(([, v]) => v).join(' '))?.[0];
      const directional =
        !['rep_origin', 'misc_feature', 'source', 'protein_bind'].includes(current.type) || /direction:\s*(right|left)/i.test(q.get('note') ?? '');
      features.push({
        name: nameQ ?? current.type,
        type: current.type,
        strand: directional ? loc.strand : 0,
        color: colorQ ? (colorQ.startsWith('#') ? colorQ : `#${colorQ}`) : undefined,
        segments: loc.segments,
        ...featureBounds(loc.segments, circular),
        note: q.get('note'),
      });
    }
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith('//')) break;
    if (section === 'header') {
      if (line.startsWith('LOCUS')) {
        const parts = line.trim().split(/\s+/);
        if (parts[1]) name = parts[1];
        circular = /\bcircular\b/i.test(line);
        if (/\baa\b/.test(line)) molecule = 'protein';
        else if (/\b(m|t|r|ss-|ds-)?RNA\b/i.test(line)) molecule = 'RNA';
      } else if (line.startsWith('DEFINITION')) {
        description = line.slice(12).trim();
      } else if (line.startsWith('            ') && description !== undefined && !line.startsWith('FEATURES')) {
        if (lastKey === 'DEFINITION') description += ' ' + line.trim();
      } else if (line.startsWith('FEATURES')) {
        section = 'features';
        continue;
      } else if (line.startsWith('ORIGIN')) {
        section = 'origin';
        continue;
      }
      const key = /^([A-Z]+)/.exec(line)?.[1];
      if (key) lastKey = key;
      continue;
    }
    if (section === 'features') {
      if (line.startsWith('ORIGIN')) {
        flush();
        section = 'origin';
        continue;
      }
      if (/^[A-Z]/.test(line)) {
        // another top-level section (BASE COUNT, CONTIG…)
        flush();
        continue;
      }
      const featureKey = /^ {5}(\S+)\s+(.*)$/.exec(line);
      if (featureKey && line[5] !== ' ') {
        flush();
        current = { type: featureKey[1], loc: featureKey[2].trim(), quals: [] };
        continue;
      }
      if (!current) continue;
      const body = line.trim();
      const qual = /^\/([^=\s]+)(?:=(.*))?$/.exec(body);
      if (qual) {
        current.quals.push([qual[1], (qual[2] ?? '').replace(/^"/, '')]);
      } else if (current.quals.length) {
        const last = current.quals[current.quals.length - 1];
        const isText = !/^(translation)$/.test(last[0]);
        last[1] += (isText ? ' ' : '') + body;
      } else {
        current.loc += body;
      }
      const last = current.quals[current.quals.length - 1];
      if (last) last[1] = last[1].replace(/"$/, '');
      continue;
    }
    if (section === 'origin') seq += line.replace(/[^A-Za-z]/g, '');
  }
  flush();
  return { name, description, molecule, circular, seq, length: seq.length, features, primers: [], format: 'GenBank' };
}

export function parseFasta(text: string, fallbackName = 'sequence'): SeqRecord {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let name = fallbackName;
  let description: string | undefined;
  let seq = '';
  let seen = false;
  for (const line of lines) {
    if (line.startsWith('>')) {
      if (seen) break;
      seen = true;
      const header = line.slice(1).trim();
      const sp = header.search(/\s/);
      name = (sp === -1 ? header : header.slice(0, sp)) || fallbackName;
      description = sp === -1 ? undefined : header.slice(sp + 1).trim();
      continue;
    }
    if (line.startsWith(';')) continue;
    seq += line.replace(/[^A-Za-z*-]/g, '');
  }
  const isProtein = /[EFILPQZ]/i.test(seq.replace(/N/gi, ''));
  return {
    name,
    description,
    molecule: isProtein ? 'protein' : /U/i.test(seq) && !/T/i.test(seq) ? 'RNA' : 'DNA',
    circular: false,
    seq,
    length: seq.length,
    features: [],
    primers: [],
    format: 'FASTA',
  };
}
