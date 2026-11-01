/**
 * The satori layers for the four styles beyond the house band (styles.ts has the cards): split, poster, flat and
 * invite. They reuse the helpers in templates.ts (label, headline, line, footer, logo, gradient) so the type,
 * tracking, floors and colours stay the kit's; compose-styles.ts puts the photo or the cutout under or over them.
 */
import { z } from 'zod';
import { typeFloors } from './legibility.js';
import { fitHeadline, fontOf, twoLines } from './text.js';
import {
  canvas, designFields, el, footer, gradient, label, line, logo, logoHeight, logoImg, spacer, uc,
  type Ctx, type El, type Side,
} from './templates.js';

const giant = (ctx: Ctx, text: string, size: number, color: string, extra: Record<string, unknown> = {}): El =>
  el('div', { display: 'flex', fontFamily: ctx.brand.fonts.heading.family, fontSize: size, lineHeight: 0.88, color, whiteSpace: 'nowrap', ...extra }, uc(text));

/** The largest size at which every line, set in capitals, fits `width`. */
function giantSize(ctx: Ctx, lines: string[], width: number, start: number): number {
  const font = fontOf(ctx.brand.fontFiles.heading);
  const floor = typeFloors(ctx.w).headline;
  const [a, b] = [lines[0] ?? '', lines[1] ?? ''];
  return fitHeadline(font, [uc(a), uc(b)], width, start, floor, 8);
}

const isStory = (ctx: Ctx) => ctx.h / ctx.w > 1.6;
const safeTop = (ctx: Ctx) => (isStory(ctx) ? ctx.brand.layout.storySafeTop : ctx.brand.layout.margin);
const safeBottom = (ctx: Ctx) => (isStory(ctx) ? ctx.brand.layout.storySafeBottom : ctx.brand.layout.margin);
const centred = (ctx: Ctx, top: number | undefined, bottom: number | undefined, children: El[]): El =>
  el('div', { position: 'absolute', left: ctx.brand.layout.margin, right: ctx.brand.layout.margin, ...(top !== undefined ? { top } : {}), ...(bottom !== undefined ? { bottom } : {}), display: 'flex', flexDirection: 'column', alignItems: 'center' }, children);

// ─── split ───────────────────────────────────────────────────────────────────────────────────────────────────

export const SplitData = z.object({
  label: z.string().max(40),
  headline: z.string().max(60),
  line: z.string().max(140),
  footer: z.enum(['brand', 'address']).default('brand'),
  bandStrength: designFields.bandStrength,
  typeScale: designFields.typeScale,
});

/** One giant word above the dish, one below; the photo fills the canvas under two soft bands. */
export function splitLayer(ctx: Ctx, d: z.infer<typeof SplitData>): El {
  const { brand } = ctx;
  const m = brand.layout.margin;
  const lines = twoLines(d.headline);
  const width = ctx.w - 2 * m;
  const size = giantSize(ctx, [lines[0], lines[1]], width, Math.round((isStory(ctx) ? 300 : 320) * d.typeScale));
  const top = safeTop(ctx);
  const bottom = safeBottom(ctx);
  const eyebrowTop = top + Math.round((logoHeight(ctx) - brand.layout.label.size) / 2);
  const parts: El[] = [
    gradient(ctx, isStory(ctx) ? 0.36 : 0.42, d.bandStrength, 'top'),
    gradient(ctx, isStory(ctx) ? 0.4 : 0.46, d.bandStrength, 'bottom'),
    el('div', { position: 'absolute', top, left: m, display: 'flex' }, logoImg(ctx, {})),
    centred(ctx, eyebrowTop, undefined, [label(ctx, d.label, brand.colors.sand, d.typeScale, width - 2 * brand.layout.logoWidth - 40)]),
    centred(ctx, top + logoHeight(ctx) + 24, undefined, [giant(ctx, lines[0], size, brand.colors.cream)]),
    centred(ctx, undefined, bottom, [
      lines[1] ? giant(ctx, lines[1], size, brand.colors.cream) : spacer(0),
      spacer(22),
      line(ctx, d.line, Math.min(840, width), Math.round(brand.layout.line.size * 0.86), 'centre', 2),
    ]),
  ];
  return canvas(ctx, parts);
}

// ─── poster ──────────────────────────────────────────────────────────────────────────────────────────────────

export const PosterData = z.object({
  label: z.string().max(40),
  headline: z.string().max(60),
  footer: z.enum(['brand', 'address']).default('brand'),
  typeScale: designFields.typeScale,
});

/** Where the plate goes on a poster, as fractions of the canvas, shared with the compositor. */
export function posterPlate(ctx: Ctx): { top: number; maxHeight: number; width: number } {
  return isStory(ctx) ? { top: 0.44, maxHeight: 0.36, width: 0.92 } : { top: 0.43, maxHeight: 0.5, width: 0.86 };
}

