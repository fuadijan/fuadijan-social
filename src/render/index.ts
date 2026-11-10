/**
 * renderPost: template key + copy + photo (and maybe a cutout) → PNGs. Feed 1080×1350, story 1080×1920, one PNG
 * per carousel page, reel cover 1080×1920. The pipeline's render stage and `npm run render-samples` both come here.
 */
import { brandLineOn, isKarahiPost } from '../pipeline/packs.js';
import type { z } from 'zod';
import type { DesignSpec } from '../brain/schemas.js';
import { loadBrand, type Brand } from './brand.js';
import { themedBrand, type FjTheme } from './theme.js';
import { composeLayoutA, composeLayoutB, composeTextOnly, shiftPhotoUp, type Cutout } from './compose.js';
import { composeFlat, composeInvite, composePoster } from './compose-styles.js';
import { templateEntry, templateKeyFor, type TemplateKey } from './registry.js';
import { PairData, composePair, pairLayer } from './pair.js';
import {
  ArchData, COUNTDOWN_PHOTO_SHARE, CountdownData, JaaliData, MenuData, PILLARS_PHOTO_SHARE, PillarsData, StarsData, VisitData, WeeklyData,
  archLayer, archWindow, composeArch, composeJaali, composeMenu, composePillars, composeVisit, countdownFor, countdownLayer, jaaliLayer,
  jaaliMedallion, menuLayer, menuStrip, pillarsClear, pillarsLayer, priceBadge, ribbon, starsLayer, stripBelow, visitFrame, visitLayer, weekdayOf,
  weeklyLayer, weeklyStrip,
} from './occasion.js';
import { FlatData, INVITE_PHOTO_SHARE, InviteData, PosterData, SplitData, flatLayer, flatPlate, inviteLayer, posterLayer, posterPlate, splitLayer } from './styled.js';
import { STYLES, feasibleStyle, type Style } from './styles.js';
import {
  CarouselCoverData, CarouselSlideData, HeroData, ReelCoverData, ReviewData, StoryData, TextOnlyData,
  canvas, carouselCoverLayer, carouselSlideLayer, heroLayer, layerToPng, makeCtx, reelCoverLayer, reviewLayer, storyLayer, textOnlyLayer,
  type RenderSettings,
} from './templates.js';

export interface RenderInput {
  /** The sheet's template value (from-the-fire, customer-review, …). */
  sheetTemplate: string;
  slot: 'feed' | 'carousel' | 'reel';
  label: string;
  headline: string;
  line: string;
  /** Review rows: the quote and initials. */
  quote?: string | null;
  reviewer?: string | null;
  /** Carousel rows: slide titles (the cover uses headline). */
  slides?: string[];
  /** Reel rows: the hook. */
  hook?: string | null;
  /** The prepped photo (JPEG) or null for text-only. */
  photo: Buffer | null;
  /** Extra photos for carousel slides, in order. */
  slidePhotos?: Buffer[];
  /** A plate cutout when the photo is a single plate and the mask was usable. */
  cutout: Cutout | null;
  busyPhoto?: boolean;
  settings: RenderSettings;
  /**
   * The art director's (or heuristic) decisions; anything missing falls back to the house defaults. The lead-in's
   * colour is the owner's alone (lookSpec), never the director's.
   */
  design?: (Partial<DesignSpec> & { accent_color?: 'saffron' | 'ember' }) | null;
  /** A 9:16 crop for the story; the feed photo is re-cropped when it is missing. */
  storyPhoto?: Buffer | null;
  /**
   * A look's own details: what the invite prints instead of the post's date, the opening hours and FROM; the
   * countdown's big day and words; the ribbon's words; the deal's price and the word over it; the menu's dishes;
   * the weekly night's day, time and offer; the review wall's rating and quotes; the visit card's parking note;
   * the promise's statements.
   */
  invite?: LookDetails | null;
  /** The post's date (YYYY-MM-DD), shown by the invite style. */
  date?: string | null;
  /**
   * The occasion theme covering the post's date (theme.ts: Independence Day in green and white, Eid…), whose colours
   * replace the kit's for this post; null or missing keeps the everyday kit. The caller looks it up, so rendering
   * itself never waits on the network.
   */
  theme?: FjTheme | null;
  /** The post's dish, for the brand line. */
  dish?: string | null;
  /** Two different dishes in one design, each cropped for the feed's and the taller canvases' panels (pair.ts). */
  pair?: PairPhoto[] | null;
}

