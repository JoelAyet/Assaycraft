/**
 * Reader for SnapGene .dna files (binary "packets": 1 byte type + 4 byte big-endian length + data).
 * Packets used: 0x09 cookie, 0x00 DNA sequence, 0x0A features (XML), 0x05 primers (XML), 0x06 notes (XML).
 */
import { featureBounds, type SeqFeature, type SeqPrimer, type SeqRecord, type Strand } from './types';

function utf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function parseXml(text: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return null;
    return doc;
  } catch {
    return null;
  }
}

function rangeOf(spec: string | null): { a: number; b: number } | null {
  const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(spec ?? '');
  return m ? { a: parseInt(m[1], 10), b: parseInt(m[2], 10) } : null;
}

function parseFeatures(xml: string, circular: boolean): SeqFeature[] {
  const doc = parseXml(xml);
  if (!doc) return [];
  const out: SeqFeature[] = [];
  for (const el of Array.from(doc.getElementsByTagName('Feature'))) {
    const type = el.getAttribute('type') || 'misc_feature';
    const dir = el.getAttribute('directionality');
    const strand: Strand = dir === '1' ? 1 : dir === '2' ? -1 : 0;
    const segments: { start: number; end: number }[] = [];
    let color: string | undefined;
    for (const seg of Array.from(el.getElementsByTagName('Segment'))) {
      if ((seg.getAttribute('type') || 'standard') === 'gap') continue;
      const r = rangeOf(seg.getAttribute('range'));
      if (!r) continue;
      // 1-based inclusive → 0-based half-open. a > b means it wraps the origin.
      segments.push({ start: r.a - 1, end: r.b });
      color ??= seg.getAttribute('color') || undefined;
    }
    if (!segments.length) continue;
    let note: string | undefined;
    let label: string | undefined;
    for (const q of Array.from(el.getElementsByTagName('Q'))) {
      const qn = q.getAttribute('name');
      const v = q.getElementsByTagName('V')[0];
      const val = v?.getAttribute('text') ?? v?.getAttribute('predef') ?? v?.getAttribute('int') ?? '';
      if (qn === 'note' && !note) note = stripHtml(val);
      if (qn === 'label' && !label) label = stripHtml(val);
    }
    out.push({
      name: el.getAttribute('name') || label || type,
      type,
      strand,
      color,
      segments,
      ...featureBounds(segments, circular),
      note,
    });
  }
  return out;
}

function parsePrimers(xml: string): SeqPrimer[] {
  const doc = parseXml(xml);
  if (!doc) return [];
  const out: SeqPrimer[] = [];
  for (const el of Array.from(doc.getElementsByTagName('Primer'))) {
    const site = el.getElementsByTagName('BindingSite')[0];
    const r = rangeOf(site?.getAttribute('location') ?? null);
    if (!r) continue;
    // Primer binding sites are stored 0-based inclusive.
    out.push({
      name: el.getAttribute('name') || 'primer',
      sequence: el.getAttribute('sequence') || '',
      start: r.a,
      end: r.b + 1,
      strand: site?.getAttribute('boundStrand') === '1' ? -1 : 1,
    });
  }
  return out;
}

export function isSnapGene(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf, 0, Math.min(buf.byteLength, 13));
  return b.length >= 13 && b[0] === 0x09 && utf8(b.subarray(5, 13)) === 'SnapGene';
}

export function parseSnapGene(buf: ArrayBuffer, name: string): SeqRecord {
  if (!isSnapGene(buf)) throw new Error('Not a SnapGene file');
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  let pos = 0;
  let seq = '';
  let circular = false;
  let featureXml = '';
  let primers: SeqPrimer[] = [];
  let description: string | undefined;
  let molecule: SeqRecord['molecule'] = 'DNA';
  while (pos + 5 <= bytes.length) {
    const type = bytes[pos];
    const len = view.getUint32(pos + 1, false);
    const start = pos + 5;
    const end = start + len;
    if (end > bytes.length) break;
    const data = bytes.subarray(start, end);
    switch (type) {
      case 0x00: // DNA
        circular = (data[0] & 0x01) === 1;
        seq = utf8(data.subarray(1));
        break;
      case 0x15: // protein
        molecule = 'protein';
        seq ||= utf8(data.subarray(1));
        break;
      case 0x20: // RNA
        molecule = 'RNA';
        circular = (data[0] & 0x01) === 1;
        seq ||= utf8(data.subarray(1));
        break;
      case 0x0a:
        featureXml = utf8(data);
        break;
      case 0x05:
        primers = parsePrimers(utf8(data));
        break;
      case 0x06: {
        const doc = parseXml(utf8(data));
        const d = doc?.getElementsByTagName('Description')[0]?.textContent;
        if (d) description = stripHtml(d);
        break;
      }
    }
    pos = end;
  }
  seq = seq.replace(/\s+/g, '');
  const features = featureXml ? parseFeatures(featureXml, circular) : [];
  return { name, description, molecule, circular, seq, length: seq.length, features, primers, format: 'SnapGene' };
}

/** Writes a minimal SnapGene file (used by tests and for exporting sequences). */
export function writeSnapGene(rec: Pick<SeqRecord, 'seq' | 'circular' | 'features'>): Uint8Array {
  const enc = new TextEncoder();
  const packets: Uint8Array[] = [];
  const packet = (type: number, data: Uint8Array) => {
    const p = new Uint8Array(5 + data.length);
    p[0] = type;
    new DataView(p.buffer).setUint32(1, data.length, false);
    p.set(data, 5);
    packets.push(p);
  };
  const cookie = new Uint8Array(14);
  cookie.set(enc.encode('SnapGene'));
  new DataView(cookie.buffer).setUint16(8, 1, false);
  new DataView(cookie.buffer).setUint16(10, 15, false);
  new DataView(cookie.buffer).setUint16(12, 19, false);
  packet(0x09, cookie);
  const dna = enc.encode(rec.seq);
  const seqData = new Uint8Array(dna.length + 1);
  seqData[0] = rec.circular ? 0x03 : 0x02;
  seqData.set(dna, 1);
  packet(0x00, seqData);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const feats = rec.features
    .map((f) => {
      const dir = f.strand === 1 ? '1' : f.strand === -1 ? '2' : '0';
      const segs = f.segments
        .map((s) => `<Segment range="${s.start + 1}-${s.end}"${f.color ? ` color="${esc(f.color)}"` : ''} type="standard"/>`)
        .join('');
      return `<Feature name="${esc(f.name)}" directionality="${dir}" type="${esc(f.type)}">${segs}</Feature>`;
    })
    .join('');
  packet(0x0a, enc.encode(`<?xml version="1.0"?><Features nextValidID="${rec.features.length}">${feats}</Features>`));
  const total = packets.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of packets) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
