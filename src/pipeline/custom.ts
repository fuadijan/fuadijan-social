/**
 * Custom designs: a one-off post the owner composes in the web app (Create) instead of the monthly workbook: a
 * product, a series template, a wording from the bank (or their own words, or the agent's), a style, which
 * formats to make, a date, and a photo (new, or one already received). It becomes a calendar row in the running
 * plan, numbered from 101 so a re-seed of the month never touches it, with the choices kept in `custom`; from
 * there the ordinary pipeline takes over (resolve → wording → render → pack → notify) with three differences,
 * all here: the owner's wording is used as given and not questioned, the chosen style is locked the way a /redo
 * note locks it, and only the formats asked for are kept.
 */
import type { Db } from '../db/pool.js';
import type { ResolvedCopy } from '../brain/schemas.js';
import { currentPlan, recordEdit, rowById, type CalendarRow, type CustomSpec, type CustomWording } from '../calendar/rows.js';
import { heroTemplates, templateEntry } from '../render/registry.js';
import type { RenderOutput } from '../render/index.js';
import { STYLE_KEYS, styleFromNote, type Style } from '../render/styles.js';
import { addDays, sydneyDate, type IsoDate } from '../time.js';
import type { Job } from './stages.js';

export const CUSTOM_FIRST_DAY = 101;
export const CUSTOM_FORMATS = ['feed', 'story'] as const;
export type CustomFormat = (typeof CUSTOM_FORMATS)[number];

export interface CustomInput {
  product: string;
  template: string;
  style: Style | 'auto';
  formats: CustomFormat[];
  wording: CustomWording | null;
  sloganId: number | null;
  date: IsoDate;
  postTime: string | null;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The web app's request body, checked; throws a message the owner can read. */
export function parseCustomInput(body: unknown): CustomInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const product = str(b.product, 60);
  if (!product) throw new Error('Which product is this about?');
  const template = str(b.template, 60);
  let entry;
  try {
    entry = templateEntry(template);
  } catch {
    throw new Error('Pick a series.');
  }
  if (entry.key !== 'hero-photo') throw new Error('Custom designs are photo posts; pick a photo series.');
  const style = str(b.style, 10) || 'auto';
  if (style !== 'auto' && !(STYLE_KEYS as readonly string[]).includes(style)) throw new Error('Pick a style.');
  const formats = Array.isArray(b.formats) ? (b.formats.filter((f): f is CustomFormat => (CUSTOM_FORMATS as readonly string[]).includes(f as string))) : [];
  if (!formats.length) throw new Error('Pick at least one format (feed or story).');
  const date = str(b.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new Error('Pick a date.');
  const postTime = str(b.postTime, 5) || null;
  if (postTime && !/^\d{2}:\d{2}$/.test(postTime)) throw new Error('The post time must be HH:MM.');
  let wording: CustomWording | null = null;
  if (b.wording && typeof b.wording === 'object') {
    const w = b.wording as Record<string, unknown>;
    const headline = str(w.headline, 60).replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join('\n');
    if (!headline) throw new Error('The wording needs a headline.');
    wording = { headline, line: str(w.line, 140), caption: str(w.caption, 2200) };
  }
  const sloganId = Number.isInteger(b.sloganId) ? Number(b.sloganId) : null;
  return { product, template, style: style as Style | 'auto', formats: [...new Set(formats)], wording, sloganId, date, postTime };
}

/** The row for a custom post, in the running plan (as of `today`), numbered from 101. */
export async function createCustomPost(db: Db, input: CustomInput, today: IsoDate = sydneyDate(new Date()), source: 'owner-web' | 'owner-telegram' = 'owner-web'): Promise<CalendarRow> {
  const plan = (await currentPlan(db, today)) ?? input.date.slice(0, 7);
  const spec: CustomSpec = { product: input.product, style: input.style, formats: input.formats, wording: input.wording, sloganId: input.sloganId };
  const { rows } = await db.query<{ id: number }>(
    `insert into calendar_rows (plan, day_no, date, slot, type, dish, post_time, template, status, objective, caption, custom)
     values ($1, (select greatest(coalesce(max(day_no), 0), $2::int - 1) + 1 from calendar_rows where plan = $1), $3, 'feed', 'custom', $4, $5, $6, 'planned', $7, $8, $9)
     returning id`,
    [plan, CUSTOM_FIRST_DAY, input.date, input.product, input.postTime, input.template, `Custom design: ${input.product}, made ${source === 'owner-web' ? 'in the web app' : 'from Telegram'}.`, input.wording?.caption || null, JSON.stringify(spec)]);
  const id = rows[0]!.id;
  await recordEdit(db, id, 'created', null, `custom design · ${input.style === 'auto' ? 'style by the art director' : `${input.style} style`} · ${input.formats.join(' + ')}`, source);
  return (await rowById(db, id))!;
}

/** The series for a custom post made without picking one: the karahi template for a karahi, else the first. */
export function defaultTemplate(product: string): string {
  const all = heroTemplates();
  const karahi = /karahi/i.test(product) ? all.find((t) => /karahi/i.test(t.label)) : null;
  return (karahi ?? all[0])!.template;
}

/** What `/custom …` says, read from the one line: the product, and any of a style, feed/story, a date, a time, and after `--` the wording. */
export interface CustomCommand {
  product: string;
  style: Style | 'auto';
  formats: CustomFormat[];
  date: IsoDate;
  postTime: string | null;
  /** Written out after `--` as `headline | line | caption` (a ` / ` in the headline breaks the line). */
  wording: CustomWording | null;
  /** `-- 2`: the second wording in the product's bank (as /slogan <item> lists them). */
  sloganIndex: number | null;
}

export const CUSTOM_USAGE = [
  '/custom <product> [band|split|poster|flat|invite] [feed|story] [date] [time] [-- <headline> | <line> | <caption>]',
  'e.g. /custom chapli kebab poster story tomorrow 7pm -- Hand-formed. / Fire-finished. | Grilled every evening.',
  'Leave the style out and the art director picks; leave feed/story out for both; "-- 2" uses wording 2 from /slogan chapli kebab; no "--" and the agent writes it.',
].join('\n');

export function parseCustomCommand(arg: string, today: IsoDate): CustomCommand {
  const m = arg.trim().match(/^([\s\S]*?)\s*(?:--|—)\s*([\s\S]+)$/);
  const head = (m ? m[1]! : arg).trim();
  const body = m ? m[2]!.trim() : '';
  let style: Style | 'auto' = 'auto';
  const formats: CustomFormat[] = [];
  let date: IsoDate | null = null;
  let postTime: string | null = null;
  const product: string[] = [];
  for (const tok of head.split(/\s+/).filter(Boolean)) {
    const t = tok.toLowerCase();
    if ((STYLE_KEYS as readonly string[]).includes(t)) style = t as Style;
    else if (t === 'auto') style = 'auto';
    else if (t === 'feed' || t === 'story') formats.push(t);
    else if (t === 'both') formats.push('feed', 'story');
    else if (/^\d{4}-\d{2}-\d{2}$/.test(t)) date = t as IsoDate;
    else if (t === 'today') date = today;
    else if (t === 'tomorrow') date = addDays(today, 1);
    else if (/^\d{1,2}:\d{2}$/.test(t)) postTime = t.padStart(5, '0');
    else if (/^\d{1,2}(:\d{2})?(am|pm)$/.test(t)) {
      const [, h, mm, ap] = t.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/)!;
      const hour = (Number(h) % 12) + (ap === 'pm' ? 12 : 0);
      postTime = `${String(hour).padStart(2, '0')}:${mm ?? '00'}`;
    } else product.push(tok);
  }
  if (!product.length) throw new Error(`Which product?\n${CUSTOM_USAGE}`);
  let wording: CustomWording | null = null;
  let sloganIndex: number | null = null;
  if (/^\d{1,2}$/.test(body)) sloganIndex = Number(body);
  else if (body) {
    const [headline = '', line = '', caption = ''] = body.split('|').map((p) => p.trim());
    if (!headline) throw new Error('The wording needs a headline: -- <headline> | <line> | <caption>');
    wording = { headline: headline.replace(/\s*\/\s*/g, '\n'), line, caption };
  }
  return { product: product.join(' '), style, formats: formats.length ? [...new Set(formats)] : ['feed', 'story'], date: date ?? today, postTime, wording, sloganIndex };
}

