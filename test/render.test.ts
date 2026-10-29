/**
 * Snapshot tests for every render template. Each PNG is compared to test/__snapshots__/<name>.png by a 16×16
 * difference hash (so a font or layout change fails, a one-pixel antialiasing change doesn't) plus a size check.
 * Delete a snapshot to re-record it. Layout A uses a synthetic elliptical mask instead of the ONNX model, so the
 * suite never downloads anything and also exercises cutoutFrom().
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { loadBrand } from '../src/render/brand.js';
import { renderPost, SAMPLE_INPUTS, SAMPLE_SETTINGS, checkTemplates } from '../src/render/index.js';
import { cutoutFrom, cutoutUsable } from '../src/images/cutout.js';
import { crop, decode } from '../src/images/prep.js';
import { fitHeadline, fontOf, measure, twoLines, wrap } from '../src/render/text.js';
import { inlineScriptHashes } from '../src/server.js';

const SNAP = join(process.cwd(), 'test', '__snapshots__');
mkdirSync(SNAP, { recursive: true });

async function dhash(png: Buffer): Promise<string> {
  const { data } = await sharp(png).greyscale().resize(17, 16, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let bits = '';
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) bits += data[y * 17 + x]! > data[y * 17 + x + 1]! ? '1' : '0';
  return bits;
}
const distance = (a: string, b: string) => [...a].reduce((n, c, i) => n + (c === b[i] ? 0 : 1), 0);

async function expectSnapshot(name: string, png: Buffer, w: number, h: number): Promise<void> {
  const meta = await sharp(png).metadata();
  expect([meta.width, meta.height]).toEqual([w, h]);
  const file = join(SNAP, `${name}.png`);
  if (!existsSync(file)) {
    writeFileSync(file, png);
    return;
  }
  const d = distance(await dhash(png), await dhash(readFileSync(file)));
  expect(d, `${name} drifted from its snapshot by ${d}/256 hash bits — delete test/__snapshots__/${name}.png to re-record`).toBeLessThanOrEqual(12);
}

const brand = loadBrand();
const karahiFull = (await decode(readFileSync('brand/reference/real-01.jpg'))).jpeg;
const karahi = await crop(karahiFull, '4x5');
const tikka = await crop(readFileSync('brand/reference/real-03.jpg'), '4x5');

/** An elliptical mask over the plate, standing in for the segmentation model. */
async function syntheticCutout() {
  const meta = await sharp(karahiFull).metadata();
  const W = meta.width!;
  const H = meta.height!;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="black"/><ellipse cx="${W / 2}" cy="${H / 2}" rx="${W * 0.44}" ry="${H * 0.42}" fill="white"/></svg>`;
  const mask = await sharp(Buffer.from(svg)).png().toBuffer();
  return cutoutFrom(karahiFull, mask, { feather: 3, shadowBlur: 40, shadowOpacity: 0.55 });
}

describe('text fitting', () => {
  const heading = fontOf(brand.fontFiles.heading);
  it('splits and fits a headline into two lines within the column', () => {
    expect(twoLines('Made Fresh in the Karahi')).toEqual(['Made Fresh', 'in the Karahi']);
    expect(twoLines('Chapli\nKebab')).toEqual(['Chapli', 'Kebab']);
    const size = fitHeadline(heading, ['Made Fresh', 'in the Karahi'], 460, 130, 84, 8);
    expect(size).toBeGreaterThanOrEqual(84);
    expect(measure(heading, 'in the Karahi', size)).toBeLessThanOrEqual(460);
    expect(fitHeadline(heading, ['Extraordinarily', 'Longwordhere'], 200, 130, 84, 8)).toBe(84);
  });
  it('wraps and ellipsises body text', () => {
    const body = fontOf(brand.fontFiles.body);
    const lines = wrap(body, 'Prepared from raw ingredients and cooked fresh for every order, every single day of the week.', 34, 460, 3);
    expect(lines).toHaveLength(3);
    expect(lines[2]!.endsWith('…')).toBe(true);
  });
});

describe('cutout post-processing', () => {
  it('builds a trimmed cutout and a shadow and reports coverage', async () => {
    const c = await syntheticCutout();
    expect(c.width).toBeGreaterThan(0);
    expect(c.coverage).toBeGreaterThan(0.4);
    expect(cutoutUsable(c.coverage)).toBe(true);
    expect(cutoutUsable(0.1)).toBe(false);
    expect(cutoutUsable(0.95)).toBe(false);
    const meta = await sharp(c.cutout).metadata();
    expect(meta.channels).toBe(4);
  });
});

describe('render templates', () => {
  it('boot check renders every template with sample data', async () => {
    await expect(checkTemplates(brand)).resolves.toBeUndefined();
  });

  it('hero-photo layout A (cutout)', async () => {
    const cut = await syntheticCutout();
    const out = await renderPost({ ...SAMPLE_INPUTS['hero-photo'], photo: karahi, cutout: cut, settings: SAMPLE_SETTINGS }, brand);
    expect(out.map((o) => o.format)).toEqual(['feed', 'story']);
    await expectSnapshot('hero-photo-A', out[0]!.png, 1080, 1350);
    await expectSnapshot('story', out[1]!.png, 1080, 1920);
  });

  it('hero-photo layout B (full bleed, address footer)', async () => {
    const out = await renderPost({ ...SAMPLE_INPUTS['hero-photo'], sheetTemplate: 'snack-pack', label: 'HOUSE SPECIAL', headline: 'Built for\nCravings', line: 'Chicken tikka over hot crispy chips.', photo: tikka, cutout: null, settings: SAMPLE_SETTINGS }, brand);
    await expectSnapshot('hero-photo-B', out[0]!.png, 1080, 1350);
  });

  it('review', async () => {
    const out = await renderPost({ ...SAMPLE_INPUTS.review, photo: tikka, cutout: null, settings: SAMPLE_SETTINGS }, brand);
    expect(out[0]!.format).toBe('feed');
    await expectSnapshot('review', out[0]!.png, 1080, 1350);
  });

  it('carousel: cover + one page per slide', async () => {
    const out = await renderPost({ ...SAMPLE_INPUTS.carousel, photo: tikka, cutout: null, slidePhotos: [karahi], settings: SAMPLE_SETTINGS }, brand);
    const pages = out.filter((o) => o.format === 'carousel');
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3, 4, 5, 6]);
    await expectSnapshot('carousel-cover', pages[0]!.png, 1080, 1350);
    await expectSnapshot('carousel-slide-photo', pages[1]!.png, 1080, 1350);
    await expectSnapshot('carousel-slide-text', pages[2]!.png, 1080, 1350);
  });

  it('reel cover', async () => {
    const out = await renderPost({ ...SAMPLE_INPUTS['reel-cover'], photo: tikka, cutout: null, settings: SAMPLE_SETTINGS }, brand);
    const cover = out.find((o) => o.format === 'reel-cover')!;
    await expectSnapshot('reel-cover', cover.png, 1080, 1920);
  });

  it('text-only', async () => {
    const out = await renderPost({ ...SAMPLE_INPUTS['text-only'], photo: null, cutout: null, settings: SAMPLE_SETTINGS }, brand);
    expect(out).toHaveLength(1);
    await expectSnapshot('text-only', out[0]!.png, 1080, 1350);
  });

  it('keeps the inline-script hash helper honest', () => {
    expect(inlineScriptHashes('<script>1</script>')).toHaveLength(1);
  });
});
