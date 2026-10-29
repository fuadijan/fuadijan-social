/**
 * npm run seed-calendar
 *
 * Reads sheet `Calendar` of calendar/Fuadijan-Posts-Calendar.xlsx (18 columns, 30 rows) into calendar_rows,
 * keyed by day_no (row order). Idempotent: an existing row is updated field by field, but a field the owner
 * has edited (calendar_edits with a non-seed source) is never overwritten. Prints the Read Me sheet and every
 * [bracketed] placeholder so the owner sees what he'll be asked.
 */
import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import { config } from '../src/config.js';
import { createDatabaseIfMissing, createPool, inTransaction } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { placeholders } from '../src/calendar/rows.js';
import { templateKeyFor } from '../src/render/registry.js';
import { addDays, daysBetween } from '../src/time.js';
import { CALENDAR_COLUMNS, cleanRow, type CalendarColumn, type SheetRow } from './calendar.schema.js';
import { readSheetRows } from './xlsx.js';

export const WORKBOOK_PATH = 'calendar/Fuadijan-Posts-Calendar.xlsx';

export interface Workbook {
  rows: SheetRow[];
  readMe: string[];
}

export async function readWorkbook(path = WORKBOOK_PATH): Promise<Workbook> {
  const sheet = await readSheetRows(path, 'Calendar');
  const header = (sheet[0] ?? []).map((v) => String(v ?? '').trim());
  const expected = [...CALENDAR_COLUMNS];
  if (header.length !== expected.length || header.some((h, i) => h !== expected[i])) {
    throw new Error(`Calendar header is not the 18 expected columns.
  got:      ${header.join(', ')}
  expected: ${expected.join(', ')}`);
  }
  const rows: SheetRow[] = [];
  for (const values of sheet.slice(1)) {
    if (!values.some((v) => v !== null && v !== undefined && String(v).trim() !== '')) continue;
    const raw = {} as Record<CalendarColumn, unknown>;
    CALENDAR_COLUMNS.forEach((col, i) => { raw[col] = values[i] ?? null; });
    rows.push(cleanRow(raw, rows.length + 1));
  }
  const readMe: string[] = [];
  try {
    for (const row of await readSheetRows(path, 'Read Me')) {
      const cells = row.map((v) => (v == null ? '' : String(v).trim())).filter(Boolean);
      if (cells.length) readMe.push(cells.join(' — '));
    }
  } catch {
    // No Read Me sheet: nothing to print.
  }
  return { rows, readMe };
}

export interface SeedResult {
  inserted: number;
  updated: number;
  protectedFields: { day_no: number; field: string }[];
}

/**
 * Writes the rows. CALENDAR_START shifts every date by the same offset when it differs from the sheet's first
 * date (dates are stored, so later pushes and skips just edit `date`).
 */
export async function seedRows(pool: pg.Pool, rows: SheetRow[], calendarStart: string = config.calendarStart): Promise<SeedResult> {
  if (!rows.length) throw new Error('No rows to seed.');
  for (const r of rows) templateKeyFor(r.template); // throws on an unmapped template
  const offset = daysBetween(rows[0]!.date, calendarStart);
  const result: SeedResult = { inserted: 0, updated: 0, protectedFields: [] };
  await inTransaction(pool, async (c) => {
    for (const r of rows) {
      const date = offset ? addDays(r.date, offset) : r.date;
      const existing = (await c.query<Record<string, unknown> & { id: number }>(
        "select id, to_char(date, 'YYYY-MM-DD') as date, slot, type, dish, theme, caption_hint, to_char(post_time, 'HH24:MI') as post_time, template, status, asset, objective, creative_instructions, on_screen_text, caption, cta, hashtags, story_ideas, confirmation_notes from calendar_rows where day_no = $1",
        [r.day_no])).rows[0];
      const values: Record<string, string | null> = { ...r, date, day_no: undefined as unknown as string };
      delete (values as Record<string, unknown>).day_no;
      if (!existing) {
        await c.query(
          `insert into calendar_rows (day_no, date, slot, type, dish, theme, caption_hint, post_time, template, status, asset, objective, creative_instructions, on_screen_text, caption, cta, hashtags, story_ideas, confirmation_notes)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
          [r.day_no, date, r.slot, r.type, r.dish, r.theme, r.caption_hint, r.post_time, r.template, r.status, r.asset, r.objective, r.creative_instructions, r.on_screen_text, r.caption, r.cta, r.hashtags, r.story_ideas, r.confirmation_notes]);
        result.inserted++;
        continue;
      }
      const edited = new Set((await c.query<{ field: string }>("select distinct field from calendar_edits where row_id = $1 and source <> 'seed'", [existing.id])).rows.map((x) => x.field));
      let changed = false;
      for (const [field, value] of Object.entries(values)) {
        const current = (existing[field] as string | null | undefined) ?? null;
        if ((current ?? null) === (value ?? null)) continue;
        if (edited.has(field) || (field === 'date' && edited.has('date')) || (field === 'status' && edited.has('status'))) {
          result.protectedFields.push({ day_no: r.day_no, field });
          continue;
        }
        await c.query(`update calendar_rows set ${field} = $2, updated_at = now() where id = $1`, [existing.id, value]);
        await c.query("insert into calendar_edits (row_id, field, old_value, new_value, source) values ($1, $2, $3, $4, 'seed')", [existing.id, field, current, value]);
        changed = true;
      }
      if (changed) result.updated++;
    }
  });
  return result;
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
    const { rows, readMe } = await readWorkbook();
    console.log(`Read ${rows.length} rows from ${WORKBOOK_PATH}.`);
    console.log('\nRead Me:');
    for (const l of readMe) console.log(`  ${l}`);
    await createDatabaseIfMissing(config.databaseUrl);
    const pool = createPool(config.databaseUrl);
    try {
      await migrate(pool, () => {});
      const res = await seedRows(pool, rows);
      console.log(`\nSeeded: ${res.inserted} inserted, ${res.updated} updated.`);
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
