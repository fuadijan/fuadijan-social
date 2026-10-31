/**
 * Legibility maths. Two questions, both answered per photo instead of by a constant:
 *  1. How strong must the Night band be so cream text over this photo reaches the target contrast?
 *  2. How small may the type go before it stops being readable on a phone?
 *
 * A 1080 px feed image shows about 390 CSS px wide on a phone, so one canvas pixel is 0.36 CSS px. The floors
 * below are CSS px people can read in a feed: 11 for the label, 14 for the body line, 34 for the headline.
 */
import type { PhotoStats, Zone } from '../images/analyze.js';
import type { Brand } from './brand.js';
import { srgbToLinear } from '../images/analyze.js';

export const PHONE_WIDTH_CSS = 390;

export function relativeLuminance(hex: string): number {
  const r = srgbToLinear(parseInt(hex.slice(1, 3), 16));
  const g = srgbToLinear(parseInt(hex.slice(3, 5), 16));
  const b = srgbToLinear(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two relative luminances (1–21). */
export function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** The band alpha that puts `night` over a photo zone of luminance `photoLum` so `text` reaches `target`. */
export function bandStrengthFor(photoLum: number, nightHex: string, textHex: string, target = 5.5, floor = 0.6, ceil = 0.97): number {
  const night = relativeLuminance(nightHex);
  const text = relativeLuminance(textHex);
  const maxBg = (text + 0.05) / target - 0.05; // the brightest background that still reaches the target
  if (photoLum <= maxBg) return floor;
  const alpha = (photoLum - maxBg) / Math.max(1e-6, photoLum - night);
  return Math.round(Math.min(ceil, Math.max(floor, alpha)) * 100) / 100;
}

/** Predicted contrast of `text` over `night` at `alpha` on a zone of `photoLum`. */
export function predictedContrast(photoLum: number, alpha: number, nightHex: string, textHex: string): number {
  const bg = alpha * relativeLuminance(nightHex) + (1 - alpha) * photoLum;
  return Math.round(contrastRatio(relativeLuminance(textHex), bg) * 10) / 10;
}

export interface TypeFloors { label: number; line: number; headline: number }

/** Smallest canvas sizes that are still readable on a phone, for a canvas `canvasWidth` px wide. */
export function typeFloors(canvasWidth: number): TypeFloors {
  const scale = canvasWidth / PHONE_WIDTH_CSS; // canvas px per CSS px
  const px = (css: number) => Math.ceil(css * scale);
  return { label: px(11), line: px(14), headline: px(34) };
}

/** The zone of the photo the text block covers, from where it is placed. */
export function textZone(position: 'top' | 'bottom', side: 'left' | 'right', stats: PhotoStats): Zone {
  // The band spans the full width, so the vertical zone decides the luminance under the text; the side is only
  // a tie-break when the photo is far brighter on one side.
  const vertical = position;
  const lateral = side;
  return stats.zones[vertical].lum >= stats.zones[lateral].lum ? vertical : lateral;
}

export interface Legibility { zone: Zone; zoneLum: number; bandStrength: number; contrast: number }

/** The band strength the photo needs under a text block at (position, side), and the contrast that gives. */
export function legibilityFor(stats: PhotoStats, position: 'top' | 'bottom', side: 'left' | 'right', brand: Brand, target = 5.5): Legibility {
  const zone = textZone(position, side, stats);
  const zoneLum = stats.zones[zone].lum;
  const bandStrength = bandStrengthFor(zoneLum, brand.colors.night, brand.colors.cream, target);
  return { zone, zoneLum, bandStrength, contrast: predictedContrast(zoneLum, bandStrength, brand.colors.night, brand.colors.cream) };
}
