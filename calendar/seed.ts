/**
 * npm run seed-calendar [-- --file calendar/December.xlsx]
 *
 * Reads sheet `Calendar` of the workbook (18 columns, 30 rows) into calendar_rows, keyed by (plan, day_no) where
 * the plan is the month of the workbook's first date: a new month's workbook is added beside the running one,
 * never over it. Idempotent within a plan: an existing row is updated field by field, but a field the owner has
 * edited (calendar_edits with a non-seed source) is never overwritten. Also loads the Slogans sheet(s). Prints the
 * Read Me sheet and every [bracketed] placeholder so the owner sees what he'll be asked.
 */
import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import { config } from '../src/config.js';
import { createDatabaseIfMissing, createPool, inTransaction } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { placeholders } from '../src/calendar/rows.js';
import { templateKeyFor } from '../src/render/registry.js';
import { addDays, daysBetween } from '../src/time.js';
import { z } from 'zod';
import { CALENDAR_COLUMNS, OPTIONAL_COLUMNS, cellDate, cleanRow, headerKey, type CalendarColumn, type OptionalColumn, type SheetRow } from './calendar.schema.js';
import { findCampaign } from '../src/campaigns.js';
import { findProduct } from '../src/products.js';
import { findBenefit } from '../src/benefits.js';
import { REFERENCE_SHEETS, storeReference, type ReferenceSheet } from '../src/reference.js';
import { campaignLayoutRows, isCampaignLayout, readRecord, unreadColumns } from './layouts.js';
import { RECORD_COLUMNS } from '../src/calendar/record.js';
import { readSheetRows, sheetNames, type WorkbookSource } from './xlsx.js';

export const WORKBOOK_PATH = 'calendar/Fuadijan-Posts-Calendar.xlsx';

export interface Workbook {
  rows: SheetRow[];
  readMe: string[];
  /** Columns the sheet has that nothing reads, reported so a misspelling is not lost. */
  unread: string[];
}

const RECORD_HEADERS = new Set(Object.values(RECORD_COLUMNS).flat().map(headerKey));

/** The same object whatever order its keys come back in, for comparing a sheet's record with the stored jsonb. */
const stableJson = (v: unknown): string | null => (v == null ? null : JSON.stringify(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))));

export interface ReadOptions {
  /** The date of Day 1 for a campaign-layout sheet that has no Date column. */
  start?: string | null;
}

/** Says which row is wrong in the sheet's own terms (its row number and day), not zod's. */
function rowError(e: unknown, sheetRow: number, day: number): Error {
  const issues = e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : (e instanceof Error ? e.message : String(e));
  return new Error(`Calendar row ${sheetRow} (Day ${day}): ${issues}`);
}

/** What the calendar sheet may be called, and the other sheets the app reads or knows are for people. */
const CALENDAR_SHEETS = ['Calendar', 'Content Records', 'Operational Calendar', 'Content Calendar'];
const READ_SHEETS = new Set([...CALENDAR_SHEETS, 'Campaigns', 'Products', 'Benefits', 'Customer Benefits', 'Slogans', 'Read Me', 'Columns', 'Templates']);

async function calendarSheetOf(source: WorkbookSource): Promise<string | null> {
  const names = await sheetNames(source);
  return CALENDAR_SHEETS.find((n) => names.includes(n)) ?? null;
}

