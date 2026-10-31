/**
 * The satori templates. Each one returns a transparent text layer (logo, label, headline, rule, line, footer and,
 * for layout B, the Night gradient) as PNG; compose.ts puts the photo or the cutout under it with sharp. Element
 * trees are plain objects (satori's React-less form), so no JSX is needed server side.
 *
 * Layout constants come from brand.json and match the six approved Canva samples. The design spec (art director
 * or heuristic) moves the text block (top/bottom, left/right), sets the band strength and scales the type; the
 * legibility floors (legibility.ts) stop any scale from making the type unreadable on a phone.
 */
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { z } from 'zod';
import type { Brand } from './brand.js';
import { typeFloors } from './legibility.js';
import { fitHeadline, fontOf, measure, twoLines, wrap } from './text.js';

type El = { type: string; props: Record<string, unknown> & { children?: El | El[] | string | (El | string)[] } };
export const el = (type: string, style: Record<string, unknown>, children?: El | El[] | string | (El | string)[], extra: Record<string, unknown> = {}): El =>
  ({ type, props: { style, ...extra, ...(children !== undefined ? { children } : {}) } });

export type Layout = 'A' | 'B';
export type Footer = 'brand' | 'address';
export type Side = 'left' | 'right' | 'centre';
export type Position = 'top' | 'bottom';

export const designFields = {
  textPosition: z.enum(['bottom', 'top']).default('bottom'),
  textSide: z.enum(['left', 'right']).default('left'),
  bandStrength: z.number().min(0).max(1).default(1),
  typeScale: z.number().min(0.8).max(1.4).default(1),
  /** The first headline line as an italic saffron lead-in. */
  accentWord: z.boolean().default(false),
};

export const HeroData = z.object({
  layout: z.enum(['A', 'B']),
  label: z.string().max(40),
  headline: z.string().max(60),
  line: z.string().max(140),
  footer: z.enum(['brand', 'address']),
  busyPhoto: z.boolean().default(false),
  ...designFields,
});
export const ReviewData = z.object({ quote: z.string().max(260), reviewer: z.string().max(12), label: z.string().default('CUSTOMER LOVE'), footer: z.enum(['brand', 'address']).default('address'), hasPhoto: z.boolean().default(true), bandStrength: designFields.bandStrength });
export const CarouselCoverData = z.object({ cover_title: z.string().max(60), label: z.string().max(40), bandStrength: designFields.bandStrength });
export const CarouselSlideData = z.object({ title: z.string().max(80), index: z.number(), total: z.number(), hasPhoto: z.boolean().default(false), closing: z.boolean().default(false) });
export const StoryData = z.object({ label: z.string().max(40), headline: z.string().max(60), ...designFields });
export const ReelCoverData = z.object({ hook: z.string().max(70), label: z.string().max(40), bandStrength: designFields.bandStrength });
export const TextOnlyData = z.object({ label: z.string().max(40), headline: z.string().max(60), line: z.string().max(140), footer: z.enum(['brand', 'address']).default('brand') });

export interface RenderSettings { storeAddress: string; openHours: string; handle?: string | null; website?: string | null }

interface Ctx { brand: Brand; w: number; h: number; settings: RenderSettings }

export const uc = (s: string) => s.toUpperCase();
export const alignItems = (side: Side) => (side === 'right' ? 'flex-end' : side === 'centre' ? 'center' : 'flex-start');
const LOGO_RATIO = 200 / 272; // logo.png is 272×200

export function label(ctx: Ctx, text: string, color?: string, scale = 1, width = ctx.brand.layout.textColumn): El {
  const { brand } = ctx;
  const floor = typeFloors(ctx.w).label;
  const font = fontOf(brand.fontFiles.bodyMedium ?? brand.fontFiles.body);
  // A label never wraps: it shrinks (never under the phone floor) until it fits the column.
  let size = Math.max(floor, Math.round(brand.layout.label.size * scale));
  while (size > floor && measure(font, uc(text), size, brand.layout.label.tracking) > width) size -= 1;
  return el('div', { display: 'flex', whiteSpace: 'nowrap', fontFamily: brand.fonts.body.family, fontWeight: 500, fontSize: size, letterSpacing: `${brand.layout.label.tracking}em`, color: color ?? brand.colors.saffron, textTransform: 'uppercase' }, uc(text));
}

export const ACCENT_RATIO = 0.64;

/**
 * The two-line headline, fitted to `width`. With `accent` the first line becomes an italic saffron lead-in at
 * ACCENT_RATIO of the size (the "Time to / Savour the flavours" idea from the owner's references), so only the
 * second line decides the size.
 */
