/**
 * Opening a notebook's file in a new tab, safely. A file opened from a blob: address runs as this
 * site: an SVG image or an HTML page opened that way could run its scripts with the reader's session
 * (a PI reading a member's notebook on a server, say). So only what a browser shows without running
 * anything opens as it is: plain images, PDFs and text. An SVG image opens as a picture of it (PNG);
 * anything else is downloaded instead.
 */
import { downloadBlob } from './download';

/** Kinds of file a browser only shows. */
const PASSIVE = /^(image\/(png|jpeg|gif|webp|bmp|avif)|application\/pdf|text\/plain)$/;
/** Text that is shown as text (never as a page). */
const PLAIN_TEXT = /\.(txt|csv|tsv|md|log|fasta|fa|seq|gb|gbk|json)$/i;

function openUrl(url: string) {
  window.open(url, '_blank', 'noopener');
  // The tab has read it by then.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** An SVG drawn into a PNG: in an <img>, an SVG runs nothing. */
async function svgToPng(blob: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(new Blob([blob], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((done, fail) => {
      img.onload = () => done();
      img.onerror = () => fail(new Error('not an image'));
      img.src = url;
    });
    const scale = 2;
    const w = Math.min(8000, (img.naturalWidth || 800) * scale);
    const h = Math.min(8000, (img.naturalHeight || 600) * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Open a file of the notebook in a new tab, as something that cannot act as this site. */
export async function openFileSafely(blob: Blob, name: string): Promise<void> {
  const type = (blob.type || '').toLowerCase().split(';')[0].trim();
  if (PASSIVE.test(type)) return openUrl(URL.createObjectURL(blob));
  if (type === 'image/svg+xml' || /\.svg$/i.test(name)) {
    const png = await svgToPng(blob);
    if (png) return openUrl(URL.createObjectURL(png));
  } else if (PLAIN_TEXT.test(name) || type === 'text/csv') {
    return openUrl(URL.createObjectURL(new Blob([blob], { type: 'text/plain;charset=utf-8' })));
  }
  downloadBlob(blob, name);
}
