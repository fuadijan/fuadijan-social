/**
 * The calendar rows: reads, status writes with an edits history, skip and push. The agent changes `status`,
 * `posted_at` and whatever an /edit asks for; nothing else, and never `dish` on its own.
 */
import type { Db } from '../db/pool.js';
import { addDays, sydneyDate, type IsoDate } from '../time.js';

export type Slot = 'feed' | 'carousel' | 'reel';
export type Status = 'planned' | 'photo-needed' | 'ready' | 'posted';
export type EditSource = 'owner-telegram' | 'owner-web' | 'agent' | 'seed';

export interface CalendarRow {
  id: number;
  /** The month the row's workbook was for, YYYY-MM; day numbers restart each plan. */
  plan: string;
  day_no: number;
  date: IsoDate;
  slot: Slot;
  type: string;
  dish: string | null;
  theme: string | null;
  caption_hint: string | null;
  post_time: string | null; // HH:MM:SS from pg
  template: string;
  status: Status;
  asset: string | null;
  objective: string | null;
  creative_instructions: string | null;
  on_screen_text: string | null;
  caption: string | null;
  cta: string | null;
  hashtags: string | null;
  story_ideas: string | null;
  confirmation_notes: string | null;
  posted_at: Date | null;
  updated_at: Date;
}

/** The text fields the owner may edit; `status`/`posted_at` go through markPosted. */
export const EDITABLE_FIELDS = ['dish', 'caption', 'cta', 'hashtags', 'story_ideas', 'post_time', 'on_screen_text', 'creative_instructions', 'theme', 'objective', 'confirmation_notes'] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

const COLS = 'id, plan, day_no, to_char(date, \'YYYY-MM-DD\') as date, slot, type, dish, theme, caption_hint, to_char(post_time, \'HH24:MI\') as post_time, template, status, asset, objective, creative_instructions, on_screen_text, caption, cta, hashtags, story_ideas, confirmation_notes, posted_at, updated_at';

/** Every plan with its first and last date, oldest first. */
export async function plans(db: Db): Promise<{ plan: string; first: IsoDate; last: IsoDate; rows: number }[]> {
  const { rows } = await db.query<{ plan: string; first: IsoDate; last: IsoDate; rows: string }>(
    "select plan, to_char(min(date), 'YYYY-MM-DD') first, to_char(max(date), 'YYYY-MM-DD') last, count(*) rows from calendar_rows group by plan order by min(date)");
  return rows.map((r) => ({ ...r, rows: Number(r.rows) }));
}

/**
 * The plan "Day N" refers to: the latest plan that has started by `today`, else the next one to start. A new
 * month's workbook sits beside the running one until its first date comes round.
 */
export async function currentPlan(db: Db, today: IsoDate = sydneyDate(new Date())): Promise<string | null> {
  const all = await plans(db);
  if (!all.length) return null;
  const started = all.filter((p) => p.first <= today);
  return (started.at(-1) ?? all[0]!).plan;
}

/** The current plan's rows (or a named plan's), by day number. */
export async function allRows(db: Db, plan?: string | null): Promise<CalendarRow[]> {
  const p = plan ?? await currentPlan(db);
  if (!p) return [];
  return (await db.query<CalendarRow>(`select ${COLS} from calendar_rows where plan = $1 order by day_no`, [p])).rows;
}

export async function rowByDay(db: Db, dayNo: number, plan?: string | null): Promise<CalendarRow | null> {
  const p = plan ?? await currentPlan(db);
  if (!p) return null;
  return (await db.query<CalendarRow>(`select ${COLS} from calendar_rows where plan = $1 and day_no = $2`, [p, dayNo])).rows[0] ?? null;
}

export async function rowById(db: Db, id: number): Promise<CalendarRow | null> {
  return (await db.query<CalendarRow>(`select ${COLS} from calendar_rows where id = $1`, [id])).rows[0] ?? null;
}

export async function rowsOnDate(db: Db, date: IsoDate): Promise<CalendarRow[]> {
  return (await db.query<CalendarRow>(`select ${COLS} from calendar_rows where date = $1 order by day_no`, [date])).rows;
}

/** Rows dated from..to inclusive. */
export async function rowsBetween(db: Db, from: IsoDate, to: IsoDate): Promise<CalendarRow[]> {
  return (await db.query<CalendarRow>(`select ${COLS} from calendar_rows where date between $1 and $2 order by date, day_no`, [from, to])).rows;
}

export async function recordEdit(db: Db, rowId: number, field: string, oldValue: string | null, newValue: string | null, source: EditSource): Promise<void> {
  await db.query('insert into calendar_edits (row_id, field, old_value, new_value, source) values ($1, $2, $3, $4, $5)', [rowId, field, oldValue, newValue, source]);
}

export async function setStatus(db: Db, row: CalendarRow, status: Status, source: EditSource = 'agent'): Promise<void> {
  if (row.status === status) return;
  await db.query('update calendar_rows set status = $2, updated_at = now() where id = $1', [row.id, status]);
  await recordEdit(db, row.id, 'status', row.status, status, source);
}

