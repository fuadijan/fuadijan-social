/**
 * renderPost: template key + copy + photo (and maybe a cutout) → PNGs. Feed 1080×1350, story 1080×1920, one PNG
 * per carousel page, reel cover 1080×1920. The pipeline's render stage and `npm run render-samples` both come here.
 */
import type { z } from 'zod';
import type { DesignSpec } from '../brain/schemas.js';
import { loadBrand, type Brand } from './brand.js';
import { composeLayoutA, composeLayoutB, composeTextOnly, type Cutout } from './compose.js';
import { composeFlat, composeInvite, composePoster } from './compose-styles.js';
import { templateEntry, templateKeyFor, type TemplateKey } from './registry.js';
import { FlatData, INVITE_PHOTO_SHARE, InviteData, PosterData, SplitData, flatLayer, flatPlate, inviteLayer, posterLayer, posterPlate, splitLayer } from './styled.js';
import { STYLES, feasibleStyle, type Style } from './styles.js';
import {
  CarouselCoverData, CarouselSlideData, HeroData, ReelCoverData, ReviewData, StoryData, TextOnlyData,
  carouselCoverLayer, carouselSlideLayer, heroLayer, layerToPng, makeCtx, reelCoverLayer, reviewLayer, storyLayer, textOnlyLayer,
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
  /** The art director's (or heuristic) decisions; anything missing falls back to the house defaults. */
  design?: Partial<DesignSpec> | null;
  /** A 9:16 crop for the story; the feed photo is re-cropped when it is missing. */
  storyPhoto?: Buffer | null;
  /** The post's date (YYYY-MM-DD), shown by the invite style. */
  date?: string | null;
}

/** HeroData/StoryData fields from a design spec (undefined fields take the zod defaults). */
function designFields(d: Partial<DesignSpec> | null | undefined) {
  return { textPosition: d?.text_position, textSide: d?.text_side, bandStrength: d?.band_strength, typeScale: d?.type_scale, accentWord: d?.accent_word };
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

export async function renderPost(input: RenderInput, brand: Brand = loadBrand()): Promise<RenderOutput[]> {
  const key = templateKeyFor(input.sheetTemplate);
  const entry = templateEntry(input.sheetTemplate);
  const [fw, fh] = brand.canvas.feed;
  const [sw, sh] = brand.canvas.story;
  const out: RenderOutput[] = [];
  const footer = entry.footer;

  const design = input.design ?? null;
  const lift = design?.lift_tone ?? 'auto';
  const style = styleFor(input);

  /** The split, poster, flat and invite compositions at any canvas size; null when the style is band. */
  const styledRender = async (w: number, h: number, photo: Buffer): Promise<Buffer | null> => {
    const ctx = makeCtx(brand, w, h, input.settings);
    const typeScale = design?.type_scale;
    const common = { label: input.label, headline: input.headline, line: input.line };
    switch (style) {
      case 'split': {
        const layer = await layerToPng(brand, splitLayer(ctx, SplitData.parse({ ...common, footer, bandStrength: design?.band_strength, typeScale })), w, h);
        return composeLayoutB(brand, w, h, photo, layer, { lift });
      }
      case 'poster': {
        if (!input.cutout) return null;
        const layer = await layerToPng(brand, posterLayer(ctx, PosterData.parse({ label: input.label, headline: input.headline, footer, typeScale })), w, h);
        return composePoster(brand, w, h, input.cutout, layer, posterPlate(ctx));
      }
      case 'flat': {
        if (!input.cutout) return null;
        const layer = await layerToPng(brand, flatLayer(ctx, FlatData.parse({ ...common, hours: input.settings.openHours.slice(0, 24), handle: (input.settings.handle ?? '').slice(0, 40), typeScale })), w, h);
        return composeFlat(brand, w, h, input.cutout, layer, flatPlate(ctx));
      }
      case 'invite': {
        const side = design?.text_side ?? 'left';
        const layer = await layerToPng(brand, inviteLayer(ctx, InviteData.parse({ ...common, ...inviteDate(input.date), hours: input.settings.openHours.slice(0, 24), address: input.settings.storeAddress.slice(0, 80), website: (input.settings.website ?? '').slice(0, 60), textSide: side, typeScale })), w, h);
        return composeInvite(brand, w, h, photo, layer, side === 'right' ? 'left' : 'right', INVITE_PHOTO_SHARE, { lift });
      }
      default:
        return null;
    }
  };

  const feed = async (): Promise<Buffer | null> => {
    switch (key) {
      case 'hero-photo': {
        if (!input.photo) return textOnly();
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

  if (input.photo) {
    // Split, poster and flat have a story of their own; invite's story is the band story.
    const styled = key === 'hero-photo' && style !== 'band' && STYLES[style].story ? await styledRender(sw, sh, input.storyPhoto ?? input.photo) : null;
    if (styled) out.push({ format: 'story', page: null, png: styled });
    else {
      const ctx = makeCtx(brand, sw, sh, input.settings);
      const layer = await layerToPng(brand, storyLayer(ctx, StoryData.parse({ label: input.label, headline: input.headline, ...designFields(design) })), sw, sh);
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