export async function readWorkbook(path: WorkbookSource = WORKBOOK_PATH, opts: ReadOptions = {}): Promise<Workbook> {
  const sheet = await readSheetRows(path, (await calendarSheetOf(path)) ?? 'Calendar');
  const header = (sheet[0] ?? []).map((v) => String(v ?? '').trim());
  const expected = [...CALENDAR_COLUMNS];
  if (isCampaignLayout(header)) {
    // The campaign layout (Day | CampaignID | ProductID | BenefitID | Series | Format | Hook | Caption | CTA | Hashtags | Status).
    const rows: SheetRow[] = [];
    for (const raw of campaignLayoutRows(sheet, { start: opts.start })) {
      try {
        rows.push(cleanRow(raw as Parameters<typeof cleanRow>[0], raw.day as number));
      } catch (e) {
        throw rowError(e, rows.length + 2, raw.day as number);
      }
    }
    if (!rows.length) throw new Error('The Calendar sheet has no rows under the header.');
    return { rows, readMe: await readMeOf(path), unread: unreadColumns(header) };
  }
  if (header.length < expected.length || expected.some((h, i) => h !== header[i])) {
    throw new Error(`Calendar header is not the 18 expected columns.
  got:      ${header.join(', ')}
  expected: ${expected.join(', ')}`);
  }
  // After the 18, optional columns in any order (campaign); anything else is a mistake worth naming.
  const extra = header.slice(expected.length).map((h) => h.toLowerCase());
  const unknown = extra.filter((h) => h && !(OPTIONAL_COLUMNS as readonly string[]).includes(h) && !RECORD_HEADERS.has(headerKey(h)));
  if (unknown.length) throw new Error(`Calendar has columns the app does not know: ${unknown.join(', ')}. After the 18, only ${OPTIONAL_COLUMNS.join(', ')} and the post record's columns may follow.`);
  const optionalAt = new Map<OptionalColumn, number>();
  extra.forEach((h, i) => { if ((OPTIONAL_COLUMNS as readonly string[]).includes(h)) optionalAt.set(h as OptionalColumn, expected.length + i); });
  const hasRecord = extra.some((h) => RECORD_HEADERS.has(headerKey(h)));
  const rows: SheetRow[] = [];
  for (const values of sheet.slice(1)) {
    if (!values.some((v) => v !== null && v !== undefined && String(v).trim() !== '')) continue;
    const raw = {} as Record<CalendarColumn, unknown> & Partial<Record<OptionalColumn, unknown>> & { content?: unknown };
    CALENDAR_COLUMNS.forEach((col, i) => { raw[col] = values[i] ?? null; });
    for (const [col, i] of optionalAt) raw[col] = values[i] ?? null;
    if (hasRecord) raw.content = readRecord(header, values);
    try {
      rows.push(cleanRow(raw, rows.length + 1));
    } catch (e) {
      throw rowError(e, rows.length + 2, rows.length + 1);
    }
  }
  if (!rows.length) throw new Error('The Calendar sheet has no rows under the header.');
  return { rows, readMe: await readMeOf(path), unread: [] };
}

async function readMeOf(path: WorkbookSource): Promise<string[]> {
  const readMe: string[] = [];
  try {
    for (const row of await readSheetRows(path, 'Read Me')) {
      const cells = row.map((v) => (v == null ? '' : String(v).trim())).filter(Boolean);
      if (cells.length) readMe.push(cells.join(' — '));
    }
  } catch {
    // No Read Me sheet: nothing to print.
  }
  return readMe;
}

/** A serial day number in a date column reads as a date; everything else as its text. */
function referenceCell(header: string, v: unknown): string {
  if (typeof v === 'number' && /date|week start|week end|^start|^end/i.test(header)) return cellDate(v) ?? String(v);
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').trim();
}

/** The workbook's planning sheets, whole. A Read Me laid out as Topic | Working Rule is kept as the Working Rules. */
async function readReference(source: WorkbookSource, names: string[]): Promise<ReferenceSheet[]> {
  const out: ReferenceSheet[] = [];
  const take = async (sheet: string, as: string) => {
    const rows = (await readSheetRows(source, sheet)).filter((r) => r.some((c) => c !== null && String(c).trim() !== ''));
    if (rows.length < 2) return;
    const header = rows[0]!.map((c) => String(c ?? '').trim());
    out.push({ name: as, source: null, header, rows: rows.slice(1).map((r) => header.map((h, i) => referenceCell(h, r[i]))) });
  };
  for (const n of names) if (REFERENCE_SHEETS.includes(n)) await take(n, n);
  if (names.includes('Read Me') && String((await readSheetRows(source, 'Read Me')).find((r) => r.some((c) => c != null))?.[0] ?? '').trim().toLowerCase() === 'topic') await take('Read Me', 'Working Rules');
  return out;
}

/** True when the workbook has a Calendar sheet at all (a workbook of campaigns, products or benefits alone has none). */
export async function hasCalendarSheet(path: WorkbookSource): Promise<boolean> {
  return (await calendarSheetOf(path)) !== null;
}

export interface SeedResult {
  /** The month the rows went to; null when the workbook had no Calendar sheet. */
  plan: string | null;
  inserted: number;
  updated: number;
  protectedFields: { day_no: number; field: string }[];
  /** Days left as they were because they had started (a photo received, or no longer "planned"); keepStarted only. */
  kept: number[];
}

export interface SeedOptions {
  /** Leave a day alone when its row already has a photo or has moved past "planned": a plan laid over a running month. */
  keepStarted?: boolean;
}

/** The plan a workbook belongs to: the month of its first date. */
export const planOf = (firstDate: string): string => firstDate.slice(0, 7);