/** The product's earlier photos, newest first: the ones the owner may want to reuse for a custom post. */
export function photosOf(photos: RecentPhoto[], product: string): RecentPhoto[] {
  const words = product.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
  const hit = (s: string | null) => Boolean(s) && words.some((w) => s!.toLowerCase().includes(w));
  return photos.filter((p) => hit(p.dish) || hit(p.caption));
}

/**
 * A photo already in the system, filed again for the custom row: the same original, crops, cutout and photo
 * read, and a job that starts at resolve (the photo needs no new intake, match or prep).
 */
export async function adoptAsset(db: Db, row: CalendarRow, assetId: number): Promise<Job> {
  const src = (await db.query<{ id: number; original_file_id: string | null }>("select id, original_file_id from assets where id = $1 and kind in ('photo','document') and prepped is not null", [assetId])).rows[0];
  if (!src) throw new Error('That photo is not available any more.');
  const clone = (await db.query<{ id: number }>(
    `insert into assets (kind, filename, mime, caption_raw, parsed_subject, parsed_tags, parsed_note, calendar_row_id, set_key, original_file_id, width, height, quality, prepped, match)
     select kind, filename, mime, $3, $4, parsed_tags, parsed_note, $2, $5, original_file_id, width, height, quality, prepped, match from assets where id = $1 returning id`,
    [src.id, row.id, `${row.dish ?? 'photo'} #day${row.day_no}`, row.dish, `row-${row.id}-${Date.now()}`])).rows[0]!;
  const prior = (await db.query<{ jpeg: string | null }>("select state->>'jpegFileId' jpeg from jobs where asset_id = $1 and state ? 'jpegFileId' order by id desc limit 1", [src.id])).rows[0];
  const state = { jpegFileId: prior?.jpeg ?? src.original_file_id ?? undefined, note: null };
  return (await db.query<Job>(
    "insert into jobs (asset_id, calendar_row_id, stage, status, state) values ($1, $2, 'resolve', 'queued', $3) returning *",
    [clone.id, row.id, JSON.stringify(state)])).rows[0]!;
}

