/**
 * What Assaycraft reads from a PDF page, independent of pdf.js: positioned text runs, a few
 * graphics that matter for layout (bullets drawn as shapes, horizontal rules), images and links.
 * Coordinates are in points with the origin at the top-left of the page and y pointing down.
 */

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PdfFont {
  /** Font name without the subset prefix, e.g. "Calibri-Bold". */
  name: string;
  bold: boolean;
  italic: boolean;
  mono: boolean;
}

/** A run of text as drawn. `y` is the baseline, `size` the font size. */
export interface PdfText {
  str: string;
  x: number;
  y: number;
  w: number;
  size: number;
  /** Key into `PdfPageData.fonts`. */
  font: string;
}

export interface PdfImageBox extends Box {
  id: string;
}

export interface PdfLinkBox extends Box {
  url: string;
}

export interface PdfPageData {
  /** 0-based page number. */
  index: number;
  width: number;
  height: number;
  texts: PdfText[];
  fonts: Record<string, PdfFont>;
  /** Small filled shapes, e.g. list bullets drawn as graphics. */
  dots: Box[];
  /** Thin horizontal lines, e.g. table borders. */
  rules: Box[];
  /** Thin vertical lines (cell borders of grid tables). */
  vrules: Box[];
  images: PdfImageBox[];
  links: PdfLinkBox[];
}

export interface PdfInfo {
  title?: string;
  subject?: string;
  author?: string;
  keywords?: string;
  pageCount: number;
}