/**
 * Writes the rows under the plan named by the workbook's first date. CALENDAR_START shifts every date by the same
 * offset only when it falls in the same month as the sheet's first date (the first month's workbook was written
 * with a sample start); a workbook for another month is taken as written.
 */
export async function seedRows(pool: pg.Pool, rows: SheetRow[], calendarStart: string = config.calendarStart, opts: SeedOptions = {}): Promise<SeedResult> {
  if (!rows.length) throw new Error('No rows to seed.');
  for (const r of rows) templateKeyFor(r.template); // throws on an unmapped template
  if (rows.some((r) => r.campaign) && !(await campaignsTableExists(pool))) throw new Error('The database has no campaigns table yet: run the migrations first.');
  const offset = planOf(rows[0]!.date) === planOf(calendarStart) ? daysBetween(rows[0]!.date, calendarStart) : 0;
  const plan = planOf(offset ? addDays(rows[0]!.date, offset) : rows[0]!.date);
  const result: SeedResult = { plan, inserted: 0, updated: 0, protectedFields: [], kept: [] };
  await inTransaction(pool, async (c) => {
    const onDate = new Map<string, number>();
    for (const sheetRow of rows) {
      const date = offset ? addDays(sheetRow.date, offset) : sheetRow.date;
      // A sheet with only dates: the post with the same PostID, else the post already on that date (the nth of that
      // date) that no other PostID holds, else the next free day. So a second post on a date is added beside the first.
      let dayNo = sheetRow.day_no;
      if (sheetRow.by_date) {
        const postId = (sheetRow.content as { content_id?: string } | null)?.content_id?.trim() || null;
        const named = postId ? (await c.query<{ day_no: number }>("select day_no from calendar_rows where plan = $1 and custom is null and content->>'content_id' = $2 order by day_no", [plan, postId])).rows[0] : undefined;
        if (named) dayNo = named.day_no;
        else {
          const nth = onDate.get(date) ?? 0;
          onDate.set(date, nth + 1);
          const same = (await c.query<{ day_no: number }>(
            "select day_no from calendar_rows where plan = $1 and date = $2 and custom is null and ($3::text is null or coalesce(content->>'content_id', '') = '') order by (status = 'planned') desc, day_no",
            [plan, date, postId])).rows[nth];
          dayNo = same?.day_no ?? (await c.query<{ n: number }>('select coalesce(max(day_no), 0)::int + 1 as n from calendar_rows where plan = $1 and day_no < 101', [plan])).rows[0]!.n;
        }
      }
      const r = { ...sheetRow, day_no: dayNo };
      const existing = (await c.query<Record<string, unknown> & { id: number }>(
        "select id, to_char(date, 'YYYY-MM-DD') as date, slot, type, dish, theme, caption_hint, to_char(post_time, 'HH24:MI') as post_time, template, status, asset, objective, creative_instructions, on_screen_text, caption, cta, hashtags, story_ideas, confirmation_notes, campaign_id, benefit, content from calendar_rows where plan = $1 and day_no = $2",
        [plan, r.day_no])).rows[0];
      // The campaign column names a campaign by id or name; the dish may be a ProductID (P004) from the Products sheet.
      let campaignId: number | null = null;
      if (r.campaign) {
        const campaign = await findCampaign(c, r.campaign);
        if (!campaign) throw new Error(`Day ${r.day_no}: campaign "${r.campaign}" is not on the Campaigns sheet or in the app.`);
        campaignId = campaign.id;
      }
      let dish = r.dish;
      if (dish && /^[a-z]+[-_]?\d+$/i.test(dish.trim())) {
        const product = await findProduct(c, dish.trim());
        if (!product) throw new Error(`Day ${r.day_no}: dish "${dish}" looks like a ProductID but is not on the Products sheet or in the app.`);
        dish = product.name;
      }
      // A benefit by id (BEN001) becomes its words; words are kept as written.
      let benefit = r.benefit;
      if (benefit && /^[a-z]+[-_]?\d+$/i.test(benefit.trim())) {
        const known = await findBenefit(c, benefit.trim());
        if (!known) throw new Error(`Day ${r.day_no}: benefit "${benefit}" looks like a BenefitID but is not on the Benefits sheet or in the app.`);
        benefit = known.benefit;
      }
      const content = r.content ? JSON.stringify(r.content) : null;
      const values: Record<string, string | number | null> = { ...r, date, dish, benefit, content, campaign_id: campaignId, day_no: undefined as unknown as string, campaign: undefined as unknown as string, by_date: undefined as unknown as string };
      delete (values as Record<string, unknown>).day_no;
      delete (values as Record<string, unknown>).campaign;
      delete (values as Record<string, unknown>).by_date;
      if (!existing) {
        await c.query(
          `insert into calendar_rows (plan, day_no, date, slot, type, dish, theme, caption_hint, post_time, template, status, asset, objective, creative_instructions, on_screen_text, caption, cta, hashtags, story_ideas, confirmation_notes, campaign_id, benefit, content)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`,
          [plan, r.day_no, date, r.slot, r.type, dish, r.theme, r.caption_hint, r.post_time, r.template, r.status, r.asset, r.objective, r.creative_instructions, r.on_screen_text, r.caption, r.cta, r.hashtags, r.story_ideas, r.confirmation_notes, campaignId, benefit, content]);
        result.inserted++;
        continue;
      }
      if (opts.keepStarted) {
        const started = existing.status !== 'planned'
          || Number((await c.query<{ n: string }>('select count(*) n from assets where calendar_row_id = $1', [existing.id])).rows[0]!.n) > 0;
        if (started) {
          result.kept.push(r.day_no);
          continue;
        }
      }
      const edited = new Set((await c.query<{ field: string }>("select distinct field from calendar_edits where row_id = $1 and source <> 'seed'", [existing.id])).rows.map((x) => x.field));
      // What the owner changed in a post's record stays theirs; the rest of the record follows the workbook.
      const ownRecord = [...edited].filter((f) => f.startsWith('content.')).map((f) => f.slice('content.'.length));
      const record = r.content && ownRecord.length ? { ...(r.content as Record<string, unknown>) } : r.content;
      if (record && ownRecord.length) {
        const had = (existing.content ?? {}) as Record<string, unknown>;
        for (const k of ownRecord) {
          if (had[k] === undefined) delete (record as Record<string, unknown>)[k];
          else (record as Record<string, unknown>)[k] = had[k];
        }
        values.content = JSON.stringify(record);
      }
      let changed = false;
      for (const [field, value] of Object.entries(values)) {
        const current = (field === 'content' ? (existing.content ? JSON.stringify(existing.content) : null) : existing[field] as string | number | null | undefined) ?? null;
        const same = field === 'content' ? stableJson(existing.content) === stableJson(record) : (current ?? null) === (value ?? null);
        if (same) continue;
        if (edited.has(field) || (field === 'date' && edited.has('date')) || (field === 'status' && edited.has('status'))) {
          result.protectedFields.push({ day_no: r.day_no, field });
          continue;
        }
        await c.query(`update calendar_rows set ${field} = $2, updated_at = now() where id = $1`, [existing.id, value]);
        await c.query("insert into calendar_edits (row_id, field, old_value, new_value, source) values ($1, $2, $3, $4, 'seed')", [existing.id, field, current == null ? null : String(current), value == null ? null : String(value)]);
        changed = true;
      }
      if (changed) result.updated++;
    }
  });
  return result;
}

