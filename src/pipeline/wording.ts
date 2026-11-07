/**
 * Wording options: every resolve stores the main copy plus Claude's alternative wordings in copy_options, the
 * owner picks one (Telegram buttons, the Day page, or `/wording N k`) before the design is rendered, and every
 * set stays available afterwards, so a wording from an earlier run can be chosen again.
 */
import { join } from 'node:path';
import type { Db } from '../db/pool.js';
import type { CopyVariant, ResolvedCopy } from '../brain/schemas.js';
import type { Slogan } from '../slogans.js';
import type { Job } from './stages.js';

export interface WordingOption extends CopyVariant {
  /** The owner wrote or changed it, so a new writer run keeps it. */
  owner?: boolean;
  /** The reusable wording it came from, so a change there reaches it. Older options have none and are matched by their words. */
  sloganId?: number;
}

/** Where the pack folders live (stages.ts writes them). */
export const PACKS_FOLDER = join(process.cwd(), 'packs');

export interface CopyOptions {
  id: number;
  calendar_row_id: number;
  job_id: number | null;
  options: WordingOption[];
  chosen: number | null;
  created_at: Date;
}

export const MAIN_NAME = 'Calendar wording';

/**
 * The calendar wording first, then Claude's alternatives, then the owner's slogans for the item (a slogan without
 * its own line or caption borrows the calendar's). Duplicates are dropped.
 */
export function optionsFrom(copy: ResolvedCopy, slogans: Slogan[] = [], extra: WordingOption[] = []): WordingOption[] {
  const main: WordingOption = { name: MAIN_NAME, headline: copy.headline, line: copy.line, caption: copy.caption };
  const seen = new Set([key(main)]);
  const out = [main];
  const push = (o: WordingOption) => {
    if (seen.has(key(o))) return;
    seen.add(key(o));
    out.push(o);
  };
  for (const v of copy.variants) push({ name: v.name || `Option ${out.length + 1}`, headline: v.headline, line: v.line, caption: v.caption });
  for (const e of extra) push(e);
  // A bank wording goes on the line under the product's name; its own line, if any, follows.
  for (const s of slogans) push(optionFromSlogan(s, copy.headline, copy.caption));
  return out;
}

/** A reusable wording as a post's option: it goes on the line under the post's title, and borrows the post's caption if it has none. */
export function optionFromSlogan(s: Slogan, headline: string, caption: string): WordingOption {
  return { name: `Slogan · ${s.item_key === 'all' ? 'house' : s.item}`, headline, line: asLine(s.headline, s.line), caption: s.caption ?? caption, sloganId: s.id };
}

/** Whether a post's option came from this reusable wording; older options have no link and are matched by their words. */
export function optionIsFrom(o: WordingOption, s: Pick<Slogan, 'id' | 'headline' | 'line'>): boolean {
  return o.sloganId === s.id || (o.sloganId === undefined && o.name.startsWith('Slogan ·') && o.line === asLine(s.headline, s.line));
}

const key = (o: WordingOption) => `${o.headline}\u0000${o.line}\u0000${o.caption}`.toLowerCase();

/** A two-line headline and its line as one supporting line: "Fresh off the grill. Halal, always." */
export function asLine(headline: string, line?: string | null): string {
  const flat = headline.replace(/\s*\n\s*/g, ' ').trim();
  const extra = line?.trim();
  return extra && !flat.toLowerCase().includes(extra.toLowerCase()) ? `${flat} ${extra}`.slice(0, 140) : flat;
}