export function headline(ctx: Ctx, text: string, width = ctx.brand.layout.textColumn, italic = false, maxSize = ctx.brand.layout.headline.start, scale = 1, side: Side = 'left', accent = false): { el: El; size: number } {
  const { brand } = ctx;
  const lines = twoLines(text);
  const font = fontOf(italic && brand.fontFiles.headingItalic ? brand.fontFiles.headingItalic : brand.fontFiles.heading);
  const start = Math.round(Math.min(maxSize, brand.layout.headline.start) * scale);
  const min = Math.max(typeFloors(ctx.w).headline, Math.min(brand.layout.headline.min, start));
  const useAccent = accent && Boolean(lines[1]);
  // With a lead-in, the main line may itself need two lines when it will not fit at the smallest size.
  const mainLines: [string, string] = useAccent && measure(font, lines[1], min) > width ? twoLines(lines[1]) : [lines[1], ''];
  const size = useAccent ? fitHeadline(font, mainLines, width, start, min, brand.layout.headline.step) : fitHeadline(font, lines, width, start, min, brand.layout.headline.step);
  const common = { display: 'flex', flexDirection: 'column', alignItems: alignItems(side), fontFamily: brand.fonts.heading.family, fontStyle: italic ? 'italic' : 'normal', fontSize: size, lineHeight: brand.layout.headline.lineHeight, color: brand.colors.cream };
  if (useAccent) {
    const accentSize = Math.round(size * ACCENT_RATIO);
    return {
      size,
      el: el('div', common, [
        el('div', { display: 'flex', fontStyle: 'italic', fontSize: accentSize, lineHeight: 1.0, color: brand.colors.saffron, marginBottom: Math.round(size * 0.04) }, lines[0]),
        ...mainLines.filter(Boolean).map((l) => el('div', { display: 'flex' }, l)),
      ]),
    };
  }
  return { size, el: el('div', common, lines.filter(Boolean).map((l) => el('div', { display: 'flex' }, l))) };
}

export function rule(ctx: Ctx): El {
  const [w, h] = ctx.brand.layout.ruleSize;
  return el('div', { display: 'flex', width: w, height: h, backgroundColor: ctx.brand.colors.ember, marginTop: 28, marginBottom: 28 });
}

export function line(ctx: Ctx, text: string, width = ctx.brand.layout.textColumn, size = ctx.brand.layout.line.size, side: Side = 'left', maxLines = ctx.brand.layout.line.maxLines, color = ctx.brand.colors.cream): El {
  const { brand } = ctx;
  const font = fontOf(brand.fontFiles.body);
  // Shrink in 2 px steps (at most 6 px, never under the phone floor) before ellipsising the last line.
  const floor = Math.max(size - 6, typeFloors(ctx.w).line);
  let used = Math.max(size, typeFloors(ctx.w).line);
  let lines = wrap(font, text, used, width, 99);
  while (lines.length > maxLines && used - 2 >= floor) {
    used -= 2;
    lines = wrap(font, text, used, width, 99);
  }
  lines = wrap(font, text, used, width, maxLines);
  return el('div', { display: 'flex', flexDirection: 'column', alignItems: alignItems(side), fontFamily: brand.fonts.body.family, fontWeight: 500, fontSize: used, lineHeight: 1.28, color }, lines.map((l) => el('div', { display: 'flex' }, l)));
}

/** The footer; `ink` colours it for a light ground (Night text, poster style). */
export function footer(ctx: Ctx, kind: Footer, ink = false): El {
  const { brand } = ctx;
  const color = ink ? brand.colors.night : brand.colors.sand;
  const base = { fontFamily: brand.fonts.body.family, fontWeight: 500, fontSize: brand.layout.footer.size, letterSpacing: `${brand.layout.footer.tracking}em`, color, textTransform: 'uppercase' as const };
  if (kind === 'address') {
    return el('div', { display: 'flex', flexDirection: 'column', gap: 10, ...base }, [
      el('div', { display: 'flex' }, uc(ctx.settings.storeAddress)),
      el('div', { display: 'flex' }, uc(`OPEN ${ctx.settings.openHours}`)),
    ]);
  }
  return el('div', { display: 'flex', flexDirection: 'column', gap: 18, ...base }, [
    el('div', { display: 'flex', alignItems: 'center', gap: 16, width: 360 }, [
      el('div', { display: 'flex', flexGrow: 1, height: 1, backgroundColor: color, opacity: 0.7 }),
      el('div', { display: 'flex', width: 10, height: 10, backgroundColor: color, transform: 'rotate(45deg)' }),
      el('div', { display: 'flex', flexGrow: 1, height: 1, backgroundColor: color, opacity: 0.7 }),
    ]),
    el('div', { display: 'flex' }, brand.brandLine),
  ]);
}

