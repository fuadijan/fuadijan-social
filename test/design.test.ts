/**
 * The smart-design pieces that need no Claude: photo measurement, the legibility maths, the rule-based spec, the
 * owner's note overrides, the critic's fixes merge, and the templates with the text moved and the type scaled.
 */
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { analyzePhoto, describeStats } from '../src/images/analyze.js';
import { bandStrengthFor, contrastRatio, legibilityFor, predictedContrast, relativeLuminance, typeFloors } from '../src/render/legibility.js';
import { applyOwnerNote, heuristicSpec, mergeFixes } from '../src/pipeline/design.js';
import { loadBrand } from '../src/render/brand.js';
import { renderPost, SAMPLE_INPUTS, SAMPLE_SETTINGS } from '../src/render/index.js';
import { crop, decode } from '../src/images/prep.js';
import { optionsFrom, applyOption } from '../src/pipeline/wording.js';
import type { MatchResult } from '../src/brain/schemas.js';

const brand = loadBrand();

/** Left half dark and flat, right half bright and noisy. */
async function splitPhoto(): Promise<Buffer> {
  const w = 400;
  const h = 500;
  const noise = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const v = x < w / 2 ? 20 + (x % 3) : 150 + ((x * 7 + y * 13) % 90);
      noise[i] = v; noise[i + 1] = v; noise[i + 2] = v;
    }
  }
  return sharp(noise, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer();
}

describe('photo measurement', () => {
  it('finds the dark, flat half quiet and the bright, noisy half busy', async () => {
    const s = await analyzePhoto(await splitPhoto());
    expect(s.cols).toBe(4);
    expect(s.zones.left.lum).toBeLessThan(0.05);
    expect(s.zones.right.lum).toBeGreaterThan(0.3);
    expect(s.zones.left.detail).toBeLessThan(s.zones.right.detail);
    expect(s.quietest).toBe('left');
    expect(s.brightCentre.x).toBeGreaterThan(0.6);
    expect(describeStats(s)).toContain('Quietest: left');
  });

  it('measures a real photo without throwing', async () => {
    const s = await analyzePhoto(readFileSync('brand/reference/real-03.jpg'));
    expect(s.mean).toBeGreaterThan(0);
    expect(s.cells).toHaveLength(4);
  });
});

describe('legibility maths', () => {
  it('knows the WCAG numbers', () => {
    expect(contrastRatio(1, 0)).toBeCloseTo(21, 0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 3);
    expect(relativeLuminance(brand.colors.night)).toBeLessThan(0.01);
  });

  it('asks for a stronger band over a brighter photo and reaches the target', () => {
    const dark = bandStrengthFor(0.03, brand.colors.night, brand.colors.cream);
    const mid = bandStrengthFor(0.45, brand.colors.night, brand.colors.cream);
    const bright = bandStrengthFor(0.7, brand.colors.night, brand.colors.cream);
    expect(dark).toBe(0.6);
    expect(mid).toBeGreaterThan(dark);
    expect(bright).toBeGreaterThan(mid);
    expect(bright).toBeLessThanOrEqual(0.97);
    expect(predictedContrast(0.25, mid, brand.colors.night, brand.colors.cream)).toBeGreaterThanOrEqual(5.3);
  });

  it('sets phone floors for a 1080 canvas', () => {
    const f = typeFloors(1080);
    expect(f).toEqual({ label: 31, line: 39, headline: 95 });
  });

  it('reads the zone under the text block', async () => {
    const s = await analyzePhoto(await splitPhoto());
    const l = legibilityFor(s, 'bottom', 'right', brand);
    expect(['bottom', 'right']).toContain(l.zone);
    expect(l.contrast).toBeGreaterThan(5);
  });
});

const read = (over: Partial<MatchResult> = {}): MatchResult => ({
  row_id: 1, confidence: 0.9, reason: '', dish_canonical: 'Chapli Kebab', alternatives: [], composition: 'scene', background_clutter: 'medium', shoot_tip: null,
  subject_box: { x: 0.1, y: 0.5, w: 0.8, h: 0.45 }, plate_shape: 'round', ...over,
});

