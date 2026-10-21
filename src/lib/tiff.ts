/**
 * TIFF images, as microscopes, gel imagers and scanners save them. Only Safari can show a TIFF in
 * a page, so they are decoded here into pixels for display; the file itself is never changed.
 * 16- and 32-bit images (a 12-bit camera, a ratio map) are stretched to their own range of values,
 * as Fiji does when it opens them, or they would look almost black.
 */
import type { IFD } from 'utif';
import { extname } from './path';

export function isTiffName(name: string) {
  return ['.tif', '.tiff'].includes(extname(name));
}

/** Bigger images are not previewed: their pixels alone would take hundreds of MB. */
export const MAX_TIFF_PIXELS = 50_000_000;

export interface TiffPreview {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, ready for a canvas. */
  rgba: Uint8ClampedArray;
  /** Pages in the file (a stack or a time series); the preview shows `page`. */
  pages: number;
  page: number;
  /** Bits per sample in the file. */
  bits: number;
  /** Values were stretched to fit the screen: 16-bit and 32-bit images. */
  stretched: boolean;
}

const tag = (ifd: IFD, name: string): number | undefined => {
  const v = ifd[name];
  return Array.isArray(v) ? Number(v[0]) : undefined;
};

/** Pages, without the small reduced-resolution copies some cameras add. */
const isPage = (ifd: IFD) => ifd.t256 != null && ((tag(ifd, 't254') ?? 0) & 1) === 0;

export async function decodeTiff(buf: ArrayBuffer, page = 0): Promise<TiffPreview> {
  const UTIF = (await import('utif')).default;
  const pages = UTIF.decode(buf).filter(isPage);
  if (!pages.length) throw new Error('No image in this TIFF');
  const index = Math.max(0, Math.min(page, pages.length - 1));
  const ifd = pages[index];
  const width = tag(ifd, 't256') ?? 0;
  const height = tag(ifd, 't257') ?? 0;
  if (width * height > MAX_TIFF_PIXELS) throw new Error(`Too large to preview (${width} × ${height} pixels)`);
  UTIF.decodeImage(buf, ifd);
  const bits = tag(ifd, 't258') ?? 1;
  const base = { width, height, pages: pages.length, page: index, bits };
  const wide = deepToRGBA(ifd, width, height, bits);
  if (wide) return { ...base, rgba: wide, stretched: true };
  return { ...base, rgba: new Uint8ClampedArray(UTIF.toRGBA8(ifd).buffer), stretched: false };
}

/** 16- and 32-bit grey or RGB pixels, stretched from their 0.1st to 99.9th percentile; null for anything else. */
function deepToRGBA(ifd: IFD, width: number, height: number, bits: number): Uint8ClampedArray | null {
  if (bits !== 16 && bits !== 32) return null;
  const photometric = tag(ifd, 't262') ?? 1;
  const samples = tag(ifd, 't277') ?? 1;
  const grey = (photometric === 0 || photometric === 1) && samples === 1;
  const rgb = photometric === 2 && (samples === 3 || samples === 4);
  if (!grey && !rgb) return null;
  const format = tag(ifd, 't339') ?? 1; // 1 unsigned, 2 signed, 3 floating point
  const view = new DataView(ifd.data.buffer, ifd.data.byteOffset, ifd.data.byteLength);
  // The decoder turns 16-bit data little-endian; 32-bit data stays as the file has it.
  const le = bits === 16 || Boolean((ifd as { isLE?: boolean }).isLE);
  const read =
    bits === 16
      ? format === 2
        ? (i: number) => view.getInt16(i * 2, true)
        : (i: number) => view.getUint16(i * 2, true)
      : format === 3
        ? (i: number) => view.getFloat32(i * 4, le)
        : format === 2
          ? (i: number) => view.getInt32(i * 4, le)
          : (i: number) => view.getUint32(i * 4, le);
  const count = Math.min(width * height * samples, Math.floor(ifd.data.byteLength / (bits / 8)));
  // The range to show, from a sample of the values (alpha excluded); hot pixels and NaN are left out.
  const step = Math.max(1, Math.floor(count / 200_000));
  const seen: number[] = [];
  for (let i = 0; i < count; i += step) {
    if (rgb && samples === 4 && i % 4 === 3) continue;
    const v = read(i);
    if (Number.isFinite(v)) seen.push(v);
  }
  seen.sort((a, b) => a - b);
  const low = seen.length ? seen[Math.floor((seen.length - 1) * 0.001)] : 0;
  const high = seen.length ? seen[Math.ceil((seen.length - 1) * 0.999)] : 1;
  const scale = high > low ? 255 / (high - low) : 0;
  const level = (v: number) => (Number.isFinite(v) ? (v - low) * scale : 0);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const o = p * 4;
    if (grey) {
      const g = photometric === 0 ? 255 - level(read(p)) : level(read(p));
      out[o] = out[o + 1] = out[o + 2] = g;
    } else {
      out[o] = level(read(p * samples));
      out[o + 1] = level(read(p * samples + 1));
      out[o + 2] = level(read(p * samples + 2));
    }
    out[o + 3] = 255;
  }
  return out;
}