export function logoImg(ctx: Ctx, style: Record<string, unknown>): El {
  const { brand } = ctx;
  return el('img', { width: brand.layout.logoWidth, height: Math.round(brand.layout.logoWidth * LOGO_RATIO), ...style }, undefined,
    { src: `data:image/png;base64,${brand.logoPng.toString('base64')}` });
}

/** The logo in a top corner: left by default, right when the text block takes the top-left. */
export function logo(ctx: Ctx, corner: Side = 'left'): El {
  const m = ctx.brand.layout.margin;
  return logoImg(ctx, corner === 'right' ? { position: 'absolute', top: m, right: m } : { position: 'absolute', top: m, left: m });
}

export function logoHeight(ctx: Ctx): number {
  return Math.round(ctx.brand.layout.logoWidth * LOGO_RATIO);
}

/**
 * The Night band under the text: opaque Night at the edge fading to clear over `fraction` of the canvas, scaled by
 * `strength` (1 = the house band; the legibility maths raises it when the photo under the text is bright).
 */
export function gradient(ctx: Ctx, fraction = 0.45, strength = 1, from: Position = 'bottom'): El {
  const night = ctx.brand.colors.night;
  const alpha = (a: number) => `${night}${Math.round(Math.min(1, a * strength) * 255).toString(16).padStart(2, '0').toUpperCase()}`;
  const stops = `${alpha(1)} 0%, ${alpha(1)} 32%, ${alpha(0.95)} 52%, ${alpha(0.7)} 74%, ${alpha(0)} 100%`;
  const anchor = from === 'bottom' ? { bottom: 0, backgroundImage: `linear-gradient(to top, ${stops})` } : { top: 0, backgroundImage: `linear-gradient(to bottom, ${stops})` };
  return el('div', { position: 'absolute', left: 0, right: 0, height: Math.round(ctx.h * fraction), ...anchor });
}

export function canvas(ctx: Ctx, children: (El | string)[], background = 'transparent'): El {
  return el('div', { display: 'flex', position: 'relative', width: ctx.w, height: ctx.h, backgroundColor: background }, children);
}

/** The text column on one side, between `top` and `bottom` of the height, 60 px margin. */
export function column(ctx: Ctx, children: El[], top = 0.35, bottom = 0.30, justify: 'center' | 'flex-end' | 'flex-start' = 'center', side: Side = 'left'): El {
  const { brand } = ctx;
  const place = side === 'right' ? { right: brand.layout.margin } : { left: brand.layout.margin };
  return el('div', { position: 'absolute', ...place, top: Math.round(ctx.h * top), bottom: Math.round(ctx.h * bottom), width: brand.layout.textColumn, display: 'flex', flexDirection: 'column', justifyContent: justify, alignItems: alignItems(side) }, children);
}

export function footerBox(ctx: Ctx, kind: Footer, ink = false): El {
  return el('div', { position: 'absolute', left: ctx.brand.layout.margin, bottom: ctx.brand.layout.margin, display: 'flex' }, footer(ctx, kind, ink));
}

export const spacer = (h: number): El => el('div', { display: 'flex', height: h });

// ─── the templates ─────────────────────────────────────────────────────────────────────────────────────────

export function heroLayer(ctx: Ctx, d: z.infer<typeof HeroData>): El {
  const { brand } = ctx;
  const parts: (El | string)[] = [];
  const atTop = d.layout === 'B' && d.textPosition === 'top';
  const side = d.textSide;
  // Layout B: the text block sits over a band that is opaque under it, so the food keeps its light; the headline
  // is capped a little smaller than layout A's to leave room for three body lines. With the text at the top the
  // band comes down from the top edge and a soft second band keeps the footer readable.
  if (d.layout === 'B') {
    if (atTop) {
      parts.push(gradient(ctx, 0.6, d.bandStrength, 'top'));
      parts.push(gradient(ctx, 0.22, Math.min(1, d.bandStrength), 'bottom'));
    } else parts.push(gradient(ctx, 0.66, d.bandStrength, 'bottom'));
  }
  // The logo takes the top corner the text block doesn't.
  parts.push(logo(ctx, atTop && side === 'left' ? 'right' : 'left'));
  const h = headline(ctx, d.headline, brand.layout.textColumn, false, d.layout === 'B' ? 128 : undefined, d.typeScale, side, d.accentWord);
  const belowLogo = (brand.layout.margin + logoHeight(ctx) + 40) / ctx.h;
  const textTop = d.layout === 'A' ? 0.26 : atTop ? belowLogo : 0.44;
  const textBottom = d.layout === 'A' ? 0.24 : atTop ? 0.36 : 0.115;
  const justify = d.layout === 'A' ? 'center' : atTop ? 'flex-start' : 'flex-end';
  parts.push(column(ctx, [
    label(ctx, d.label, d.busyPhoto || d.layout === 'B' ? brand.colors.sand : brand.colors.saffron, d.typeScale),
    spacer(18),
    h.el,
    rule(ctx),
    line(ctx, d.line, brand.layout.textColumn, Math.round(brand.layout.line.size * d.typeScale), side, atTop ? 3 : brand.layout.line.maxLines),
  ], textTop, textBottom, justify, side));
  parts.push(footerBox(ctx, d.footer));
  return canvas(ctx, parts);
}

