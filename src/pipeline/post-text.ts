/**
 * The owner's edits to a post's finished text, from the Day page. An edit is the owner's from then on: it goes on the
 * row (where a new writer run and a new workbook keep it), into the copy the job remembers, into the wording in use,
 * and straight into the pack, with no writer run and no question. Only text printed on the design rebuilds the design.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedCopy } from '../brain/schemas.js';
import { platformVersions, platformsTxt, type RecordField } from '../calendar/record.js';
import { editField, postAbout, recordEdit, reelClips, rowById, setClips, type CalendarRow, type EditSource } from '../calendar/rows.js';
import type { Db } from '../db/pool.js';
import { allSettings } from '../settings.js';
import { canvaBriefTxt, captionTxt, postTimeFor, reelPackTxt } from './packs.js';
import { aboutPost, itemKey, linkReaches, productGroups, sloganById, type Slogan } from '../slogans.js';
import { PACKS_FOLDER, applyOption, latestCopyOptions, optionAfterSloganEdit, optionFromSlogan, optionIsFrom, rerenderRow, rerenderWithWording, updateOption, type CopyOptions } from './wording.js';

const ROW_FIELDS = ['caption', 'cta', 'hashtags'] as const;
const RECORD_FIELDS = [
  'alt_text', 'story_text', 'facebook_caption', 'facebook_cta', 'facebook_hashtags', 'tiktok_opening', 'tiktok_hook', 'tiktok_script', 'tiktok_caption', 'tiktok_cta', 'tiktok_hashtags',
  'story_sequence', 'reel_cover_text', 'canva_headline', 'canva_subheading', 'hook',
] as const satisfies readonly RecordField[];

export const POST_TEXT_FIELDS = [...ROW_FIELDS, ...RECORD_FIELDS] as const;
export type PostTextField = (typeof POST_TEXT_FIELDS)[number];

/** Printed on the designs, so changing it means making them again. */
export const ON_THE_DESIGN: readonly PostTextField[] = ['canva_headline', 'canva_subheading', 'reel_cover_text', 'hook'];
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
    case 'hook': return value ? { ...copy, line: v } : copy;
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
  const clips = await reelClips(db, row);
  const captionText = captionTxt(row, copy, settings, postTime);
  const brief = canvaBriefTxt(row, copy, settings, pack.sources.layout ?? 'B', { feed: 'crop-4x5.jpg', story: 'crop-9x16.jpg' });
  const reelText = row.slot === 'reel' ? reelPackTxt(row, copy, clips.received, clips.picked) : null;
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

/** The latest wordings of every post written but not yet posted. */
async function unpostedSets(db: Db): Promise<CopyOptions[]> {
  return (await db.query<CopyOptions>(
    `select distinct on (o.calendar_row_id) o.* from copy_options o join calendar_rows r on r.id = o.calendar_row_id
     where r.retired_at is null and r.status <> 'posted' order by o.calendar_row_id, o.created_at desc, o.id desc`)).rows;
}

/**
 * A reusable wording was linked to an item or taken off one, and posts written but not yet posted follow: those about the
 * item get it in their list, or lose it when no other link reaches them. A post using it keeps it, as does one the owner
 * changed it on, and a post waiting on the owner's answer keeps its numbering. Returns how many posts changed.
 */
export async function spreadSloganLink(db: Db, id: number, item: string, linked: boolean): Promise<number> {
  const slogan = await sloganById(db, id);
  if (!slogan) return 0;
  const key = itemKey(item);
  const products = await productGroups(db);
  const keys = (await db.query<{ item_key: string }>('select item_key from slogan_items where slogan_id = $1', [id])).rows.map((r) => r.item_key);
  let posts = 0;
  for (const set of await unpostedSets(db)) {
    const row = await rowById(db, set.calendar_row_id);
    if (!row) continue;
    const about = aboutPost(postAbout(row), products);
    if (key !== 'all' && !linkReaches(key, about)) continue;
    const at = set.options.findIndex((o) => optionIsFrom(o, slogan));
    if (linked) {
      if (at >= 0) continue;
      const main = set.options[0];
      if (!main) continue;
      await db.query('update copy_options set options = $2 where id = $1', [set.id, JSON.stringify([...set.options, optionFromSlogan({ ...slogan, item, item_key: key }, main.headline, main.caption)])]);
      posts++;
      continue;
    }
    if (at < 0 || at === set.chosen || set.options[at]!.owner) continue;
    if (keys.some((k) => k === 'all' || linkReaches(k, about))) continue;
    if (await rowIsWaiting(db, row.id) || await rowIsBusy(db, row.id)) continue;
    const chosen = set.chosen != null && set.chosen > at ? set.chosen - 1 : set.chosen;
    await db.query('update copy_options set options = $2, chosen = $3 where id = $1', [set.id, JSON.stringify(set.options.filter((_, i) => i !== at)), chosen]);
    posts++;
  }
  return posts;
}

/**
 * A reusable wording changed: every post written but not yet posted that offers it gets the new words in its list. A post
 * using it follows, the pack at once and new designs only if the words on them changed. A wording the owner changed on
 * the post stays theirs. Returns how many posts changed and how many are having their designs made again.
 */
