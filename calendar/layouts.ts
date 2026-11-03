/**
 * The campaign layout of a Calendar sheet: one row per post with `Date` and/or `Day`, `CampaignID`, `ProductID`,
 * `BenefitID`, `Series`, `Format`, `Hook`, `Caption`, `CTA`, `Hashtags`, `Status`, plus any of the post record's
 * columns (src/calendar/record.ts). It is turned into the same rows the classic 18-column sheet gives
 * (calendar.schema.ts), so everything downstream is one path: the series picks the template, the format the slot,
 * the hook becomes the theme the writer reads, and the ids resolve against the tables when the rows are seeded.
 * `Day` may be a number or a weekday: a number gives the date from the first day when there is no `Date`; a weekday
 * is checked against the date, and the days are then numbered in date order.
 */
import { RECORD_COLUMNS, type PostRecord, type RecordField } from '../src/calendar/record.js';
import { templateForSeries } from '../src/render/registry.js';
import { addDays, sydneyDate, type IsoDate } from '../src/time.js';
import { CALENDAR_COLUMNS, cellDate, cellText, cellTime, headerIndex, headerKey, type SheetRow } from './calendar.schema.js';
import type { Cell } from './xlsx.js';

export const CAMPAIGN_LAYOUT_COLUMNS = ['Date', 'Day', 'CampaignID', 'Campaign', 'ProductID', 'Product', 'BenefitID', 'Benefit', 'Series', 'Format', 'Caption', 'CTA', 'Hashtags', 'Status'] as const;

const COLUMN_NAMES = {
  day: ['Day', 'Day No', 'DayNo', '#'],
  weekday: ['Weekday', 'Day Of Week'],
  date: ['Date'],
  time: ['Time', 'Post Time', 'PostTime'],
  campaign: ['CampaignID', 'Campaign'],
  product: ['ProductID', 'Product', 'Dish'],
  benefit: ['BenefitID', 'Benefit'],
  series: ['Series'],
  format: ['Format', 'Slot'],
  status: ['Status'],
  type: ['Type'],
  objective: ['Objective'],
  instructions: ['Creative Instructions', 'Instructions', 'Brief'],
  onScreen: ['On Screen Text', 'OnScreenText'],
  caption: ['Instagram Caption', 'Caption'],
  cta: ['Instagram CTA', 'CTA'],
  hashtags: ['Instagram Hashtags', 'Hashtags'],
  story: ['Story Ideas', 'Story'],
  notes: ['Confirmation Notes', 'Notes'],
} as const;

const KNOWN = new Set<string>([...Object.values(COLUMN_NAMES).flat(), ...Object.values(RECORD_COLUMNS).flat()].map(headerKey));

/** True when the header is not the classic 18 columns but names a post by its campaign, product, series or format. */
export function isCampaignLayout(header: string[]): boolean {
  if (CALENDAR_COLUMNS.every((c, i) => header[i] === c)) return false;
  const col = headerIndex(header);
  const when = col('Date') >= 0 || col(...COLUMN_NAMES.day) >= 0;
  return when && (col(...COLUMN_NAMES.campaign) >= 0 || col('ProductID', 'Product') >= 0 || col('Series') >= 0 || col('Format') >= 0 || col('Hook') >= 0 || col('BenefitID') >= 0);
}

/** The header's columns the layout does not read, so a misspelt column is reported rather than lost. */
export function unreadColumns(header: string[]): string[] {
  return header.filter((h) => h.trim() && !KNOWN.has(headerKey(h)));
}

/** The record's fields a row fills; a blank cell is left out. */
export function readRecord(header: unknown[], row: Cell[]): PostRecord {
  const col = headerIndex(header);
  const out: PostRecord = {};
  for (const [field, names] of Object.entries(RECORD_COLUMNS) as [RecordField, readonly string[]][]) {
    for (const name of names) {
      const i = col(name);
      const v = i >= 0 ? cellText(row[i]) : null;
      if (v) {
        out[field] = v;
        break;
      }
    }
  }
  return out;
}

