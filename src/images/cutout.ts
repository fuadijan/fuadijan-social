/**
 * Plate cutout: segmentation, never generation. A BackgroundRemover returns a soft mask; sharp then feathers the
 * edge, drops stray islands, builds a drop shadow from the blurred alpha and a warm Ember glow, and decides from
 * the mask's coverage whether the cutout is usable (25–90 % of the frame) or layout B should take over.
 *
 * Removers:
 *  - `u2netp` (default) / `isnet`: Apache-2.0 ONNX models run locally with onnxruntime-node. The weights are
 *    downloaded once into DATA_DIR/models and checked against a pinned sha256 so Railway builds are repeatable.
 *  - `removebg`: the remove.bg API (REMOVE_BG_KEY), a few cents an image.
 *  - `none`: no cutouts; every hero renders as layout B.
 * (@imgly/background-removal-node was considered and rejected: it is AGPL-3.0.)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';

export interface MaskResult {
  /** Greyscale PNG, same size as the input, 255 = plate. */
  mask: Buffer;
  /** Fraction of the frame the mask covers (0–1). */
  coverage: number;
}

export interface BackgroundRemover {
  readonly name: string;
  remove(jpeg: Buffer): Promise<MaskResult>;
}

interface ModelSpec { url: string; sha256: string | null; size: number; mean: [number, number, number]; std: [number, number, number]; output: string }

export const MODELS: Record<'u2netp' | 'u2net' | 'isnet', ModelSpec> = {
  // U²-Net (Apache-2.0), the small variant: 4.7 MB, good enough for a plate on a bench.
  u2netp: { url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx', sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8', size: 320, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], output: 'd0' },
  u2net: { url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx', sha256: process.env.U2NET_SHA256 ?? null, size: 320, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], output: 'd0' },
  // IS-Net (DIS, Apache-2.0): sharper edges, 176 MB.
  isnet: { url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx', sha256: process.env.ISNET_SHA256 ?? null, size: 1024, mean: [0.5, 0.5, 0.5], std: [1, 1, 1], output: 'output' },
};

async function modelPath(name: keyof typeof MODELS): Promise<string> {
  const spec = MODELS[name];
  const dir = join(config.dataDir, 'models');
  const file = join(dir, `${name}.onnx`);
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    const res = await fetch(spec.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Couldn't download ${name} model: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  if (spec.sha256) {
    const got = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (got !== spec.sha256) throw new Error(`${name} model hash mismatch: ${got}`);
  }
  return file;
}

export class OnnxRemover implements BackgroundRemover {
  readonly name: string;
  private session: Promise<import('onnxruntime-node').InferenceSession> | null = null;
  constructor(private readonly model: keyof typeof MODELS) {
    this.name = model;
  }

  private async load() {
    this.session ??= (async () => {
      const ort = await import('onnxruntime-node');
      return ort.InferenceSession.create(await modelPath(this.model), { executionProviders: ['cpu'] });
    })();
    return this.session;
  }

  async remove(jpeg: Buffer): Promise<MaskResult> {
    const spec = MODELS[this.model];
    const ort = await import('onnxruntime-node');
    const session = await this.load();
    const meta = await sharp(jpeg).metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    const { data } = await sharp(jpeg).resize(spec.size, spec.size, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const n = spec.size * spec.size;
    const input = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) input[c * n + i] = (data[i * 3 + c]! / 255 - spec.mean[c]!) / spec.std[c]!;
    }
    const tensor = new ort.Tensor('float32', input, [1, 3, spec.size, spec.size]);
    const inputName = session.inputNames[0]!;
    const out = await session.run({ [inputName]: tensor });
    const outName = out[spec.output] ? spec.output : session.outputNames[0]!;
    const pred = out[outName]!.data as Float32Array;
    let min = Infinity;
    let max = -Infinity;
    for (const v of pred) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const grey = Buffer.alloc(n);
    for (let i = 0; i < n; i++) grey[i] = Math.round(((pred[i]! - min) / (max - min || 1)) * 255);
    const mask = await sharp(grey, { raw: { width: spec.size, height: spec.size, channels: 1 } }).resize(W, H, { fit: 'fill' }).png().toBuffer();
    return { mask, coverage: await coverageOf(mask) };
  }
}

