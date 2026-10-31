/**
 * Wording options: every resolve stores the main copy plus Claude's alternative wordings in copy_options, the
 * owner picks one (Telegram buttons, the Day page, or `/wording N k`) before the design is rendered, and every
 * set stays available afterwards, so a wording from an earlier run can be chosen again.
 */
import type { Db } from '../db/pool.js';
import type { CopyVariant, ResolvedCopy } from '../brain/schemas.js';
import type { Job } from './stages.js';

export interface WordingOption extends CopyVariant {}

export interface CopyOptions {
  id: number;
  calendar_row_id: number;
  job_id: number | null;
  options: WordingOption[];
  chosen: number | null;
  created_at: Date;
}

export const MAIN_NAME = 'Calendar wording';

/** The owner's own words become an option too (name "Your words"). */
export function optionsFrom(copy: ResolvedCopy): WordingOption[] {
  const main: WordingOption = { name: MAIN_NAME, headline: copy.headline, line: copy.line, caption: copy.caption };
  const seen = new Set([key(main)]);
  const out = [main];
  for (const v of copy.variants) {
    if (seen.has(key(v))) continue;
    seen.add(key(v));
    out.push({ name: v.name || `Option ${out.length + 1}`, headline: v.headline, line: v.line, caption: v.caption });
  }
  return out;
}

const key = (o: WordingOption) => `${o.headline}\u0000${o.line}\u0000${o.caption}`.toLowerCase();

export async function storeCopyOptions(db: Db, rowId: number, jobId: number | null, copy: ResolvedCopy): Promise<CopyOptions> {
  const options = optionsFrom(copy);
  const { rows } = await db.query<CopyOptions>(
    'insert into copy_options (calendar_row_id, job_id, options) values ($1, $2, $3) returning *',
    [rowId, jobId, JSON.stringify(options)]);
  return rows[0]!;
}

export async function latestCopyOptions(db: Db, rowId: number): Promise<CopyOptions | null> {
  return (await db.query<CopyOptions>('select * from copy_options where calendar_row_id = $1 order by created_at desc, id desc limit 1', [rowId])).rows[0] ?? null;
}

export async function allCopyOptions(db: Db, rowId: number): Promise<CopyOptions[]> {
  return (await db.query<CopyOptions>('select * from copy_options where calendar_row_id = $1 order by created_at desc, id desc', [rowId])).rows;
}

export async function copyOptionsById(db: Db, id: number): Promise<CopyOptions | null> {
  return (await db.query<CopyOptions>('select * from copy_options where id = $1', [id])).rows[0] ?? null;
}

export async function markChosen(db: Db, id: number, index: number): Promise<void> {
  await db.query('update copy_options set chosen = $2 where id = $1', [id, index]);
}

/** Appends the owner's typed headline as an option and marks it chosen; returns the new index. */
export async function addCustomOption(db: Db, set: CopyOptions, text: string): Promise<{ set: CopyOptions; index: number }> {
  const base = set.options[set.chosen ?? 0] ?? set.options[0]!;
  const custom: WordingOption = { name: 'Your words', headline: text.trim().slice(0, 60), line: base.line, caption: base.caption };
  const options = [...set.options, custom];
  const index = options.length - 1;
  await db.query('update copy_options set options = $2, chosen = $3 where id = $1', [set.id, JSON.stringify(options), index]);
  return { set: { ...set, options, chosen: index }, index };
}

/** The copy with one option's words in place of the main ones. */
export function applyOption(copy: ResolvedCopy, o: WordingOption): ResolvedCopy {
  return { ...copy, headline: o.headline, line: o.line, caption: o.caption, facebook_caption: `${o.caption.trim()} ${copy.cta.trim()}`.trim() };
}

/**
 * The owner picked a wording after the pack was made (Day page or /wording): a new job starts at the render stage
 * with the chosen words, so the designs and the pack are rebuilt and sent again. Null when the row has never
 * been resolved (nothing to re-render).
 */
export async function rerenderWithWording(db: Db, rowId: number, set: CopyOptions, index: number): Promise<Job | null> {
  const option = set.options[index];
  if (!option) return null;
  const prior = (await db.query<{ id: number; asset_id: number | null; state: { copy?: ResolvedCopy; jpegFileId?: string } }>(
    "select id, asset_id, state from jobs where calendar_row_id = $1 and state ? 'copy' order by id desc limit 1", [rowId])).rows[0];
  if (!prior?.state.copy) return null;
  await markChosen(db, set.id, index);
  const state = { copy: applyOption(prior.state.copy, option), wordingChosen: index, jpegFileId: prior.state.jpegFileId, note: `wording ${index + 1}` };
  const job = (await db.query<Job>(
    "insert into jobs (asset_id, calendar_row_id, stage, status, state) values ($1, $2, 'render', 'queued', $3) returning *",
    [prior.asset_id, rowId, JSON.stringify(state)])).rows[0]!;
  return job;
}