const slotOf = (format: string | null): SheetRow['slot'] => {
  const f = (format ?? '').trim().toLowerCase();
  if (f.startsWith('r')) return 'reel';
  if (f.startsWith('c')) return 'carousel';
  return 'feed';
};

const statusOf = (s: string | null): SheetRow['status'] => {
  const k = (s ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (!k || k === 'planned' || k === 'draft' || k === 'scheduled') return 'planned';
  if (k === 'photo-needed' || k === 'needs-photo') return 'photo-needed';
  if (k === 'ready' || k === 'done') return 'ready';
  if (k === 'posted' || k === 'published') return 'posted';
  throw new Error(`status "${s}" is not one of planned, photo-needed, ready, posted`);
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const weekdayOf = (date: IsoDate) => new Date(`${date}T00:00:00Z`).getUTCDay();
const weekdayName = (i: number) => WEEKDAYS[i]![0]!.toUpperCase() + WEEKDAYS[i]!.slice(1);

/** A date cell, or text such as 18-Nov, 18 Nov 2026, Nov 18 or 18/11/2026 (day first). Without a year: the first day's year, else the coming date. */
export function sheetDate(cell: unknown, opts: { start?: IsoDate | null; today?: IsoDate } = {}): IsoDate | null {
  const real = cellDate(cell);
  if (real) return real;
  const s = (cellText(cell) ?? '').toLowerCase();
  const numeric = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (numeric) return iso(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
  const dayFirst = s.match(/^(\d{1,2})[\s-]+([a-z]{3})[a-z]*\.?(?:[\s-]+(\d{4}))?$/);
  const monthFirst = s.match(/^([a-z]{3})[a-z]*\.?[\s-]+(\d{1,2})(?:,?\s+(\d{4}))?$/);
  const day = Number(dayFirst?.[1] ?? monthFirst?.[2]);
  const month = MONTHS.indexOf(dayFirst?.[2] ?? monthFirst?.[1] ?? '') + 1;
  const year = dayFirst?.[3] ?? monthFirst?.[3];
  if (!day || !month) return null;
  if (year) return iso(Number(year), month, day);
  if (opts.start) return iso(Number(opts.start.slice(0, 4)), month, day);
  const today = opts.today ?? sydneyDate(new Date());
  const thisYear = iso(Number(today.slice(0, 4)), month, day);
  return Date.parse(thisYear) < Date.parse(today) - 180 * 86_400_000 ? iso(Number(today.slice(0, 4)) + 1, month, day) : thisYear;
}

export interface LayoutOptions {
  /** The date of Day 1 when the sheet has no dates. */
  start?: IsoDate | null;
  today?: IsoDate;
}

/**
 * The sheet's data rows as cleanRow's input, in day order. Throws, naming the sheet row, on a day that is missing
 * or repeated, a weekday that does not match its date, a series that is not one of the labels, or a date it
 * cannot work out.
 */
export function campaignLayoutRows(sheet: Cell[][], opts: LayoutOptions = {}): Record<string, unknown>[] {
  const header = (sheet[0] ?? []).map((v) => String(v ?? '').trim());
  const col = headerIndex(header);
  const iDate = col(...COLUMN_NAMES.date);
  const hasDay = col(...COLUMN_NAMES.day) >= 0;
  if (iDate < 0 && !opts.start) throw new Error('The Calendar has no Date column: give the first day (the date of Day 1) when loading it, or add a Date column.');
  const at = (r: Cell[], names: readonly string[]) => {
    for (const n of names) {
      const i = col(n);
      const v = i >= 0 ? cellText(r[i]) : null;
      if (v) return v;
    }
    return null;
  };
  const out: Record<string, unknown>[] = [];
  const days = new Set<number>();
  sheet.slice(1).forEach((r, i) => {
    if (!r.some((v) => v !== null && v !== undefined && String(v).trim() !== '')) return;
    const dayText = at(r, COLUMN_NAMES.day);
    const dayNumber = dayText && /^\d+$/.test(dayText) && Number(dayText) >= 1 ? Number(dayText) : null;
    const where = `Calendar row ${i + 2}${dayNumber ? ` (Day ${dayNumber})` : ''}`;
    const weekdayText = at(r, COLUMN_NAMES.weekday) ?? (dayNumber ? null : dayText);
    const weekday = weekdayText ? WEEKDAYS.findIndex((w) => w.startsWith(weekdayText.trim().toLowerCase().slice(0, 3))) : -1;
    if (weekdayText && weekday < 0) throw new Error(`${where}: Day "${weekdayText}" is not a day number or a weekday.`);
    if (hasDay && !dayNumber && !weekdayText) throw new Error(`${where}: Day is empty.`);
    if (dayNumber) {
      if (days.has(dayNumber)) throw new Error(`${where}: Day ${dayNumber} appears twice.`);
      days.add(dayNumber);
    }
    const dateCell = iDate >= 0 ? cellText(r[iDate]) : null;
    const date = dateCell ? sheetDate(r[iDate], opts) : dayNumber && opts.start ? addDays(opts.start, dayNumber - 1) : null;
    if (!date) throw new Error(`${where}: ${dateCell ? `the Date "${dateCell}" is not a date` : 'there is no date for this post'}.`);
    if (weekday >= 0 && weekdayOf(date) !== weekday) throw new Error(`${where}: ${date} is a ${weekdayName(weekdayOf(date))}, but the sheet says ${weekdayName(weekday)}.`);
    const series = at(r, COLUMN_NAMES.series);
    const product = at(r, COLUMN_NAMES.product);
    const benefit = at(r, COLUMN_NAMES.benefit);
    let template: string | null = null;
    if (series) {
      template = templateForSeries(series);
      if (!template) throw new Error(`${where}: series "${series}" is not one on the Templates sheet.`);
    }
    if (!template) template = benefit && !product ? 'for-our-customers' : 'from-the-fire';
    let status: SheetRow['status'];
    try {
      status = statusOf(at(r, COLUMN_NAMES.status));
    } catch (e) {
      throw new Error(`${where}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const content = readRecord(header, r);
    const timeCol = col(...COLUMN_NAMES.time);
    out.push({
      day: dayNumber,
      date,
      slot: slotOf(at(r, COLUMN_NAMES.format)),
      type: at(r, COLUMN_NAMES.type) ?? (benefit && !product ? 'benefit' : product ? 'hero-dish' : 'community'),
      dish: product,
      theme: content.hook ?? null,
      caption_hint: null,
      post_time: timeCol >= 0 ? cellTime(r[timeCol]) : null,
      template,
      status,
      asset: null,
      objective: at(r, COLUMN_NAMES.objective),
      creative_instructions: at(r, COLUMN_NAMES.instructions),
      on_screen_text: at(r, COLUMN_NAMES.onScreen),
      caption: at(r, COLUMN_NAMES.caption),
      cta: at(r, COLUMN_NAMES.cta),
      hashtags: at(r, COLUMN_NAMES.hashtags)?.replace(/\s+/g, ' ') ?? null,
      story_ideas: at(r, COLUMN_NAMES.story),
      confirmation_notes: at(r, COLUMN_NAMES.notes),
      campaign: at(r, COLUMN_NAMES.campaign),
      benefit,
      content,
    });
  });
  // Numbered days keep their numbers. A sheet with only dates is put in date order, and the seed matches each post
  // to the month's existing post on that date (by_date), so a partial sheet never lands on the wrong day.
  if (out.every((o) => o.day != null)) return out.sort((a, b) => (a.day as number) - (b.day as number));
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date))).map((o, i) => ({ ...o, day: i + 1, by_date: true }));
}
