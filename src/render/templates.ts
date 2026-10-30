/**
 * The satori templates. Each one returns a transparent text layer (logo, label, headline, rule, line, footer and,
 * for layout B, the Night gradient) as PNG; compose.ts puts the photo or the cutout under it with sharp. Element
 * trees are plain objects (satori's React-less form), so no JSX is needed server side.
 *
 * Layout constants come from brand.json and match the six approved Canva samples.
 */
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { z } from 'zod';
import type { Brand } from './brand.js';
import { fitHeadline, fontOf, twoLines, wrap } from './text.js';

type El = { type: string; props: Record<string, unknown> & { children?: El | El[] | string | (El | string)[] } };
const el = (type: string, style: Record<string, unknown>, children?: El | El[] | string | (El | string)[], extra: Record<string, unknown> = {}): El =>
  ({ type, props: { style, ...extra, ...(children !== undefined ? { children } : {}) } });

export type Layout = 'A' | 'B';
export type Footer = 'brand' | 'address';

export const HeroData = z.object({
  layout: z.enum(['A', 'B']),
  label: z.string().max(40),
  headline: z.string().max(60),
  line: z.string().max(140),
  footer: z.enum(['brand', 'address']),
  busyPhoto: z.boolean().default(false),
});
export const ReviewData = z.object({ quote: z.string().max(260), reviewer: z.string().max(12), label: z.string().default('CUSTOMER LOVE'), footer: z.enum(['brand', 'address']).default('address'), hasPhoto: z.boolean().default(true) });
export const CarouselCoverData = z.object({ cover_title: z.string().max(60), label: z.string().max(40) });
export const CarouselSlideData = z.object({ title: z.string().max(80), index: z.number(), total: z.number(), hasPhoto: z.boolean().default(false), closing: z.boolean().default(false) });
export const StoryData = z.object({ label: z.string().max(40), headline: z.string().max(60) });
export const ReelCoverData = z.object({ hook: z.string().max(70), label: z.string().max(40) });
export const TextOnlyData = z.object({ label: z.string().max(40), headline: z.string().max(60), line: z.string().max(140), footer: z.enum(['brand', 'address']).default('brand') });

export interface RenderSettings { storeAddress: string; openHours: string }

interface Ctx { brand: Brand; w: number; h: number; settings: RenderSettings }

const uc = (s: string) => s.toUpperCase();

function label(ctx: Ctx, text: string, color?: string): El {
  const { brand } = ctx;
  return el('div', { display: 'flex', fontFamily: brand.fonts.body.family, fontWeight: 500, fontSize: brand.layout.label.size, letterSpacing: `${brand.layout.label.tracking}em`, color: color ?? brand.colors.saffron, textTransform: 'uppercase' }, uc(text));
}

function headline(ctx: Ctx, text: string, width = ctx.brand.layout.textColumn, italic = false, maxSize = ctx.brand.layout.headline.start): { el: El; size: number } {
  const { brand } = ctx;
  const lines = twoLines(text);
  const font = fontOf(italic && brand.fontFiles.headingItalic ? brand.fontFiles.headingItalic : brand.fontFiles.heading);
  const size = fitHeadline(font, lines, width, Math.min(maxSize, brand.layout.headline.start), brand.layout.headline.min, brand.layout.headline.step);
  return {
    size,
    el: el('div', { display: 'flex', flexDirection: 'column', fontFamily: brand.fonts.heading.family, fontStyle: italic ? 'italic' : 'normal', fontSize: size, lineHeight: brand.layout.headline.lineHeight, color: brand.colors.cream },
      lines.filter(Boolean).map((l) => el('div', { display: 'flex' }, l))),
  };
}

function rule(ctx: Ctx): El {
  const [w, h] = ctx.brand.layout.ruleSize;
  return el('div', { display: 'flex', width: w, height: h, backgroundColor: ctx.brand.colors.ember, marginTop: 28, marginBottom: 28 });
}

function line(ctx: Ctx, text: string, width = ctx.brand.layout.textColumn, size = ctx.brand.layout.line.size): El {
  const { brand } = ctx;
  const font = fontOf(brand.fontFiles.body);
  // Shrink in 2 px steps (42 → 36) before ellipsising the last line (four lines are allowed).
  let used = size;
  let lines = wrap(font, text, used, width, 99);
  while (lines.length > brand.layout.line.maxLines && used > size - 6) {
    used -= 2;
    lines = wrap(font, text, used, width, 99);
  }
  lines = wrap(font, text, used, width, brand.layout.line.maxLines);
  return el('div', { display: 'flex', flexDirection: 'column', fontFamily: brand.fonts.body.family, fontWeight: 500, fontSize: used, lineHeight: 1.28, color: brand.colors.cream }, lines.map((l) => el('div', { display: 'flex' }, l)));
}