export async function spreadSloganEdit(db: Db, before: Slogan, after: Pick<Slogan, 'headline' | 'line' | 'caption'>): Promise<{ posts: number; rebuilding: number }> {
  let posts = 0;
  let rebuilding = 0;
  for (const set of await unpostedSets(db)) {
    const main = set.options[0]?.caption ?? '';
    const changes = set.options.map((o) => optionAfterSloganEdit(o, before, after, main));
    if (!changes.some(Boolean)) continue;
    const options = set.options.map((o, i) => changes[i] ?? o);
    await db.query('update copy_options set options = $2 where id = $1', [set.id, JSON.stringify(options)]);
    posts++;
    const inUse = set.chosen == null ? null : changes[set.chosen];
    if (!inUse) continue;
    const row = (await rowById(db, set.calendar_row_id))!;
    const job = await latestJobWithCopy(db, row.id);
    if (!job) continue;
    const waiting = await rowIsWaiting(db, row.id);
    const printed = inUse.line !== set.options[set.chosen!]!.line && row.slot !== 'reel';
    // A rebuild already running would write its own pack over a change made in place, so it gets another after it.
    if (!waiting && (printed || await rowIsBusy(db, row.id))) {
      if (await rerenderWithWording(db, row.id, { ...set, options }, set.chosen!)) rebuilding++;
      continue;
    }
    const copy = applyOption(job.copy, inUse);
    await db.query("update jobs set state = jsonb_set(state, '{copy}', $2::jsonb) where id = $1", [job.id, JSON.stringify(copy)]);
    await refreshPack(db, row, copy);
  }
  return { posts, rebuilding };
}

/** With `rerender: false` the designs are left as they are and `printed` says whether they would have been made again. */
export async function setPostText(db: Db, row: CalendarRow, field: PostTextField, raw: string | null, source: EditSource, opts: { rerender?: boolean } = {}): Promise<{ rebuilding: boolean; printed?: boolean }> {
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
  const inWording = field === 'caption' ? { caption: value! } : field === 'canva_headline' ? { headline: value! } : field === 'hook' && value ? { line: value } : null;
  if (inWording) {
    const set = await latestCopyOptions(db, row.id);
    if (set) await updateOption(db, set, set.chosen ?? 0, inWording);
  }

  const job = await latestJobWithCopy(db, row.id);
  if (!job) return { rebuilding: false };
  const copy = copyWith(job.copy, field, value);
  await db.query("update jobs set state = jsonb_set(state, '{copy}', $2::jsonb) where id = $1", [job.id, JSON.stringify(copy)]);
  const made = ((await db.query('select 1 from packs where calendar_row_id = $1 limit 1', [row.id])).rowCount ?? 0) > 0;
  if (!made) return { rebuilding: false };
  // The text changes either way: until the new designs arrive the page already shows it.
  await refreshPack(db, fresh, copy);
  // A reel's cover and story don't print the line.
  const printed = ON_THE_DESIGN.includes(field) && !(field === 'hook' && row.slot === 'reel');
  if (opts.rerender === false) return { rebuilding: false, printed };
  if (!printed || await rowIsWaiting(db, row.id)) return { rebuilding: false };
  return { rebuilding: Boolean(await rerenderRow(db, row.id)) };
}

/** The parts of a post the step-by-step builder saves at once, in the order they are applied. */
export const POST_PARTS = ['canva_subheading', 'canva_headline', 'hook', 'reel_cover_text', 'on_screen_text', 'caption', 'cta', 'hashtags'] as const;
export type PostPart = (typeof POST_PARTS)[number];

/**
 * Several parts of one post, as the builder sends them: each saved like a single edit, and the designs made again
 * once at the end when anything printed on them changed. Parts that say what they already say are left alone.
 */
export async function setPostParts(db: Db, row: CalendarRow, parts: Partial<Record<PostPart, string | null>>, source: EditSource, look?: { note: string | null; force: boolean }): Promise<{ rebuilding: boolean; changed: PostPart[] }> {
  if (await rowIsBusy(db, row.id)) throw new PostBusyError();
  const changed: PostPart[] = [];
  let printed = false;
  for (const field of POST_PARTS) {
    if (!(field in parts)) continue;
    const value = parts[field]?.trim() || null;
    const now = (await rowById(db, row.id))!;
    if (field === 'on_screen_text') {
      if ((now.on_screen_text?.trim() || null) === value) continue;
      await editField(db, now, 'on_screen_text', value, source);
      const job = await latestJobWithCopy(db, row.id);
      if (job) {
        const copy = { ...job.copy, on_screen_text: (value ?? '').split(/\s*(?:→|\n)\s*/).filter(Boolean) };
        await db.query("update jobs set state = jsonb_set(state, '{copy}', $2::jsonb) where id = $1", [job.id, JSON.stringify(copy)]);
        await refreshPack(db, (await rowById(db, row.id))!, copy);
      }
      changed.push(field);
      continue;
    }
    const was = (ROW_FIELDS as readonly string[]).includes(field) ? (now as unknown as Record<string, string | null>)[field] : now.content?.[field as RecordField];
    const same = field === 'hashtags' ? cleanHashtags(was ?? '') === cleanHashtags(value ?? '') : (was?.trim() || null) === value;
    if (same) continue;
    const r = await setPostText(db, now, field, value, source, { rerender: false });
    printed ||= Boolean(r.printed);
    changed.push(field);
  }
  // A new look (a style, the invite's details) makes the design again even when no words on it changed.
  if (!(printed || look?.force) || await rowIsWaiting(db, row.id)) return { rebuilding: false, changed };
  const made = ((await db.query('select 1 from packs where calendar_row_id = $1 limit 1', [row.id])).rowCount ?? 0) > 0;
  if (!made) return { rebuilding: false, changed };
  return { rebuilding: Boolean(await rerenderRow(db, row.id, { note: look?.note ?? undefined })), changed };
}

/** The clips picked for a reel, saved in order; the reel pack lists them at once (no design is made again). */
export async function setReelClips(db: Db, row: CalendarRow, ids: number[], source: EditSource): Promise<number[] | null> {
  const clips = await setClips(db, row, ids, source);
  const job = await latestJobWithCopy(db, row.id);
  if (job) await refreshPack(db, (await rowById(db, row.id))!, job.copy);
  return clips;
}