export interface PairPhoto { name: string; feed: Buffer; tall: Buffer }

/** A look's own details (calendar_rows.invite), and the owner's text side and italic lead-in over the title. */
export interface LookDetails {
  date?: string | null; time?: string; message?: string; price?: string; menu?: { name: string; price: string }[];
  /** The weekly night's day, 0 = Monday … 6 = Sunday; missing, the day the post goes up. */
  day?: number;
  /** The review wall's rating ("4.8") and the guests' words with their initials. */
  rating?: string; quotes?: { text: string; who: string }[];
  /** The promise's statements, up to three; missing, the headline split at its lines or sentences. */
  points?: string[];
  side?: 'left' | 'right'; accent?: 'none' | 'gold' | 'orange'; lead?: string;
  /** Move the photo up by this percentage of its height (10, 20 or 30), so a low dish clears the words. */
  photoUp?: number;
}

/** The owner's text side and lead-in as design fields; they win over the art director and the critic. */
export function lookSpec(look: LookDetails | null | undefined): Partial<DesignSpec> & { accent_color?: 'saffron' | 'ember' } {
  const out: Partial<DesignSpec> & { accent_color?: 'saffron' | 'ember' } = {};
  if (look?.side) out.text_side = look.side;
  if (look?.accent === 'none') out.accent_word = false;
  else if (look?.accent) { out.accent_word = true; out.accent_color = look.accent === 'orange' ? 'ember' : 'saffron'; }
  return out;
}

/** The input with the owner's look applied: the design fields, and their own lead-in words over the title. */
export function withLook(input: RenderInput): RenderInput {
  const look = lookSpec(input.invite);
  if (!Object.keys(look).length) return input;
  const design = { ...(input.design ?? {}), ...look };
  const lead = input.invite?.lead?.trim();
  const headline = design.accent_word && lead ? `${lead}\n${input.headline.replace(/\s*\n\s*/g, ' ')}` : input.headline;
  return { ...input, design, headline };
}

/** HeroData/StoryData fields from a design spec (undefined fields take the zod defaults). */
function designFields(d: RenderInput['design']) {
  return { textPosition: d?.text_position, textSide: d?.text_side, bandStrength: d?.band_strength, typeScale: d?.type_scale, accentWord: d?.accent_word, accentColor: d?.accent_color };
}

/** "FRIDAY" and "08 NOV" for the invite's first column, from a YYYY-MM-DD date. */
export function inviteDate(iso: string | null | undefined): { day: string; date: string } {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return { day: '', date: '' };
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return { day: '', date: '' };
  const day = d.toLocaleDateString('en-AU', { weekday: 'long' }).toUpperCase();
  const date = d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }).replace('.', '').toUpperCase();
  return { day, date };
}

/** The style that will actually be rendered for this input. */
export function styleFor(input: Pick<RenderInput, 'photo' | 'cutout' | 'design'>): Style {
  return feasibleStyle(input.design?.style ?? 'band', { cutout: Boolean(input.cutout), photo: Boolean(input.photo) });
}

export interface RenderOutput { format: 'feed' | 'story' | 'carousel' | 'reel-cover'; page: number | null; png: Buffer }

