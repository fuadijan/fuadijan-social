/**
 * Photo prep with sharp: decode (HEIC first, through heic-convert), auto-orient, quality statistics, and the
 * three crops the pack needs. Nothing here paints, extends or relights anything: crop, tone, sharpen, resize.
 */
import sharp from 'sharp';
import { config } from '../config.js';

export interface Quality {
  width: number;
  height: number;
  longEdge: number;
  luminance: number;   // mean 0–255
  laplacian: number;   // variance of the Laplacian on a 512 px grey copy; low = blurry
  verdict: 'ok' | 'small' | 'dark' | 'blurry';
}

export const CROPS = {
  '4x5': { w: 2160, h: 2700, name: 'crop-4x5.jpg' },
  '9x16': { w: 2160, h: 3840, name: 'crop-9x16.jpg' },
  '1x1': { w: 2160, h: 2160, name: 'crop-1x1.jpg' },
} as const;
export type CropKey = keyof typeof CROPS;

function looksHeic(bytes: Buffer, mime?: string | null, filename?: string | null): boolean {
  if (mime && /hei[cf]/i.test(mime)) return true;
  if (filename && /\.hei[cf]$/i.test(filename)) return true;
  return bytes.length > 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp' && /^(heic|heix|hevc|mif1|msf1)/.test(bytes.subarray(8, 12).toString('ascii'));
}

/** Any supported input → an oriented JPEG buffer (EXIF dropped), plus its size. */
export async function decode(bytes: Buffer, mime?: string | null, filename?: string | null): Promise<{ jpeg: Buffer; width: number; height: number }> {
  let input = bytes;
  if (looksHeic(bytes, mime, filename)) {
    const heicConvert = (await import('heic-convert')).default;
    input = Buffer.from(await heicConvert({ buffer: new Uint8Array(bytes), format: 'JPEG', quality: 0.95 }));
  }
  const img = sharp(input, { failOn: 'none' }).rotate();
  const jpeg = await img.jpeg({ quality: 95, mozjpeg: true }).toBuffer();
  const meta = await sharp(jpeg).metadata();
  return { jpeg, width: meta.width ?? 0, height: meta.height ?? 0 };
}

export async function measure(jpeg: Buffer): Promise<Quality> {
  const meta = await sharp(jpeg).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const grey = sharp(jpeg).resize({ width: 512, withoutEnlargement: true }).greyscale();
  const stats = await grey.clone().stats();
  const luminance = stats.channels[0]?.mean ?? 0;
  // Laplacian variance: convolve, then variance of the result.
  const { data, info } = await grey.clone()
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
    .raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  let sq = 0;
  const n = info.width * info.height;
  for (let i = 0; i < n; i++) {
    const v = data[i]!;
    sum += v;
    sq += v * v;
  }
  const mean = sum / n;
  const laplacian = sq / n - mean * mean;
  const longEdge = Math.max(width, height);
  const verdict: Quality['verdict'] = luminance < config.quality.minLuminance ? 'dark'
    : laplacian < config.quality.minLaplacian ? 'blurry'
    : longEdge < config.quality.minLongEdge ? 'small' : 'ok';
  return { width, height, longEdge, luminance: Math.round(luminance), laplacian: Math.round(laplacian), verdict };
}

/** A centred attention crop at the ratio, long edge 2160, gentle normalise and light sharpen, EXIF stripped. */
export async function crop(jpeg: Buffer, key: CropKey): Promise<Buffer> {
  const { w, h } = CROPS[key];
  return sharp(jpeg)
    .resize({ width: w, height: h, fit: 'cover', position: sharp.strategy.attention, withoutEnlargement: false })
    .normalise({ lower: 1, upper: 99 })
    .sharpen({ sigma: 0.8 })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

/** A thumbnail for Claude: never above `max` px on the long edge. */
export async function thumbnail(jpeg: Buffer, max = 512): Promise<Buffer> {
  return sharp(jpeg).resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
}
