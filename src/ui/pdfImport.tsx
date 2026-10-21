/**
 * Importing PDFs as protocols: the "From a PDF" start of the New protocol dialog, the import of
 * several files at once, and dropping PDFs onto the Protocols page.
 */
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { CircleAlert, CircleCheck, FileType2, FileUp, LoaderCircle } from 'lucide-react';
import type { ConvertedPdf } from '../pdf/convert';
import { importPdfProtocol, type PdfImportProgress, type PdfImportResult } from '../notebook/actions';
import { navigate, toast } from '../notebook/store';
import { Dialog } from './overlay';
import { pickFiles } from '../lib/download';

export const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

export const pickPdfs = (multiple = true) => pickFiles({ accept: 'application/pdf,.pdf', multiple });

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** What the conversion found, e.g. "4 sections · 12 steps · 2 tables · 1 figure". */
export function conversionSummary(stats: ConvertedPdf['stats']): string {
  const parts = [
    stats.headings && plural(stats.headings, 'section'),
    stats.steps && plural(stats.steps, 'step'),
    stats.lists - (stats.steps ? 1 : 0) > 0 && stats.steps === 0 && plural(stats.lists, 'list'),
    stats.tables && plural(stats.tables, 'table'),
    stats.figures && plural(stats.figures, 'figure'),
  ].filter(Boolean) as string[];
  return parts.length ? parts.join(' · ') : plural(stats.words, 'word');
}

export interface PdfConversionState {
  conv: ConvertedPdf | null;
  progress: PdfImportProgress | null;
  error: string | null;
}

/** Convert a file as soon as it is chosen. */
export function useConvertedPdf(file: File | null): PdfConversionState {
  const [state, setState] = useState<PdfConversionState>({ conv: null, progress: null, error: null });
  useEffect(() => {
    setState({ conv: null, progress: null, error: null });
    if (!file) return;
    let cancelled = false;
    void import('../pdf/convert')
      .then(({ convertPdf }) => convertPdf(file, file.name, (progress) => !cancelled && setState((s) => ({ ...s, progress }))))
      .then((conv) => !cancelled && setState({ conv, progress: null, error: null }))
      .catch((err: Error) => !cancelled && setState({ conv: null, progress: null, error: err.message || 'The PDF could not be read.' }));
    return () => {
      cancelled = true;
    };
  }, [file]);
  return state;
}

/** Drag and drop of files onto an element. */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  return {
    over,
    props: {
      onDragEnter: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current++;
        setOver(true);
      },
      onDragOver: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      },
      onDragLeave: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      },
      onDrop: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      },
    },
  };
}

/** Choose a PDF (or drop one), then see what the conversion found. */
export function PdfPicker({ file, onFile, state }: { file: File | null; onFile: (f: File) => void; state: PdfConversionState }) {
  const choose = async () => {
    const [f] = await pickPdfs(false);
    if (f) onFile(f);
  };
  const drop = useFileDrop((files) => {
    const f = files.find(isPdf);
    if (f) onFile(f);
    else toast('That is not a PDF.', 'error');
  });
  if (!file)
    return (
      <button type="button" className={`gc-dropzone ${drop.over ? 'is-over' : ''}`} onClick={() => void choose()} {...drop.props}>
        <FileUp />
        <span>
          <strong>Choose a PDF</strong> or drop it here
        </span>
        <small>A vendor protocol, a kit handbook, an SOP or a methods section. PDFs made from documents convert best.</small>
      </button>
    );
  const { conv, progress, error } = state;
  return (
    <div className={`gc-pdf-card ${error ? 'is-error' : ''}`} {...drop.props}>
      <span className="gc-pdf-card-icon">{error ? <CircleAlert /> : conv ? <CircleCheck /> : <LoaderCircle className="spin" />}</span>
      <div className="gc-pdf-card-main">
        <strong className="gc-pdf-card-name" title={file.name}>
          {file.name}
        </strong>
        {error ? (
          <span className="gc-warn">{error}</span>
        ) : conv ? (
          <span className="gc-pdf-card-sub">
            {plural(conv.stats.pages, 'page')} converted: {conversionSummary(conv.stats)}
          </span>
        ) : (
          <>
            <span className="gc-pdf-card-sub">{progress?.message ?? 'Loading the PDF reader…'}</span>
            <progress className="gc-progress" value={progress?.fraction ?? 0} max={1} />
          </>
        )}
        {conv?.scanned && (
          <span className="gc-warn">No text found: it is probably a scan. Its pages will be added as images, with the PDF attached.</span>
        )}
        {conv?.truncated && <span className="gc-warn">Very long PDF: only the first 300 pages are converted. The whole PDF is kept.</span>}
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void choose()}>
        Change
      </button>
    </div>
  );
}

type Row = { file: File; status: 'waiting' | 'working' | 'done' | 'failed'; progress?: PdfImportProgress; result?: PdfImportResult; error?: string };

/** Import several PDFs, one after the other. */
export function PdfBatchDialog({ files, close }: { files: File[]; close: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => files.map((file) => ({ file, status: 'waiting' })));
  const [running, setRunning] = useState(true);
  const started = useRef(false);
  const stop = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
    void (async () => {
      for (let i = 0; i < files.length && !stop.current; i++) {
        update(i, { status: 'working' });
        try {
          const result = await importPdfProtocol(files[i], { open: false, onProgress: (progress) => update(i, { progress }) });
          update(i, { status: 'done', result });
        } catch (err) {
          update(i, { status: 'failed', error: (err as Error).message || 'Could not be converted' });
        }
      }
      setRunning(false);
    })();
  }, [files]);
  const done = rows.filter((r) => r.status === 'done').length;
  return (
    <Dialog
      title={running ? `Importing ${plural(files.length, 'PDF')}…` : `Imported ${plural(done, 'protocol')}`}
      icon={<FileType2 className="gc-dialog-icon" />}
      onClose={() => {
        stop.current = true;
        close();
      }}
      footer={
        <>
          <span className="muted gc-footer-hint">Each PDF becomes a draft protocol; the PDF is kept with it.</span>
          {running ? (
            <button className="btn" onClick={() => (stop.current = true)}>
              Stop after this one
            </button>
          ) : (
            <button className="btn btn-primary" onClick={close}>
              Done
            </button>
          )}
        </>
      }
    >
      <ul className="gc-batch-list">
        {rows.map((r, i) => (
          <li key={i} className={`gc-batch-row is-${r.status}`}>
            <span className="gc-batch-icon">
              {r.status === 'done' ? (
                <CircleCheck />
              ) : r.status === 'failed' ? (
                <CircleAlert />
              ) : r.status === 'working' ? (
                <LoaderCircle className="spin" />
              ) : (
                <FileType2 />
              )}
            </span>
            <span className="gc-batch-main">
              <span className="gc-batch-name">{r.file.name}</span>
              <span className="gc-batch-sub">
                {r.status === 'waiting' && 'Waiting'}
                {r.status === 'working' && (r.progress?.message ?? 'Opening…')}
                {r.status === 'failed' && <span className="gc-warn">{r.error}</span>}
                {r.status === 'done' && r.result && (
                  <>
                    {r.result.scanned ? 'Scanned: pages added as images' : conversionSummary(r.result.stats)}
                    {' · '}
                    <button
                      className="gc-link-btn"
                      onClick={() => {
                        close();
                        navigate({ name: 'doc', path: r.result!.path });
                      }}
                    >
                      Open “{r.result.title}”
                    </button>
                  </>
                )}
              </span>
              {r.status === 'working' && <progress className="gc-progress" value={r.progress?.fraction ?? 0} max={1} />}
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
