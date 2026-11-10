/**
 * The ten occasion looks, which only the owner picks (styles.ts has their cards):
 *  arch       Night, the photo in an arched window with a saffron outline, the greeting centred under it
 *  countdown  a Night panel with a giant count of the days left, the photo fading off the right
 *  ribbon     the house band design with a ribbon across the top-right corner
 *  jaali      a lattice ground in a double saffron frame, the photo in a small round window, all centred
 *  deal       the house band design with a round price sticker in the top-right corner
 *  menu       Night, a list of dishes with dotted leaders and prices, a strip of the photo along the bottom
 *  weekly     a weekly night: the title over a strip of the week with its day filled, the time and the offer
 *  stars      a review wall: the rating big beside five stars, the guests' words on cards, the address
 *  visit      a visit card: the photo in a rounded frame, then the address, hours, parking and where to order
 *  pillars    a promise: three short statements stacked and numbered, the photo as a tall strip on the right
 * They reuse the kit helpers (label, headline, rule, line, logo) so type, floors and colours stay the kit's; the
 * compositions at the end put the photo where each look needs it. Colours always come from the kit, never a hex
 * written here, so a day's own palette recolours every look.
 */
import sharp, { type OverlayOptions } from 'sharp';
import { z } from 'zod';
import type { Brand } from './brand.js';
import { liftTone, nightBackground } from './compose.js';
import { typeFloors } from './legibility.js';
import { isStory, safeBottom, safeTop } from './styled.js';
import { fitHeadline, fontOf, measure, wrap } from './text.js';
import {
  canvas, designFields, el, footer, headline, label, line, logoHeight, logoImg, rule, spacer, uc,
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

/**
 * The headline on one line when the owner typed it as one ("Karahi Night", "And counting") and it fits at a size
 * the phone can read; otherwise the two-line title, as everywhere else.
 */
function titleLine(ctx: Ctx, d: Parameters<typeof title>[1], width: number, max: number, side: Side): { el: El; size: number } {
  const { brand } = ctx;
  const text = d.headline.trim();
  const font = fontOf(brand.fontFiles.heading);
  const floor = typeFloors(ctx.w).headline;
  if (d.accentWord || text.includes('\n') || measure(font, text, floor) > width) return title(ctx, d, width, max, side);
  const size = fitHeadline(font, [text, ''], width, Math.round(Math.min(max, brand.layout.headline.start) * d.typeScale), floor, 4);
  return { size, el: el('div', { display: 'flex', whiteSpace: 'nowrap', fontFamily: brand.fonts.heading.family, fontSize: size, lineHeight: brand.layout.headline.lineHeight, color: brand.colors.cream }, text) };
}

/** Tracked capitals that shrink (to `min`) until they fit `width`: an offer, a numeral, a row's head. */
function capsFit(ctx: Ctx, text: string, size: number, color: string, width: number, min = 22, tracking = 0.2): El {
  const font = fontOf(ctx.brand.fontFiles.bodyMedium ?? ctx.brand.fontFiles.body);
  let s = size;
  while (s > min && measure(font, uc(text), s, tracking) > width) s -= 1;
  return caps(ctx, text, s, color, tracking);
}

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

// ─── weekly ──────────────────────────────────────────────────────────────────────────────────────────────────

export const WeeklyData = z.object({
  ...common,
  /** The ritual's day, 0 = Monday … 6 = Sunday; null fills no day. */
  day: z.number().int().min(0).max(6).nullable().default(null),
  /** "5PM – 10PM", big under the week. */
  time: z.string().max(24).default(''),
  /** The offer in capitals under the time (FREE NAAN WITH ANY FULL KARAHI); empty, the line shows instead. */
  message: z.string().max(40).default(''),
});

export const WEEK_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/** The day of the week of a YYYY-MM-DD date, 0 = Monday … 6 = Sunday, or null. */
export function weekdayOf(iso: string | null | undefined): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  return Number.isNaN(d.getTime()) ? null : (d.getUTCDay() + 6) % 7;
}

/**
 * The most photo along the bottom of a weekly night: taller than the menu's, the dish is the draw. stripBelow() then
 * starts it just under the lowest word, so it fills the room the words leave rather than a fixed share — on a story,
 * a fixed 40% left an empty band of Night between the offer and the photo.
 */
export const weeklyStrip = (ctx: Ctx): number => Math.round(ctx.h * (isStory(ctx) ? 0.58 : 0.5));