export async function markPosted(db: Db, row: CalendarRow, source: EditSource, at: Date = new Date()): Promise<void> {
  await db.query("update calendar_rows set status = 'posted', posted_at = $2, updated_at = now() where id = $1", [row.id, at]);
  await recordEdit(db, row.id, 'status', row.status, 'posted', source);
}

export async function editField(db: Db, row: CalendarRow, field: EditableField, value: string | null, source: EditSource): Promise<void> {
  if (!EDITABLE_FIELDS.includes(field)) throw new Error(`Not an editable field: ${field}`);
  if (field === 'post_time' && value !== null && !/^\d{2}:\d{2}$/.test(value)) throw new Error('post_time must be HH:MM');
  const old = (row as unknown as Record<string, string | null>)[field] ?? null;
  await db.query(`update calendar_rows set ${field} = $2, updated_at = now() where id = $1`, [row.id, value]);
  await recordEdit(db, row.id, field, old, value, source);
}

/** Moves one row by `days` (negative allowed). The date it lands on may already hold a row; that's allowed. */
export async function pushRow(db: Db, row: CalendarRow, days: number, source: EditSource): Promise<IsoDate> {
  const next = addDays(row.date, days);
  await db.query('update calendar_rows set date = $2, updated_at = now() where id = $1', [row.id, next]);
  await recordEdit(db, row.id, 'date', row.date, next, source);
  return next;
}

/**
 * `skip N`: the row stays planned and moves to the next free date. Either everything dated after it moves by a
 * day too (the calendar keeps its order) or just this one moves to the first date with no row.
 */
export async function skipRow(db: Db, row: CalendarRow, mode: 'push-all' | 'just-this', source: EditSource): Promise<IsoDate> {
  if (mode === 'push-all') {
    // Only this plan moves; next month's rows stay where they are.
    const later = (await db.query<{ id: number; date: string }>("select id, to_char(date, 'YYYY-MM-DD') as date from calendar_rows where plan = $2 and date > $1 order by date desc", [row.date, row.plan])).rows;
    for (const r of later) {
      const next = addDays(r.date, 1);
      await db.query('update calendar_rows set date = $2, updated_at = now() where id = $1', [r.id, next]);
      await recordEdit(db, r.id, 'date', r.date, next, source);
    }
    return pushRow(db, row, 1, source);
  }
  let candidate = addDays(row.date, 1);
  for (let i = 0; i < 60; i++) {
    const taken = (await db.query('select 1 from calendar_rows where date = $1 and id <> $2', [candidate, row.id])).rowCount;
    if (!taken) break;
    candidate = addDays(candidate, 1);
  }
  await db.query('update calendar_rows set date = $2, updated_at = now() where id = $1', [row.id, candidate]);
  await recordEdit(db, row.id, 'date', row.date, candidate, source);
  return candidate;
}

/** The [bracketed] placeholders in a row's publishable fields, in order. */
export function placeholders(row: Pick<CalendarRow, 'dish' | 'caption' | 'cta' | 'hashtags' | 'on_screen_text' | 'creative_instructions' | 'story_ideas' | 'caption_hint'>): string[] {
  const out: string[] = [];
  for (const k of ['dish', 'caption', 'cta', 'hashtags', 'on_screen_text', 'creative_instructions', 'story_ideas', 'caption_hint'] as const) {
    for (const m of (row[k] ?? '').matchAll(/\[([^\]]+)\]/g)) out.push(m[1]!.trim());
  }
  return out;
}

/** The series label the row belongs to, from its theme/template; falls back to the brand line. */
export function seriesLabel(row: Pick<CalendarRow, 'template' | 'theme' | 'type'>): string {
  const t = `${row.template} ${row.theme ?? ''} ${row.type}`.toLowerCase();
  if (t.includes('karahi')) return 'FROM THE KARAHI';
  if (t.includes('fire') || t.includes('bbq') || t.includes('seek') || t.includes('tikka') || t.includes('snack')) return 'FROM THE FIRE';
  if (t.includes('modern') || t.includes('shami') || t.includes('teaser') || t.includes('reveal')) return 'MODERN FUADIJAN';
  if (t.includes('behind') || t.includes('team') || t.includes('people') || t.includes('community') || t.includes('auburn')) return 'BEHIND FUADIJAN';
  return 'ROOTED IN TRADITION';
}

/** URL-safe slug for a pack folder: "chapli-kebab", or the theme for dish-less rows. */
export function daySlug(row: Pick<CalendarRow, 'dish' | 'theme' | 'type'>): string {
  const base = row.dish && !row.dish.startsWith('[') ? row.dish : (row.theme ?? row.type);
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'post';
}

/** A short title: "Day 12 — Chicken Tikka Snack Pack" */
export function rowTitle(row: Pick<CalendarRow, 'day_no' | 'dish' | 'theme' | 'type'>): string {
  const name = row.dish && !row.dish.startsWith('[') ? row.dish : (row.theme ?? row.type);
  return `Day ${row.day_no} — ${name}`;
}