function footer(ctx: Ctx, kind: Footer): El {
  const { brand } = ctx;
  const base = { fontFamily: brand.fonts.body.family, fontWeight: 500, fontSize: brand.layout.footer.size, letterSpacing: `${brand.layout.footer.tracking}em`, color: brand.colors.sand, textTransform: 'uppercase' as const };
  if (kind === 'address') {
    return el('div', { display: 'flex', flexDirection: 'column', gap: 10, ...base }, [
      el('div', { display: 'flex' }, uc(ctx.settings.storeAddress)),
      el('div', { display: 'flex' }, uc(`OPEN ${ctx.settings.openHours}`)),
    ]);
  }
  return el('div', { display: 'flex', flexDirection: 'column', gap: 18, ...base }, [
    el('div', { display: 'flex', alignItems: 'center', gap: 16, width: 360 }, [
      el('div', { display: 'flex', flexGrow: 1, height: 1, backgroundColor: brand.colors.sand, opacity: 0.7 }),
      el('div', { display: 'flex', width: 10, height: 10, backgroundColor: brand.colors.sand, transform: 'rotate(45deg)' }),
      el('div', { display: 'flex', flexGrow: 1, height: 1, backgroundColor: brand.colors.sand, opacity: 0.7 }),
    ]),
    el('div', { display: 'flex' }, brand.brandLine),
  ]);
}

function logo(ctx: Ctx): El {
  const { brand } = ctx;
  const ratio = 200 / 272; // logo.png is 272×200
  return el('img', { position: 'absolute', top: brand.layout.margin, left: brand.layout.margin, width: brand.layout.logoWidth, height: Math.round(brand.layout.logoWidth * ratio) }, undefined,
    { src: `data:image/png;base64,${brand.logoPng.toString('base64')}` });
}

/** Bottom-to-top gradient from opaque Night to transparent over the lower `fraction` of the canvas (layout B). */
function gradient(ctx: Ctx, fraction = 0.45): El {
  return el('div', { position: 'absolute', left: 0, right: 0, bottom: 0, height: Math.round(ctx.h * fraction), backgroundImage: `linear-gradient(to top, ${ctx.brand.colors.night} 0%, ${ctx.brand.colors.night} 32%, ${ctx.brand.colors.night}F2 52%, ${ctx.brand.colors.night}B3 74%, ${ctx.brand.colors.night}00 100%)` });
}

function canvas(ctx: Ctx, children: (El | string)[], background = 'transparent'): El {
  return el('div', { display: 'flex', position: 'relative', width: ctx.w, height: ctx.h, backgroundColor: background }, children);
}

/** Text column on the left, between 35% and 70% of the height, 60 px margin. */
function column(ctx: Ctx, children: El[], top = 0.35, bottom = 0.30, justify: 'center' | 'flex-end' = 'center'): El {
  const { brand } = ctx;
  return el('div', { position: 'absolute', left: brand.layout.margin, top: Math.round(ctx.h * top), bottom: Math.round(ctx.h * bottom), width: brand.layout.textColumn, display: 'flex', flexDirection: 'column', justifyContent: justify }, children);
}

function footerBox(ctx: Ctx, kind: Footer): El {
  return el('div', { position: 'absolute', left: ctx.brand.layout.margin, bottom: ctx.brand.layout.margin, display: 'flex' }, footer(ctx, kind));
}

// ─── the templates ─────────────────────────────────────────────────────────────────────────────────────────