async function campaignsTableExists(pool: pg.Pool): Promise<boolean> {
  return Boolean((await pool.query<{ ok: boolean }>("select to_regclass('campaigns') is not null as ok")).rows[0]?.ok);
}

/**
 * Everything a month's workbook carries, loaded in the order the rows need: campaigns and products first (a row
 * may name them), then the rows, then the slogans. Shared by the command line and the web app's import.
 */
export async function loadWorkbook(pool: pg.Pool, source: WorkbookSource, opts: SeedOptions & ReadOptions & { calendarStart?: string; sourceName?: string } = {}): Promise<WorkbookLoad> {
  const { readCampaignsSheet, seedCampaigns } = await import('./campaigns.js');
  const { readProductsSheet, seedProducts } = await import('./products.js');
  const { readBenefitsSheet, seedBenefits } = await import('./benefits.js');
  const { readSlogansSheet, seedSlogans } = await import('./slogans.js');
  // Everything is read and checked before anything is written.
  const withCalendar = await hasCalendarSheet(source);
  const { rows, readMe, unread } = withCalendar ? await readWorkbook(source, { start: opts.start }) : { rows: [] as SheetRow[], readMe: await readMeOf(source), unread: [] as string[] };
  const campaigns = await readCampaignsSheet(source);
  const products = await readProductsSheet(source);
  const benefits = await readBenefitsSheet(source);
  const slogans = await readSlogansSheet(source);
  const names = await sheetNames(source);
  const reference = await readReference(source, names);
  if (!withCalendar && !campaigns.length && !products.length && !benefits.length && !slogans.length && !reference.length) {
    throw new Error('The workbook has none of the sheets the app reads: Calendar, Campaigns, Products, Benefits, Slogans.');
  }
  const unreadSheets = names.filter((n) => !READ_SHEETS.has(n) && !REFERENCE_SHEETS.includes(n));
  await seedCampaigns(pool, campaigns);
  await seedProducts(pool, products);
  await seedBenefits(pool, benefits);
  for (const s of reference) await storeReference(pool, { ...s, source: opts.sourceName ?? null });
  const result: SeedResult = rows.length ? await seedRows(pool, rows, opts.calendarStart ?? rows[0]!.date, opts) : { plan: null, inserted: 0, updated: 0, protectedFields: [], kept: [] };
  const loaded = await seedSlogans(pool, slogans);
  return { ...result, rows: rows.length, from: rows[0]?.date ?? null, to: rows[rows.length - 1]?.date ?? null, campaigns: campaigns.length, products: products.length, benefits: benefits.length, slogans: loaded, placeholders: placeholderReport(rows), unread, unreadSheets, reference: reference.map((s) => s.name), readMe, sheetRows: rows };
}