describe('rule-based design', () => {
  it('puts the text at the top when the dish sits low, and enlarges a short headline', async () => {
    const stats = await analyzePhoto(await splitPhoto());
    const spec = heuristicSpec({ stats, read: read(), cutoutAvailable: false, cutoutCoverage: null, headline: 'Chapli\nKebab', line: 'x', note: null, designNotes: '' });
    expect(spec.layout).toBe('B');
    expect(spec.text_position).toBe('top');
    expect(spec.crop_focus_y).toBeCloseTo(0.58);
    expect(spec.type_scale).toBeGreaterThan(1);
    // Quiet left half → text on the left.
    expect(spec.text_side).toBe('left');
  });

  it('chooses layout A only for a single plate with a cutout', async () => {
    const stats = await analyzePhoto(await splitPhoto());
    const a = heuristicSpec({ stats, read: read({ composition: 'single-plate', subject_box: { x: 0.1, y: 0.1, w: 0.8, h: 0.6 } }), cutoutAvailable: true, cutoutCoverage: 0.6, headline: 'Made Fresh in the Karahi', line: 'x', note: null, designNotes: '' });
    expect(a.layout).toBe('A');
    const b = heuristicSpec({ stats, read: read({ composition: 'single-plate' }), cutoutAvailable: false, cutoutCoverage: null, headline: 'x', line: 'x', note: null, designNotes: '' });
    expect(b.layout).toBe('B');
  });

  it('lets the owner override and locks what they said', () => {
    const base = { layout: 'A' as const, text_position: 'bottom' as const, text_side: 'left' as const, band_strength: 0.9, type_scale: 1, crop_focus_y: 0.42, lift_tone: false, rationale: 'r' };
    const { spec, locked } = applyOwnerNote(base, 'layout B, text on the right, bigger text');
    expect(spec).toMatchObject({ layout: 'B', text_side: 'right', type_scale: 1.15 });
    expect(locked).toEqual(['layout', 'text_side', 'type_scale']);
    const top = applyOwnerNote(base, 'text at the top');
    expect(top.spec.text_position).toBe('top');
    expect(top.spec.crop_focus_y).toBeCloseTo(0.58);
    expect(applyOwnerNote(base, 'shorter caption').locked).toEqual([]);
    // The critic can't undo a locked field, but moves the crop with a new text position.
    const merged = mergeFixes(spec, { layout: 'A', text_position: 'top', band_strength: 1 }, locked);
    expect(merged.layout).toBe('B');
    expect(merged.text_position).toBe('top');
    expect(merged.band_strength).toBe(1);
    expect(merged.crop_focus_y).toBeCloseTo(0.58);
  });
});

describe('wording options', () => {
  const copy = { label: 'L', headline: 'A\nB', line: 'l', caption: 'c', cta: 'Come by.', hashtags: ['#a', '#b', '#c'], alt_text: 'x', story_text: 's', facebook_caption: 'c Come by.', on_screen_text: [], unresolved: [], variants: [{ name: 'Punchy', headline: 'P\nQ', line: 'pl', caption: 'pc' }, { name: 'Dup', headline: 'A\nB', line: 'l', caption: 'c' }] };
  it('lists the calendar wording first and drops duplicates', () => {
    const options = optionsFrom(copy);
    expect(options.map((o) => o.name)).toEqual(['Calendar wording', 'Punchy']);
    const applied = applyOption(copy, options[1]!);
    expect(applied).toMatchObject({ headline: 'P\nQ', line: 'pl', caption: 'pc', facebook_caption: 'pc Come by.' });
  });
});

describe('templates with a design spec', () => {
  it('renders the text top-right with scaled type, and a strong band', async () => {
    const tikka = await crop((await decode(readFileSync('brand/reference/real-03.jpg'))).jpeg, '4x5');
    const out = await renderPost({ ...SAMPLE_INPUTS['hero-photo'], photo: tikka, cutout: null, settings: SAMPLE_SETTINGS, design: { layout: 'B', text_position: 'top', text_side: 'right', band_strength: 1, type_scale: 1.2, lift_tone: true } }, brand);
    const feed = out.find((o) => o.format === 'feed')!;
    const meta = await sharp(feed.png).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1350]);
    // The top band is darker than the untouched middle, where the photo shows through.
    // sharp's stats() ignore a preceding extract, so the regions are cut to buffers first.
    const lum = async (r: { left: number; top: number; width: number; height: number }) => (await sharp(await sharp(feed.png).extract(r).toBuffer()).greyscale().stats()).channels[0]!.mean;
    const topLum = await lum({ left: 540, top: 60, width: 480, height: 200 });
    const midLum = await lum({ left: 300, top: 850, width: 480, height: 200 });
    expect(topLum).toBeLessThan(midLum);
    const story = out.find((o) => o.format === 'story')!;
    expect((await sharp(story.png).metadata()).height).toBe(1920);
  });
});