export class RemoveBgRemover implements BackgroundRemover {
  readonly name = 'removebg';
  constructor(private readonly apiKey: string, private readonly fetchFn: typeof fetch = fetch) {}
  async remove(jpeg: Buffer): Promise<MaskResult> {
    const form = new FormData();
    form.append('image_file', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'photo.jpg');
    form.append('size', 'auto');
    form.append('format', 'png');
    form.append('channels', 'alpha');
    const res = await this.fetchFn('https://api.remove.bg/v1.0/removebg', { method: 'POST', headers: { 'X-Api-Key': this.apiKey }, body: form, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`remove.bg answered HTTP ${res.status}`);
    const alpha = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(jpeg).metadata();
    const mask = await sharp(alpha).greyscale().resize(meta.width, meta.height, { fit: 'fill' }).png().toBuffer();
    return { mask, coverage: await coverageOf(mask) };
  }
}

export class NoRemover implements BackgroundRemover {
  readonly name = 'none';
  async remove(): Promise<MaskResult> {
    throw new Error('Background removal is off (BACKGROUND_REMOVER=none).');
  }
}

export function removerFromConfig(): BackgroundRemover {
  const kind = (process.env.BACKGROUND_REMOVER ?? 'u2netp').trim();
  if (kind === 'none') return new NoRemover();
  if (kind === 'removebg') {
    const key = process.env.REMOVE_BG_KEY?.trim();
    if (!key) throw new Error('BACKGROUND_REMOVER=removebg needs REMOVE_BG_KEY.');
    return new RemoveBgRemover(key);
  }
  if (kind in MODELS) return new OnnxRemover(kind as keyof typeof MODELS);
  throw new Error(`Unknown BACKGROUND_REMOVER "${kind}" (none | removebg | u2netp | u2net | isnet).`);
}

export async function coverageOf(maskPng: Buffer): Promise<number> {
  const stats = await sharp(maskPng).greyscale().stats();
  return (stats.channels[0]?.mean ?? 0) / 255;
}

export interface CutoutResult {
  /** RGBA PNG of the plate alone, trimmed to its bounding box. */
  cutout: Buffer;
  /** RGBA PNG of the soft shadow, same size as the cutout, to place offset below it. */
  shadow: Buffer;
  width: number;
  height: number;
  coverage: number;
}

/**
 * Mask post-processing: threshold + feather the edge (2–3 px), drop stray islands (a morphological open via blur
 * and re-threshold on a reduced copy), then cut the plate out and build its shadow.
 */
export async function cutoutFrom(jpeg: Buffer, mask: Buffer, opts: { feather?: number; shadowBlur?: number; shadowOpacity?: number } = {}): Promise<CutoutResult> {
  const feather = opts.feather ?? 3;
  const meta = await sharp(jpeg).metadata();
  const W = meta.width!;
  const H = meta.height!;
  // 1. Clean: blur at a reduced size kills islands smaller than the kernel, then re-threshold.
  const small = Math.max(64, Math.round(Math.min(W, H) / 8));
  const cleaned = await sharp(mask).greyscale().resize({ width: small, fit: 'inside' }).blur(2).threshold(128).resize(W, H, { fit: 'fill' }).toBuffer();
  const hard = await sharp(mask).greyscale().threshold(128).toBuffer();
  // Keep only what both the hard mask and the cleaned mask agree on.
  const agreed = await sharp(hard).composite([{ input: cleaned, blend: 'darken' }]).blur(feather / 2).png().toBuffer();
  const coverage = await coverageOf(agreed);
  // 2. Cut out.
  const rgba = await sharp(jpeg).ensureAlpha().joinChannel(await sharp(agreed).greyscale().toColourspace('b-w').toBuffer()).png().toBuffer();
  const { data: trimmed, info } = await sharp(rgba).trim({ threshold: 10 }).png().toBuffer({ resolveWithObject: true });
  // 3. Shadow from the blurred alpha.
  const alpha = await sharp(trimmed).extractChannel(3).toBuffer();
  const pad = (opts.shadowBlur ?? 40) * 2;
  const shadowAlpha = await sharp(alpha).extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } }).blur(opts.shadowBlur ?? 40).linear(opts.shadowOpacity ?? 0.55, 0).toBuffer();
  const sw = info.width + pad * 2;
  const sh = info.height + pad * 2;
  const shadow = await sharp({ create: { width: sw, height: sh, channels: 3, background: '#000000' } }).joinChannel(shadowAlpha).png().toBuffer();
  return { cutout: trimmed, shadow, width: info.width, height: info.height, coverage };
}

/** Decides from the mask whether the cutout is usable: between 25 % and 90 % of the frame. */
export function cutoutUsable(coverage: number, min = 0.25, max = 0.9): boolean {
  return coverage >= min && coverage <= max;
}
