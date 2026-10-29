/**
 * The social brand kit: brand/brand.json plus the font files and logo it names. Loaded once; boot fails loudly if
 * a file is missing. This is the kit for rendered posts, separate from the app UI tokens (fuadijan-brand).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const BrandSchema = z.object({
  name: z.string(),
  version: z.number(),
  colors: z.object({ night: Hex, charcoal: Hex, cream: Hex, sand: Hex, ember: Hex, saffron: Hex }),
  fonts: z.object({
    heading: z.object({ family: z.string(), file: z.string(), italic: z.string().optional(), fallback: z.string().optional() }),
    body: z.object({ family: z.string(), file: z.string(), medium: z.string().optional(), fallback: z.string().optional() }),
  }),
  logo: z.string(),
  canvas: z.object({ feed: z.tuple([z.number(), z.number()]), story: z.tuple([z.number(), z.number()]), square: z.tuple([z.number(), z.number()]) }),
  layout: z.object({
    margin: z.number(), logoWidth: z.number(), textColumn: z.number(), ruleSize: z.tuple([z.number(), z.number()]),
    label: z.object({ size: z.number(), tracking: z.number() }),
    headline: z.object({ start: z.number(), min: z.number(), step: z.number(), lineHeight: z.number() }),
    line: z.object({ size: z.number(), maxLines: z.number() }),
    footer: z.object({ size: z.number(), tracking: z.number() }),
    storySafeTop: z.number(), storySafeBottom: z.number(),
  }),
  cutout: z.object({
    widthRatio: z.number(), shadow: z.object({ offsetY: z.number(), blur: z.number(), opacity: z.number() }),
    glow: z.object({ color: z.string(), opacity: z.number() }), feather: z.number(), minCoverage: z.number(), maxCoverage: z.number(),
  }),
  seriesLabels: z.array(z.string()),
  brandLine: z.string(),
  ornament: z.string(),
});
export type BrandSpec = z.infer<typeof BrandSchema>;

export interface LoadedFont { name: string; data: Buffer; weight: 400 | 500 | 700; style: 'normal' | 'italic' }

export interface Brand extends BrandSpec {
  dir: string;
  fontFiles: { heading: Buffer; headingItalic: Buffer | null; body: Buffer; bodyMedium: Buffer | null };
  /** Fonts as satori wants them. */
  satoriFonts: LoadedFont[];
  logoPng: Buffer;
}

let cached: Brand | null = null;

export function loadBrand(dir = resolve(process.cwd(), 'brand')): Brand {
  if (cached && cached.dir === dir) return cached;
  const jsonPath = join(dir, 'brand.json');
  if (!existsSync(jsonPath)) throw new Error(`Brand kit missing: ${jsonPath}`);
  const spec = BrandSchema.parse(JSON.parse(readFileSync(jsonPath, 'utf8')));
  const need = (rel: string, what: string): Buffer => {
    const p = join(dir, rel);
    if (!existsSync(p)) throw new Error(`Brand kit: ${what} not found at ${p}`);
    return readFileSync(p);
  };
  const heading = need(spec.fonts.heading.file, 'heading font');
  const headingItalic = spec.fonts.heading.italic ? need(spec.fonts.heading.italic, 'heading italic font') : null;
  const body = need(spec.fonts.body.file, 'body font');
  const bodyMedium = spec.fonts.body.medium ? need(spec.fonts.body.medium, 'body medium font') : null;
  const logoPng = need(spec.logo, 'logo');
  const satoriFonts: LoadedFont[] = [
    { name: spec.fonts.heading.family, data: heading, weight: 400, style: 'normal' },
    ...(headingItalic ? [{ name: spec.fonts.heading.family, data: headingItalic, weight: 400 as const, style: 'italic' as const }] : []),
    { name: spec.fonts.body.family, data: body, weight: 400, style: 'normal' },
    ...(bodyMedium ? [{ name: spec.fonts.body.family, data: bodyMedium, weight: 500 as const, style: 'normal' as const }] : []),
  ];
  cached = { ...spec, dir, fontFiles: { heading, headingItalic, body, bodyMedium }, satoriFonts, logoPng };
  return cached;
}

/** For tests that want a fresh load. */
export function resetBrandCache(): void {
  cached = null;
}