export function reviewLayer(ctx: Ctx, d: z.infer<typeof ReviewData>): El {
  const { brand } = ctx;
  const quoteFont = fontOf(brand.fontFiles.headingItalic ?? brand.fontFiles.heading);
  let size = 72;
  let lines = wrap(quoteFont, `“${d.quote}”`, size, 680, 6);
  while (lines.length > 5 && size > 40) {
    size -= 4;
    lines = wrap(quoteFont, `“${d.quote}”`, size, 680, 6);
  }
  const parts: (El | string)[] = [];
  if (d.hasPhoto) parts.push(gradient(ctx, 0.62, d.bandStrength));
  parts.push(logo(ctx));
  parts.push(el('div', { position: 'absolute', left: brand.layout.margin, right: brand.layout.margin, top: d.hasPhoto ? Math.round(ctx.h * 0.46) : Math.round(ctx.h * 0.30), display: 'flex', flexDirection: 'column' }, [
    label(ctx, d.label),
    spacer(22),
    el('div', { display: 'flex', flexDirection: 'column', fontFamily: brand.fonts.heading.family, fontStyle: 'italic', fontSize: size, lineHeight: 1.1, color: brand.colors.cream }, lines.map((l) => el('div', { display: 'flex' }, l))),
    spacer(26),
    el('div', { display: 'flex', fontFamily: brand.fonts.body.family, fontSize: 30, letterSpacing: '0.2em', color: brand.colors.sand }, `— ${d.reviewer.toUpperCase()}`),
  ]));
  parts.push(footerBox(ctx, d.footer));
  return canvas(ctx, parts, d.hasPhoto ? 'transparent' : brand.colors.night);
}

export function carouselCoverLayer(ctx: Ctx, d: z.infer<typeof CarouselCoverData>): El {
  const parts: (El | string)[] = [gradient(ctx, 0.55, d.bandStrength), logo(ctx)];
  const h = headline(ctx, d.cover_title, 760);
  parts.push(el('div', { position: 'absolute', left: ctx.brand.layout.margin, right: ctx.brand.layout.margin, bottom: Math.round(ctx.h * 0.16), display: 'flex', flexDirection: 'column' }, [
    label(ctx, d.label, ctx.brand.colors.sand), spacer(18), h.el, rule(ctx),
    el('div', { display: 'flex', fontFamily: ctx.brand.fonts.body.family, fontSize: 28, color: ctx.brand.colors.sand, letterSpacing: '0.1em' }, 'SWIPE  →'),
  ]));
  parts.push(footerBox(ctx, 'brand'));
  return canvas(ctx, parts);
}

export function carouselSlideLayer(ctx: Ctx, d: z.infer<typeof CarouselSlideData>): El {
  const { brand } = ctx;
  const titleFont = fontOf(brand.fontFiles.heading);
  const lines = wrap(titleFont, d.title, 100, 820, 3);
  const card = el('div', { position: 'absolute', left: 60, right: 60, top: d.hasPhoto ? Math.round(ctx.h * 0.52) : 160, bottom: 160, display: 'flex', flexDirection: 'column', justifyContent: d.hasPhoto ? 'flex-end' : 'center', padding: 70, borderRadius: 28, backgroundColor: d.hasPhoto ? `${brand.colors.charcoal}E6` : brand.colors.charcoal }, [
    el('div', { display: 'flex', fontFamily: brand.fonts.body.family, fontSize: 24, letterSpacing: '0.3em', color: brand.colors.saffron }, d.closing ? 'FUADIJAN' : `${d.index} / ${d.total}`),
    spacer(26),
    el('div', { display: 'flex', flexDirection: 'column', fontFamily: brand.fonts.heading.family, fontSize: 100, lineHeight: 1.0, color: brand.colors.cream }, lines.map((l) => el('div', { display: 'flex' }, l))),
    rule(ctx),
  ]);
  return canvas(ctx, [logo(ctx), card, footerBox(ctx, 'brand')], d.hasPhoto ? 'transparent' : brand.colors.night);
}