export function heroLayer(ctx: Ctx, d: z.infer<typeof HeroData>): El {
  const parts: (El | string)[] = [];
  // Layout B: the text block sits in the lower 40% over a gradient that is opaque under it, so the food above
  // keeps its light; the headline is capped a little smaller than layout A's to leave room for three body lines.
  if (d.layout === 'B') parts.push(gradient(ctx, 0.66));
  parts.push(logo(ctx));
  const h = headline(ctx, d.headline, ctx.brand.layout.textColumn, false, d.layout === 'B' ? 128 : undefined);
  const textTop = d.layout === 'B' ? 0.44 : 0.26;
  const textBottom = d.layout === 'B' ? 0.115 : 0.24;
  parts.push(column(ctx, [
    label(ctx, d.label, d.busyPhoto || d.layout === 'B' ? ctx.brand.colors.sand : ctx.brand.colors.saffron),
    el('div', { display: 'flex', height: 18 }),
    h.el,
    rule(ctx),
    line(ctx, d.line),
  ], textTop, textBottom, d.layout === 'B' ? 'flex-end' : 'center'));
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
  if (d.hasPhoto) parts.push(gradient(ctx, 0.62));
  parts.push(logo(ctx));
  parts.push(el('div', { position: 'absolute', left: brand.layout.margin, right: brand.layout.margin, top: d.hasPhoto ? Math.round(ctx.h * 0.46) : Math.round(ctx.h * 0.30), display: 'flex', flexDirection: 'column' }, [
    label(ctx, d.label),
    el('div', { display: 'flex', height: 22 }),
    el('div', { display: 'flex', flexDirection: 'column', fontFamily: brand.fonts.heading.family, fontStyle: 'italic', fontSize: size, lineHeight: 1.1, color: brand.colors.cream }, lines.map((l) => el('div', { display: 'flex' }, l))),
    el('div', { display: 'flex', height: 26 }),
    el('div', { display: 'flex', fontFamily: brand.fonts.body.family, fontSize: 30, letterSpacing: '0.2em', color: brand.colors.sand }, `— ${d.reviewer.toUpperCase()}`),
  ]));
  parts.push(footerBox(ctx, d.footer));
  return canvas(ctx, parts, d.hasPhoto ? 'transparent' : brand.colors.night);
}

export function carouselCoverLayer(ctx: Ctx, d: z.infer<typeof CarouselCoverData>): El {
  const parts: (El | string)[] = [gradient(ctx, 0.55), logo(ctx)];
  const h = headline(ctx, d.cover_title, 760);
  parts.push(el('div', { position: 'absolute', left: ctx.brand.layout.margin, right: ctx.brand.layout.margin, bottom: Math.round(ctx.h * 0.16), display: 'flex', flexDirection: 'column' }, [
    label(ctx, d.label, ctx.brand.colors.sand), el('div', { display: 'flex', height: 18 }), h.el, rule(ctx),
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
    el('div', { display: 'flex', height: 26 }),
    el('div', { display: 'flex', flexDirection: 'column', fontFamily: brand.fonts.heading.family, fontSize: 100, lineHeight: 1.0, color: brand.colors.cream }, lines.map((l) => el('div', { display: 'flex' }, l))),
    rule(ctx),
  ]);
  return canvas(ctx, [logo(ctx), card, footerBox(ctx, 'brand')], d.hasPhoto ? 'transparent' : brand.colors.night);
}

export function storyLayer(ctx: Ctx, d: z.infer<typeof StoryData>): El {
  const { brand } = ctx;
  const h = headline(ctx, d.headline, 760);
  return canvas(ctx, [
    gradient(ctx, 0.5),
    el('div', { position: 'absolute', top: brand.layout.storySafeTop + 20, left: brand.layout.margin, display: 'flex' }, el('img', { width: brand.layout.logoWidth, height: Math.round(brand.layout.logoWidth * 200 / 272) }, undefined, { src: `data:image/png;base64,${brand.logoPng.toString('base64')}` })),
    el('div', { position: 'absolute', left: brand.layout.margin, right: brand.layout.margin, bottom: brand.layout.storySafeBottom + 40, display: 'flex', flexDirection: 'column' }, [
      label(ctx, d.label, brand.colors.sand), el('div', { display: 'flex', height: 18 }), h.el, rule(ctx),
      el('div', { display: 'flex', fontFamily: brand.fonts.body.family, fontWeight: 500, fontSize: 28, letterSpacing: '0.2em', color: brand.colors.sand }, brand.brandLine),
    ]),
  ]);
}

export function reelCoverLayer(ctx: Ctx, d: z.infer<typeof ReelCoverData>): El {
  const { brand } = ctx;
  const h = headline(ctx, d.hook, 820);
  return canvas(ctx, [
    gradient(ctx, 0.55), logo(ctx),
    el('div', { position: 'absolute', left: brand.layout.margin, right: brand.layout.margin, bottom: Math.round(ctx.h * 0.17), display: 'flex', flexDirection: 'column' }, [
      label(ctx, d.label, brand.colors.sand), el('div', { display: 'flex', height: 18 }), h.el, rule(ctx),
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
      label(ctx, d.label), el('div', { display: 'flex', height: 18 }), h.el, rule(ctx), line(ctx, d.line, 820),
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