/** The size of a day's circle and the gap between them, shared with the tests. */
export const weekCircle = (ctx: Ctx): { size: number; gap: number } => (isStory(ctx) ? { size: 104, gap: 22 } : { size: 86, gap: 20 });

/** The week as seven day letters in circles, the ritual's day filled saffron with Night letters. */
function weekStrip(ctx: Ctx, day: number | null): El {
  const { brand } = ctx;
  const { size, gap } = weekCircle(ctx);
  return el('div', { display: 'flex', gap }, WEEK_LETTERS.map((letter, i) => el('div', {
    display: 'flex', width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
    ...(i === day ? { backgroundColor: brand.colors.saffron } : { border: `2px solid ${brand.colors.sand}66` }),
    fontFamily: brand.fonts.body.family, fontWeight: 500, fontSize: Math.round(size * 0.4), color: i === day ? brand.colors.night : brand.colors.sand,
  }, letter)));
}

export function weeklyLayer(ctx: Ctx, d: z.infer<typeof WeeklyData>): El {
  const { brand } = ctx;
  const m = brand.layout.margin;
  const story = isStory(ctx);
  const width = ctx.w - 2 * m;
  const top = safeTop(ctx);
  const h = titleLine(ctx, d, width, story ? 150 : 124, 'centre');
  const timeSize = fitHeadline(fontOf(brand.fontFiles.heading), [uc(d.time), ''], width, story ? 108 : 84, 48, 4);
  // The offer, or the line when there is none, closes the block.
  const close = d.message
    ? [spacer(story ? 20 : 12), capsFit(ctx, d.message, story ? 34 : 30, brand.colors.cream, width)]
    : d.line ? [spacer(story ? 24 : 16), line(ctx, d.line, Math.min(840, width), Math.round(brand.layout.line.size * 0.86), 'centre', 2, brand.colors.sand)] : [];
  return canvas(ctx, [
    el('div', { position: 'absolute', left: 0, right: 0, top, display: 'flex', justifyContent: 'center' }, logoImg(ctx, {})),
    el('div', { position: 'absolute', left: m, right: m, top: top + logoHeight(ctx) + (story ? 56 : 24), display: 'flex', flexDirection: 'column', alignItems: 'center' }, [
      label(ctx, d.label, brand.colors.saffron, d.typeScale, width),
      spacer(story ? 16 : 10),
      h.el,
      rule(ctx),
      weekStrip(ctx, d.day),
      ...(d.time ? [spacer(story ? 34 : 22), el('div', { display: 'flex', whiteSpace: 'nowrap', fontFamily: brand.fonts.heading.family, fontSize: timeSize, lineHeight: 1, color: brand.colors.cream }, uc(d.time))] : []),
      ...close,
    ]),
  ]);
}

// ─── stars ───────────────────────────────────────────────────────────────────────────────────────────────────

export const Quote = z.object({ text: z.string().max(120), who: z.string().max(24).default('') });
export const StarsData = z.object({
  ...common,
  /** "4.8", big in saffron beside the stars; empty, the stars alone. */
  rating: z.string().max(4).default(''),
  /** The guests' words and their initials, on cards; empty, the line shows instead. */
  quotes: z.array(Quote).max(3).default([]),
  hasPhoto: z.boolean().default(false),
});

/**
 * Five stars drawn as an SVG picture (the fonts have no star). With a rating such as 4.8 the last star is filled
 * to match it; anything else fills all five.
 */
