/**
 * The render stage: the row's template, the resolved copy and the hero photo → PNGs in `files` + `renders` rows.
 * Single-plate photos get the plate cutout (from the whole photo, not the crop) when the mask is usable; anything
 * else, or a remover that is off or fails, renders as layout B. Reels get a reel cover + story; feed rows a feed +
 * story; carousels one page per slide.
 */
import type { CalendarRow } from '../calendar/rows.js';
import { getFile, putFile } from '../files.js';
import { cutoutFrom, cutoutUsable, removerFromConfig, type BackgroundRemover } from '../images/cutout.js';
import { regionAround } from '../images/prep.js';
import type { MatchResult } from '../brain/schemas.js';
import { loadBrand } from '../render/brand.js';
import type { Cutout } from '../render/compose.js';
import { renderPost, type RenderOutput } from '../render/index.js';
import { templateEntry } from '../render/registry.js';
import { allSettings } from '../settings.js';
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

export async function cutoutForAsset(ctx: StageContext, asset: Asset, jpegFileId: string | null, read: MatchResult | null): Promise<Cutout | null> {
  const r = getRemover(ctx.log);
  if (!r || r.name === 'none') return null;
  const brand = loadBrand();
  const original = await getFile(ctx.pool, jpegFileId ?? asset.original_file_id ?? '');
  if (!original) return null;
  try {
    // Segment the region around the dish, not the whole scene, so the plate (not the bread basket) is the subject.
    const source = await regionAround(original.bytes, read?.subject_box ?? null);
    const mask = await r.remove(source);
    const cut = await cutoutFrom(source, mask.mask, { feather: brand.cutout.feather, shadowBlur: brand.cutout.shadow.blur, shadowOpacity: brand.cutout.shadow.opacity });
    if (!cutoutUsable(cut.coverage, brand.cutout.minCoverage, brand.cutout.maxCoverage)) {
      ctx.log.info(`cutout skipped: coverage ${(cut.coverage * 100).toFixed(0)}%`);
      return null;
    }
    const cutoutId = await putFile(ctx.pool, cut.cutout, 'image/png');
    const shadowId = await putFile(ctx.pool, cut.shadow, 'image/png');
    await ctx.pool.query("update assets set prepped = coalesce(prepped, '{}'::jsonb) || $2::jsonb where id = $1", [asset.id, JSON.stringify({ cutout: cutoutId, shadow: shadowId })]);
    return cut;
  } catch (e) {
    ctx.log.warn(`cutout failed, using layout B: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

export async function renderForRow(ctx: StageContext, row: CalendarRow): Promise<RenderOutput[]> {
  const copy = ctx.job.state.copy;
  if (!copy) throw new Error('render needs resolved copy');
  const brand = loadBrand();
  const s = await allSettings(ctx.pool);
  const settings = { storeAddress: s.store_address ?? '', openHours: s.open_hours ?? '' };
  const entry = templateEntry(row.template);

  const assets = (await ctx.pool.query<Asset>("select * from assets where calendar_row_id = $1 and kind in ('photo','document') and prepped is not null order by created_at", [row.id])).rows;
  const hero = (ctx.asset?.prepped ? ctx.asset : assets.at(-1)) ?? null;
  const heroPhoto = hero?.prepped?.['4x5'] ? (await getFile(ctx.pool, hero.prepped['4x5']))?.bytes ?? null : null;
  const others = assets.filter((a) => a.id !== hero?.id);
  const slidePhotos: Buffer[] = [];
  for (const a of others) {
    const f = a.prepped?.['4x5'] ? await getFile(ctx.pool, a.prepped['4x5']) : null;
    if (f) slidePhotos.push(f.bytes);
  }

  // The photo read lives on the asset too, so a /redo (a fresh job with no state) still knows the composition.
  const read: MatchResult | null = ctx.job.state.match ?? hero?.match ?? null;
  const composition = read?.composition;
  // A scene with a located dish still gets the cutout try: the remover works on the region around the dish.
  const wantCutout = entry.key === 'hero-photo' && hero && heroPhoto && composition !== 'people' && (composition !== 'scene' || Boolean(read?.subject_box));
  const cutout = wantCutout ? await cutoutForAsset(ctx, hero, ctx.job.state.jpegFileId ?? null, read) : null;

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

  return renderPost({
    sheetTemplate: row.template, slot: row.slot, label: copy.label || entry.label, headline: copy.headline, line: copy.line,
    quote, reviewer, slides, hook: copy.on_screen_text[0] ?? null,
    photo: heroPhoto, slidePhotos, cutout, busyPhoto: read?.background_clutter === 'high', settings,
  }, brand);
}

export const RENDER_FILENAMES: Record<RenderOutput['format'], (page: number | null) => string> = {
  feed: () => 'feed.png',
  story: () => 'story.png',
  'reel-cover': () => 'reel-cover.png',
  carousel: (page) => `carousel-${String(page ?? 1).padStart(2, '0')}.png`,
};
