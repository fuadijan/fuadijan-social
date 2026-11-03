/**
 * The post record: one calendar row carrying everything each platform needs. The owner's sheet may fill any of
 * these columns; what it leaves blank the writer drafts from the same facts. What the owner wrote is never
 * rewritten: `applyRecord` lays it over the writer's answer, and `platformVersions` is the finished set the pack
 * stores and the Day page shows.
 */
import type { ResolvedCopy } from '../brain/schemas.js';

/** Each stored field and the column names a sheet may use for it (matched without case, spaces or punctuation). */
export const RECORD_COLUMNS = {
  platform: ['Platform', 'Platforms'],
  content_goal: ['Content Goal', 'Goal'],
  funnel_stage: ['Funnel Stage', 'Funnel'],
  kpi: ['KPI', 'KPIs'],
  priority: ['Priority'],
  canva_headline: ['Canva Headline', 'Headline'],
  canva_subheading: ['Canva Subheading', 'Subheading'],
  reel_cover_text: ['Reel Cover Text', 'Reel Cover', 'Cover Text'],
  hook: ['Hook'],
  facebook_caption: ['Facebook Version', 'Facebook Caption', 'Facebook'],
  facebook_cta: ['Facebook CTA'],
  tiktok_opening: ['TikTok Opening Text', 'TikTok Opening'],
  tiktok_hook: ['TikTok Hook'],
  tiktok_script: ['TikTok Script', 'TikTok Version'],
  tiktok_cta: ['TikTok CTA'],
  tiktok_hashtags: ['TikTok Hashtags'],
  story_sequence: ['Story Sequence', 'Stories'],
  shot_list: ['Reel Shot List', 'Shot List', 'Shots'],
  image_prompt: ['AI Image Prompt', 'Image Prompt'],
  customer_message: ['Customer Message'],
} as const;

export type RecordField = keyof typeof RECORD_COLUMNS;
export type PostRecord = Partial<Record<RecordField, string>>;

/** The lines of a list cell, without "Shot 3:", "3)" or "- " in front, and without a line that is only "Shot 3". */
export function listLines(text: string | null | undefined): string[] {
  return (text ?? '').split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(shot|story)\s*\d+\s*:?$/i.test(l))
    .map((l) => l.replace(/^(?:(?:shot|story)\s*\d+\s*[:.)-]\s*|\d+[.)]\s*|[-•]\s*)/i, '').trim())
    .filter(Boolean);
}

/** A shot list as the instructions the shoot section and the reel pack read: "1) … 2) …". */
export function shotsAsInstructions(text: string | null | undefined): string | null {
  const lines = listLines(text);
  return lines.length ? lines.map((l, i) => `${i + 1}) ${l}`).join(' ') : null;
}

const tagsOf = (text: string | null | undefined): string[] => (text ?? '').split(/\s+/).filter((t) => t.startsWith('#'));

/** What the owner wrote goes over the writer's answer. An owner's note on this run may change the wording, so it leaves the title and line to the writer. */
export function applyRecord(copy: ResolvedCopy, row: { content: PostRecord | null; hashtags: string | null }, ownerNote = false): ResolvedCopy {
  const r = row.content;
  if (!r) return copy;
  const tags = row.hashtags?.includes('[') ? [] : tagsOf(row.hashtags);
  const headline = ownerNote ? null : r.canva_headline?.trim() || null;
  const facebook = [r.facebook_caption?.trim(), r.facebook_cta?.trim()].filter(Boolean).join('\n\n');
  return {
    ...copy,
    label: r.canva_subheading?.trim() || copy.label,
    headline: headline ?? copy.headline,
    line: (ownerNote ? null : r.hook?.trim()) || copy.line,
    hashtags: tags.length ? tags : copy.hashtags,
    facebook_caption: r.facebook_caption?.trim() ? facebook : copy.facebook_caption,
    variants: headline ? copy.variants.map((v) => ({ ...v, headline })) : copy.variants,
  };
}

