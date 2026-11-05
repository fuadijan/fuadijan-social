/**
 * The owner's edits to a post's finished text, from the Day page. An edit is the owner's from then on: it goes on the
 * row (where a new writer run and a new workbook keep it), into the copy the job remembers, into the wording in use,
 * and straight into the pack, with no writer run and no question. Only text printed on the design rebuilds the design.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedCopy } from '../brain/schemas.js';
import { platformVersions, platformsTxt, type RecordField } from '../calendar/record.js';
import { editField, recordEdit, rowById, type CalendarRow, type EditSource } from '../calendar/rows.js';
import type { Db } from '../db/pool.js';
import { allSettings } from '../settings.js';
import { canvaBriefTxt, captionTxt, postTimeFor, reelPackTxt } from './packs.js';
import { PACKS_FOLDER, latestCopyOptions, rerenderRow, updateOption } from './wording.js';

const ROW_FIELDS = ['caption', 'cta', 'hashtags'] as const;
const RECORD_FIELDS = [
  'alt_text', 'story_text', 'facebook_caption', 'facebook_cta', 'facebook_hashtags', 'tiktok_opening', 'tiktok_hook', 'tiktok_script', 'tiktok_caption', 'tiktok_cta', 'tiktok_hashtags',
  'story_sequence', 'reel_cover_text', 'canva_headline', 'canva_subheading',
] as const satisfies readonly RecordField[];

export const POST_TEXT_FIELDS = [...ROW_FIELDS, ...RECORD_FIELDS] as const;
export type PostTextField = (typeof POST_TEXT_FIELDS)[number];

/** Printed on the designs, so changing it means making them again. */
export const ON_THE_DESIGN: readonly PostTextField[] = ['canva_headline', 'canva_subheading', 'reel_cover_text'];
const REQUIRED: readonly PostTextField[] = ['caption', 'canva_headline'];

export class PostBusyError extends Error {
  constructor() {
    super('This post is being rebuilt. Try again in a minute.');
  }
}

/** Hashtags as the owner may type them (commas, a missing #, a repeat), one space apart. */
export function cleanHashtags(text: string): string {
  const tags = text.split(/[\s,]+/).filter(Boolean).map((t) => (t.startsWith('#') ? t : `#${t}`));
  return [...new Set(tags)].join(' ');
}

/** The copy with one field changed. A field the copy doesn't hold (the record alone supplies it) leaves it as it is. */
export function copyWith(copy: ResolvedCopy, field: PostTextField, value: string | null): ResolvedCopy {
  const v = value ?? '';
  switch (field) {
    case 'caption': return { ...copy, caption: v };
    case 'cta': return { ...copy, cta: v };
    case 'hashtags': return { ...copy, hashtags: v.split(/\s+/).filter(Boolean) };
    case 'alt_text': return { ...copy, alt_text: v };
    case 'story_text': return { ...copy, story_text: v };
    case 'facebook_caption': return value ? { ...copy, facebook_caption: v } : copy;
    case 'canva_headline': return { ...copy, headline: v };
    case 'canva_subheading': return value ? { ...copy, label: v } : copy;
    default: return copy;
  }
}

async function latestJobWithCopy(db: Db, rowId: number): Promise<{ id: number; copy: ResolvedCopy } | null> {
  const job = (await db.query<{ id: number; state: { copy?: ResolvedCopy } }>("select id, state from jobs where calendar_row_id = $1 and state ? 'copy' order by id desc limit 1", [rowId])).rows[0];
  return job?.state.copy ? { id: job.id, copy: job.state.copy } : null;
}

/** A job already waiting on the owner's answer makes the designs when it wakes, from what was just changed. */
export async function rowIsWaiting(db: Db, rowId: number): Promise<boolean> {
  return ((await db.query("select 1 from jobs where calendar_row_id = $1 and status = 'waiting' limit 1", [rowId])).rowCount ?? 0) > 0;
}

export async function rowIsBusy(db: Db, rowId: number): Promise<boolean> {
  return ((await db.query("select 1 from jobs where calendar_row_id = $1 and status in ('queued', 'running') limit 1", [rowId])).rowCount ?? 0) > 0;
}

