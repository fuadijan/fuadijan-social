/**
 * The six occasion looks, which only the owner picks (styles.ts has their cards):
 *  arch       Night, the photo in an arched window with a saffron outline, the greeting centred under it
 *  countdown  a Night panel with a giant count of the days left, the photo fading off the right
 *  ribbon     the house band design with a ribbon across the top-right corner
 *  jaali      a lattice ground in a double saffron frame, the photo in a small round window, all centred
 *  deal       the house band design with a round price sticker in the top-right corner
 *  menu       Night, a list of dishes with dotted leaders and prices, a strip of the photo along the bottom
 * They reuse the kit helpers (label, headline, rule, line, logo) so type, floors and colours stay the kit's; the
 * compositions at the end put the photo where each look needs it.
 */
import sharp, { type OverlayOptions } from 'sharp';
import { z } from 'zod';
import type { Brand } from './brand.js';
import { liftTone, nightBackground } from './compose.js';
import { typeFloors } from './legibility.js';
import { isStory, safeBottom, safeTop } from './styled.js';
import { fitHeadline, fontOf, measure } from './text.js';
import {
  canvas, designFields, el, headline, label, line, logoHeight, logoImg, rule, spacer, uc,
  type Ctx, type El, type Side,
} from './templates.js';

type Lift = boolean | 'auto';
const lifted = (jpeg: Buffer, lift: Lift): Promise<Buffer> => (lift === 'auto' ? liftTone(jpeg) : lift ? liftTone(jpeg, true) : Promise.resolve(jpeg));

/** Small tracked capitals: the unit under a count, the word over a price, a ribbon. */
function caps(ctx: Ctx, text: string, size: number, color: string, tracking = 0.22): El {
  return el('div', { display: 'flex', whiteSpace: 'nowrap', fontFamily: ctx.brand.fonts.body.family, fontWeight: 500, fontSize: size, letterSpacing: `${tracking}em`, color }, uc(text));
}

/** The brand line, centred at the bottom safe margin. */
function brandLineBottom(ctx: Ctx, inset = 0): El {
  const { brand } = ctx;
  return el('div', { position: 'absolute', left: brand.layout.margin, right: brand.layout.margin, bottom: safeBottom(ctx) + inset, display: 'flex', justifyContent: 'center' }, caps(ctx, brand.brandLine, 26, brand.colors.sand, 0.2));
}

const common = { label: z.string().max(40), headline: z.string().max(80), line: z.string().max(140), typeScale: designFields.typeScale, accentWord: designFields.accentWord, accentColor: designFields.accentColor };

/** The headline with the owner's italic lead-in, if any. */
const title = (ctx: Ctx, d: { headline: string; typeScale: number; accentWord: boolean; accentColor: 'saffron' | 'ember' }, width: number, max: number, side: Side) =>
  headline(ctx, d.headline, width, false, max, d.typeScale, side, d.accentWord, ctx.brand.colors[d.accentColor]);

// ─── arch ────────────────────────────────────────────────────────────────────────────────────────────────────

export const ArchData = z.object(common);

const ARCH_GAP = 16;

/** The arched window, in pixels; it starts low enough for its round top to clear the logo in the corner. */
export function archWindow(ctx: Ctx): { left: number; top: number; width: number; height: number } {
  const story = isStory(ctx);
  const width = Math.round(ctx.w * (story ? 0.6 : 0.5));
  const height = Math.round(ctx.h * (story ? 0.44 : 0.46));
  const top = story ? safeTop(ctx) + 110 : ctx.brand.layout.margin + 40;
  return { left: Math.round((ctx.w - width) / 2), top, width, height };
}