export interface PlatformVersions {
  instagram: { caption: string; cta: string; hashtags: string[] };
  facebook: { caption: string; cta: string };
  tiktok: { opening: string; hook: string; script: string; cta: string; hashtags: string[] };
  stories: string[];
  reel_cover: string;
  canva: { headline: string; subheading: string };
  image_prompt: string;
  benefit: string;
  customer_message: string;
  notes: { platform: string; goal: string; funnel: string; kpi: string; priority: string; objective: string };
}

/** The finished set for one post: the owner's text first, then the writer's draft, then the row's own columns. `copy` is null before a pack exists. */
export function platformVersions(row: { content: PostRecord | null; caption: string | null; cta: string | null; hashtags: string | null; objective: string | null; benefit: string | null }, copy: ResolvedCopy | null): PlatformVersions {
  const r = row.content ?? {};
  const v = copy?.versions ?? null;
  const text = (s: string | null | undefined) => s?.trim() ?? '';
  return {
    instagram: { caption: text(copy?.caption ?? row.caption), cta: text(copy?.cta ?? row.cta), hashtags: copy?.hashtags ?? tagsOf(row.hashtags) },
    facebook: { caption: text(r.facebook_caption) || text(copy?.facebook_caption), cta: text(r.facebook_cta) },
    tiktok: {
      opening: text(r.tiktok_opening) || text(v?.tiktok_opening),
      hook: text(r.tiktok_hook) || text(r.hook) || text(v?.tiktok_hook),
      script: text(r.tiktok_script) || text(v?.tiktok_script),
      cta: text(r.tiktok_cta) || text(v?.tiktok_cta),
      hashtags: tagsOf(r.tiktok_hashtags).length ? tagsOf(r.tiktok_hashtags) : v?.tiktok_hashtags ?? [],
    },
    stories: r.story_sequence ? r.story_sequence.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : v?.stories ?? [],
    reel_cover: text(r.reel_cover_text) || text(v?.reel_cover_text),
    canva: { headline: text(r.canva_headline) || text(copy?.headline), subheading: text(r.canva_subheading) || text(copy?.label) },
    image_prompt: text(r.image_prompt) || text(v?.image_prompt),
    benefit: text(row.benefit),
    customer_message: text(r.customer_message),
    notes: { platform: text(r.platform), goal: text(r.content_goal), funnel: text(r.funnel_stage), kpi: text(r.kpi), priority: text(r.priority), objective: text(row.objective) },
  };
}

/** The same set as a text file for the pack folder; a section with nothing in it is left out. */
export function platformsTxt(p: PlatformVersions): string {
  const block = (title: string, ...lines: (string | null | undefined)[]) => {
    const kept = lines.filter((l): l is string => Boolean(l && l.trim()));
    return kept.length ? [`=== ${title} ===`, ...kept, ''] : [];
  };
  const named = (name: string, value: string) => (value ? `${name}: ${value}` : null);
  return [
    ...block('INSTAGRAM', p.instagram.caption, p.instagram.cta, p.instagram.hashtags.join(' ')),
    ...block('FACEBOOK', p.facebook.caption, p.facebook.cta),
    ...block('TIKTOK', named('Opening text', p.tiktok.opening), named('Hook', p.tiktok.hook), p.tiktok.script, named('CTA', p.tiktok.cta), p.tiktok.hashtags.join(' ')),
    ...block('STORY SEQUENCE', ...p.stories),
    ...block('REEL COVER', p.reel_cover),
    ...block('CANVA', named('Headline', p.canva.headline), named('Subheading', p.canva.subheading)),
    ...block('IMAGE PROMPT (a reference for the shoot or a mock-up, not a photo of the dish)', p.image_prompt),
    ...block('CUSTOMER BENEFIT', p.benefit, p.customer_message),
    ...block('INTERNAL NOTES (never posted)', named('Platform', p.notes.platform), named('Goal', p.notes.goal), named('Funnel stage', p.notes.funnel), named('Objective', p.notes.objective), named('KPI', p.notes.kpi), named('Priority', p.notes.priority)),
  ].join('\n');
}