export interface WorkbookLoad extends SeedResult {
  rows: number;
  from: string | null;
  to: string | null;
  campaigns: number;
  products: number;
  benefits: number;
  unread: string[];
  /** Sheets in the workbook the app has no place for yet. */
  unreadSheets: string[];
  /** Planning sheets kept whole (src/reference.ts). */
  reference: string[];
  slogans: { loaded: number; items: number };
  placeholders: string[];
  readMe: string[];
  sheetRows: SheetRow[];
}

export function placeholderReport(rows: SheetRow[]): string[] {
  const lines: string[] = [];
  for (const r of rows) {
    const ph = placeholders(r);
    if (ph.length) lines.push(`Day ${String(r.day_no).padStart(2)} (${r.date}, ${r.slot}): ${ph.map((p) => `[${p}]`).join('  ')}`);
  }
  return lines;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  (async () => {
    const fileArg = process.argv.indexOf('--file');
    const path = fileArg >= 0 && process.argv[fileArg + 1] ? process.argv[fileArg + 1]! : WORKBOOK_PATH;
    const startArg = process.argv.indexOf('--start');
    const start = startArg >= 0 ? process.argv[startArg + 1] ?? null : null;
    await createDatabaseIfMissing(config.databaseUrl);
    const pool = createPool(config.databaseUrl);
    try {
      await migrate(pool, () => {});
      const res = await loadWorkbook(pool, path, { calendarStart: config.calendarStart, start });
      const rows = res.sheetRows;
      console.log(`Read ${rows.length} rows from ${path}.`);
      console.log('\nRead Me:');
      for (const l of res.readMe) console.log(`  ${l}`);
      console.log(res.plan ? `\nPlan ${res.plan}: ${res.inserted} inserted, ${res.updated} updated.` : '\nNo Calendar sheet: no days loaded.');
      if (res.campaigns || res.products || res.benefits) console.log(`Campaigns: ${res.campaigns}. Products: ${res.products}. Benefits: ${res.benefits}.`);
      const { readSlogans, seedSlogans, SLOGANS_PATH } = await import('./slogans.js');
      const more = await seedSlogans(pool, await readSlogans([...new Set([WORKBOOK_PATH, SLOGANS_PATH].filter((p) => p !== path))]));
      const slogans = { loaded: res.slogans.loaded + more.loaded, items: res.slogans.items + more.items };
      console.log(slogans.loaded ? `Slogans: ${slogans.loaded} loaded for ${slogans.items} item${slogans.items === 1 ? '' : 's'}.` : `Slogans: none (add a "Slogans" sheet to the plan workbook or fill ${SLOGANS_PATH}).`);
      if (res.protectedFields.length) {
        console.log('Left alone (edited by the owner):');
        for (const p of res.protectedFields) console.log(`  Day ${p.day_no} ${p.field}`);
      }
      console.log('\n day  date        slot      template               dish');
      for (const r of rows) console.log(`  ${String(r.day_no).padStart(2)}  ${r.date}  ${r.slot.padEnd(8)}  ${r.template.padEnd(21)}  ${r.dish ?? '(choose by rotation)'}`);
      console.log('\nPlaceholders the owner will be asked about:');
      for (const l of placeholderReport(rows)) console.log(`  ${l}`);
    } finally {
      await pool.end();
    }
  })().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