export function archLayer(ctx: Ctx, d: z.infer<typeof ArchData>): El {
  const { brand } = ctx;
  const m = brand.layout.margin;
  const a = archWindow(ctx);
  const ow = a.width + 2 * ARCH_GAP;
  const width = ctx.w - 2 * m;
  const h = title(ctx, d, width, isStory(ctx) ? 130 : 100, 'centre');
  return canvas(ctx, [
    el('div', { position: 'absolute', left: a.left - ARCH_GAP, top: a.top - ARCH_GAP, width: ow, height: a.height + 2 * ARCH_GAP, borderTopLeftRadius: ow / 2, borderTopRightRadius: ow / 2, border: `3px solid ${brand.colors.saffron}`, display: 'flex' }),
    // A small diamond over the apex, like a finial.
    el('div', { position: 'absolute', left: ctx.w / 2 - 9, top: a.top - ARCH_GAP - 32, width: 18, height: 18, backgroundColor: brand.colors.saffron, transform: 'rotate(45deg)', display: 'flex' }),
    el('div', { position: 'absolute', top: safeTop(ctx), left: m, display: 'flex' }, logoImg(ctx, {})),
    el('div', { position: 'absolute', left: m, right: m, top: a.top + a.height + ARCH_GAP + (isStory(ctx) ? 56 : 38), display: 'flex', flexDirection: 'column', alignItems: 'center' }, [
      label(ctx, d.label, brand.colors.saffron, d.typeScale, width),
      spacer(16),
      h.el,
      rule(ctx),
      line(ctx, d.line, Math.min(840, width), Math.round(brand.layout.line.size * 0.9), 'centre', 2, brand.colors.sand),
    ]),
    brandLineBottom(ctx),
  ]);
}

// ─── countdown ───────────────────────────────────────────────────────────────────────────────────────────────

export const CountdownData = z.object({
  ...common,
  /** "3", "TODAY", "SOON": the big word in saffron. */
  count: z.string().max(12),
  /** Under the count: DAYS TO GO, or the owner's words. */
  unit: z.string().max(24).default(''),
  /** The big day, "SATURDAY 14 NOV", at the bottom. */
  when: z.string().max(24).default(''),
  /** The panel's side; the photo fades off the other edge. */
  textSide: designFields.textSide,
});

/** The share of the width the photo takes on a countdown, from the right edge. */
export const COUNTDOWN_PHOTO_SHARE = 0.52;

/** The count and the words under it, from the big day and the day the post goes up. */
export function countdownFor(bigDay: string | null | undefined, postDate: string | null | undefined, words: string): { count: string; unit: string } {
  const day = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) : null);
  const big = day(bigDay);
  const post = day(postDate);
  if (big === null || post === null) return { count: 'SOON', unit: words };
  const n = Math.round((big - post) / 86_400_000);
  if (n > 1) return { count: String(n), unit: words || 'DAYS TO GO' };
  if (n === 1) return { count: '1', unit: words || 'DAY TO GO' };
  if (n === 0) return { count: 'TODAY', unit: words || "IT'S HERE" };
  return { count: 'NOW ON', unit: words };
}

export function countdownLayer(ctx: Ctx, d: z.infer<typeof CountdownData>): El {
  const { brand } = ctx;
  const m = brand.layout.margin;
  const story = isStory(ctx);
  const colWidth = Math.round(ctx.w * 0.5);
  const font = fontOf(brand.fontFiles.heading);
  const countSize = fitHeadline(font, [uc(d.count), ''], colWidth, Math.round((story ? 360 : 300) * d.typeScale), typeFloors(ctx.w).headline, 8);
  const side: Side = d.textSide;
  const place = side === 'right' ? { right: m } : { left: m };
  const align = side === 'right' ? 'flex-end' : 'flex-start';
  const h = title(ctx, d, colWidth, story ? 110 : 92, side);
  const top = safeTop(ctx);
  return canvas(ctx, [
    el('div', { position: 'absolute', top, ...place, display: 'flex' }, logoImg(ctx, {})),
    el('div', { position: 'absolute', ...place, top: top + logoHeight(ctx) + (story ? 200 : 44), width: colWidth, display: 'flex', flexDirection: 'column', alignItems: align }, [
      label(ctx, d.label, brand.colors.sand, d.typeScale, colWidth),
      spacer(10),
      el('div', { display: 'flex', fontFamily: brand.fonts.heading.family, fontSize: countSize, lineHeight: 0.92, color: brand.colors.saffron, whiteSpace: 'nowrap' }, uc(d.count)),
      ...(d.unit ? [caps(ctx, d.unit, story ? 38 : 34, brand.colors.cream)] : []),
      rule(ctx),
      h.el,
      spacer(18),
      line(ctx, d.line, colWidth, Math.round(brand.layout.line.size * 0.82), side, 2, brand.colors.sand),
    ]),
    ...(d.when ? [el('div', { position: 'absolute', ...place, bottom: safeBottom(ctx), display: 'flex', flexDirection: 'column', alignItems: align, gap: 6, ...(side === 'right' ? { paddingRight: 22, borderRight: `3px solid ${brand.colors.ember}` } : { paddingLeft: 22, borderLeft: `3px solid ${brand.colors.ember}` }) }, [
      caps(ctx, 'THE BIG DAY', 24, brand.colors.saffron),
      el('div', { display: 'flex', fontFamily: brand.fonts.heading.family, fontSize: 50, lineHeight: 1.1, color: brand.colors.cream }, uc(d.when)),
    ])] : []),
  ]);
}