/** The latest pack's text made again from this copy, in the database and in its folder when that is still there. */
async function refreshPack(db: Db, row: CalendarRow, copy: ResolvedCopy): Promise<boolean> {
  const pack = (await db.query<{ id: number; folder: string; sources: { layout?: 'A' | 'B' } }>('select id, folder, sources from packs where calendar_row_id = $1 order by created_at desc limit 1', [row.id])).rows[0];
  if (!pack) return false;
  const s = await allSettings(db);
  const settings = { storeAddress: s.store_address ?? '', openHours: s.open_hours ?? '', websiteUrl: s.website_url ?? '', instagramHandle: s.instagram_handle ?? '@fuadijan' };
  const postTime = postTimeFor(row, { post: s.post_time_default ?? '18:00', story: s.story_time_default ?? '12:00' });
  const clips = Number((await db.query<{ n: string }>("select count(*) n from assets where calendar_row_id = $1 and kind = 'video'", [row.id])).rows[0]!.n);
  const captionText = captionTxt(row, copy, settings, postTime);
  const brief = canvaBriefTxt(row, copy, settings, pack.sources.layout ?? 'B', { feed: 'crop-4x5.jpg', story: 'crop-9x16.jpg' });
  const reelText = row.slot === 'reel' ? reelPackTxt(row, copy, clips) : null;
  const platforms = platformVersions(row, copy);
  await db.query(
    'update packs set caption = $2, cta = $3, hashtags = $4, alt_text = $5, story_text = $6, facebook_caption = $7, caption_txt = $8, canva_brief = $9, reel_pack_txt = $10, platforms = $11 where id = $1',
    [pack.id, copy.caption, copy.cta, copy.hashtags, copy.alt_text, copy.story_text, copy.facebook_caption, captionText, brief, reelText, JSON.stringify(platforms)]);
  const folder = join(PACKS_FOLDER, pack.folder);
  if (existsSync(folder)) {
    writeFileSync(join(folder, 'caption.txt'), captionText);
    writeFileSync(join(folder, 'canva-brief.txt'), brief);
    writeFileSync(join(folder, 'platforms.txt'), platformsTxt(platforms));
    if (reelText) writeFileSync(join(folder, 'reel-pack.txt'), reelText);
  }
  return true;
}

export async function setPostText(db: Db, row: CalendarRow, field: PostTextField, raw: string | null, source: EditSource): Promise<{ rebuilding: boolean }> {
  if (!POST_TEXT_FIELDS.includes(field)) throw new Error(`field must be one of ${POST_TEXT_FIELDS.join(', ')}`);
  if (await rowIsBusy(db, row.id)) throw new PostBusyError();
  const trimmed = raw?.trim() || null;
  const value = trimmed && /hashtags$/.test(field) ? cleanHashtags(trimmed) : trimmed;
  if (!value && REQUIRED.includes(field)) throw new Error('This text cannot be empty.');

  if ((ROW_FIELDS as readonly string[]).includes(field)) {
    await editField(db, row, field as (typeof ROW_FIELDS)[number], value, source);
  } else {
    const old = row.content?.[field as RecordField] ?? null;
    await db.query(
      "update calendar_rows set content = case when $2::text is null then coalesce(content, '{}'::jsonb) - $3 else coalesce(content, '{}'::jsonb) || jsonb_build_object($3::text, $2::text) end, updated_at = now() where id = $1",
      [row.id, value, field]);
    await recordEdit(db, row.id, `content.${field}`, old, value, source);
  }
  const fresh = (await rowById(db, row.id))!;

  // The wording in use (the first one until one is picked) says the same, or picking it again would undo this edit.
  if (field === 'caption' || field === 'canva_headline') {
    const set = await latestCopyOptions(db, row.id);
    if (set) await updateOption(db, set, set.chosen ?? 0, field === 'caption' ? { caption: value! } : { headline: value! });
  }

  const job = await latestJobWithCopy(db, row.id);
  if (!job) return { rebuilding: false };
  const copy = copyWith(job.copy, field, value);
  await db.query("update jobs set state = jsonb_set(state, '{copy}', $2::jsonb) where id = $1", [job.id, JSON.stringify(copy)]);
  const made = ((await db.query('select 1 from packs where calendar_row_id = $1 limit 1', [row.id])).rowCount ?? 0) > 0;
  if (!made) return { rebuilding: false };
  // The text changes either way: until the new designs arrive the page already shows it.
  await refreshPack(db, fresh, copy);
  if (!ON_THE_DESIGN.includes(field) || await rowIsWaiting(db, row.id)) return { rebuilding: false };
  return { rebuilding: Boolean(await rerenderRow(db, row.id)) };
}
