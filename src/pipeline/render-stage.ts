/**
 * The render stage: the row's template, the resolved copy and the hero photo → PNGs in `files` + `renders` rows.
 *
 * For a hero photo the design is decided per photo, not by a fixed recipe: the photo is measured (analyze.ts), the
 * art director picks layout, text placement, band and type scale from the thumbnail and the numbers (design.ts),
 * the legibility maths raises the band until cream text reaches its contrast target, the owner's note overrides
 * all of it, and the critic looks at the finished feed PNG at phone size and may ask for one more pass. Reels get
 * a reel cover + story; feed rows a feed + story; carousels one page per slide.
 */
import type { CalendarRow } from '../calendar/rows.js';
import { getFile, putFile } from '../files.js';
import { analyzePhoto, type PhotoStats } from '../images/analyze.js';
import { cutoutFrom, cutoutUsable, removerFromConfig, type BackgroundRemover } from '../images/cutout.js';
import { cropAround, regionAround, thumbnail, upright } from '../images/prep.js';
import type { Critique, DesignSpec, MatchResult } from '../brain/schemas.js';
import { loadBrand } from '../render/brand.js';
import type { Cutout } from '../render/compose.js';
import { renderPost, type RenderInput, type RenderOutput } from '../render/index.js';
import { templateEntry } from '../render/registry.js';
import { STYLES, feasibleStyle } from '../render/styles.js';
import { allSettings } from '../settings.js';
import { CRITIQUE_FIX_BELOW, applyOwnerNote, critiqueDesign, directDesign, mergeFixes, withLegibility, type DesignRun } from './design.js';
import { customNote } from './custom.js';
import { designBrief, strategyIfAny } from '../strategy.js';
import type { Asset, StageContext } from './stages.js';

let remover: BackgroundRemover | null | undefined;
function getRemover(log: StageContext['log']): BackgroundRemover | null {
  if (remover !== undefined) return remover;
  try {
    remover = removerFromConfig();
  } catch (e) {
    log.warn(`Background remover unavailable: ${e instanceof Error ? e.message : e}`);
    remover = null;
  }
  return remover;
}

export interface CutoutResult { cutout: Cutout | null; coverage: number | null }

/**
 * The photo a design is made from: the upright JPEG the intake stored, or, when a job carries none (a redo of an
 * older row), the original set upright. The original may still hold the camera's orientation tag, which the
 * compositing ignores.
 */
async function sourcePhoto(ctx: StageContext, jpegFileId: string | null | undefined, originalId: string | null | undefined): Promise<{ bytes: Buffer; mime: string } | null> {
  const f = await getFile(ctx.pool, jpegFileId ?? originalId ?? '');
  if (!f) return null;
  return jpegFileId ? f : { ...f, bytes: await upright(f.bytes, f.mime) };
}

export async function cutoutForAsset(ctx: StageContext, asset: Asset, jpegFileId: string | null, read: MatchResult | null): Promise<CutoutResult> {
  const r = getRemover(ctx.log);
  if (!r || r.name === 'none') return { cutout: null, coverage: null };
  const brand = loadBrand();
  const original = await sourcePhoto(ctx, jpegFileId, asset.original_file_id);
  if (!original) return { cutout: null, coverage: null };
  try {
    // Segment the region around the dish, not the whole scene, so the plate (not the bread basket) is the subject.
    const source = await regionAround(original.bytes, read?.subject_box ?? null);
    const mask = await r.remove(source);
    const cut = await cutoutFrom(source, mask.mask, { feather: brand.cutout.feather, shadowBlur: brand.cutout.shadow.blur, shadowOpacity: brand.cutout.shadow.opacity });
    if (!cutoutUsable(cut.coverage, brand.cutout.minCoverage, brand.cutout.maxCoverage)) {
      ctx.log.info(`cutout skipped: coverage ${(cut.coverage * 100).toFixed(0)}%`);
      return { cutout: null, coverage: cut.coverage };
    }
    // The plate has to come with the food (the approved samples all keep it). When Claude located the plate, the
    // region is that box padded 1.35×, so the plate fills about 55% of it; a mask well under that means the model
    // kept the food and dropped the plate, and layout B (full photo) is the honest fallback.
    if (read?.subject_box && read.plate_shape !== 'none' && cut.coverage < 0.42) {
      ctx.log.info(`cutout skipped: mask covers ${(cut.coverage * 100).toFixed(0)}% of the plate region, plate probably lost`);
      return { cutout: null, coverage: cut.coverage };
    }
    const cutoutId = await putFile(ctx.pool, cut.cutout, 'image/png');
    const shadowId = await putFile(ctx.pool, cut.shadow, 'image/png');
    await ctx.pool.query("update assets set prepped = coalesce(prepped, '{}'::jsonb) || $2::jsonb where id = $1", [asset.id, JSON.stringify({ cutout: cutoutId, shadow: shadowId })]);
    return { cutout: cut, coverage: cut.coverage };
  } catch (e) {
    ctx.log.warn(`cutout failed, using layout B: ${e instanceof Error ? e.message : e}`);
    return { cutout: null, coverage: null };
  }
}

