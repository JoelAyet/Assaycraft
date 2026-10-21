/**
 * TIFF previews. The fixtures in tests/fixtures/tiff were written with Pillow: an 8-bit RGB gel
 * photo (LZW), a big-endian 16-bit camera frame holding 12-bit values with one hot pixel, a
 * 32-bit float ratio map, and a 3-page deflate stack.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeTiff, isTiffName } from '../../src/lib/tiff';

const fixture = (name: string) => {
  const b = readFileSync(`tests/fixtures/tiff/${name}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const pixel = (t: { width: number; rgba: Uint8ClampedArray }, x: number, y: number) => [
  ...t.rgba.slice((y * t.width + x) * 4, (y * t.width + x) * 4 + 4),
];

describe('TIFF previews', () => {
  it('knows TIFF files by name', () => {
    expect(isTiffName('attachments/EXP-0001/gel.TIF')).toBe(true);
    expect(isTiffName('scan.tiff')).toBe(true);
    expect(isTiffName('photo.png')).toBe(false);
  });

  it('shows an 8-bit RGB image as it is (LZW)', async () => {
    const t = await decodeTiff(fixture('gel-rgb-lzw.tif'));
    expect([t.width, t.height, t.pages, t.bits, t.stretched]).toEqual([96, 64, 1, 8, false]);
    expect(pixel(t, 0, 0)).toEqual([20, 20, 24, 255]);
    expect(pixel(t, 10, 16)).toEqual([230, 240, 255, 255]);
  });

  it('stretches a 12-bit camera frame stored in 16 bits, whatever the byte order, ignoring a hot pixel', async () => {
    const t = await decodeTiff(fixture('cells-16bit-be.tif'));
    expect([t.width, t.height, t.bits, t.stretched]).toEqual([64, 48, 16, true]);
    // Taking the high byte would give 15 at best: the bright centre is now near white, the background near black.
    expect(pixel(t, 32, 24)[0]).toBeGreaterThan(240);
    expect(pixel(t, 60, 44)[0]).toBeLessThan(15);
    expect(pixel(t, 2, 2)[0]).toBe(255);
  });

  it('stretches a 32-bit float map', async () => {
    const t = await decodeTiff(fixture('ratio-float32.tif'));
    expect([t.bits, t.stretched]).toEqual([32, true]);
    const values = new Set<number>();
    for (let i = 0; i < t.rgba.length; i += 4) values.add(t.rgba[i]);
    expect(Math.min(...values)).toBeLessThan(10);
    expect(Math.max(...values)).toBeGreaterThan(245);
  });

  it('reads each page of a stack (deflate)', async () => {
    const shades = [];
    for (const page of [0, 1, 2, 7]) {
      const t = await decodeTiff(fixture('stack-3pages.tif'), page);
      expect(t.pages).toBe(3);
      shades.push([t.page, pixel(t, 5, 5)[0]]);
    }
    expect(shades).toEqual([
      [0, 40],
      [1, 120],
      [2, 200],
      [2, 200],
    ]);
  });

  it('says so when a file is not a TIFF', async () => {
    await expect(decodeTiff(new TextEncoder().encode('not a tiff at all').buffer as ArrayBuffer)).rejects.toThrow();
  });
});
