/**
 * Convert a PDF file into a document, in the browser: read it with pdf.js, rebuild its structure
 * (layout.ts) and render its figures (and scanned pages) to images. Loaded on demand.
 */
import type * as PdfJs from 'pdfjs-dist';
import { extractDocument, type PdfLib } from './extract';
import { pdfToDoc, type Figure, type PdfConversion } from './layout';
import { loadPdfjs, openPdf } from './pdfjs';

export interface ConvertedPdf extends PdfConversion {
  /** Rendered figures by figure id. */
  images: Map<string, Blob>;
  /** Only the first MAX_PAGES pages were converted. */
  truncated: boolean;
}

export const MAX_PAGES = 300;

function friendlyError(err: unknown): Error {
  const e = err as { name?: string; message?: string };
  if (e?.name === 'PasswordException') return new Error('This PDF is protected with a password. Remove the password and import it again.');
  if (e?.name === 'InvalidPDFException') return new Error('This file is not a PDF, or it is damaged.');
  return err instanceof Error ? err : new Error(String(err));
}

export async function convertPdf(file: Blob, name: string, onProgress?: (p: { fraction: number; message: string }) => void): Promise<ConvertedPdf> {
  onProgress?.({ fraction: 0, message: 'Opening the PDF…' });
  let doc: PdfJs.PDFDocumentProxy;
  try {
    doc = await openPdf(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    throw friendlyError(err);
  }
  try {
    const { info, pages } = await extractDocument(
      (await loadPdfjs()) as unknown as PdfLib,
      doc,
      (done, total) => onProgress?.({ fraction: (done / total) * 0.75, message: `Reading page ${done} of ${total}…` }),
      MAX_PAGES,
    );
    const conv = pdfToDoc(pages, info, name);
    const images = new Map<string, Blob>();
    const byPage = new Map<number, Figure[]>();
    for (const f of conv.figures) byPage.set(f.page, [...(byPage.get(f.page) ?? []), f]);
    let done = 0;
    for (const [index, figs] of byPage) {
      onProgress?.({ fraction: 0.75 + (done / byPage.size) * 0.25, message: `Saving figures (page ${index + 1})…` });
      const page = await doc.getPage(index + 1);
      try {
        for (const [id, blob] of await renderFigures(page, figs)) images.set(id, blob);
      } catch (err) {
        console.warn('Could not render figures on page', index + 1, err);
      }
      page.cleanup();
      done++;
    }
    onProgress?.({ fraction: 1, message: 'Done' });
    return { ...conv, images, truncated: doc.numPages > MAX_PAGES };
  } finally {
    void doc.loadingTask.destroy();
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Render the page once and cut out each figure (whole pages for scans). */
async function renderFigures(page: PdfJs.PDFPageProxy, figs: Figure[]): Promise<Map<string, Blob>> {
  const base = page.getViewport({ scale: 1 });
  const widest = Math.max(...figs.map((f) => f.box.x1 - f.box.x0));
  // Sharp enough to read labels, without huge files: about 1400 px for the widest figure, 1.5–3× the page.
  let scale = Math.min(3, Math.max(1.5, 1400 / widest));
  scale = Math.min(scale, Math.sqrt(16_000_000 / (base.width * base.height)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Map();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport, background: '#ffffff' }).promise;
  const out = new Map<string, Blob>();
  for (const f of figs) {
    const pad = f.wholePage ? 0 : 3;
    const sx = Math.max(0, Math.floor((f.box.x0 - pad) * scale));
    const sy = Math.max(0, Math.floor((f.box.y0 - pad) * scale));
    const sw = Math.min(canvas.width - sx, Math.ceil((f.box.x1 - f.box.x0 + pad * 2) * scale));
    const sh = Math.min(canvas.height - sy, Math.ceil((f.box.y1 - f.box.y0 + pad * 2) * scale));
    if (sw < 8 || sh < 8) continue;
    const crop = document.createElement('canvas');
    crop.width = sw;
    crop.height = sh;
    crop.getContext('2d')!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    // PNG keeps diagrams and text sharp; photos and scans are much smaller as JPEG.
    let blob = await toBlob(crop, 'image/png');
    if (blob && blob.size > 700_000) {
      const jpeg = await toBlob(crop, 'image/jpeg', 0.88);
      if (jpeg && jpeg.size < blob.size * 0.7) blob = jpeg;
    }
    if (blob) out.set(f.id, blob);
    crop.width = crop.height = 0;
  }
  canvas.width = canvas.height = 0;
  return out;
}
