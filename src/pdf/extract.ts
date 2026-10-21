/**
 * Reads pages with pdf.js into plain data (see types.ts). Works in the browser and in Node (tests);
 * the pdf.js module is passed in so this file never loads it by itself.
 */
import type * as PdfJs from 'pdfjs-dist';
import type { Box, PdfFont, PdfInfo, PdfPageData, PdfText } from './types';

export type PdfLib = typeof PdfJs;
type Matrix = number[];

/** Options for getDocument that suit text extraction. */
export const DOCUMENT_OPTIONS = {
  // Font names (e.g. "Arial-BoldMT") tell bold and italic text apart.
  fontExtraProperties: true,
  isEvalSupported: false,
  verbosity: 0,
} as const;

const BOLD = /bold|black|heavy|semibold|demibold|extrabold|ultrabold|[-_,]bd$|^(cm|sf|lm)bx/i;
const ITALIC = /italic|oblique|[-_,](it|ital|obl)$|^(cm|sf|lm)(ti|mi|sl)/i;
const MONO = /mono|courier|consol|menlo|inconsolata|lucidaconsole|^(cm|sf|lm)tt/i;

function fontInfo(page: PdfJs.PDFPageProxy, key: string, family: string | undefined): PdfFont {
  let name = '';
  let bold = false;
  let italic = false;
  let mono = family === 'monospace';
  try {
    if (page.commonObjs.has(key)) {
      const f = page.commonObjs.get(key) as { name?: string; bold?: boolean; black?: boolean; italic?: boolean; isMonospace?: boolean };
      name = String(f.name ?? '').replace(/^[A-Z]{6}\+/, '');
      bold = !!(f.bold || f.black);
      italic = !!f.italic;
      mono ||= !!f.isMonospace;
    }
  } catch {
    // Font not loaded: fall back to what the text content says.
  }
  return { name, bold: bold || BOLD.test(name), italic: italic || ITALIC.test(name), mono: mono || MONO.test(name) };
}

/** m1 × m2: apply m2, then m1. */
function multiply(m1: Matrix, m2: ArrayLike<number>): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

const apply = (m: Matrix, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function applyBox(m: Matrix, x0: number, y0: number, x1: number, y1: number): Box {
  const pts = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const round = (n: number) => Math.round(n * 100) / 100;

export async function extractPage(lib: PdfLib, page: PdfJs.PDFPageProxy, index: number): Promise<PdfPageData> {
  const viewport = page.getViewport({ scale: 1 });
  const vt = viewport.transform as Matrix;
  const content = await page.getTextContent();
  // The operator list loads the fonts (for their names) and tells where images, bullets and rules are drawn.
  const ops = await page.getOperatorList();

  const fonts: Record<string, PdfFont> = {};
  for (const [key, style] of Object.entries(content.styles)) fonts[key] = fontInfo(page, key, style.fontFamily);

  const texts: PdfText[] = [];
  for (const it of content.items) {
    if (!('str' in it) || !it.str || !it.str.trim()) continue;
    const m = multiply(vt, it.transform as number[]);
    const size = Math.abs(m[3]);
    // Upright text only: rotated text is usually a watermark or a margin note.
    if (size < 3 || m[0] <= 0 || m[3] >= 0 || Math.abs(m[1]) > 0.05 * Math.abs(m[0]) || Math.abs(m[2]) > 0.05 * size) continue;
    texts.push({ str: it.str, x: round(m[4]), y: round(m[5]), w: round(it.width), size: round(size), font: it.fontName });
    if (!fonts[it.fontName]) fonts[it.fontName] = fontInfo(page, it.fontName, undefined);
  }

  const { OPS } = lib;
  const fills = new Set<number>([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const strokes = new Set<number>([OPS.stroke, OPS.closeStroke]);
  const dots: Box[] = [];
  const rules: Box[] = [];
  const vrules: Box[] = [];
  const images: PdfPageData['images'] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const toPage = (m: Matrix, x0: number, y0: number, x1: number, y1: number) => applyBox(multiply(vt, m), x0, y0, x1, y1);
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = multiply(ctm, args as number[]);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args[0]) || ArrayBuffer.isView(args[0])) ctm = multiply(ctm, args[0] as ArrayLike<number>);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat) {
      const b = toPage(ctm, 0, 0, 1, 1);
      if (b.x1 - b.x0 >= 8 && b.y1 - b.y0 >= 8) images.push({ ...b, id: typeof args[0] === 'string' ? args[0] : `inline${i}` });
    } else if (fn === OPS.constructPath) {
      const paint = args[0] as number;
      const mm = args[2] as ArrayLike<number> | null | undefined;
      if (!mm || mm.length < 4 || !(fills.has(paint) || strokes.has(paint))) continue;
      const b = toPage(ctm, mm[0], mm[1], mm[2], mm[3]);
      const w = b.x1 - b.x0;
      const h = b.y1 - b.y0;
      if (h <= 2.5 && w >= 6) rules.push(b);
      else if (w <= 2.5 && h >= 6) vrules.push(b);
      else if (fills.has(paint) && w >= 1.2 && h >= 1.2 && w <= 9 && h <= 9 && w / h < 1.8 && h / w < 1.8) dots.push(b);
    }
  }

  const links: PdfPageData['links'] = [];
  try {
    for (const a of await page.getAnnotations({ intent: 'display' })) {
      if (a.subtype !== 'Link' || typeof a.url !== 'string' || !/^(https?|mailto):/i.test(a.url) || !Array.isArray(a.rect)) continue;
      const r = a.rect as number[];
      links.push({ ...applyBox(vt, r[0], r[1], r[2], r[3]), url: a.url });
    }
  } catch {
    // Annotations are optional.
  }

  return {
    index,
    width: round(viewport.width),
    height: round(viewport.height),
    texts,
    fonts,
    // Graphics-heavy pages (charts, outlined text) have no meaningful bullets.
    dots: dots.length > 400 ? [] : dots,
    rules: rules.length > 2000 ? [] : rules,
    vrules: vrules.length > 2000 ? [] : vrules,
    images,
    links,
  };
}

export async function documentInfo(doc: PdfJs.PDFDocumentProxy): Promise<PdfInfo> {
  const info: PdfInfo = { pageCount: doc.numPages };
  try {
    const meta = (await doc.getMetadata()).info as Record<string, unknown>;
    const s = (k: string) => (typeof meta[k] === 'string' && (meta[k] as string).trim() ? (meta[k] as string).trim() : undefined);
    info.title = s('Title');
    info.subject = s('Subject');
    info.author = s('Author');
    info.keywords = s('Keywords');
  } catch {
    // No metadata.
  }
  return info;
}

/** Extract every page, reporting progress as (pages done, page count). */
export async function extractDocument(
  lib: PdfLib,
  doc: PdfJs.PDFDocumentProxy,
  onProgress?: (done: number, total: number) => void,
  maxPages = 300,
): Promise<{ info: PdfInfo; pages: PdfPageData[] }> {
  const info = await documentInfo(doc);
  const pages: PdfPageData[] = [];
  const total = Math.min(doc.numPages, maxPages);
  for (let i = 0; i < total; i++) {
    const page = await doc.getPage(i + 1);
    pages.push(await extractPage(lib, page, i));
    page.cleanup();
    onProgress?.(i + 1, total);
  }
  return { info, pages };
}