/** The ink layer behind the plate: eyebrow, stacked Night headline, footer, all on the paper. */
export function posterLayer(ctx: Ctx, d: z.infer<typeof PosterData>): El {
  const { brand } = ctx;
  const m = brand.layout.margin;
  const lines = twoLines(d.headline);
  const width = ctx.w - 2 * m;
  const size = giantSize(ctx, [lines[0], lines[1]], width, Math.round(280 * d.typeScale));
  const top = safeTop(ctx);
  const headlineTop = top + brand.layout.label.size + 56;
  return canvas(ctx, [
    centred(ctx, top + 8, undefined, [label(ctx, d.label, brand.colors.ember, d.typeScale, width)]),
    el('div', { position: 'absolute', left: m, right: m, top: headlineTop, display: 'flex', flexDirection: 'column', alignItems: 'center' },
      lines.filter(Boolean).map((l) => giant(ctx, l, size, brand.colors.night))),
    el('div', { position: 'absolute', left: m, right: m, bottom: safeBottom(ctx), display: 'flex', justifyContent: 'center' }, footer(ctx, d.footer, true)),
  ]);
}

// ─── flat ────────────────────────────────────────────────────────────────────────────────────────────────────

export const FlatData = z.object({
  label: z.string().max(40),
  headline: z.string().max(60),
  line: z.string().max(140),
  hours: z.string().max(24).default(''),
  handle: z.string().max(40).default(''),
  typeScale: designFields.typeScale,
});

/** Where the plate goes on a flat design, as fractions; it bleeds off the bottom edge. */
export function flatPlate(ctx: Ctx): { top: number; width: number } {
  return isStory(ctx) ? { top: 0.5, width: 1.08 } : { top: 0.52, width: 1.02 };
}

function pill(ctx: Ctx, text: string, size = 30): El {
  const { brand } = ctx;
  return el('div', { display: 'flex', paddingTop: 14, paddingBottom: 14, paddingLeft: 34, paddingRight: 34, borderRadius: 999, backgroundColor: brand.colors.cream, fontFamily: brand.fonts.body.family, fontWeight: 500, fontSize: size, letterSpacing: '0.18em', color: brand.colors.night, textTransform: 'uppercase', whiteSpace: 'nowrap' }, uc(text));
}

/** The cream sticker with the hours, tilted, with a dashed ember ring. */
function badge(ctx: Ctx, hours: string): El {
  const { brand } = ctx;
  const d = isStory(ctx) ? 300 : 270;
  const [first, ...rest] = hours.split(/\s*[–-]\s*/);
  return el('div', { display: 'flex', width: d, height: d, borderRadius: d / 2, backgroundColor: brand.colors.cream, alignItems: 'center', justifyContent: 'center', transform: 'rotate(-8deg)' }, [
    el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: d - 28, height: d - 28, borderRadius: (d - 28) / 2, border: `3px dashed ${brand.colors.ember}`, fontFamily: brand.fonts.body.family, fontWeight: 500, color: brand.colors.night }, [
      el('div', { display: 'flex', fontSize: 24, letterSpacing: '0.24em' }, 'OPEN'),
      el('div', { display: 'flex', fontFamily: brand.fonts.heading.family, fontSize: rest.length ? 58 : 66, lineHeight: 1, marginTop: 8 }, uc(first ?? '')),
      ...(rest.length ? [el('div', { display: 'flex', fontSize: 26, letterSpacing: '0.12em', marginTop: 6 }, uc(`to ${rest.join(' ')}`))] : []),
    ]),
  ]);
}

/** Ember ground: pill label, cream capitals, Night subline; the plate comes under this layer, the badge over it. */
export function flatLayer(ctx: Ctx, d: z.infer<typeof FlatData>): El {
  const { brand } = ctx;
  const m = brand.layout.margin;
  const lines = twoLines(d.headline);
  const width = ctx.w - 2 * m;
  const size = giantSize(ctx, [lines[0], lines[1]], width, Math.round((isStory(ctx) ? 300 : 260) * d.typeScale));
  const top = safeTop(ctx);
  const plate = flatPlate(ctx);
  const parts: El[] = [
    centred(ctx, top, undefined, [pill(ctx, d.label)]),
    el('div', { position: 'absolute', left: m, right: m, top: top + 110, display: 'flex', flexDirection: 'column', alignItems: 'center' }, [
      ...lines.filter(Boolean).map((l) => giant(ctx, l, size, brand.colors.cream)),
      spacer(26),
      line(ctx, d.line, Math.min(820, width), Math.round(brand.layout.line.size * 0.86), 'centre', 2, brand.colors.night),
    ]),
  ];
  if (d.hours) parts.push(el('div', { position: 'absolute', right: Math.round(ctx.w * 0.06), top: Math.round(ctx.h * (plate.top + (isStory(ctx) ? 0.18 : 0.2))), display: 'flex' }, badge(ctx, d.hours)));
  parts.push(centred(ctx, undefined, safeBottom(ctx), [pill(ctx, d.handle || brand.brandLine, 26)]));
  return canvas(ctx, parts);
}