export function starRow(ctx: Ctx, rating: string, size: number): El {
  const { saffron, sand } = ctx.brand.colors;
  const gap = Math.round(size * 0.2);
  const value = Number.parseFloat(rating);
  const filled = Number.isFinite(value) && value > 0 && value <= 5 ? value : 5;
  const w = 5 * size + 4 * gap;
  const r = size / 2;
  const point = (k: number) => {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rad = k % 2 ? r * 0.42 : r;
    return `${(r + rad * Math.cos(a)).toFixed(1)},${(r + 0.06 * size + rad * Math.sin(a)).toFixed(1)}`;
  };
  const shape = Array.from({ length: 10 }, (_, k) => point(k)).join(' ');
  const stars = Array.from({ length: 5 }, (_, i) => {
    const part = Math.max(0, Math.min(1, filled - i)).toFixed(3);
    return `<defs><linearGradient id="s${i}" x1="0" x2="1" y1="0" y2="0"><stop offset="${part}" stop-color="${saffron}"/><stop offset="${part}" stop-color="${sand}" stop-opacity="0.35"/></linearGradient></defs>`
      + `<polygon transform="translate(${i * (size + gap)} 0)" points="${shape}" fill="url(#s${i})"/>`;
  }).join('');
  const src = `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${size}" viewBox="0 0 ${w} ${size}">${stars}</svg>`).toString('base64')}`;
  return el('img', { width: w, height: size }, undefined, { src });
}

/** A guest's words on a Charcoal card, in the italic serif, their initials in sand capitals under them. */
function quoteCard(ctx: Ctx, q: z.infer<typeof Quote>, width: number, size: number): El {
  const { brand } = ctx;
  const pad = isStory(ctx) ? 30 : 26;
  const font = fontOf(brand.fontFiles.headingItalic ?? brand.fontFiles.heading);
  const lines = wrap(font, `“${q.text}”`, size, width - 2 * pad - 4, 2);
  return el('div', { display: 'flex', flexDirection: 'column', gap: 10, paddingTop: pad - 6, paddingBottom: pad, paddingLeft: pad, paddingRight: pad, backgroundColor: brand.colors.charcoal, borderRadius: 18, borderLeft: `4px solid ${brand.colors.saffron}` }, [
    el('div', { display: 'flex', flexDirection: 'column', fontFamily: brand.fonts.heading.family, fontStyle: 'italic', fontSize: size, lineHeight: 1.12, color: brand.colors.cream }, lines.map((l) => el('div', { display: 'flex' }, l))),
    ...(q.who ? [caps(ctx, `— ${q.who}`, isStory(ctx) ? 26 : 24, brand.colors.sand, 0.2)] : []),
  ]);
}

/** The size the quotes share: the largest, from `start`, at which each fits two lines. */
function quoteSize(ctx: Ctx, quotes: z.infer<typeof Quote>[], width: number, start: number): number {
  const font = fontOf(ctx.brand.fontFiles.headingItalic ?? ctx.brand.fontFiles.heading);
  const inner = width - 2 * (isStory(ctx) ? 30 : 26) - 4;
  let size = start;
  while (size > 34 && quotes.some((q) => wrap(font, `“${q.text}”`, size, inner, 99).length > 2)) size -= 2;
  return size;
}

export function starsLayer(ctx: Ctx, d: z.infer<typeof StarsData>): El {
  const { brand } = ctx;
  const m = brand.layout.margin;
  const story = isStory(ctx);
  const width = ctx.w - 2 * m;
  const top = safeTop(ctx);
  const rating = d.rating.trim();
  const font = fontOf(brand.fontFiles.heading);
  const ratingSize = rating ? fitHeadline(font, [rating, ''], Math.round(width * 0.42), story ? 290 : 236, 120, 8) : 0;
  const ratingWidth = rating ? Math.ceil(measure(font, rating, ratingSize)) : 0;
  const side = rating ? width - ratingWidth - 40 : width;
  const h = titleLine(ctx, d, side, story ? 118 : 100, 'left');
  const stars = starRow(ctx, rating, rating ? (story ? 62 : 52) : story ? 76 : 64);
  // The rating big on the left; the stars and the headline beside it. No rating: the stars over the headline.
  const head = rating
    ? el('div', { display: 'flex', alignItems: 'center', gap: 40 }, [
      el('div', { display: 'flex', whiteSpace: 'nowrap', fontFamily: brand.fonts.heading.family, fontSize: ratingSize, lineHeight: 0.9, color: brand.colors.saffron }, rating),
      el('div', { display: 'flex', flexDirection: 'column', width: side, gap: story ? 22 : 16 }, [stars, h.el]),
    ])
    : el('div', { display: 'flex', flexDirection: 'column', gap: story ? 26 : 18 }, [stars, h.el]);
  const quotes = d.quotes.filter((q) => q.text.trim()).slice(0, d.hasPhoto ? 2 : 3);
  const size = quoteSize(ctx, quotes, width, story ? 48 : 42);
  const body = quotes.length
    ? [el('div', { display: 'flex', flexDirection: 'column', gap: story ? 22 : 16 }, quotes.map((q) => quoteCard(ctx, q, width, size))),
      ...(d.line ? [spacer(story ? 36 : 24), line(ctx, d.line, width, Math.round(brand.layout.line.size * 0.9), 'left', 1, brand.colors.sand)] : [])]
    : [line(ctx, d.line, width, brand.layout.line.size, 'left', 3)];
  // Without a photo the block sits in the middle of the space between the logo and the address.
  const blockTop = top + logoHeight(ctx) + (story ? 60 : 30);
  const blockBottom = ctx.h - safeBottom(ctx) - 2 * Math.round(brand.layout.footer.size * 1.25) - 10 - 40;
  return canvas(ctx, [
    el('div', { position: 'absolute', top, left: m, display: 'flex' }, logoImg(ctx, {})),
    el('div', { position: 'absolute', left: m, right: m, top: blockTop, ...(d.hasPhoto ? {} : { height: blockBottom - blockTop, justifyContent: 'center' }), display: 'flex', flexDirection: 'column' }, [
      label(ctx, d.label, brand.colors.saffron, d.typeScale, width),
      spacer(story ? 18 : 10),
      head,
      rule(ctx),
      ...body,
    ]),
    ...(d.hasPhoto ? [] : [el('div', { position: 'absolute', left: m, right: m, bottom: safeBottom(ctx), display: 'flex' }, footer(ctx, 'address'))]),
  ]);
}

// ─── visit ───────────────────────────────────────────────────────────────────────────────────────────────────

export const VisitData = z.object({
  ...common,
  address: z.string().max(80).default(''),
  hours: z.string().max(60).default(''),
  /** The owner's parking note; empty, no PARKING row. */
  parking: z.string().max(40).default(''),
  /** Where to order (the website); empty, no ORDER row. */
  website: z.string().max(60).default(''),
  hasPhoto: z.boolean().default(true),
});

/** The photo's rounded window across the top of a visit card, in pixels; the saffron outline sits 14 px outside it. */
export function visitFrame(ctx: Ctx): { left: number; top: number; width: number; height: number; radius: number } {
  const inset = ctx.brand.layout.margin + 14;
  return { left: inset, top: safeTop(ctx) + 14, width: ctx.w - 2 * inset, height: Math.round(ctx.h * (isStory(ctx) ? 0.37 : 0.4)), radius: 30 };
}

/** One row of the visit list: the saffron head on the left, the value in cream serif on the right. */
function infoRow(ctx: Ctx, head: string, value: string, width: number, first: boolean): El {
  const { brand } = ctx;
  const story = isStory(ctx);
  const size = story ? 50 : 44;
  const headWidth = story ? 230 : 210;
  const lines = wrap(fontOf(brand.fontFiles.heading), value, size, width - headWidth - 24, 2);
  return el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, paddingTop: story ? 22 : 16, paddingBottom: story ? 22 : 16, ...(first ? {} : { borderTop: `1px solid ${brand.colors.sand}59` }) }, [
    el('div', { display: 'flex', width: headWidth, paddingTop: Math.round(size * 0.3) }, capsFit(ctx, head, story ? 28 : 26, brand.colors.saffron, headWidth, 20, 0.22)),
    el('div', { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontFamily: brand.fonts.heading.family, fontSize: size, lineHeight: 1.1, color: brand.colors.cream }, lines.map((l) => el('div', { display: 'flex' }, l))),
  ]);
}

export function visitLayer(ctx: Ctx, d: z.infer<typeof VisitData>): El {
  const { brand } = ctx;
  const m = brand.layout.margin;
  const story = isStory(ctx);
  const width = ctx.w - 2 * m;
  const f = visitFrame(ctx);
  const h = titleLine(ctx, d, width, story ? 140 : 112, 'left');
  const rows = ([['ADDRESS', d.address], ['HOURS', d.hours], ['PARKING', d.parking], ['ORDER', d.website.replace(/^https?:\/\//, '')]] as const).filter(([, v]) => v.trim());
  const block = [
    label(ctx, d.label, brand.colors.saffron, d.typeScale, width),
    spacer(story ? 16 : 10),
    h.el,
    rule(ctx),
    ...(rows.length ? [el('div', { display: 'flex', flexDirection: 'column', width }, rows.map(([head, value], i) => infoRow(ctx, head, value, width, i === 0)))] : [line(ctx, d.line, width, brand.layout.line.size, 'left', 3)]),
  ];
  const logoTop = safeTop(ctx);
  // Without a photo the block sits in the middle of the space between the logo and the brand line.
  const textTop = d.hasPhoto ? f.top + f.height + 14 + (story ? 60 : 38) : logoTop + logoHeight(ctx) + 40;
  const footerTop = ctx.h - safeBottom(ctx) - 30 - 40;
  return canvas(ctx, [
    ...(d.hasPhoto ? [el('div', { position: 'absolute', left: f.left - 14, top: f.top - 14, width: f.width + 28, height: f.height + 28, borderRadius: f.radius + 14, border: `2px solid ${brand.colors.saffron}`, display: 'flex' })] : []),
    el('div', { position: 'absolute', top: d.hasPhoto ? f.top + 24 : logoTop, left: d.hasPhoto ? f.left + 28 : m, display: 'flex' }, logoImg(ctx, {})),
    el('div', { position: 'absolute', left: m, right: m, top: textTop, ...(d.hasPhoto ? {} : { height: footerTop - textTop, justifyContent: 'center' }), display: 'flex', flexDirection: 'column' }, block),
    brandLineBottom(ctx),
  ]);
}

// ─── pillars ─────────────────────────────────────────────────────────────────────────────────────────────────

export const PillarsData = z.object({
  ...common,
  /** Up to three short statements ("Smoked.", "Grilled.", "Rooted in tradition."). */
  points: z.array(z.string().max(32)).max(3).default([]),
  hasPhoto: z.boolean().default(true),
});

/** The share of the width the photo takes on a promise, from the right edge. */
export const PILLARS_PHOTO_SHARE = 0.4;

/** How far up from the bottom the photo has faded out on a promise, so the brand line sits on Night. */
export const pillarsClear = (ctx: Ctx): number => safeBottom(ctx) + 64;

/** The statements from a headline, when the owner typed none: one per line, or one per sentence. */
export function pillarsFrom(text: string): string[] {
  const parts = text.split(/\n+|(?<=\.)\s+/).map((p) => p.trim()).filter(Boolean);
  const kept = parts.length > 3 ? [...parts.slice(0, 2), parts.slice(2).join(' ')] : parts;
  return kept.map((p) => p.slice(0, 32).trim());
}

export function pillarsLayer(ctx: Ctx, d: z.infer<typeof PillarsData>): El {
  const { brand } = ctx;
  const m = brand.layout.margin;
  const story = isStory(ctx);
  const side: Side = d.hasPhoto ? 'left' : 'centre';
  const align = d.hasPhoto ? 'flex-start' : 'center';
  // With the photo the column stops short of the strip's fade; without it, the full width.
  const width = d.hasPhoto ? Math.round(ctx.w * (1 - PILLARS_PHOTO_SHARE)) - m - 10 : ctx.w - 2 * m;
  const top = safeTop(ctx);
  const logoTop = top;
  const blockTop = logoTop + logoHeight(ctx) + (story ? 70 : 34);
  const footerTop = ctx.h - safeBottom(ctx) - 30 - 40;
  const points = (d.points.length ? d.points : pillarsFrom(d.headline)).filter(Boolean).slice(0, 3);
  const font = fontOf(brand.fontFiles.heading);
  const numeral = story ? 28 : 26;
  const gapY = story ? 28 : 20;
  const lineH = d.line ? 2 * Math.round(brand.layout.line.size * 0.86 * 1.28) + (story ? 44 : 36) : 0;
  const room = footerTop - blockTop - (brand.layout.label.size + 34) - lineH;
  // One size for all three, the largest at which each wraps to two lines at most and the stack fits the room.
  const height = (s: number) => points.reduce((sum, p) => sum + numeral + 10 + wrap(font, p, s, width, 99).length * s * 0.98, 0) + (points.length - 1) * (2 * gapY + 2);
  let size = Math.round((story ? 156 : 128) * d.typeScale);
  while (size > 64 && (points.some((p) => wrap(font, p, size, width, 99).length > 2) || height(size) > room)) size -= 4;
  const stack: El[] = [];
  points.forEach((p, i) => {
    if (i) stack.push(el('div', { display: 'flex', width: 90, height: 2, backgroundColor: brand.colors.ember, marginTop: gapY, marginBottom: gapY }));
    stack.push(el('div', { display: 'flex', flexDirection: 'column', alignItems: align }, [
      el('div', { display: 'flex', marginBottom: 10 }, caps(ctx, String(i + 1).padStart(2, '0'), numeral, brand.colors.saffron, 0.22)),
      el('div', { display: 'flex', flexDirection: 'column', alignItems: align, fontFamily: brand.fonts.heading.family, fontSize: size, lineHeight: 0.98, color: brand.colors.cream }, wrap(font, p, size, width, 2).map((l) => el('div', { display: 'flex' }, l))),
    ]));
  });
  return canvas(ctx, [
    el('div', { position: 'absolute', top: logoTop, ...(d.hasPhoto ? { left: m } : { left: 0, right: 0, justifyContent: 'center' }), display: 'flex' }, logoImg(ctx, {})),
    el('div', { position: 'absolute', left: m, top: blockTop, width: d.hasPhoto ? width : ctx.w - 2 * m, height: footerTop - blockTop, display: 'flex', flexDirection: 'column', alignItems: align, justifyContent: d.hasPhoto ? 'flex-start' : 'center' }, [
      label(ctx, d.label, brand.colors.saffron, d.typeScale, width),
      spacer(story ? 34 : 26),
      el('div', { display: 'flex', flexDirection: 'column', alignItems: align }, stack),
      ...(d.line ? [spacer(story ? 44 : 36), line(ctx, d.line, Math.min(width, 820), Math.round(brand.layout.line.size * 0.86), side, 2, brand.colors.sand)] : []),
    ]),
    brandLineBottom(ctx),
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

/**
 * The photo strip's height under a text layer: `target`, or shorter so the strip starts just below the lowest word
 * on the layer (a two-line title, a long line), but never shorter than `min`.
 */
export async function stripBelow(layer: Buffer, target: number, min: number, gap = 12): Promise<number> {
  const { data, info } = await sharp(layer).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  let y = info.height - 1;
  while (y > 0 && !data.subarray(y * info.width, (y + 1) * info.width).some((a) => a > 16)) y--;
  return Math.max(min, Math.min(target, info.height - y - 1 - gap));
}

/** Visit card: Night with a low glow, the photo cut to its rounded window across the top, the text layer over it. */
export async function composeVisit(brand: Brand, w: number, h: number, jpeg: Buffer | null, layer: Buffer, f: { left: number; top: number; width: number; height: number; radius: number }, lift: Lift = 'auto'): Promise<Buffer> {
  const ground = await nightBackground(brand, w, h, { x: 0.5, y: jpeg ? 0.7 : 0.45 });
  const inputs: OverlayOptions[] = [];
  if (jpeg) {
    const photo = await sharp(await lifted(jpeg, lift)).resize(f.width, f.height, { fit: 'cover', position: sharp.strategy.attention }).modulate({ saturation: 1.04 }).png().toBuffer();
    const mask = svg(f.width, f.height, `<rect width="${f.width}" height="${f.height}" rx="${f.radius}" ry="${f.radius}" fill="#fff"/>`);
    inputs.push({ input: await sharp(photo).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer(), left: f.left, top: f.top });
  }
  return sharp(ground).composite([...inputs, { input: layer, left: 0, top: 0 }]).png().toBuffer();
}

/**
 * Promise: Night, the photo as a tall strip on the right covering `share` of the width, fading into the Night along
 * its inner edge and above the brand line at the bottom, so every word sits on Night.
 */
export async function composePillars(brand: Brand, w: number, h: number, jpeg: Buffer | null, layer: Buffer, share: number, clearBelow: number, lift: Lift = 'auto'): Promise<Buffer> {
  const ground = await nightBackground(brand, w, h, { x: jpeg ? 0.3 : 0.5, y: 0.45 });
  const inputs: OverlayOptions[] = [];
  if (jpeg) {
    const pw = Math.round(w * share);
    const photo = await sharp(await lifted(jpeg, lift)).resize(pw, h, { fit: 'cover', position: sharp.strategy.attention }).modulate({ saturation: 1.04 }).png().toBuffer();
    const edge = svg(pw, h, `<defs><linearGradient id="f" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="1"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#f)"/>`);
    const end = (h - clearBelow) / h;
    const foot = svg(pw, h, `<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="${Math.max(0, end - 0.14)}" stop-color="#fff" stop-opacity="1"/><stop offset="${end}" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#b)"/>`);
    const faded = await sharp(await sharp(photo).composite([{ input: edge, blend: 'dest-in' }]).png().toBuffer()).composite([{ input: foot, blend: 'dest-in' }]).png().toBuffer();
    inputs.push({ input: faded, left: w - pw, top: 0 });
  }
  return sharp(ground).composite([...inputs, { input: layer, left: 0, top: 0 }]).png().toBuffer();
}
