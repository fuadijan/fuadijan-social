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

/**
 * A stored original set the right way up: an upright JPEG comes back as it is; anything with a camera orientation
 * tag (or a HEIC) is decoded like the intake does, so a design never shows a phone photo on its side.
 */
export async function upright(bytes: Buffer, mime?: string | null): Promise<Buffer> {
  const meta = await sharp(bytes, { failOn: 'none' }).metadata().catch(() => null);
  if (meta?.format === 'jpeg' && (meta.orientation ?? 1) === 1) return bytes;
  return (await decode(bytes, mime)).jpeg;
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

export interface Box { x: number; y: number; w: number; h: number }

/**
 * A crop at `ratio` (width/height) built around the dish Claude located, instead of sharp's generic attention
 * crop: the box is padded, the window is sized so the dish fills most of it, and the dish's centre is placed at
 * `focusY` of the window's height (0.42 keeps it above a text band at the bottom). Falls back to the attention
 * crop when the box is missing or degenerate.
 */
export async function cropAround(jpeg: Buffer, box: Box | null | undefined, ratio: number, opts: { focusY?: number; pad?: number; longEdge?: number } = {}): Promise<Buffer> {
  const meta = await sharp(jpeg).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const key: CropKey = Math.abs(ratio - 0.8) < 0.01 ? '4x5' : Math.abs(ratio - 0.5625) < 0.01 ? '9x16' : '1x1';
  if (!box || !W || !H || box.w <= 0.05 || box.h <= 0.05) return crop(jpeg, key);
  const pad = opts.pad ?? 1.25;
  const focusY = opts.focusY ?? 0.42;
  const bx = box.x * W;
  const by = box.y * H;
  const bw = box.w * W;
  const bh = box.h * H;
  const cx = bx + bw / 2;
  const cy = by + bh / 2;
  // Window large enough for the padded box in both directions, at the requested ratio.
  let winW = Math.max(bw * pad, (bh * pad) * ratio);
  let winH = winW / ratio;
  if (winW > W) { winW = W; winH = winW / ratio; }
  if (winH > H) { winH = H; winW = winH * ratio; }
  let left = cx - winW / 2;
  let top = cy - winH * focusY;
  left = Math.min(Math.max(0, left), W - winW);
  top = Math.min(Math.max(0, top), H - winH);
  const { w, h } = CROPS[key];
  const area = { left: Math.max(0, Math.round(left)), top: Math.max(0, Math.round(top)), width: 0, height: 0 };
  area.width = Math.min(Math.round(winW), W - area.left);
  area.height = Math.min(Math.round(winH), H - area.top);
  return sharp(jpeg)
    .extract(area)
    .resize({ width: w, height: h, fit: 'cover' })
    .normalise({ lower: 1, upper: 99 })
    .sharpen({ sigma: 0.8 })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

/** The padded region around the dish, for the background remover, so the plate dominates the mask. */
export async function regionAround(jpeg: Buffer, box: Box | null | undefined, pad = 1.35): Promise<Buffer> {
  const meta = await sharp(jpeg).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!box || !W || !H || box.w <= 0.05 || box.h <= 0.05) return jpeg;
  const bw = box.w * W * pad;
  const bh = box.h * H * pad;
  const left = Math.max(0, Math.round(Math.min(Math.max(0, (box.x + box.w / 2) * W - bw / 2), Math.max(0, W - bw))));
  const top = Math.max(0, Math.round(Math.min(Math.max(0, (box.y + box.h / 2) * H - bh / 2), Math.max(0, H - bh))));
  const width = Math.min(Math.round(bw), W - left);
  const height = Math.min(Math.round(bh), H - top);
  return sharp(jpeg).extract({ left, top, width, height }).jpeg({ quality: 95 }).toBuffer();
}
