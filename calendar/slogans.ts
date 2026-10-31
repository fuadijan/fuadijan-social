/**
 * The Slogans sheet: `Item | Slogan | Line | Caption`, one slogan per row, as a sheet named "Slogans" in the monthly
 * plan workbook and/or in calendar/Fuadijan-Slogans.xlsx. `npm run seed-calendar` loads both (idempotent: the same
 * item + slogan updates its line and caption rather than duplicating). Item "all" applies to every post.
 */
import { existsSync } from 'node:fs';
import type pg from 'pg';
import { readSheetRows } from './xlsx.js';
import { WORKBOOK_PATH } from './seed.js';
import { addSlogan } from '../src/slogans.js';

export const SLOGANS_PATH = 'calendar/Fuadijan-Slogans.xlsx';
export const SLOGAN_COLUMNS = ['Item', 'Slogan', 'Line', 'Caption'] as const;

export interface SloganRow { item: string; headline: string; line: string | null; caption: string | null; from: string }

const text = (v: unknown): string => (v == null ? '' : String(v)).replace(/\r\n?/g, '\n').trim();

/** The slogans of one sheet; [] when the file or the sheet is missing; throws on a wrong header. */
export async function readSlogansSheet(path: string, sheetName = 'Slogans'): Promise<SloganRow[]> {
  if (!existsSync(path)) return [];
  let rows;
  try {
    rows = await readSheetRows(path, sheetName);
  } catch (e) {
    if (e instanceof Error && /not found/.test(e.message)) return [];
    throw e;
  }
  const header = (rows[0] ?? []).map((v) => text(v).toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const iItem = col('Item');
  const iSlogan = col('Slogan');
  if (iItem < 0 || iSlogan < 0) throw new Error(`${path} sheet "${sheetName}": the header needs at least the columns Item and Slogan (then optional Line, Caption); got: ${header.join(', ')}`);
  const iLine = col('Line');
  const iCaption = col('Caption');
  const out: SloganRow[] = [];
  for (const r of rows.slice(1)) {
    const item = text(r[iItem]);
    const headline = text(r[iSlogan]);
    if (!item || !headline) continue;
    out.push({ item, headline, line: iLine >= 0 ? text(r[iLine]) || null : null, caption: iCaption >= 0 ? text(r[iCaption]) || null : null, from: path });
  }
  return out;
}

/** Everything in the plan workbook's Slogans sheet and the separate slogan workbook. */
export async function readSlogans(paths: string[] = [WORKBOOK_PATH, SLOGANS_PATH]): Promise<SloganRow[]> {
  const out: SloganRow[] = [];
  for (const p of paths) out.push(...await readSlogansSheet(p));
  return out;
}

export async function seedSlogans(pool: pg.Pool, rows: SloganRow[]): Promise<{ loaded: number; items: number }> {
  const items = new Set<string>();
  for (const r of rows) {
    await addSlogan(pool, { item: r.item, headline: r.headline, line: r.line, caption: r.caption, source: 'sheet' });
    items.add(r.item.toLowerCase());
  }
  return { loaded: rows.length, items: items.size };
}