export async function renderPost(raw: RenderInput, kit: Brand = loadBrand()): Promise<RenderOutput[]> {
  const baseBrand = themedBrand(kit, raw.theme);
  const looked = withLook(raw);
  const up = (looked.invite?.photoUp ?? 0) / 100;
  const input = up > 0 ? {
    ...looked,
    photo: looked.photo ? await shiftPhotoUp(looked.photo, up, baseBrand.colors.night) : null,
    storyPhoto: looked.storyPhoto ? await shiftPhotoUp(looked.storyPhoto, up, baseBrand.colors.night) : looked.storyPhoto,
  } : looked;
  const key = templateKeyFor(input.sheetTemplate);
  const entry = templateEntry(input.sheetTemplate);
  const brand: Brand = { ...baseBrand, brandLine: brandLineOn(input.date, baseBrand.brandLine, isKarahiPost({ template: input.sheetTemplate, label: input.label, dish: input.dish })) };
  const [fw, fh] = brand.canvas.feed;
  const [sw, sh] = brand.canvas.story;
  const out: RenderOutput[] = [];
  const footer = entry.footer;

  if (input.pair?.length === 2 && key === 'hero-photo') {
    const [a, b] = input.pair as [PairPhoto, PairPhoto];
    const names = [a.name, b.name] as [string, string];
    const pairOn = async (kind: 'feed' | 'story' | 'reel', w: number, h: number, photos: [Buffer, Buffer]) => {
      const data = PairData.parse({ kind, label: input.label, headline: kind === 'reel' ? input.hook ?? input.headline : input.headline, line: input.line, names, footer });
      return composePair(brand, w, h, photos, await layerToPng(brand, pairLayer(makeCtx(brand, w, h, input.settings), data), w, h));
    };
    const tall: [Buffer, Buffer] = [a.tall, b.tall];
    if (input.slot === 'reel') out.push({ format: 'reel-cover', page: null, png: await pairOn('reel', sw, sh, tall) });
    else out.push({ format: 'feed', page: null, png: await pairOn('feed', fw, fh, [a.feed, b.feed]) });
    out.push({ format: 'story', page: null, png: await pairOn('story', sw, sh, tall) });
    return out;
  }

  const design = input.design ?? null;
  const lift = design?.lift_tone ?? 'auto';
  const style = styleFor(input);

  /** The styled compositions at any canvas size; null when the style is band. The photo-free looks take no photo too. */
  const styledRender = async (w: number, h: number, photo: Buffer | null): Promise<Buffer | null> => {
    const ctx = makeCtx(brand, w, h, input.settings);
    const typeScale = design?.type_scale;
    const common = { label: input.label, headline: input.headline, line: input.line };
    const looks = { typeScale, accentWord: design?.accent_word, accentColor: design?.accent_color };
    const message = input.invite?.message?.trim() ?? '';
    if (!photo && !STYLES[style].photoFree) return null;
    switch (style) {
      case 'split': {
        if (!photo) return null;
        const layer = await layerToPng(brand, splitLayer(ctx, SplitData.parse({ ...common, footer, bandStrength: design?.band_strength, typeScale })), w, h);
        return composeLayoutB(brand, w, h, photo, layer, { lift });
      }
      case 'poster': {
        if (!input.cutout || !photo) return null;
        const layer = await layerToPng(brand, posterLayer(ctx, PosterData.parse({ label: input.label, headline: input.headline, footer, typeScale })), w, h);
        return composePoster(brand, w, h, input.cutout, layer, posterPlate(ctx));
      }
      case 'flat': {
        if (!input.cutout || !photo) return null;
        const layer = await layerToPng(brand, flatLayer(ctx, FlatData.parse({ ...common, hours: input.settings.openHours.slice(0, 24), handle: (input.settings.handle ?? '').slice(0, 40), typeScale })), w, h);
        return composeFlat(brand, w, h, input.cutout, layer, flatPlate(ctx));
      }
      case 'invite': {
        if (!photo) return null;
        const side = design?.text_side ?? 'left';
        const layer = await layerToPng(brand, inviteLayer(ctx, InviteData.parse({ ...common, ...inviteDate(input.invite?.date || input.date), hours: (input.invite?.time || input.settings.openHours).slice(0, 24), message: (input.invite?.message ?? '').slice(0, 24), address: input.settings.storeAddress.slice(0, 80), website: (input.settings.website ?? '').slice(0, 60), textSide: side, typeScale, accentColor: design?.accent_color })), w, h);
        return composeInvite(brand, w, h, photo!, layer, side === 'right' ? 'left' : 'right', INVITE_PHOTO_SHARE, { lift });
      }
      case 'arch': {
        const layer = await layerToPng(brand, archLayer(ctx, ArchData.parse({ ...common, ...looks })), w, h);
        return composeArch(brand, w, h, photo!, layer, archWindow(ctx), lift);
      }
      case 'countdown': {
        const big = input.invite?.date || null;
        const when = inviteDate(big);
        const layer = await layerToPng(brand, countdownLayer(ctx, CountdownData.parse({ ...common, ...countdownFor(big, input.date, message.slice(0, 24)), when: big ? `${when.day} ${when.date}`.trim().slice(0, 24) : '', ...looks, textSide: design?.text_side })), w, h);
        return composeInvite(brand, w, h, photo!, layer, design?.text_side === 'right' ? 'left' : 'right', COUNTDOWN_PHOTO_SHARE, { lift });
      }
      case 'ribbon':
      case 'deal': {
        // The house band design with the text at the bottom, so the top-right corner is free for the ribbon or sticker.
        const story = h / w > 1.6;
        const base = story
          ? storyLayer(ctx, StoryData.parse({ ...common, ...designFields(design), textPosition: 'bottom' }))
          : heroLayer(ctx, HeroData.parse({ ...common, layout: 'B', footer, busyPhoto: input.busyPhoto ?? false, ...designFields(design), textPosition: 'bottom' }));
        const extra = style === 'ribbon' ? ribbon(ctx, message || 'NEW ON THE MENU') : priceBadge(ctx, input.invite?.price ?? '', message);
        const layer = await layerToPng(brand, canvas(ctx, [base, extra]), w, h);
        return composeLayoutB(brand, w, h, photo!, layer, { lift });
      }
      case 'jaali': {
        const layer = await layerToPng(brand, jaaliLayer(ctx, JaaliData.parse({ ...common, hasPhoto: Boolean(photo), ...looks })), w, h);
        return composeJaali(brand, w, h, photo, layer, jaaliMedallion(ctx), lift);
      }
      case 'menu': {
        const items = (input.invite?.menu ?? []).filter((i) => i.name.trim()).slice(0, 6).map((i) => ({ name: i.name.trim().slice(0, 40), price: i.price.trim().slice(0, 12) }));
        const layer = await layerToPng(brand, menuLayer(ctx, MenuData.parse({ ...common, items, hasPhoto: Boolean(photo), ...looks })), w, h);
        return composeMenu(brand, w, h, photo, layer, menuStrip(ctx), lift);
      }
      case 'weekly': {
        // The owner's day, else the weekday the post goes up; the owner's time, else the opening hours.
        const day = input.invite?.day ?? weekdayOf(input.date);
        const time = (input.invite?.time?.trim() || input.settings.openHours).slice(0, 24);
        const layer = await layerToPng(brand, weeklyLayer(ctx, WeeklyData.parse({ ...common, day, time, message: message.slice(0, 40), ...looks })), w, h);
        return composeMenu(brand, w, h, photo, layer, await stripBelow(layer, weeklyStrip(ctx), Math.round(h * 0.28)), lift);
      }
      case 'stars': {
        const quotes = (input.invite?.quotes ?? []).filter((q) => q.text.trim()).slice(0, 3).map((q) => ({ text: q.text.trim().slice(0, 120), who: (q.who ?? '').trim().slice(0, 24) }));
        const layer = await layerToPng(brand, starsLayer(ctx, StarsData.parse({ ...common, rating: (input.invite?.rating ?? '').trim().slice(0, 4), quotes, hasPhoto: Boolean(photo), ...looks })), w, h);
        return composeMenu(brand, w, h, photo, layer, photo ? await stripBelow(layer, menuStrip(ctx), Math.round(h * 0.2)) : 0, lift);
      }
      case 'visit': {
        const s = input.settings;
        const layer = await layerToPng(brand, visitLayer(ctx, VisitData.parse({ ...common, address: s.storeAddress.slice(0, 80), hours: s.openHours.slice(0, 60), parking: message.slice(0, 40), website: (s.website ?? '').slice(0, 60), hasPhoto: Boolean(photo), ...looks })), w, h);
        return composeVisit(brand, w, h, photo, layer, visitFrame(ctx), lift);
      }
      case 'pillars': {
        const points = (input.invite?.points ?? []).map((p) => p.trim().slice(0, 32)).filter(Boolean).slice(0, 3);
        const layer = await layerToPng(brand, pillarsLayer(ctx, PillarsData.parse({ ...common, points, hasPhoto: Boolean(photo), ...looks })), w, h);
        return composePillars(brand, w, h, photo, layer, PILLARS_PHOTO_SHARE, pillarsClear(ctx), lift);
      }
      default:
        return null;
    }
  };

  const feed = async (): Promise<Buffer | null> => {
    switch (key) {
      case 'hero-photo': {
        if (!input.photo) return (style !== 'band' ? await styledRender(fw, fh, null) : null) ?? textOnly();
        const styled = style === 'band' ? null : await styledRender(fw, fh, input.photo);
        if (styled) return styled;
        // The spec's layout wins when it can be honoured; A needs a cutout.
        const layout: 'A' | 'B' = design?.layout === 'B' ? 'B' : input.cutout ? 'A' : 'B';
        const ctx = makeCtx(brand, fw, fh, input.settings);
        const data = HeroData.parse({ layout, label: input.label, headline: input.headline, line: input.line, footer, busyPhoto: input.busyPhoto ?? false, ...designFields(design) });
        const layer = await layerToPng(brand, heroLayer(ctx, data), fw, fh);
        return layout === 'A' && input.cutout
          ? composeLayoutA(brand, fw, fh, input.cutout, layer, data.textSide === 'left' ? 'right' : 'left')
          : composeLayoutB(brand, fw, fh, input.photo, layer, { lift });
      }
      case 'review': {
        const ctx = makeCtx(brand, fw, fh, input.settings);
        const layer = await layerToPng(brand, reviewLayer(ctx, ReviewData.parse({ quote: input.quote ?? input.line, reviewer: input.reviewer ?? 'A GUEST', label: 'CUSTOMER LOVE', footer, hasPhoto: Boolean(input.photo), bandStrength: design?.band_strength })), fw, fh);
        return input.photo ? composeLayoutB(brand, fw, fh, input.photo, layer, { lift }) : composeTextOnly(brand, fw, fh, layer);
      }
      case 'text-only':
        return textOnly();
      default:
        return null;
    }
  };

  const textOnly = async (): Promise<Buffer> => {
    const ctx = makeCtx(brand, fw, fh, input.settings);
    const layer = await layerToPng(brand, textOnlyLayer(ctx, TextOnlyData.parse({ label: input.label, headline: input.headline, line: input.line, footer })), fw, fh);
    return composeTextOnly(brand, fw, fh, layer);
  };

  if (key === 'carousel') {
    const ctx = makeCtx(brand, fw, fh, input.settings);
    const coverLayer = await layerToPng(brand, carouselCoverLayer(ctx, CarouselCoverData.parse({ cover_title: input.headline, label: input.label, bandStrength: design?.band_strength })), fw, fh);
    out.push({ format: 'carousel', page: 1, png: input.photo ? await composeLayoutB(brand, fw, fh, input.photo, coverLayer, { lift }) : await composeTextOnly(brand, fw, fh, coverLayer) });
    const slides = input.slides?.length ? input.slides : [input.line];
    const total = slides.length + 1;
    for (let i = 0; i < slides.length; i++) {
      const photo = input.slidePhotos?.[i] ?? null;
      const layer = await layerToPng(brand, carouselSlideLayer(ctx, CarouselSlideData.parse({ title: slides[i]!, index: i + 2, total, hasPhoto: Boolean(photo), closing: i === slides.length - 1 })), fw, fh);
      out.push({ format: 'carousel', page: i + 2, png: photo ? await composeLayoutB(brand, fw, fh, photo, layer) : await composeTextOnly(brand, fw, fh, layer) });
    }
  } else if (input.slot !== 'reel') {
    const png = await feed();
    if (png) out.push({ format: 'feed', page: null, png });
  }

  if (input.slot === 'reel' && input.photo) {
    const ctx = makeCtx(brand, sw, sh, input.settings);
    const layer = await layerToPng(brand, reelCoverLayer(ctx, ReelCoverData.parse({ hook: input.hook ?? input.headline, label: input.label, bandStrength: design?.band_strength })), sw, sh);
    out.push({ format: 'reel-cover', page: null, png: await composeLayoutB(brand, sw, sh, input.storyPhoto ?? input.photo, layer, { lift }) });
  }

  if (input.photo || (key === 'hero-photo' && STYLES[style].photoFree)) {
    // Most styles have a story of their own; invite's story is the band story.
    const styled = key === 'hero-photo' && style !== 'band' && STYLES[style].story ? await styledRender(sw, sh, input.storyPhoto ?? input.photo) : null;
    if (styled) out.push({ format: 'story', page: null, png: styled });
    else if (input.photo) {
      const ctx = makeCtx(brand, sw, sh, input.settings);
      // An invite's story carries its day and date, and the message over the time, like the feed post.
      const when = inviteDate(input.invite?.date || input.date);
      const hours = (input.invite?.time || input.settings.openHours).slice(0, 24);
      const message = (input.invite?.message ?? '').slice(0, 24);
      const details = style === 'invite' ? [
        ...(when.day || when.date ? [{ head: when.day || 'DATE', value: when.date || when.day }] : []),
        ...(hours ? [{ head: message || (when.day || when.date ? 'FROM' : 'OPEN'), value: hours }] : message ? [{ head: message, value: '' }] : []),
      ] : [];
      const layer = await layerToPng(brand, storyLayer(ctx, StoryData.parse({ label: input.label, headline: input.headline, line: input.line ?? '', details, ...designFields(design) })), sw, sh);
      out.push({ format: 'story', page: null, png: await composeLayoutB(brand, sw, sh, input.storyPhoto ?? input.photo, layer, { lift }) });
    }
  }
  return out;
}