// ─── ribbon ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A ribbon across the top-right corner, its centre `c` in from both edges, so the band crosses the corner and the
 * words sit on its middle, clear of Instagram's story header.
 */
export function ribbon(ctx: Ctx, text: string): El {
  const { brand } = ctx;
  const story = isStory(ctx);
  const c = story ? 330 : 225;
  const len = 1100;
  const thick = story ? 92 : 84;
  // The chord across the corner is 2c√2 long; the words keep a margin inside it.
  const room = Math.round(2 * c * Math.SQRT2 - 150);
  const font = fontOf(brand.fontFiles.bodyMedium ?? brand.fontFiles.body);
  let size = story ? 38 : 34;
  while (size > 22 && measure(font, uc(text), size, 0.22) > room) size -= 1;
  return el('div', {
    position: 'absolute', left: ctx.w - c - len / 2, top: c - thick / 2, width: len, height: thick, transform: 'rotate(45deg)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: brand.colors.ember,
    borderTop: `2px solid ${brand.colors.saffron}`, borderBottom: `2px solid ${brand.colors.saffron}`,
  }, [caps(ctx, text, size, brand.colors.cream)]);
}

// ─── deal ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The cream price sticker, tilted, with a dashed ember ring: the small word over the price. */
export function priceBadge(ctx: Ctx, price: string, word: string): El {
  const { brand } = ctx;
  const story = isStory(ctx);
  const d = story ? 330 : 300;
  const inner = d - 28;
  const big = price.trim() || word.trim() || 'SPECIAL';
  const small = price.trim() ? word.trim() || 'ONLY' : '';
  const bigSize = fitHeadline(fontOf(brand.fontFiles.heading), [uc(big), ''], inner - 64, price.trim() ? 124 : 72, 36, 4);
  return el('div', { position: 'absolute', right: brand.layout.margin, top: safeTop(ctx) + (story ? 0 : 10), display: 'flex', width: d, height: d, borderRadius: d / 2, backgroundColor: brand.colors.cream, alignItems: 'center', justifyContent: 'center', transform: 'rotate(-8deg)' }, [
    el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: inner, height: inner, borderRadius: inner / 2, border: `3px dashed ${brand.colors.ember}` }, [
      ...(small ? [caps(ctx, small, 26, brand.colors.ember, 0.24)] : []),
      el('div', { display: 'flex', fontFamily: brand.fonts.heading.family, fontSize: bigSize, lineHeight: 1, color: brand.colors.night, marginTop: small ? 8 : 0, whiteSpace: 'nowrap' }, uc(big)),
    ]),
  ]);
}

// ─── jaali ───────────────────────────────────────────────────────────────────────────────────────────────────

export const JaaliData = z.object({ ...common, hasPhoto: z.boolean().default(true) });

const frameInset = (ctx: Ctx) => (isStory(ctx) ? 40 : 36);

/** The round photo window under the logo, in pixels. */
export function jaaliMedallion(ctx: Ctx): { left: number; top: number; size: number } {
  const story = isStory(ctx);
  const size = story ? 540 : 320;
  const top = jaaliLogoTop(ctx) + logoHeight(ctx) + (story ? 90 : 36);
  return { left: Math.round((ctx.w - size) / 2), top, size };
}

const jaaliLogoTop = (ctx: Ctx) => (isStory(ctx) ? safeTop(ctx) : ctx.brand.layout.margin + 24);

