/**
 * HEIC/HEIF photos (iPhones save these): converted to JPEG on import so every browser and Markdown
 * viewer shows them, and shown by converting on the fly where a page already has one.
 *
 * Safari draws HEIC itself; elsewhere the decoder (libheif, via heic-to, LGPL-3.0) is loaded on first
 * use, from the website. The single-file version has no decoder.
 */
import { extname } from './path';

export const isHeicName = (name: string) => ['.heic', '.heif'].includes(extname(name));
export const isHeicFile = (file: File) => /^image\/hei[cf](-sequence)?$/i.test(file.type) || isHeicName(file.name);

/** Draw a blob through the browser's own decoder (Safari reads HEIC); null where it cannot. */
async function viaBrowser(blob: Blob, quality: number): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  } catch {
    return null;
  }
}

/** A HEIF file starts with an "ftyp" box naming a HEIF brand. */
async function looksLikeHeif(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const text = String.fromCharCode(...head);
  return text.slice(4, 8) === 'ftyp' && /heic|heix|hevc|heim|heis|hevm|hevs|mif1|msf1|avif/.test(text.slice(8));
}

/** The photo as a JPEG. Throws when it cannot be read. */
export async function heicToJpeg(blob: Blob, quality = 0.92): Promise<Blob> {
  if (!(await looksLikeHeif(blob))) throw new Error('the file is not a HEIC photo');
  const own = await viaBrowser(blob, quality);
  if (own) return own;
  if (import.meta.env.MODE === 'single')
    throw new Error('HEIC photos can be converted on the website (assaycraftlab.com), not in the single-file version');
  const { heicTo } = await import('heic-to/csp');
  // A photo the decoder chokes on should not leave the page waiting forever.
  return Promise.race([
    heicTo({ blob, type: 'image/jpeg', quality }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('reading it took too long')), 60_000)),
  ]);
}

/** A photo to attach: HEIC becomes "<name>.jpg"; anything else, or a HEIC that cannot be read, stays as it is. */
export async function convertForNotebook(file: File): Promise<{ file: File; converted: boolean }> {
  if (!isHeicFile(file)) return { file, converted: false };
  try {
    const jpeg = await heicToJpeg(file);
    const name = (file.name || 'photo.heic').replace(/\.(heic|heif)$/i, '') + '.jpg';
    return { file: new File([jpeg], name, { type: 'image/jpeg', lastModified: file.lastModified }), converted: true };
  } catch (err) {
    console.warn('Could not convert HEIC photo', err);
    return { file, converted: false };
  }
}