export interface RenderResult { outputs: RenderOutput[]; design: DesignRun | null }

export async function renderForRow(ctx: StageContext, row: CalendarRow): Promise<RenderResult> {
  const copy = ctx.job.state.copy;
  if (!copy) throw new Error('render needs resolved copy');
  const brand = loadBrand();
  const s = await allSettings(ctx.pool);
  const settings = { storeAddress: s.store_address ?? '', openHours: s.open_hours ?? '', handle: s.instagram_handle ?? '@fuadijan', website: s.website_url ?? '' };
  const entry = templateEntry(row.template);

  const assets = (await ctx.pool.query<Asset>("select * from assets where calendar_row_id = $1 and kind in ('photo','document') and prepped is not null order by created_at", [row.id])).rows;
  const hero = (ctx.asset?.prepped ? ctx.asset : assets.at(-1)) ?? null;
  const heroPhoto = hero?.prepped?.['4x5'] ? (await getFile(ctx.pool, hero.prepped['4x5']))?.bytes ?? null : null;
  const storyPhoto = hero?.prepped?.['9x16'] ? (await getFile(ctx.pool, hero.prepped['9x16']))?.bytes ?? null : null;
  const others = assets.filter((a) => a.id !== hero?.id);
  const slidePhotos: Buffer[] = [];
  for (const a of others) {
    const f = a.prepped?.['4x5'] ? await getFile(ctx.pool, a.prepped['4x5']) : null;
    if (f) slidePhotos.push(f.bytes);
  }

  // The photo read lives on the asset too, so a /redo (a fresh job with no state) still knows the composition.
  const read: MatchResult | null = ctx.job.state.match ?? hero?.match ?? null;
  const composition = read?.composition;
  // A custom post's chosen style reads like a note ("poster style"), unless this run's note names another.
  const note = customNote(row.custom, ctx.job.state.note ?? null);
  const { spec: noteSpec, locked } = applyOwnerNote(blankSpec(), note);
  const forceB = locked.includes('layout') && noteSpec.layout === 'B';
  const forceA = locked.includes('layout') && noteSpec.layout === 'A';
  // A style that needs the cutout (poster, flat), asked for in the note or preferred by the template, gets the try too.
  const askedStyle = locked.includes('style') ? noteSpec.style : entry.style ?? 'band';
  const styleNeedsCutout = STYLES[askedStyle].needsCutout;
  // A scene with a located dish still gets the cutout try: the remover works on the region around the dish.
  const wantCutout = entry.key === 'hero-photo' && hero && heroPhoto && !forceB && (forceA || styleNeedsCutout || (composition !== 'people' && (composition !== 'scene' || Boolean(read?.subject_box))));
  const cut: CutoutResult = wantCutout ? await cutoutForAsset(ctx, hero, ctx.job.state.jpegFileId ?? null, read) : { cutout: null, coverage: null };

  // Reviews: the quote is what the owner sent (an asset of kind text, "review -- AB …"), never generated.
  let quote: string | null = null;
  let reviewer: string | null = null;
  if (entry.key === 'review') {
    const r = (await ctx.pool.query<{ caption_raw: string; parsed_note: string | null }>("select caption_raw, parsed_note from assets where calendar_row_id = $1 and kind = 'text' order by created_at desc limit 1", [row.id])).rows[0];
    if (r) {
      quote = r.caption_raw.replace(/^review\s*(?:--|—)\s*[A-Za-z.]{1,6}\s*/i, '').trim();
      reviewer = r.parsed_note;
    }
    if (!quote) throw new Error('A review day needs the review text first: send "review -- AB" and the quote.');
  }

  const slides = entry.key === 'carousel' ? copy.on_screen_text.length ? copy.on_screen_text : (row.creative_instructions ?? '').match(/\d\)\s*“([^”]+)”/g)?.map((m) => m.replace(/^\d\)\s*“|”$/g, '')) ?? [] : undefined;

  const base: RenderInput = {
    sheetTemplate: row.template, slot: row.slot, label: copy.label || entry.label, headline: copy.headline, line: copy.line,
    quote, reviewer, slides, hook: copy.on_screen_text[0] ?? null,
    photo: heroPhoto, storyPhoto, slidePhotos, cutout: cut.cutout, busyPhoto: read?.background_clutter === 'high', settings, date: row.date,
  };

  // Templates without a directed design still get the legibility band: the photo under the text decides it.
  if (entry.key !== 'hero-photo' || !heroPhoto || !hero) {
    if (heroPhoto) {
      const stats = await analyzePhoto(heroPhoto);
      const { spec } = withLegibility({ ...blankSpec(), band_strength: 0.95 }, stats, brand);
      return { outputs: await renderPost({ ...base, design: { band_strength: spec.band_strength } }, brand), design: null };
    }
    return { outputs: await renderPost(base, brand), design: null };
  }

  // ── the directed design ──────────────────────────────────────────────────────────────────────────────────
  const stats = await analyzePhoto(heroPhoto);
  const designInput = {
    stats, read, cutoutAvailable: Boolean(cut.cutout), cutoutCoverage: cut.coverage, headline: copy.headline, line: copy.line,
    note, designNotes: s.design_notes ?? '', templateStyle: entry.style ?? null,
    strategy: strategyIfAny() ? designBrief(strategyIfAny()!) : null,
  };
  const directed = await directDesign(ctx, designInput, await thumbnail(heroPhoto, 512), ctx.job.id);
  let { spec } = applyOwnerNote(directed.spec, note);
  spec = feasible(spec);
  const source = locked.length ? 'owner' : directed.source;

  const original = (await sourcePhoto(ctx, ctx.job.state.jpegFileId, hero.original_file_id))?.bytes ?? null;
  const dish = read?.dish_canonical ?? row.dish;

  /** Layout A, poster and flat need the cutout; without one they become B / band. */
  function feasible(sp: DesignSpec): DesignSpec {
    const style = feasibleStyle(sp.style, { cutout: Boolean(cut.cutout), photo: true });
    const layout = sp.layout === 'A' && !cut.cutout ? 'B' : sp.layout;
    return style === sp.style && layout === sp.layout ? sp : { ...sp, style, layout };
  }

  const renderWith = async (sp: DesignSpec): Promise<{ outputs: RenderOutput[]; spec: DesignSpec; legibility: DesignRun['legibility'] }> => {
    const lit = withLegibility(feasible(sp), stats, brand);
    // The crop follows the text: with the block at the top the dish sits lower in the frame, and vice versa.
    let photo = heroPhoto;
    let story = storyPhoto;
    if (original && read?.subject_box && Math.abs(lit.spec.crop_focus_y - 0.42) > 0.04) {
      photo = await cropAround(original, read.subject_box, 4 / 5, { focusY: lit.spec.crop_focus_y });
      story = await cropAround(original, read.subject_box, 9 / 16, { focusY: Math.min(0.6, lit.spec.crop_focus_y) });
    }
    const outputs = await renderPost({ ...base, photo, storyPhoto: story, design: lit.spec }, brand);
    return { outputs, spec: lit.spec, legibility: lit.legibility };
  };

  let pass = await renderWith(spec);
  const feedPng = pass.outputs.find((o) => o.format === 'feed')?.png ?? null;
  let critique: Critique | null = feedPng ? await critiqueDesign(ctx, feedPng, pass.spec, dish, 1, [], ctx.job.id) : null;
  let attempts = 1;
  let firstScore: number | null = null;

  if (critique && critique.verdict === 'fix' && critique.score < CRITIQUE_FIX_BELOW && Object.keys(critique.fixes).length) {
    const fixed = mergeFixes(pass.spec, critique.fixes, locked);
    const second = await renderWith(fixed);
    const secondFeed = second.outputs.find((o) => o.format === 'feed')?.png ?? null;
    const secondCritique = secondFeed ? await critiqueDesign(ctx, secondFeed, second.spec, dish, 2, critique.issues, ctx.job.id) : null;
    attempts = 2;
    firstScore = critique.score;
    ctx.log.info(`design critique ${critique.score}/10 → fixes ${JSON.stringify(critique.fixes)} → ${secondCritique ? `${secondCritique.score}/10` : 'no second critique'}`);
    // Keep the better of the two; without a second read, trust the fix.
    if (!secondCritique || secondCritique.score >= critique.score) {
      pass = second;
      critique = secondCritique;
    }
  }

  return { outputs: pass.outputs, design: { spec: pass.spec, source, locked, legibility: pass.legibility, critique, attempts, firstScore } };
}

/** A neutral spec for note parsing and the no-director paths. */
function blankSpec(): DesignSpec {
  return { style: 'band', accent_word: false, layout: 'B', text_position: 'bottom', text_side: 'left', band_strength: 0.95, type_scale: 1, crop_focus_y: 0.42, lift_tone: false, rationale: '' };
}

export const RENDER_FILENAMES: Record<RenderOutput['format'], (page: number | null) => string> = {
  feed: () => 'feed.png',
  story: () => 'story.png',
  'reel-cover': () => 'reel-cover.png',
  carousel: (page) => `carousel-${String(page ?? 1).padStart(2, '0')}.png`,
};