/** Sample data per template key for the boot check, the snapshot tests and `npm run render-samples`. */
export const SAMPLE_INPUTS: Record<TemplateKey, Omit<RenderInput, 'photo' | 'cutout' | 'settings'>> = {
  'hero-photo': { sheetTemplate: 'from-the-karahi', slot: 'feed', label: 'COOKED TO ORDER', headline: 'Made Fresh\nin the Karahi', line: 'Prepared from raw ingredients and cooked fresh for every order.' },
  review: { sheetTemplate: 'customer-review', slot: 'feed', label: 'CUSTOMER LOVE', headline: 'Customer love', line: '', quote: 'Best karahi in Auburn. The chapli kebab was unreal and the staff were lovely.', reviewer: 'S.A.' },
  carousel: { sheetTemplate: 'chapli-education', slot: 'carousel', label: 'FROM THE FIRE', headline: 'What is\nChapli Kebab?', line: 'A Pakistani classic', slides: ['Bold spices', 'Fresh herbs', 'Hand-formed', 'Grilled over fire', 'Rooted in tradition'] },
  story: { sheetTemplate: 'from-the-fire', slot: 'feed', label: 'FROM THE FIRE', headline: 'Chapli\nKebab', line: '' },
  'reel-cover': { sheetTemplate: 'snack-pack', slot: 'reel', label: 'FROM THE FIRE', headline: 'Snack Pack', line: '', hook: 'Charcoal-grilled chicken tikka over hot chips' },
  'text-only': { sheetTemplate: 'brand-intro', slot: 'feed', label: 'THIS IS FUADIJAN', headline: 'Smoked. Grilled.\nRooted in Tradition.', line: 'Halal Pakistani charcoal BBQ, Auburn.' },
};

export const SAMPLE_SETTINGS: RenderSettings = { storeAddress: '129 Parramatta Road, Auburn NSW 2144', openHours: '5PM – 10PM' };

/** Boot check: every template renders with sample data (no photo), so a missing font or token fails loudly. */
export async function checkTemplates(brand: Brand = loadBrand()): Promise<void> {
  for (const [key, sample] of Object.entries(SAMPLE_INPUTS) as [TemplateKey, (typeof SAMPLE_INPUTS)[TemplateKey]][]) {
    if (key === 'story' || key === 'reel-cover') continue; // need a photo; covered by hero-photo's fonts
    const out = await renderPost({ ...sample, photo: null, cutout: null, settings: SAMPLE_SETTINGS }, brand);
    if (!out.length && key !== 'hero-photo') throw new Error(`Template ${key} rendered nothing`);
  }
}

export type { z };