export function jaaliLayer(ctx: Ctx, d: z.infer<typeof JaaliData>): El {
  const { brand } = ctx;
  const m = brand.layout.margin;
  const story = isStory(ctx);
  const fi = frameInset(ctx);
  const ii = fi + 14;
  const width = ctx.w - 2 * m - 40;
  const med = jaaliMedallion(ctx);
  const h = title(ctx, d, width, story ? 140 : 112, 'centre');
  const diamond = (left: number, top: number) => el('div', { position: 'absolute', left: left - 8, top: top - 8, width: 16, height: 16, backgroundColor: brand.colors.saffron, transform: 'rotate(45deg)', display: 'flex' });
  const block = [label(ctx, d.label, brand.colors.saffron, d.typeScale, width), spacer(16), h.el, rule(ctx), line(ctx, d.line, Math.min(820, width), Math.round(brand.layout.line.size * 0.9), 'centre', 2, brand.colors.sand)];
  const logoTop = jaaliLogoTop(ctx);
  const textTop = d.hasPhoto ? med.top + med.size + (story ? 56 : 40) : logoTop + logoHeight(ctx) + 40;
  const footerTop = ctx.h - safeBottom(ctx) - 30 - 40;
  return canvas(ctx, [
    el('div', { position: 'absolute', left: fi, top: fi, right: fi, bottom: fi, border: `3px solid ${brand.colors.saffron}`, display: 'flex' }),
    el('div', { position: 'absolute', left: ii, top: ii, right: ii, bottom: ii, border: `1px solid ${brand.colors.saffron}8C`, display: 'flex' }),
    diamond(ii, ii), diamond(ctx.w - ii, ii), diamond(ii, ctx.h - ii), diamond(ctx.w - ii, ctx.h - ii),
    el('div', { position: 'absolute', left: 0, right: 0, top: logoTop, display: 'flex', justifyContent: 'center' }, logoImg(ctx, {})),
    ...(d.hasPhoto ? [el('div', { position: 'absolute', left: med.left - 12, top: med.top - 12, width: med.size + 24, height: med.size + 24, borderRadius: (med.size + 24) / 2, border: `3px solid ${brand.colors.saffron}`, display: 'flex' })] : []),
    el('div', { position: 'absolute', left: m + 20, right: m + 20, top: textTop, ...(d.hasPhoto ? {} : { height: footerTop - textTop, justifyContent: 'center' }), display: 'flex', flexDirection: 'column', alignItems: 'center' }, block),
    brandLineBottom(ctx, 30),
  ]);
}

// ─── menu ────────────────────────────────────────────────────────────────────────────────────────────────────

export const MenuItem = z.object({ name: z.string().max(40), price: z.string().max(12).default('') });
export const MenuData = z.object({ ...common, items: z.array(MenuItem).max(6).default([]), hasPhoto: z.boolean().default(true) });

/** The height of the photo strip along the bottom of a menu. */
export const menuStrip = (ctx: Ctx): number => Math.round(ctx.h * 0.3);

export function menuLayer(ctx: Ctx, d: z.infer<typeof MenuData>): El {
  const { brand } = ctx;
  const m = brand.layout.margin;
  const story = isStory(ctx);
  const width = ctx.w - 2 * m;
  const top = safeTop(ctx);
  const h = title(ctx, d, width, story ? 130 : 110, 'left');
  const size = (story ? 52 : 38) - (d.items.length > 4 ? 4 : 0);
  const rows = d.items.map((it) => el('div', { display: 'flex', alignItems: 'flex-end', gap: 16 }, [
    el('div', { display: 'flex', whiteSpace: 'nowrap', fontFamily: brand.fonts.body.family, fontWeight: 500, fontSize: size, color: brand.colors.cream }, it.name),
    el('div', { display: 'flex', flexGrow: 1, marginBottom: Math.round(size * 0.28), borderBottom: `3px dotted ${brand.colors.sand}80` }),
    ...(it.price ? [el('div', { display: 'flex', whiteSpace: 'nowrap', fontFamily: brand.fonts.heading.family, fontSize: Math.round(size * 1.18), lineHeight: 1, color: brand.colors.saffron }, it.price)] : []),
  ]));
  const body = rows.length
    ? [el('div', { display: 'flex', flexDirection: 'column', gap: story ? 34 : 18 }, rows)]
    : [line(ctx, d.line, width, brand.layout.line.size, 'left', 4)];
  return canvas(ctx, [
    el('div', { position: 'absolute', top, left: m, display: 'flex' }, logoImg(ctx, {})),
    el('div', { position: 'absolute', left: m, right: m, top: top + logoHeight(ctx) + (story ? 60 : 36), display: 'flex', flexDirection: 'column' }, [
      label(ctx, d.label, brand.colors.saffron, d.typeScale, width),
      spacer(14),
      h.el,
      rule(ctx),
      ...body,
    ]),
    ...(d.hasPhoto ? [] : [brandLineBottom(ctx)]),
  ]);
}