export interface RecentPhoto { assetId: number; thumb: string | null; caption: string | null; dayNo: number | null; dish: string | null; createdAt: Date }

/** Photos the pipeline has prepared, newest first, one per original (a photo adopted by a custom post is not listed twice). */
export async function recentPhotos(db: Db, limit = 40): Promise<RecentPhoto[]> {
  const { rows } = await db.query<{ id: number; thumb: string | null; caption_raw: string | null; day_no: number | null; dish: string | null; created_at: Date }>(
    `select distinct on (coalesce(a.original_file_id, a.id::text)) a.id, a.prepped->>'thumb' thumb, a.caption_raw, r.day_no, r.dish, a.created_at
       from assets a left join calendar_rows r on r.id = a.calendar_row_id
      where a.kind in ('photo','document') and a.prepped is not null
      order by coalesce(a.original_file_id, a.id::text), a.created_at`);
  return rows
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    .slice(0, limit)
    .map((r) => ({ assetId: r.id, thumb: r.thumb, caption: r.caption_raw, dayNo: r.day_no, dish: r.dish, createdAt: r.created_at }));
}

/** The note the render stage parses: the custom style, unless the run's own note (a /redo) already names one. */
export function customNote(spec: CustomSpec | null | undefined, note: string | null): string | null {
  if (!spec || spec.style === 'auto') return note;
  if (note && styleFromNote(note)) return note;
  return [note, `${spec.style} style`].filter(Boolean).join(', ');
}

/** What the resolve prompt is told about a custom post. */
export interface RedoContext {
  redo: true;
  /** Fields the owner changed on the row after making the post, as `field: "value"` lines. */
  ownerEdits: string[];
}

/**
 * Fields the owner edited on the row after it was made (dish, theme, objective, creative instructions), newest
 * value per field, as `field: "value"` lines for the writer.
 */
export async function ownerEditsSince(db: Db, row: CalendarRow): Promise<string[]> {
  const { rows } = await db.query<{ field: string; new_value: string | null }>(
    `select distinct on (field) field, new_value from calendar_edits
     where row_id = $1 and source like 'owner%' and field in ('dish', 'theme', 'objective', 'creative_instructions', 'on_screen_text')
     order by field, created_at desc`, [row.id]);
  return rows.filter((r) => r.new_value?.trim()).map((r) => `${r.field}: "${r.new_value!.trim()}"`);
}

export function customResolveNote(spec: CustomSpec, redo?: RedoContext): string {
  if (spec.wording && redo) {
    const w = spec.wording;
    const edits = redo.ownerEdits.length ? ` Since then the owner changed ${redo.ownerEdits.join(', ')}; write around the new values.` : '';
    return `This is a one-off custom post about ${spec.product}. When it was made the owner composed its wording (headline: "${w.headline.replace(/\n/g, ' / ')}"${w.line ? `; line: "${w.line}"` : ''}${w.caption ? `; caption: "${w.caption}"` : ''}). The owner now asks for it to be done again.${edits} If the owner's note, or a changed dish or theme, calls for different words (a new title, headline, wording, theme or tone), write a new headline and line in the brand's voice; otherwise keep the owner's words as the main headline and line. Offer two alternatives as variants either way. Ask nothing: leave unresolved empty.`;
  }
  if (spec.wording) {
    const w = spec.wording;
    return `This is a one-off custom post about ${spec.product}, composed by the owner. The headline and the line are the owner's own words and are used exactly as given (headline: "${w.headline.replace(/\n/g, ' / ')}"${w.line ? `; line: "${w.line}"` : ''}${w.caption ? `; caption: "${w.caption}"` : ''}). Write the ${w.caption ? 'alternative captions' : 'caption'}, CTA, hashtags, alt text and story text around them. Ask nothing: leave unresolved empty.`;
  }
  return `This is a one-off custom post about ${spec.product}, composed by the owner in the web app; there is no calendar brief beyond the product and the series. Write the headline, line and caption for it from the menu facts.`;
}

/** The owner's words in place of the agent's; nothing left to ask. */
export function applyCustomWording(copy: ResolvedCopy, spec: CustomSpec | null | undefined): ResolvedCopy {
  if (!spec?.wording) return copy;
  const w = spec.wording;
  const caption = w.caption.trim() || copy.caption;
  return { ...copy, headline: w.headline.trim(), line: w.line.trim() || copy.line, caption, facebook_caption: `${caption.trim()} ${copy.cta.trim()}`.trim(), unresolved: [] };
}

/** Only the formats the owner asked for (carousel pages and reel covers are never custom). */
export function keepFormats<T extends Pick<RenderOutput, 'format'>>(outputs: T[], spec: CustomSpec | null | undefined): T[] {
  if (!spec) return outputs;
  return outputs.filter((o) => (o.format === 'feed' || o.format === 'story' ? spec.formats.includes(o.format) : true));
}