// ─── invite ──────────────────────────────────────────────────────────────────────────────────────────────────

export const InviteData = z.object({
  label: z.string().max(40),
  headline: z.string().max(60),
  line: z.string().max(140),
  /** "FRIDAY" / "08 NOV": the post's date, or nothing. */
  day: z.string().max(12).default(''),
  date: z.string().max(12).default(''),
  hours: z.string().max(24).default(''),
  address: z.string().max(80).default(''),
  website: z.string().max(60).default(''),
  textSide: designFields.textSide,
  typeScale: designFields.typeScale,
});

/** The share of the width the photo takes on an invite, from its outer edge. */
export const INVITE_PHOTO_SHARE = 0.62;

function detail(ctx: Ctx, head: string, value: string, big = true): El {
  const { brand } = ctx;
  return el('div', { display: 'flex', flexDirection: 'column', paddingLeft: 22, borderLeft: `3px solid ${brand.colors.ember}`, gap: 8 }, [
    el('div', { display: 'flex', fontFamily: brand.fonts.body.family, fontWeight: 500, fontSize: 26, letterSpacing: '0.22em', color: brand.colors.saffron }, uc(head)),
    el('div', { display: 'flex', fontFamily: big ? brand.fonts.heading.family : brand.fonts.body.family, fontWeight: big ? 400 : 500, fontSize: big ? 54 : 26, letterSpacing: big ? '0.02em' : '0.03em', lineHeight: 1.15, color: brand.colors.cream }, big ? uc(value) : value),
  ]);
}

/** Night panel on the text side, the photo off the other edge: eyebrow, italic lead-in, capitals, details. */
export function inviteLayer(ctx: Ctx, d: z.infer<typeof InviteData>): El {
  const { brand } = ctx;
  const m = brand.layout.margin;
  const side: Side = d.textSide === 'right' ? 'right' : 'left';
  const place = side === 'right' ? { right: m } : { left: m };
  const align = side === 'right' ? 'flex-end' : 'flex-start';
  const colWidth = Math.round(ctx.w * 0.52);
  const lines = twoLines(d.headline);
  const font = fontOf(brand.fontFiles.heading);
  const floor = typeFloors(ctx.w).headline;
  const main = lines[1] || lines[0];
  const lead = lines[1] ? lines[0] : '';
  const size = fitHeadline(font, [uc(main), ''], colWidth, Math.round(190 * d.typeScale), floor, 8);
  const top = safeTop(ctx);
  const details: El[] = [];
  if (d.day || d.date) details.push(detail(ctx, d.day || 'DATE', d.date || d.day));
  if (d.hours) details.push(detail(ctx, d.day || d.date ? 'FROM' : 'OPEN', d.hours));
  const rsvp: El[] = [];
  if (d.address) rsvp.push(detail(ctx, 'FIND US', d.address, false));
  if (d.website) rsvp.push(el('div', { display: 'flex', fontFamily: brand.fonts.body.family, fontWeight: 500, fontSize: 26, letterSpacing: '0.12em', color: brand.colors.sand, paddingLeft: 25 }, d.website.replace(/^https?:\/\//, '')));
  return canvas(ctx, [
    logo(ctx, side === 'right' ? 'left' : 'right'),
    el('div', { position: 'absolute', ...place, top: top + 10, width: colWidth, display: 'flex', flexDirection: 'column', alignItems: align }, [
      label(ctx, d.label, brand.colors.sand, d.typeScale, colWidth),
      spacer(Math.round(ctx.h * 0.05)),
      lead ? el('div', { display: 'flex', fontFamily: brand.fonts.heading.family, fontStyle: 'italic', fontSize: Math.round(size * 0.62), lineHeight: 1, color: brand.colors.saffron, marginBottom: 6 }, lead) : spacer(0),
      el('div', { display: 'flex', fontFamily: brand.fonts.heading.family, fontSize: size, lineHeight: 0.92, color: brand.colors.cream, whiteSpace: 'nowrap' }, uc(main)),
      spacer(26),
      line(ctx, d.line, Math.min(colWidth, 560), Math.round(brand.layout.line.size * 0.8), side, 2, brand.colors.sand),
    ]),
    el('div', { position: 'absolute', ...place, bottom: safeBottom(ctx), width: colWidth, display: 'flex', flexDirection: 'column', alignItems: align, gap: 34 }, [
      details.length ? el('div', { display: 'flex', gap: 48 }, details) : spacer(0),
      ...rsvp.length ? [el('div', { display: 'flex', flexDirection: 'column', gap: 12 }, rsvp)] : [],
    ]),
  ]);
}
