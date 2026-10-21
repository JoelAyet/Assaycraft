/**
 * Shows a PDF: in the browser's own viewer when it has one (desktop), otherwise (phones, tablets)
 * as page images rendered with pdf.js, because PDFs in frames do not display there.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { Download, ExternalLink, FileType2, X } from 'lucide-react';
import { useNotebook } from '../notebook/store';
import type { DocMeta } from '../notebook/model';
import { useVaultBlob } from '../editor/useVaultBlob';
import { basename, dirname, join } from '../lib/path';

export function hasNativePdfViewer(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { pdfViewerEnabled?: boolean };
  return nav.pdfViewerEnabled !== false && !window.matchMedia('(pointer: coarse)').matches;
}

const asPdf = (blob: Blob) => (blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' }));

export function PdfView({ blob, name, native = hasNativePdfViewer() }: { blob: Blob; name: string; native?: boolean }) {
  const url = useMemo(() => (native ? URL.createObjectURL(asPdf(blob)) : null), [blob, native]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  if (url) return <iframe className="gc-pdf-frame" src={url} title={name} />;
  return <PdfPages blob={blob} />;
}

interface PageSize {
  w: number;
  h: number;
}

/** Pages as images, rendered when they scroll into view. */
export function PdfPages({ blob, maxPages = 200 }: { blob: Blob; maxPages?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<PageSize[] | null>(null);
  const [images, setImages] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const docRef = useRef<Awaited<ReturnType<typeof import('../pdf/pdfjs').openPdf>> | null>(null);
  const queue = useRef<{ wanted: Set<number>; busy: boolean; done: Set<number> }>({ wanted: new Set(), busy: false, done: new Set() });
  const urls = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { openPdf } = await import('../pdf/pdfjs');
        const doc = await openPdf(new Uint8Array(await blob.arrayBuffer()));
        if (cancelled) return void doc.loadingTask.destroy();
        docRef.current = doc;
        const out: PageSize[] = [];
        for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
          const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
          out.push({ w: vp.width, h: vp.height });
        }
        if (!cancelled) setSizes(out);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    const q = queue.current;
    return () => {
      cancelled = true;
      q.wanted.clear();
      q.done.clear();
      void docRef.current?.loadingTask.destroy();
      docRef.current = null;
      for (const u of urls.current.splice(0)) URL.revokeObjectURL(u);
      setImages({});
      setSizes(null);
    };
  }, [blob, maxPages]);

  // Render the pages near the viewport, one at a time.
  useEffect(() => {
    const root = box.current;
    if (!sizes || !root) return;
    const q = queue.current;
    const pump = async () => {
      if (q.busy) return;
      q.busy = true;
      while (q.wanted.size && docRef.current) {
        const n = Math.min(...q.wanted);
        q.wanted.delete(n);
        if (q.done.has(n)) continue;
        q.done.add(n);
        try {
          const page = await docRef.current.getPage(n);
          const width = Math.max(320, root.clientWidth) * Math.min(2, window.devicePixelRatio || 1);
          const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          page.cleanup();
          const img = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
          canvas.width = canvas.height = 0;
          if (img && docRef.current) {
            const url = URL.createObjectURL(img);
            urls.current.push(url);
            setImages((cur) => ({ ...cur, [n]: url }));
          }
        } catch {
          // A page that fails to render stays blank.
        }
      }
      q.busy = false;
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) q.wanted.add(Number((e.target as HTMLElement).dataset.page));
        void pump();
      },
      { root: root.closest('.gc-source-body, .gc-pdf') ?? null, rootMargin: '600px 0px' },
    );
    root.querySelectorAll('[data-page]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sizes]);

  if (error) return <p className="gc-pdf-error">This PDF could not be displayed: {error}</p>;
  if (!sizes) return <div className="spinner" />;
  return (
    <div className="gc-pdf-pages" ref={box}>
      {sizes.map((s, i) => (
        <div key={i} className="gc-pdf-page" data-page={i + 1} style={{ aspectRatio: `${s.w} / ${s.h}` }}>
          {images[i + 1] && <img src={images[i + 1]} alt={`Page ${i + 1}`} />}
        </div>
      ))}
    </div>
  );
}

// ───────────── The original file of an imported protocol, next to it ─────────────

export const useSourcePane = create<{ path: string | null }>(() => ({ path: null }));
export const openSourcePane = (path: string) => useSourcePane.setState({ path });
export const closeSourcePane = () => useSourcePane.setState({ path: null });

export function sourcePathOf(meta: DocMeta): string | null {
  return meta.source ? join(dirname(meta.path), meta.source) : null;
}

export function SourcePane({ meta }: { meta: DocMeta }) {
  const vault = useNotebook((s) => s.vault);
  const path = sourcePathOf(meta);
  const { blob, url, error } = useVaultBlob(vault, path);
  const name = path ? basename(path) : '';
  return (
    <aside className="gc-source-pane" aria-label="Original PDF">
      <header className="gc-source-head">
        <FileType2 />
        <span className="gc-source-name" title={name}>
          {name}
        </span>
        <span className="spacer" />
        {url && (
          <a className="icon-btn" href={url} target="_blank" rel="noreferrer" title="Open in a new tab">
            <ExternalLink />
          </a>
        )}
        {url && (
          <a className="icon-btn" href={url} download={name} title="Download">
            <Download />
          </a>
        )}
        <button className="icon-btn" onClick={closeSourcePane} title="Close" aria-label="Close the original PDF">
          <X />
        </button>
      </header>
      <div className="gc-source-body">
        {error ? (
          <p className="gc-pdf-error">The original file is not in the notebook folder any more ({meta.source}).</p>
        ) : blob ? (
          <PdfView blob={blob} name={name} />
        ) : (
          <div className="spinner" />
        )}
      </div>
    </aside>
  );
}
