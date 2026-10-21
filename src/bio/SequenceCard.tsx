import { useEffect, useMemo, useState } from 'react';
import { Copy, Dna, Download, FolderOpen, ScrollText } from 'lucide-react';
import { readSequence } from './detect';
import { PlasmidMap } from './PlasmidMap';
import { featureColor, gcContent, spanLength, type SeqRecord } from './types';
import { toast } from '../notebook/store';

interface Props {
  blob: Blob;
  fileName: string;
  url: string | null;
  vaultPath: string | null;
  storage: 'folder' | 'browser';
  actions?: React.ReactNode;
}

function strandArrow(s: number) {
  return s === 1 ? '→' : s === -1 ? '←' : '–';
}

function SequenceText({ seq }: { seq: string }) {
  const [all, setAll] = useState(false);
  const limit = 6000;
  const shown = all ? seq : seq.slice(0, limit);
  const lines: string[] = [];
  for (let i = 0; i < shown.length; i += 60) {
    const chunk = shown.slice(i, i + 60);
    const groups = chunk.match(/.{1,10}/g)?.join(' ') ?? '';
    lines.push(`${String(i + 1).padStart(8, ' ')}  ${groups}`);
  }
  return (
    <div className="gc-seq-text">
      <pre>{lines.join('\n')}</pre>
      {seq.length > limit && !all && (
        <button className="btn btn-sm" onClick={() => setAll(true)}>
          Show all {seq.length.toLocaleString()} bases
        </button>
      )}
    </div>
  );
}

export function SequenceCard({ blob, fileName, url, vaultPath, storage, actions }: Props) {
  const [record, setRecord] = useState<SeqRecord | null | undefined>(undefined);
  const [hl, setHl] = useState<number | null>(null);
  const [showSeq, setShowSeq] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readSequence(blob, fileName).then((r) => !cancelled && setRecord(r));
    return () => {
      cancelled = true;
    };
  }, [blob, fileName]);

  const stats = useMemo(() => (record ? { gc: gcContent(record.seq) } : null), [record]);

  if (record === undefined) return <div className="gc-seq gc-seq-loading">Reading {fileName}…</div>;

  const header = (
    <div className="gc-seq-head">
      <span className="gc-seq-icon">
        <Dna />
      </span>
      <div className="gc-seq-titles">
        <a className="gc-seq-name" href={url ?? undefined} download={fileName}>
          {fileName}
        </a>
        {record ? (
          <span className="gc-seq-sub">
            <span className="pill pill-sq tone-purple">{record.format}</span>
            {record.length.toLocaleString()} {record.molecule === 'protein' ? 'aa' : 'bp'} · {record.circular ? 'circular' : 'linear'}
            {record.molecule !== 'protein' && stats ? ` · GC ${(stats.gc * 100).toFixed(1)}%` : ''} · {record.features.length} features
            {record.primers.length ? ` · ${record.primers.length} primers` : ''}
          </span>
        ) : (
          <span className="gc-seq-sub">Sequence file (preview not available)</span>
        )}
      </div>
      <div className="gc-seq-actions">
        {record && (
          <button
            className="icon-btn"
            title="Copy sequence"
            onClick={() => {
              void navigator.clipboard.writeText(record.seq).then(() => toast('Sequence copied', 'success'));
            }}
          >
            <Copy />
          </button>
        )}
        {record && record.seq && (
          <button className={`icon-btn ${showSeq ? 'active' : ''}`} title="Show sequence" onClick={() => setShowSeq((s) => !s)}>
            <ScrollText />
          </button>
        )}
        {vaultPath && storage === 'folder' && (
          <button
            className="icon-btn"
            title="Copy file location (to open it in SnapGene)"
            onClick={() => {
              void navigator.clipboard
                .writeText(vaultPath)
                .then(() => toast('File location copied: open it from your notebook folder in SnapGene', 'success'));
            }}
          >
            <FolderOpen />
          </button>
        )}
        {url && (
          <a className="icon-btn" title="Download" href={url} download={fileName}>
            <Download />
          </a>
        )}
        {actions}
      </div>
    </div>
  );

  if (!record) return <div className="gc-seq">{header}</div>;

  return (
    <div className="gc-seq">
      {header}
      {record.description && <div className="gc-seq-desc">{record.description}</div>}
      <div className="gc-seq-body">
        <div className={`gc-seq-map ${record.circular ? '' : 'is-linear'}`}>
          <PlasmidMap record={record} highlight={hl} onHover={setHl} />
        </div>
        {record.features.length > 0 && (
          <div className="gc-seq-features">
            <table>
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Type</th>
                  <th>Location</th>
                  <th className="num">Length</th>
                </tr>
              </thead>
              <tbody>
                {record.features.map((f, i) => (
                  <tr key={i} className={hl === i ? 'is-hl' : ''} onMouseEnter={() => setHl(i)} onMouseLeave={() => setHl(null)}>
                    <td>
                      <span className="gc-swatch" style={{ background: featureColor(f) }} />
                      {f.name}
                    </td>
                    <td className="muted">{f.type}</td>
                    <td className="mono">
                      {f.start + 1}..{f.end} {strandArrow(f.strand)}
                    </td>
                    <td className="num mono">{spanLength(f.start, f.end, record.length).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {showSeq && <SequenceText seq={record.seq} />}
    </div>
  );
}