export function storyLayer(ctx: Ctx, d: z.infer<typeof StoryData>): El {
  const { brand } = ctx;
  const atTop = d.textPosition === 'top';
  const h = headline(ctx, d.headline, 760, false, undefined, d.typeScale, 'left', d.accentWord);
  const logoTop = brand.layout.storySafeTop + 20;
  const block = [
    label(ctx, d.label, brand.colors.sand, d.typeScale), spacer(18), h.el, rule(ctx),
    el('div', { display: 'flex', fontFamily: brand.fonts.body.family, fontWeight: 500, fontSize: 28, letterSpacing: '0.2em', color: brand.colors.sand }, brand.brandLine),
  ];
  return canvas(ctx, [
    gradient(ctx, atTop ? 0.55 : 0.5, d.bandStrength, atTop ? 'top' : 'bottom'),
    el('div', { position: 'absolute', top: logoTop, left: brand.layout.margin, display: 'flex' }, logoImg(ctx, {})),
    atTop
      ? el('div', { position: 'absolute', left: brand.layout.margin, right: brand.layout.margin, top: logoTop + logoHeight(ctx) + 60, display: 'flex', flexDirection: 'column' }, block)
      : el('div', { position: 'absolute', left: brand.layout.margin, right: brand.layout.margin, bottom: brand.layout.storySafeBottom + 40, display: 'flex', flexDirection: 'column' }, block),
  ]);
}

export function reelCoverLayer(ctx: Ctx, d: z.infer<typeof ReelCoverData>): El {
  const { brand } = ctx;
  const h = headline(ctx, d.hook, 820);
  return canvas(ctx, [
    gradient(ctx, 0.55, d.bandStrength), logo(ctx),
    el('div', { position: 'absolute', left: brand.layout.margin, right: brand.layout.margin, bottom: Math.round(ctx.h * 0.17), display: 'flex', flexDirection: 'column' }, [
      label(ctx, d.label, brand.colors.sand), spacer(18), h.el, rule(ctx),
      el('div', { display: 'flex', alignItems: 'center', gap: 14, fontFamily: brand.fonts.body.family, fontSize: 26, color: brand.colors.cream }, [
        el('div', { display: 'flex', width: 54, height: 54, borderRadius: 27, border: `2px solid ${brand.colors.cream}`, alignItems: 'center', justifyContent: 'center' }, '▶'),
        'Watch',
      ]),
    ]),
    footerBox(ctx, 'brand'),
  ]);
}

export function textOnlyLayer(ctx: Ctx, d: z.infer<typeof TextOnlyData>): El {
  const { brand } = ctx;
  const h = headline(ctx, d.headline, 820);
  return canvas(ctx, [
    // A soft Charcoal radial glow on Night.
    el('div', { position: 'absolute', left: -200, top: -100, width: ctx.w + 400, height: ctx.h + 200, backgroundImage: `radial-gradient(circle at 65% 40%, ${brand.colors.charcoal} 0%, ${brand.colors.night} 60%)` }),
    el('div', { position: 'absolute', left: 0, top: 0, width: ctx.w, height: ctx.h, backgroundImage: `radial-gradient(circle at 70% 35%, ${brand.colors.ember}1F 0%, ${brand.colors.ember}00 45%)` }),
    logo(ctx),
    el('div', { position: 'absolute', left: brand.layout.margin, right: brand.layout.margin, top: Math.round(ctx.h * 0.36), display: 'flex', flexDirection: 'column' }, [
      label(ctx, d.label), spacer(18), h.el, rule(ctx), line(ctx, d.line, 820),
    ]),
    footerBox(ctx, d.footer),
  ], brand.colors.night);
}

// ─── rendering ─────────────────────────────────────────────────────────────────────────────────────────────

export async function layerToPng(brand: Brand, tree: El, w: number, h: number): Promise<Buffer> {
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
    width: w, height: h,
    fonts: brand.satoriFonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: f.style })),
  });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: w } }).render().asPng();
  return Buffer.from(png);
}

export function makeCtx(brand: Brand, w: number, h: number, settings: RenderSettings): Ctx {
  return { brand, w, h, settings };
}

export type { Ctx, El };