// ─── compositions ────────────────────────────────────────────────────────────────────────────────────────────

const svg = (w: number, h: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);

/** Arch: Night with a soft glow, the photo cut to the arched window, the text layer over it. */
export async function composeArch(brand: Brand, w: number, h: number, jpeg: Buffer, layer: Buffer, a: { left: number; top: number; width: number; height: number }, lift: Lift = 'auto'): Promise<Buffer> {
  const r = a.width / 2;
  const photo = await sharp(await lifted(jpeg, lift)).resize(a.width, a.height, { fit: 'cover', position: sharp.strategy.attention }).modulate({ saturation: 1.04 }).png().toBuffer();
  const mask = svg(a.width, a.height, `<path d="M0 ${r} A${r} ${r} 0 0 1 ${a.width} ${r} V${a.height} H0 Z" fill="#fff"/>`);
  const window = await sharp(photo).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const ground = await nightBackground(brand, w, h, { x: 0.5, y: (a.top + a.height / 2) / h });
  return sharp(ground).composite([{ input: window, left: a.left, top: a.top }, { input: layer, left: 0, top: 0 }]).png().toBuffer();
}

/** Jaali: a saffron lattice on Night, calmed in the middle for the words, and the photo in its round window. */
export async function composeJaali(brand: Brand, w: number, h: number, jpeg: Buffer | null, layer: Buffer, med: { left: number; top: number; size: number }, lift: Lift = 'auto'): Promise<Buffer> {
  const { night, saffron } = brand.colors;
  const ground = await sharp(svg(w, h, `
    <defs>
      <pattern id="j" width="96" height="96" patternUnits="userSpaceOnUse"><g fill="none" stroke="${saffron}" stroke-opacity="0.2" stroke-width="2">
        <rect x="28" y="28" width="40" height="40"/><rect x="28" y="28" width="40" height="40" transform="rotate(45 48 48)"/>
        <path d="M0 48H20M76 48H96M48 0V20M48 76V96"/>
      </g></pattern>
      <radialGradient id="v" cx="0.5" cy="0.56" r="0.6"><stop offset="0" stop-color="${night}" stop-opacity="0.94"/><stop offset="0.62" stop-color="${night}" stop-opacity="0.72"/><stop offset="1" stop-color="${night}" stop-opacity="0.1"/></radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="${night}"/><rect width="100%" height="100%" fill="url(#j)"/><rect width="100%" height="100%" fill="url(#v)"/>`)).png().toBuffer();
  const inputs: OverlayOptions[] = [];
  if (jpeg) {
    const photo = await sharp(await lifted(jpeg, lift)).resize(med.size, med.size, { fit: 'cover', position: sharp.strategy.attention }).modulate({ saturation: 1.04 }).png().toBuffer();
    const r = med.size / 2;
    inputs.push({ input: await sharp(photo).composite([{ input: svg(med.size, med.size, `<circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/>`), blend: 'dest-in' }]).png().toBuffer(), left: med.left, top: med.top });
  }
  return sharp(ground).composite([...inputs, { input: layer, left: 0, top: 0 }]).png().toBuffer();
}

/** Menu: Night, the photo along the bottom fading up into it, the text layer over everything. */
export async function composeMenu(brand: Brand, w: number, h: number, jpeg: Buffer | null, layer: Buffer, stripH: number, lift: Lift = 'auto'): Promise<Buffer> {
  const ground = await nightBackground(brand, w, h, { x: 0.5, y: 0.3 });
  const inputs: OverlayOptions[] = [];
  if (jpeg) {
    const photo = await sharp(await lifted(jpeg, lift)).resize(w, stripH, { fit: 'cover', position: sharp.strategy.attention }).modulate({ saturation: 1.04 }).png().toBuffer();
    const fade = svg(w, stripH, `<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.45" stop-color="#fff" stop-opacity="1"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#f)"/>`);
    inputs.push({ input: await sharp(photo).composite([{ input: fade, blend: 'dest-in' }]).png().toBuffer(), left: 0, top: h - stripH });
  }
  return sharp(ground).composite([...inputs, { input: layer, left: 0, top: 0 }]).png().toBuffer();
}