export async function storeCopyOptions(db: Db, rowId: number, jobId: number | null, copy: ResolvedCopy, slogans: Slogan[] = [], extra: WordingOption[] = []): Promise<CopyOptions> {
  const options = optionsFrom(copy, slogans, extra);
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

/** Appends the owner's typed headline (and, when given, line and caption) as an option and marks it chosen; returns the new index. */
export async function addCustomOption(db: Db, set: CopyOptions, text: string, more: { line?: string | null; caption?: string | null } = {}): Promise<{ set: CopyOptions; index: number }> {
  const base = set.options[set.chosen ?? 0] ?? set.options[0]!;
  const custom: WordingOption = { name: 'Your words', headline: text.trim().slice(0, 60), line: more.line?.trim() || base.line, caption: more.caption?.trim() || base.caption, owner: true };
  const options = [...set.options, custom];
  const index = options.length - 1;
  await db.query('update copy_options set options = $2, chosen = $3 where id = $1', [set.id, JSON.stringify(options), index]);
  return { set: { ...set, options, chosen: index }, index };
}

/**
 * A post's option after its reusable wording changed; null when it isn't that wording's, or when the owner has changed it
 * on the post, which then stays theirs. The post's title stays. With no caption left, it borrows the post's main one.
 */
export function optionAfterSloganEdit(o: WordingOption, before: Slogan, after: Pick<Slogan, 'headline' | 'line' | 'caption'>, mainCaption: string): WordingOption | null {
  if (o.owner) return null;
  if (!optionIsFrom(o, before)) return null;
  const borrowed = before.caption ? o.caption !== before.caption : true;
  return { ...o, sloganId: before.id, line: asLine(after.headline, after.line), caption: after.caption ?? (borrowed ? o.caption : mainCaption) };
}

/** The owner's own wordings in the latest set, to carry into the next one. */
export function ownerOptions(set: CopyOptions | null): WordingOption[] {
  return set?.options.filter((o) => o.owner) ?? [];
}

/** The owner changes one wording's words; it is theirs from then on. */
export async function updateOption(db: Db, set: CopyOptions, index: number, words: Partial<Pick<WordingOption, 'headline' | 'line' | 'caption'>>): Promise<CopyOptions> {
  const old = set.options[index];
  if (!old) throw new Error('No such wording');
  const name = old.owner ? old.name : `${old.name} (edited)`;
  const options = set.options.map((o, i) => (i === index ? { ...o, ...words, name, owner: true } : o));
  await db.query('update copy_options set options = $2 where id = $1', [set.id, JSON.stringify(options)]);
  return { ...set, options };
}

/** The owner adds a wording to the post's latest set, starting a set when the post has none yet. Returns the set and where it landed. */
export async function addOwnerOption(db: Db, rowId: number, words: { headline: string; line: string; caption: string }): Promise<{ set: CopyOptions; index: number }> {
  const option: WordingOption = { name: 'Your words', ...words, owner: true };
  const set = await latestCopyOptions(db, rowId);
  if (!set) {
    const made = (await db.query<CopyOptions>('insert into copy_options (calendar_row_id, options) values ($1, $2) returning *', [rowId, JSON.stringify([option])])).rows[0]!;
    return { set: made, index: 0 };
  }
  const options = [...set.options, option];
  await db.query('update copy_options set options = $2 where id = $1', [set.id, JSON.stringify(options)]);
  return { set: { ...set, options }, index: options.length - 1 };
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
  const job = await rerenderRow(db, rowId, { wording: { option, index }, note: `wording ${index + 1}` });
  if (job) await markChosen(db, set.id, index);
  return job;
}

/**
 * The designs and the pack made again from the copy the post already has, with no writer run and no wording question.
 * `assetId` starts from another photo. Null when the post has never been written.
 */
/** The note a remade design runs with: the look asked for, then anything the owner wants changed. */
export function remakeNote(style: string | null | undefined, note: string | null | undefined): string | null {
  const parts = [style && style !== 'auto' ? `${style} style` : null, note?.trim().slice(0, 300) || null].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export async function rerenderRow(db: Db, rowId: number, opts: { wording?: { option: WordingOption; index: number }; note?: string; assetId?: number } = {}): Promise<Job | null> {
  const prior = (await db.query<{ asset_id: number | null; state: { copy?: ResolvedCopy; jpegFileId?: string; wordingChosen?: number } }>(
    "select asset_id, state from jobs where calendar_row_id = $1 and state ? 'copy' order by id desc limit 1", [rowId])).rows[0];
  if (!prior?.state.copy) return null;
  const assetId = opts.assetId ?? prior.asset_id;
  const jpegFileId = assetId === prior.asset_id ? prior.state.jpegFileId
    : (await db.query<{ jpeg: string | null }>("select state->>'jpegFileId' jpeg from jobs where asset_id = $1 and state ? 'jpegFileId' order by id desc limit 1", [assetId])).rows[0]?.jpeg ?? undefined;
  const chosen = opts.wording?.index ?? prior.state.wordingChosen ?? (await latestCopyOptions(db, rowId))?.chosen ?? 0;
  const state = { copy: opts.wording ? applyOption(prior.state.copy, opts.wording.option) : prior.state.copy, wordingChosen: chosen, jpegFileId, note: opts.note ?? null };
  return (await db.query<Job>(
    "insert into jobs (asset_id, calendar_row_id, stage, status, state) values ($1, $2, 'render', 'queued', $3) returning *",
    [assetId, rowId, JSON.stringify(state)])).rows[0]!;
}
