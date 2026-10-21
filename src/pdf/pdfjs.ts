/**
 * pdf.js, loaded on first use. The library and its worker are bundled compressed (see vite.config.ts)
 * and started from Blob URLs: the app stays small and quick to start, and it works in the single-file
 * build opened from disk (file://), where scripts cannot be loaded from separate files.
 */
import type * as PdfJs from 'pdfjs-dist';
import { gunzipSync, strFromU8 } from 'fflate';
import library from 'pdfjs-dist/legacy/build/pdf.min.mjs?gzip';
import worker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?gzip';
import { DOCUMENT_OPTIONS } from './extract';

type Lib = typeof PdfJs;

let lib: Promise<Lib> | null = null;

const unpack = (base64: string) => strFromU8(gunzipSync(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))));
const scriptUrl = (code: string) => URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));

/**
 * The worker as a classic script: pages opened from disk (file://) cannot start module workers.
 * Its only module syntax is the final export and import.meta (used by rarely needed image decoders).
 */
const classicWorker = (code: string) => code.replace(/export\s*\{[^}]*\};?\s*$/, '').replace(/import\.meta\.url/g, 'self.location.href');

export function loadPdfjs(): Promise<Lib> {
  lib ??= (async () => {
    const pdfjs = (await import(/* @vite-ignore */ scriptUrl(unpack(library)))) as Lib;
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(scriptUrl(classicWorker(unpack(worker))), { name: 'pdf.js' });
    return pdfjs;
  })().catch((err: unknown) => {
    lib = null;
    throw err;
  });
  return lib;
}

export async function openPdf(data: Uint8Array): Promise<PdfJs.PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  return pdfjs.getDocument({ data, ...DOCUMENT_OPTIONS }).promise;
}
